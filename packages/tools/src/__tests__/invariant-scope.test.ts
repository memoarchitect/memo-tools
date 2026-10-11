import { describe, it, expect } from 'vitest';
import { parseConstraintExpression, type CompiledConstraint } from '../validator/constraint-eval.js';
import { validateModel } from '../validator/rule-engine.js';
import { activeRuleCandidates, type EffectiveScope } from '../model/effective-scope.js';
import type { MemoModel, MemoElement } from '../model/semantic.js';
import { toElementIndex } from '../model/element-index.js';

// ─── A methodology cannot opt out of an invariant ────────────────────────────
//
// A RulePolicy that disables an invariant is refused (`invariant-protected`).
// Scope was a second way to the same place with no refusal: a rule is active
// only when its declaring package and its subject kind are selected, and it
// runs only on in-scope elements, so a methodology that left either package
// out — or a project that kept the element out of scope — switched the
// invariant off with no policy and no diagnostic. An invariant a project can
// decline is not an invariant.
//
// And a rule over an empty subject set raised nothing and counted as passed,
// so "tested and held" and "tested nothing" read the same.
// ─────────────────────────────────────────────────────────────────────────────

function el(id: string, kind: string, attributes: Record<string, string> = {}): MemoElement {
    return { id, name: id, kind, construct: 'part', layer: 'functional', file: 't.sysml', attributes };
}
function makeModel(elements: MemoElement[]): MemoModel {
    const byKind = new Map<string, MemoElement[]>();
    for (const e of elements) (byKind.get(e.kind) ?? byKind.set(e.kind, []).get(e.kind)!).push(e);
    return {
        elements: toElementIndex(new Map(elements.map(e => [e.id, e]))), relationships: [], errors: [],
        packages: [], elementsByKind: byKind, elementsByLayer: new Map(),
        relationshipsByType: new Map(), outgoing: new Map(), incoming: new Map(),
    } as MemoModel;
}
function rule(id: string, tailoring: CompiledConstraint['tailoring'], appliesToKind = 'Widget'): CompiledConstraint {
    return {
        id, typeName: `${id}Rule`, description: id, appliesToKind, severity: 'error', tailoring,
        sourceFile: '/rules/ontology.sysml', ast: parseConstraintExpression('attributes.ok == "yes"'),
    };
}

/** An explicit scope that selects neither the rules' package nor their subject's. */
const narrow: EffectiveScope = {
    mode: 'explicit', packages: new Set(['memo_core_common']),
    standards: new Set(), artifactKinds: new Set(), viewpoints: new Set(),
};
const filePackages = new Map([
    ['/rules/ontology.sysml', 'memo_rules_ontology'],
    ['/kinds/widget.sysml', 'memo_architecture_functional_widgets'],
]);
const kindFile = (kind: string) => (kind === 'Widget' ? '/kinds/widget.sysml' : undefined);

describe('rule activation under an explicit scope', () => {
    const active = activeRuleCandidates(
        [rule('INV', 'invariant'), rule('ASR', 'assurance')], narrow, filePackages, kindFile);

    it('keeps an invariant whose package and subject kind are both unselected', () => {
        expect(active.map(c => c.id)).toContain('INV');
    });

    it('still drops an assurance rule the methodology did not select', () => {
        // Completeness and assurance rules stay tailorable; only invariants are exempt.
        expect(active.map(c => c.id)).not.toContain('ASR');
    });
});

describe('rule subjects under an explicit scope', () => {
    const model = makeModel([el('w', 'Widget', { ok: 'no' })]);
    const nothingInScope = () => false;

    it('evaluates an invariant on an element the scope leaves out', () => {
        const result = validateModel(model, [rule('INV', 'invariant')], undefined, undefined, nothingInScope);
        expect(result.violations.map(v => v.ruleId)).toContain('INV');
    });

    it('does not evaluate an assurance rule there', () => {
        const result = validateModel(model, [rule('ASR', 'assurance')], undefined, undefined, nothingInScope);
        expect(result.violations.map(v => v.ruleId)).not.toContain('ASR');
    });
});

describe('a rule with no subjects', () => {
    it('is vacuous, not passed', () => {
        const result = validateModel(makeModel([]), [rule('INV', 'invariant')]);
        const baseline = validateModel(makeModel([]), []);
        expect(result.rulesVacuous).toBe(1);
        expect(result.rulesPassed).toBe(baseline.rulesPassed);
    });

    it('is passed once it has a subject that holds', () => {
        const result = validateModel(makeModel([el('w', 'Widget', { ok: 'yes' })]), [rule('INV', 'invariant')]);
        const baseline = validateModel(makeModel([]), []);
        expect(result.rulesVacuous).toBe(0);
        expect(result.rulesPassed).toBe(baseline.rulesPassed + 1);
    });
});
