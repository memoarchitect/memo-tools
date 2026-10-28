// ─── Running a project's calculations ────────────────────────────────────────
//
// A project uses a calculation by declaring a usage (`calc costLap : ProcedureCost { in workflow = wfLap; }`)
// and compares alternatives with a native `TradeStudy`. This evaluates each of them over the built model:
// every calculation usage with the inputs it binds, and every trade study by scoring each of its
// alternatives with its evaluation function and choosing by its objective. A calculation the evaluator
// cannot run is reported with the reason, not skipped.

import type { ApiElement } from '../../stage2/api-model.js';
import type { ProjectModel } from '../../toolchain/project-model.js';
import { makeKindConformance } from '../../model/complete-model.js';
import { CalcReader, type Expr } from './calc-ast.js';
import { CalcEvaluator, flatten, UnsupportedCalculation, type CalcResult, type Value } from './calc-eval.js';
import { formatQuantity, isQuantity } from './units.js';

export interface CalculationOutcome {
    id: string;
    name: string;
    /** The calculation definition it is a usage of. */
    calc: string;
    /** The result as text, or the reason it could not be run. */
    result: string;
    ok: boolean;
}

export interface TradeStudyOutcome {
    id: string;
    name: string;
    objective: string;
    scores: { alternative: string; score: string }[];
    selected?: string;
    ok: boolean;
    error?: string;
}

export interface CalculationReport { calculations: CalculationOutcome[]; studies: TradeStudyOutcome[] }

const idOf = (reference: unknown): string => {
    const value = reference as { '@id'?: string } | string;
    return typeof value === 'string' ? value : value?.['@id'] ?? '';
};

export function show(value: Value): string {
    const items = flatten(value);
    if (items.length === 0) return '(empty)';
    return items.map(item => isQuantity(item) ? formatQuantity(item)
        : typeof item === 'number' ? formatQuantity(item)
        : typeof item === 'object' && 'id' in item ? item.name
        : typeof item === 'object' ? JSON.stringify(item)
        : String(item)).join(', ');
}

export function evaluateCalculations(project: ProjectModel): CalculationReport {
    const { api, model, registries } = project;
    const reader = new CalcReader(api);
    const definitions = reader.definitions();
    const conforms = makeKindConformance(model.elements, registries?.kindRegistry);
    const evaluator = new CalcEvaluator(api, model, conforms, definitions, reader);
    const projectIds = new Set<string>();
    for (const element of api.projectElements()) projectIds.add(element['@id']);

    const owned = (id: string) => api.ownedMembers(id);
    const nameOf = (id: string) => api.name(id) ?? api.declaredName(id) ?? '';
    const typeOf = (id: string) => api.types(id).map(t => api.qualifiedName(t['@id']) ?? '')[0] ?? '';

    /** The inputs a usage binds: each `in x = expr`, evaluated in `env`. */
    const bindInputs = (usage: ApiElement, env: Map<string, Value>) => owned(usage['@id'])
        .filter(member => member.direction === 'in')
        .map(member => {
            const expr = reader.valueOf(member['@id']);
            return { name: nameOf(member['@id']), value: expr ? evaluator.eval(expr, env) : [] as Value };
        })
        .filter(input => input.name);

    const runUsage = (usage: ApiElement, env: Map<string, Value>): CalcResult => {
        const definition = definitions.get(typeOf(usage['@id']));
        if (!definition) throw new UnsupportedCalculation(`no calculation definition ${typeOf(usage['@id'])}`);
        const value = evaluator.invoke(definition, bindInputs(usage, env));
        return { named: { [definition.returnName ?? 'result']: value } };
    };

    const calculations: CalculationOutcome[] = [];
    for (const usage of api.ofType('CalculationUsage')) {
        const id = usage['@id'];
        const owner = api.owner(id);
        if (!projectIds.has(id) || owner?.['@type'] !== 'Package' || !definitions.has(typeOf(id))) continue;
        const outcome: CalculationOutcome = { id: api.qualifiedName(id) ?? nameOf(id), name: nameOf(id), calc: typeOf(id).split('::').pop() ?? '', result: '', ok: true };
        try { outcome.result = show(Object.values(runUsage(usage, new Map()).named)[0] ?? []); }
        catch (error) { outcome.ok = false; outcome.result = (error as Error).message; }
        calculations.push(outcome);
    }

    const studies: TradeStudyOutcome[] = [];
    for (const study of api.ofType('AnalysisCaseUsage')) {
        const id = study['@id'];
        if (!projectIds.has(id) || api.owner(id)?.['@type'] !== 'Package' || !typeOf(id).endsWith('TradeStudy')) continue;
        const outcome: TradeStudyOutcome = { id: api.qualifiedName(id) ?? nameOf(id), name: nameOf(id), objective: '', scores: [], ok: true };
        try {
            const members = owned(id);
            const subject = members.find(m => api.name(m['@id']) === 'studyAlternatives' || api.owner(m['@id'])?.['@id'] === id && m['@type'] === 'ReferenceUsage' && reader.valueOf(m['@id']));
            const alternatives = subject && reader.valueOf(subject['@id']) ? flatten(evaluator.eval(reader.valueOf(subject['@id'])!, new Map())) : [];
            const objective = members.find(m => typeOf(m['@id']).endsWith('Objective'));
            outcome.objective = objective ? typeOf(objective['@id']).split('::').pop()! : '';
            const evaluation = members.find(m => nameOf(m['@id']) === 'evaluationFunction');
            if (!evaluation) throw new UnsupportedCalculation('the study declares no evaluation function');
            const parameter = owned(evaluation['@id']).find(m => m.direction === 'in' && m['@type'] === 'PartUsage' || m.direction === 'in');
            const returned = api.ownedRelationships(evaluation['@id']).find(r => r['@type'] === 'ReturnParameterMembership');
            const returnFeature = returned ? idOf(((returned.ownedRelatedElement as unknown[]) ?? [])[0]) : '';
            const scored = alternatives.map(alternative => {
                const env = new Map<string, Value>();
                if (parameter) env.set(nameOf(parameter['@id']), alternative);
                for (const step of owned(evaluation['@id'])) {
                    if (step['@type'] !== 'CalculationUsage' || !definitions.has(typeOf(step['@id']))) continue;
                    env.set(nameOf(step['@id']), runUsage(step, env));
                }
                const expr: Expr | undefined = returnFeature ? reader.valueOf(returnFeature) : undefined;
                if (!expr) throw new UnsupportedCalculation('the evaluation function returns nothing');
                const score = flatten(evaluator.eval(expr, env))[0];
                return { alternative: show(alternative), element: alternative, score: typeof score === 'number' ? score : Number.NaN };
            });
            outcome.scores = scored.map(s => ({ alternative: s.alternative, score: String(Math.round(s.score * 100) / 100) }));
            const best = scored.filter(s => Number.isFinite(s.score)).sort((a, b) => outcome.objective.startsWith('Maximize') ? b.score - a.score : a.score - b.score)[0];
            outcome.selected = best?.alternative;
        } catch (error) { outcome.ok = false; outcome.error = (error as Error).message; }
        studies.push(outcome);
    }
    return { calculations, studies };
}
