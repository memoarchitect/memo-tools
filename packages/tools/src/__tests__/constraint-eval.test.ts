import { describe, it, expect } from 'vitest';
import { evaluateNativeConstraint, type NativeConstraint } from '../validator/constraint-eval.js';
import type { MemoModel, MemoElement, MemoRelationship } from '../model/semantic.js';

// ─── Fixture helpers ──────────────────────────────────────────────────────────

function el(id: string, kind: string, attrs: Record<string, string> = {}): MemoElement {
    return { id, name: id, kind, construct: 'action', layer: 'behavior', file: 'test.sysml', attributes: attrs };
}

function rel(id: string, type: string, sourceId: string, targetId: string): MemoRelationship {
    return { id, type, sourceId, sourceEnd: 'a', targetId, targetEnd: 'b', file: 'test.sysml' };
}

function makeModel(elements: MemoElement[], relationships: MemoRelationship[]): MemoModel {
    const byId = new Map(elements.map(e => [e.id, e]));
    const byKind = new Map<string, MemoElement[]>();
    const byLayer = new Map<string, MemoElement[]>();
    const outgoing = new Map<string, MemoRelationship[]>();
    const incoming = new Map<string, MemoRelationship[]>();
    const relByType = new Map<string, MemoRelationship[]>();
    for (const e of elements) {
        (byKind.get(e.kind) ?? byKind.set(e.kind, []).get(e.kind)!).push(e);
        (byLayer.get(e.layer) ?? byLayer.set(e.layer, []).get(e.layer)!).push(e);
    }
    for (const r of relationships) {
        (outgoing.get(r.sourceId) ?? outgoing.set(r.sourceId, []).get(r.sourceId)!).push(r);
        (incoming.get(r.targetId) ?? incoming.set(r.targetId, []).get(r.targetId)!).push(r);
        (relByType.get(r.type) ?? relByType.set(r.type, []).get(r.type)!).push(r);
    }
    return {
        elements: byId, relationships, errors: [],
        elementsByKind: byKind, elementsByLayer: byLayer,
        relationshipsByType: relByType, outgoing, incoming,
    };
}

