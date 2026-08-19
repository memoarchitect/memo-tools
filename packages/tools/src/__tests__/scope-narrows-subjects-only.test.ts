import { describe, it, expect } from 'vitest';
import { evaluateNativeConstraint, evaluateConstraintNode, parseConstraintExpression } from '../validator/constraint-eval.js';
import type { MemoModel, MemoElement, MemoRelationship } from '../model/semantic.js';

// ─── Methodology scope narrows SUBJECTS, never the graph ─────────────────────
//
// `memo validate` narrowed the model itself before evaluating rules: it dropped
// out-of-scope elements from `elements` and filtered `relationships` to edges
// with both endpoints kept — while leaving `outgoing`, `incoming` and
// `relationshipsByType` pointing at the FULL model. The model contradicted
// itself, and every rule that NAVIGATES a trace silently saw nothing, because
// `navigate` looks the far endpoint up in `elements`.
//
// Measured on gpca-pump 2026-08-19: 374 of 723 elements dropped and ALL 110
// `satisfiedBy` edges lost an endpoint, because `filePackages` maps every file,
// so the module-scope test was applied to architecture kinds that
// `includedLayer` governs. XL-002 then reported 89 requirements as lacking
// requirements-to-architecture traceability that the source plainly traces.
//
// Narrowing `elementsByKind` instead is no better: `conformsTo` reads it, so
// in-scope elements start failing type checks (eight CR-ONT-06x rules began
// reporting against `__model__` the moment that was tried).
//
// Scope is a statement about what a rule RUNS ON. Nothing else.
// ─────────────────────────────────────────────────────────────────────────────

function el(id: string, kind: string): MemoElement {
    return { id, name: id, kind, construct: 'part', layer: 'logical', file: 't.sysml', attributes: {} };
}
function rel(id: string, type: string, sourceId: string, targetId: string): MemoRelationship {
    return { id, type, sourceId, sourceEnd: 'a', targetId, targetEnd: 'b', file: 't.sysml' };
}
function makeModel(elements: MemoElement[], relationships: MemoRelationship[]): MemoModel {
    const byId = new Map(elements.map(e => [e.id, e]));
    const byKind = new Map<string, MemoElement[]>();
    const outgoing = new Map<string, MemoRelationship[]>();
    const incoming = new Map<string, MemoRelationship[]>();
    const relByType = new Map<string, MemoRelationship[]>();
    for (const e of elements) (byKind.get(e.kind) ?? byKind.set(e.kind, []).get(e.kind)!).push(e);
    for (const r of relationships) {
        (outgoing.get(r.sourceId) ?? outgoing.set(r.sourceId, []).get(r.sourceId)!).push(r);
        (incoming.get(r.targetId) ?? incoming.set(r.targetId, []).get(r.targetId)!).push(r);
        (relByType.get(r.type) ?? relByType.set(r.type, []).get(r.type)!).push(r);
    }
    return {
        elements: byId, relationships, errors: [], packages: [],
        elementsByKind: byKind, elementsByLayer: new Map(),
        relationshipsByType: relByType, outgoing, incoming,
    } as MemoModel;
}

/** One in-scope requirement traced to one out-of-scope architecture element. */
const model = makeModel(
    [el('req', 'Requirement'), el('pump', 'Part')],
    [rel('s', 'satisfiedBy', 'req', 'pump')],
);

const meta = {
    id: 'TRACE', description: 'a requirement must be satisfied by something',
    appliesToKind: 'Requirement', severity: 'warning' as const,
};
const ast = parseConstraintExpression('satisfiedBy->notEmpty()');

describe('methodology scope', () => {
    it('a trace to an out-of-scope element still resolves', () => {
        // `pump` is not in scope; the requirement is. The trace must still be
        // navigable, or the rule reports a missing trace that plainly exists.
        const violations = evaluateConstraintNode(meta, ast, model, undefined,
            element => element.id === 'req');
        expect(violations, 'the satisfy edge was dropped with its out-of-scope target').toEqual([]);
    });

    it('an out-of-scope element is not itself a subject', () => {
        // `satisfiedBy` is bidirectional, so pump passes that one; use a
        // relation it genuinely has none of.
        const everyPartIsDerived = { ...meta, appliesToKind: 'Part' };
        const derived = parseConstraintExpression('derivesFrom->notEmpty()');
        expect(evaluateConstraintNode(everyPartIsDerived, derived, model, undefined,
            element => element.id === 'req')).toEqual([]);
        // Without the filter it does violate — proving the filter is what silenced it.
        expect(evaluateNativeConstraint(
            { ...everyPartIsDerived, expression: 'derivesFrom->notEmpty()' }, model,
        ).map(v => v.elementId)).toEqual(['pump']);
    });

    it('the Model pseudo-subject is never filtered out', () => {
        // Model-scoped rules have no element to be in or out of scope.
        const modelScoped = { ...meta, appliesToKind: 'Model' };
        const always = parseConstraintExpression('false');
        expect(evaluateConstraintNode(modelScoped, always, model, undefined, () => false))
            .toHaveLength(1);
    });
});
