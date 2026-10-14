// ─── The Guide: where a model stands against its method ──────────────────────
//
// Pure. For a workspace, each step of the method is done, open or blocked, from what the step states:
//
//   done      every output kind has an element in the workspace, and every rule the step is `#DoneWhen`
//             has a subject there and no finding on any subject. A rule with nothing to judge is not
//             satisfied, it has not run.
//   blocked   not done, and a step that comes first (`first … then …`, at the same level) is open or blocked.
//   open      everything else.
//   no criterion  the step names no output kind and no rule: it is never reported as done.
//
// An imported element (one that carries `@ExternalSource`) counts toward an output only when it is traced:
// it has at least one link other than the containment of its own package, so an import nobody relates to
// anything does not complete a step.
//
// The caller gives the findings already scoped to the workspace (`validateModel(…, workspace)`): filtering a
// whole-model result afterwards would lose the rule that a trace to another system's element is not evidence,
// and a pump test would then complete a generator's step.
// ─────────────────────────────────────────────────────────────────────────────

import type { KindRegistry } from '../model/kind-registry.js';
import type { MemoModel } from '../model/semantic.js';
import { derivesFrom } from '../model/workspace-membership.js';
import type { GuideStep } from '../stage2/guide-from-api.js';
import type { Violation } from '../validator/types.js';

export type StepState = 'done' | 'open' | 'blocked' | 'no-criterion';

export interface OutputStatus {
    kind: string;
    /** Elements of the kind in the workspace that count. */
    count: number;
    /** Imported elements of the kind that do not count, for want of a trace. */
    untracedImports: number;
}

export interface RuleStatus {
    /** The rule def's name, as the step names it. */
    rule: string;
    /** False when the rule is not in the resolved rule set: it cannot be satisfied. */
    known: boolean;
    /** Elements of the rule's subject kind in the workspace. */
    subjects: number;
    violations: number;
}

export interface StepStatus extends GuideStep {
    state: StepState;
    outputs: OutputStatus[];
    rules: RuleStatus[];
    /** Steps that come first and are not done, by id. */
    blockedBy: string[];
    /** Why, in words, for a step that is not done. */
    reasons: string[];
}

export interface GuideEvaluation {
    steps: StepStatus[];
    /** The first step that is open, in the method's order. */
    next?: string;
}

/** The rule facts the evaluation needs: the def's name, its id (what findings carry) and the kind it judges. */
export interface GuideRule {
    id: string;
    typeName?: string;
    appliesToKind: string;
}

export interface GuideInput {
    steps: readonly GuideStep[];
    model: MemoModel;
    kinds?: KindRegistry;
    /** A workspace: its elements, and whether it is the system of systems' or a system's. Absent: the whole model. */
    workspace?: { subjects: ReadonlySet<string>; scope: 'sos' | 'system' };
    /** Findings already scoped to the workspace. */
    violations: readonly Violation[];
    rules: readonly GuideRule[];
}

const IMPORTED = 'externalReference.identifier';
const LEVEL_OF_SCOPE = { sos: 'systemOfSystems', system: 'system' } as const;

export function evaluateGuide(input: GuideInput): GuideEvaluation {
    const { model, kinds, workspace } = input;
    const inScope = (id: string) => !workspace || workspace.subjects.has(id);
    const elements = [...model.elements.values()].filter(e => inScope(e.id));
    const conforms = (kind: string, root: string) => kind === root || (kinds !== undefined && derivesFrom(kinds, kind, root));
    const traced = (id: string) => [...(model.outgoing.get(id) ?? []), ...(model.incoming.get(id) ?? [])].some(r => r.type !== 'composes');

    // A workspace is worked at one level; the whole model has both.
    const wanted = workspace ? LEVEL_OF_SCOPE[workspace.scope] : undefined;
    const steps = input.steps.filter(step => !wanted || !step.level || step.level === wanted);

    const status = new Map<string, StepStatus>();
    for (const step of steps) {
        const reasons: string[] = [];
        const outputs: OutputStatus[] = step.outputKinds.map(kind => {
            const ofKind = elements.filter(e => conforms(e.kind, kind));
            const counted = ofKind.filter(e => !e.attributes?.[IMPORTED] || traced(e.id));
            return { kind, count: counted.length, untracedImports: ofKind.length - counted.length };
        });
        for (const output of outputs.filter(o => o.count === 0)) {
            reasons.push(output.untracedImports > 0
                ? `${output.untracedImports} imported ${output.kind} element(s) are not traced to anything`
                : `no ${output.kind} yet`);
        }
        const rules: RuleStatus[] = step.doneWhen.map(name => {
            const rule = input.rules.find(r => r.typeName === name);
            if (!rule) return { rule: name, known: false, subjects: 0, violations: 0 };
            const subjects = elements.filter(e => conforms(e.kind, rule.appliesToKind)).length;
            const violations = input.violations.filter(v => v.ruleId === rule.id && inScope(v.elementId)).length;
            return { rule: name, known: true, subjects, violations };
        });
        for (const rule of rules) {
            if (!rule.known) reasons.push(`the rule ${rule.rule} is not in the rule set`);
            else if (rule.subjects === 0) reasons.push(`${rule.rule} has nothing to judge yet`);
            else if (rule.violations > 0) reasons.push(`${rule.rule}: ${rule.violations} finding(s)`);
        }
        const criterion = step.outputKinds.length > 0 || step.doneWhen.length > 0;
        const done = criterion && reasons.length === 0;
        status.set(step.id, {
            ...step, state: !criterion ? 'no-criterion' : done ? 'done' : 'open', outputs, rules, blockedBy: [], reasons,
        });
    }
    // Blocked: a step that comes first is open or blocked. Resolved in order, so a chain blocks all the way down.
    for (const step of steps) {
        const own = status.get(step.id)!;
        if (own.state === 'done' || own.state === 'no-criterion') continue;
        const before = step.predecessors.map(id => status.get(id)).filter((s): s is StepStatus => s !== undefined);
        own.blockedBy = before.filter(s => s.state === 'open' || s.state === 'blocked').map(s => s.id);
        if (own.blockedBy.length > 0) own.state = 'blocked';
    }
    const ordered = steps.map(step => status.get(step.id)!);
    return { steps: ordered, next: ordered.find(step => step.state === 'open')?.id };
}