// Reference fixture: one allocated function, one un-allocated function, one block.
function allocationModel(): MemoModel {
    return makeModel(
        [el('pumpControl', 'Function'), el('idleMonitor', 'Function'), el('controllerBlock', 'LogicalBlock')],
        [rel('r1', 'allocate', 'pumpControl', 'controllerBlock')],
    );
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('native constraint evaluator (Epic EE ⊕-0 spike)', () => {
    it('flags the function with no allocation — "allocate->notEmpty()"', () => {
        const c: NativeConstraint = {
            id: 'EE-ALLOC-001',
            description: 'Every function must be allocated to a structural block.',
            appliesToKind: 'Function',
            expression: 'allocate->notEmpty()',
            severity: 'error',
        };
        const violations = evaluateNativeConstraint(c, allocationModel());
        expect(violations).toHaveLength(1);
        expect(violations[0].elementId).toBe('idleMonitor');
        expect(violations[0].ruleId).toBe('EE-ALLOC-001');
        expect(violations[0].severity).toBe('error');
    });

    it('supports size comparison — "allocate->size() >= 1"', () => {
        const c: NativeConstraint = {
            id: 'EE-ALLOC-002', description: 'allocated at least once', appliesToKind: 'Function',
            expression: 'allocate->size() >= 1', severity: 'warning',
        };
        const v = evaluateNativeConstraint(c, allocationModel());
        expect(v.map(x => x.elementId)).toEqual(['idleMonitor']);
    });

    it('supports boolean conjunction across two relationship types', () => {
        // Requirement traceability: must satisfy a need AND mitigate a risk.
        const model = makeModel(
            [
                el('REQ-1', 'Requirement'), el('REQ-2', 'Requirement'),
                el('NEED-1', 'UserNeed'), el('RISK-1', 'Risk'),
            ],
            [
                rel('a', 'satisfy', 'REQ-1', 'NEED-1'), rel('b', 'mitigates', 'REQ-1', 'RISK-1'),
                rel('c', 'satisfy', 'REQ-2', 'NEED-1'), // REQ-2 satisfies need but mitigates no risk
            ],
        );
        const c: NativeConstraint = {
            id: 'EE-TRACE-001', description: 'requirement traces to need and risk', appliesToKind: 'Requirement',
            expression: 'satisfy->notEmpty() and mitigates->notEmpty()', severity: 'error',
        };
        const v = evaluateNativeConstraint(c, model);
        expect(v.map(x => x.elementId)).toEqual(['REQ-2']);
    });

    it('passes vacuously when no element of the subject kind exists', () => {
        const c: NativeConstraint = {
            id: 'EE-X', description: 'n/a', appliesToKind: 'Nonexistent',
            expression: 'allocate->notEmpty()', severity: 'error',
        };
        expect(evaluateNativeConstraint(c, allocationModel())).toHaveLength(0);
    });

    it('rejects an unsupported collection op with a clear error', () => {
        const c: NativeConstraint = {
            id: 'EE-BAD', description: 'bad', appliesToKind: 'Function',
            expression: 'allocate->isPrime()', severity: 'error',
        };
        expect(() => evaluateNativeConstraint(c, allocationModel())).toThrow(/Unsupported collection op/);
    });
});

// ─── EE-2: attributes, strings, quantifiers, arithmetic ───────────────────────

describe('native constraint evaluator (EE-2 breadth)', () => {
    it('resolves a typed field — "kind == \\"Function\\""', () => {
        // Subject kind is Function, so the comparison holds for both functions
        // and the rule fires for none of them.
        const c: NativeConstraint = {
            id: 'EE-ATTR-001', description: 'kind is Function', appliesToKind: 'Function',
            expression: 'kind == "Function"', severity: 'error',
        };
        expect(evaluateNativeConstraint(c, allocationModel())).toHaveLength(0);
    });

    it('resolves an attribute via attributes["key"] and via dotted access', () => {
        const model = makeModel(
            [el('REQ-A', 'Requirement', { safetyClass: 'C' }), el('REQ-B', 'Requirement', { safetyClass: 'B' })],
            [],
        );
        const bracket: NativeConstraint = {
            id: 'EE-ATTR-002', description: 'class C', appliesToKind: 'Requirement',
            expression: 'attributes["safetyClass"] == "C"', severity: 'error',
        };
        const dotted: NativeConstraint = { ...bracket, id: 'EE-ATTR-003', expression: 'attributes.safetyClass == "C"' };
        // Flags every requirement whose class is NOT "C" → REQ-B.
        expect(evaluateNativeConstraint(bracket, model).map(v => v.elementId)).toEqual(['REQ-B']);
        expect(evaluateNativeConstraint(dotted, model).map(v => v.elementId)).toEqual(['REQ-B']);
    });

    it('requireAttribute equivalent — "attributes[\\"x\\"]->notEmpty()"', () => {
        const model = makeModel(
            [el('H-1', 'Hazard', { severity: 'high' }), el('H-2', 'Hazard', {}), el('H-3', 'Hazard', { severity: '' })],
            [],
        );
        const c: NativeConstraint = {
            id: 'EE-ATTR-004', description: 'severity present', appliesToKind: 'Hazard',
            expression: 'attributes["severity"]->notEmpty()', severity: 'error',
        };
        // Missing and empty-string attributes both fail.
        expect(evaluateNativeConstraint(c, model).map(v => v.elementId)).toEqual(['H-2', 'H-3']);
    });

    it('evaluates arithmetic in a comparison', () => {
        const model = makeModel(
            [el('F-1', 'Function'), el('F-2', 'Function'), el('B', 'LogicalBlock'), el('X', 'UserNeed')],
            [rel('a', 'allocate', 'F-1', 'B'), rel('b', 'satisfy', 'F-1', 'X')],
        );
        // (allocate->size() + satisfy->size()) >= 2 : F-1 has 2, F-2 has 0.
        const c: NativeConstraint = {
            id: 'EE-ARITH-001', description: 'total links >= 2', appliesToKind: 'Function',
            expression: 'allocate->size() + satisfy->size() >= 2', severity: 'warning',
        };
        expect(evaluateNativeConstraint(c, model).map(v => v.elementId)).toEqual(['F-2']);
    });

    it('forAll: every navigated element must satisfy a sub-expression', () => {
        const model = makeModel(
            [
                el('REQ-OK', 'Requirement'), el('REQ-BAD', 'Requirement'),
                el('V-1', 'VerificationCase', { status: 'pass' }),
                el('V-2', 'VerificationCase', { status: 'pass' }),
                el('V-3', 'VerificationCase', { status: 'fail' }),
            ],
            [
                rel('a', 'verify', 'REQ-OK', 'V-1'), rel('b', 'verify', 'REQ-OK', 'V-2'),
                rel('c', 'verify', 'REQ-BAD', 'V-3'),
            ],
        );
        const c: NativeConstraint = {
            id: 'EE-QUANT-001', description: 'all verifications pass', appliesToKind: 'Requirement',
            expression: 'verify->forAll(attributes["status"] == "pass")', severity: 'error',
        };
        expect(evaluateNativeConstraint(c, model).map(v => v.elementId)).toEqual(['REQ-BAD']);
    });

    it('exists + select: at least one mitigation of a given kind', () => {
        const model = makeModel(
            [
                el('RISK-1', 'Risk'), el('RISK-2', 'Risk'),
                el('M-1', 'DesignControl'), el('M-2', 'LabelWarning'),
            ],
            [rel('a', 'mitigates', 'M-1', 'RISK-1'), rel('b', 'mitigates', 'M-2', 'RISK-2')],
        );
        const existsC: NativeConstraint = {
            id: 'EE-QUANT-002', description: 'mitigated by a design control', appliesToKind: 'Risk',
            expression: 'mitigates->exists(kind == "DesignControl")', severity: 'error',
        };
        // RISK-2 only mitigated by a LabelWarning → fails.
        expect(evaluateNativeConstraint(existsC, model).map(v => v.elementId)).toEqual(['RISK-2']);

        const selectC: NativeConstraint = {
            id: 'EE-QUANT-003', description: 'has a design-control mitigation', appliesToKind: 'Risk',
            expression: 'mitigates->select(kind == "DesignControl")->notEmpty()', severity: 'error',
        };
        expect(evaluateNativeConstraint(selectC, model).map(v => v.elementId)).toEqual(['RISK-2']);
    });

    it('uniqueAttribute equivalent — allOfKind + subject reference', () => {
        const model = makeModel(
            [
                el('R-1', 'Requirement', { docId: 'SRS-1' }),
                el('R-2', 'Requirement', { docId: 'SRS-2' }),
                el('R-3', 'Requirement', { docId: 'SRS-1' }), // duplicate docId with R-1
            ],
            [],
        );
        const c: NativeConstraint = {
            id: 'EE-UNIQ-001', description: 'docId unique across requirements', appliesToKind: 'Requirement',
            expression: 'allOfKind("Requirement")->select(attributes["docId"] == subject.attributes["docId"])->size() <= 1',
            severity: 'error',
        };
        // R-1 and R-3 share SRS-1 → both flagged; R-2 is unique.
        expect(evaluateNativeConstraint(c, model).map(v => v.elementId).sort()).toEqual(['R-1', 'R-3']);
    });

    it('conditional rule: class-C requirements must be verified', () => {
        // The conditionalRequireRelationship class of rule: if kind=="Requirement"
        // and safetyClass=="C" then verify->notEmpty(). Authored as: not(cond) or consequent.
        const model = makeModel(
            [
                el('C-OK', 'Requirement', { safetyClass: 'C' }),
                el('C-BAD', 'Requirement', { safetyClass: 'C' }),
                el('B-OK', 'Requirement', { safetyClass: 'B' }), // condition false → passes vacuously
                el('V-1', 'VerificationCase'), el('V-2', 'VerificationCase'),
            ],
            [rel('a', 'verify', 'C-OK', 'V-1'), rel('z', 'verify', 'B-OK', 'V-2')],
        );
        const c: NativeConstraint = {
            id: 'EE-COND-001', description: 'class C requires verification', appliesToKind: 'Requirement',
            expression: 'not (kind == "Requirement" and attributes["safetyClass"] == "C") or verify->notEmpty()',
            severity: 'error',
        };
        expect(evaluateNativeConstraint(c, model).map(v => v.elementId)).toEqual(['C-BAD']);
    });
});
