import { describe, it, expect } from 'vitest';
import { evaluateNativeConstraint, type NativeConstraint } from '../validator/constraint-eval.js';
import type { MemoModel, MemoElement, MemoRelationship } from '../model/semantic.js';

// ─── Directional trace navigation ────────────────────────────────────────────
//
// The bare relation-name segment is bidirectional by design, which is right for
// "is this hazard mitigated" and useless for a chain: from a requirement,
// `derivesFrom` returns its drivers AND everything derived from it in one
// undifferentiated collection. No rule could ask "what is upstream of this",
// which is why the two assurance-trace warnings could not be written.
//
// `upstream` / `downstream` are the additive directional tokens the `navigate`
// comment prescribes; the bare name stays bidirectional.
// ─────────────────────────────────────────────────────────────────────────────

function el(id: string, kind: string): MemoElement {
    return { id, name: id, kind, construct: 'requirement', layer: 'assurance', file: 't.sysml', attributes: {} };
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

/** need -> reqTop -> reqMid -> reqLeaf, a derivesFrom chain (driver is the source). */
function chain(): MemoModel {
    return makeModel(
        [el('need', 'Need'), el('reqTop', 'Requirement'), el('reqMid', 'Requirement'), el('reqLeaf', 'Requirement')],
        [
            rel('d1', 'derivesFrom', 'need', 'reqTop'),
            rel('d2', 'derivesFrom', 'reqTop', 'reqMid'),
            rel('d3', 'derivesFrom', 'reqMid', 'reqLeaf'),
        ],
    );
}

const rule = (expression: string): NativeConstraint =>
    ({ id: 'T', description: 'T', appliesToKind: 'Requirement', expression, severity: 'warning' });

describe('upstream / downstream navigate one direction, transitively', () => {
    // A violation is where the predicate is FALSE, so each assertion below
    // names the elements that BREAK the stated bound.

    it('upstream reaches every ancestor, not just the immediate one', () => {
        // ancestors: reqTop 1 (need), reqMid 2, reqLeaf 3 — transitive, so only
        // reqLeaf breaks "fewer than 3".
        const v = evaluateNativeConstraint(rule('upstream(derivesFrom)->size() < 3'), chain());
        expect(v.map(x => x.elementId)).toEqual(['reqLeaf']);
    });

    it('downstream reaches every descendant', () => {
        // descendants: reqTop 2, reqMid 1, reqLeaf 0 — only reqTop breaks
        // "fewer than 2", and it does so only because the walk is transitive.
        const v = evaluateNativeConstraint(rule('downstream(derivesFrom)->size() < 2'), chain());
        expect(v.map(x => x.elementId)).toEqual(['reqTop']);
    });

    it('the bare name stays bidirectional', () => {
        // Bare `derivesFrom` counts BOTH directions but only one hop: reqTop
        // and reqMid see 2 each (one driver, one derived), reqLeaf sees 1.
        // That conflation is exactly why the directional tokens were needed.
        const v = evaluateNativeConstraint(rule('derivesFrom->size() == 2'), chain());
        expect(v.map(x => x.elementId)).toEqual(['reqLeaf']);
    });

    it('terminates on a cycle instead of hanging', () => {
        const cyclic = makeModel(
            [el('a', 'Requirement'), el('b', 'Requirement')],
            [rel('c1', 'derivesFrom', 'a', 'b'), rel('c2', 'derivesFrom', 'b', 'a')],
        );
        // Each reaches the other and stops; neither counts itself.
        const v = evaluateNativeConstraint(rule('upstream(derivesFrom)->size() == 1'), cyclic);
        expect(v).toEqual([]);
    });

    it('a directional walk can be navigated onward', () => {
        // `downstream(derivesFrom).satisfiedBy` — the second hop the trace
        // rules need. Without chaining, a walk is a dead end.
        const m = makeModel(
            [el('reqTop', 'Requirement'), el('reqLeaf', 'Requirement'),
             { ...el('pump', 'Requirement'), kind: 'Part' } as MemoElement],
            [rel('d', 'derivesFrom', 'reqTop', 'reqLeaf'),
             rel('s', 'satisfiedBy', 'reqLeaf', 'pump')],
        );
        // reqTop reaches reqLeaf, then its satisfier: exactly one element.
        const v = evaluateNativeConstraint(
            rule('downstream(derivesFrom).satisfiedBy->isEmpty()'), m);
        expect(v.map(x => x.elementId)).toEqual(['reqTop']);
    });

    it('CR-ONT-081 fires only when one element satisfies both a requirement and its descendant', () => {
        const REDUNDANT = 'not satisfiedBy->intersects(downstream(derivesFrom).satisfiedBy)';
        const parent = el('reqTop', 'Requirement'), child = el('reqLeaf', 'Requirement');
        const pump = { ...el('pump', 'Requirement'), kind: 'Part' } as MemoElement;
        const other = { ...el('valve', 'Requirement'), kind: 'Part' } as MemoElement;
        const derive = rel('d', 'derivesFrom', 'reqTop', 'reqLeaf');

        // Same element on both ends of the chain: the ancestor trace is implied.
        const redundant = makeModel([parent, child, pump],
            [derive, rel('s1', 'satisfiedBy', 'reqTop', 'pump'), rel('s2', 'satisfiedBy', 'reqLeaf', 'pump')]);
        expect(evaluateNativeConstraint(rule(REDUNDANT), redundant).map(x => x.elementId))
            .toEqual(['reqTop']);

        // Different elements: a real decomposition, and NOT a finding.
        const fine = makeModel([parent, child, pump, other],
            [derive, rel('s1', 'satisfiedBy', 'reqTop', 'valve'), rel('s2', 'satisfiedBy', 'reqLeaf', 'pump')]);
        expect(evaluateNativeConstraint(rule(REDUNDANT), fine)).toEqual([]);
    });

    it('CR-ONT-080 fires on a chain rooted at an underived requirement', () => {
        const GAP = 'downstream(derivesFrom)->isEmpty() or upstream(derivesFrom)->notEmpty() or conformsTo(MemoNeed)';
        // reqTop has things derived from it but nothing above it, and is not a need.
        const orphan = makeModel([el('reqTop', 'Requirement'), el('reqLeaf', 'Requirement')],
            [rel('d', 'derivesFrom', 'reqTop', 'reqLeaf')]);
        expect(evaluateNativeConstraint(rule(GAP), orphan).map(x => x.elementId)).toEqual(['reqTop']);

        // Same shape with a driver above it: no finding.
        expect(evaluateNativeConstraint(rule(GAP), chain())).toEqual([]);
    });

    it('intersects compares the current collection against the subject scope', () => {
        // reqLeaf's ancestors include reqTop; a rule can now ask whether two
        // collections overlap, which no existing op could express.
        const v = evaluateNativeConstraint(
            rule('not upstream(derivesFrom)->intersects(downstream(derivesFrom))'), chain());
        expect(v).toEqual([]); // no requirement is both its own ancestor and descendant
    });
});
