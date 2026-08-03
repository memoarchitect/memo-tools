// ─── Activity notation roles ─────────────────────────────────────────────────
//
// Two claims are being held here, and only one of them is about behaviour.
//
// The behavioural claim is that every spelling the old Architect ladder handled
// still classifies the same way, so moving the logic into memo-tools was a move
// and not a rewrite.
//
// The structural claim is the one that matters more: that classification is
// driven by the generated metamodel rather than by names written down here. A
// metaclass nobody enumerated — `AssignmentActionUsage`, say — must classify as
// an action because the metamodel says it specializes `ActionUsage`, and a
// deeper subtype must beat a shallower anchor without anyone ordering them.
// ─────────────────────────────────────────────────────────────────────────────

import { describe, expect, it } from 'vitest';
import { SYSML_METACLASSES, conformsTo } from '@memoarchitect/sysml-ir';
import {
    ACTIVITY_NOTATION_ROLES,
    activityNodeType,
    activityRolesBySpecificity,
    controlKindMetaclassesAreControlNodes,
    isControlNode,
} from '../model/activity-notation.js';
import type { MemoElement } from '../model/semantic.js';
import type { OntologyRegistriesDTO } from '../model/relationship-legality.js';

function el(id: string, overrides: Partial<MemoElement> = {}): MemoElement {
    return {
        id, name: id, kind: 'Action', construct: 'action', layer: 'behavior',
        file: 'model/flow.sysml', attributes: {}, ...overrides,
    } as MemoElement;
}

describe('classification against the generated metamodel', () => {
    it('classifies every spelling the view template used to handle', () => {
        expect(activityNodeType(el('route', { kind: 'DecisionNodeUsage', construct: 'decision' }))).toBe('decision');
        expect(activityNodeType(el('afterRoute', { kind: 'MergeNode' }))).toBe('merge');
        expect(activityNodeType(el('receive', { kind: 'AcceptActionUsage' }))).toBe('accept');
        expect(activityNodeType(el('send', { kind: 'SendActionUsage' }))).toBe('send');
        expect(activityNodeType(el('stop', { kind: 'TerminateActionUsage' }))).toBe('activityFinal');
        expect(activityNodeType(el('discard', { kind: 'FlowFinalNode' }))).toBe('flowFinal');
        expect(activityNodeType(el('split', { kind: 'ForkNode' }))).toBe('fork');
        expect(activityNodeType(el('sync', { kind: 'JoinNode' }))).toBe('join');
        expect(activityNodeType(el('work', { kind: 'ActionUsage' }))).toBe('action');
        expect(activityNodeType(el('work', { construct: 'action', kind: 'ProcessStep' }))).toBe('action');
        // A definition draws as an action but is not a kind of `ActionUsage` in
        // the metamodel, so it has its own anchor.
        expect(activityNodeType(el('Fulfill', { kind: 'ActionDefinition', construct: 'action def' }))).toBe('action');
    });

    it('reads the control node discriminator MEMO\'s own grammar emits', () => {
        // `memo`'s parser gives a control node `kind: 'ForkNode'` *and*
        // `controlKind: 'fork'`; either alone must be enough.
        expect(activityNodeType(el('split', { kind: 'ControlNode', attributes: { controlKind: 'fork' } }))).toBe('fork');
        expect(activityNodeType(el('sync', { kind: 'ControlNode', attributes: { controlKind: 'join' } }))).toBe('join');
        expect(activityNodeType(el('route', { kind: 'ControlNode', attributes: { controlKind: 'decide' } }))).toBe('decision');
    });

    it('classifies a metaclass nobody enumerated, because the metamodel places it', () => {
        // Never named in `ACTIVITY_NOTATION_ROLES`, never in a test fixture:
        // it classifies because `SysML.ecore` says it specializes `ActionUsage`.
        expect(conformsTo('AssignmentActionUsage', 'ActionUsage')).toBe(true);
        expect(activityNodeType(el('assign', { kind: 'AssignmentActionUsage' }))).toBe('action');
        expect(activityNodeType(el('loop', { kind: 'WhileLoopActionUsage' }))).toBe('action');
    });

    it('prefers the most specific anchor without anyone ordering the roles', () => {
        // `ForkNode` → `ControlNode` → `ActionUsage`: the action anchor must not
        // swallow it. Precedence is computed from supertype depth, so the
        // declaration order in the module is irrelevant — proved by checking
        // the derived order rather than trusting the outcome alone.
        const order = activityRolesBySpecificity().map(role => role.role);
        expect(order.indexOf('fork')).toBeLessThan(order.indexOf('action'));
        expect(order.at(-1)).toBe('action');
        expect(activityNodeType(el('split', { kind: 'ForkNode', construct: 'action' }))).toBe('fork');
    });

    it('is not an activity node when nothing in the metamodel places it', () => {
        expect(activityNodeType(el('pump', { kind: 'Component', construct: 'part' }))).toBeUndefined();
        expect(activityNodeType(el('haz', { kind: 'Hazard', construct: 'part' }))).toBeUndefined();
    });

    it('answers "is this a control node" from the metamodel, not a role list', () => {
        expect(isControlNode(el('split', { kind: 'ForkNode' }))).toBe(true);
        expect(isControlNode(el('route', { kind: 'DecisionNode' }))).toBe(true);
        expect(isControlNode(el('work', { kind: 'ActionUsage' }))).toBe(false);
        // Final nodes are control nodes for layout purposes but have no v2
        // metaclass to derive that from, so they are stated rather than derived.
        expect(isControlNode(el('discard', { kind: 'FlowFinalNode' }))).toBe(true);
    });
});

describe('the ontology as the extension point', () => {
    const registries: OntologyRegistriesDTO = {
        relationships: [],
        kinds: [
            { name: 'MemoProcessStep', label: 'Process Step', layer: 'behavior', construct: 'action def', superType: 'ActionUsage' },
            { name: 'ReviewStep', label: 'Review Step', layer: 'behavior', construct: 'action def', superType: 'MemoProcessStep' },
            { name: 'MemoGateway', label: 'Gateway', layer: 'behavior', construct: 'action def', superType: 'DecisionNode' },
        ],
    };

    it('binds a project kind to a role through its declared specialization chain', () => {
        // Two levels up the ontology chain, then onto a metaclass. Binding a new
        // kind to a notation role is an ontology edit, not a code change.
        expect(activityNodeType(el('review', { kind: 'ReviewStep', construct: 'part' }), registries)).toBe('action');
        expect(activityNodeType(el('gate', { kind: 'MemoGateway', construct: 'part' }), registries)).toBe('decision');
        expect(isControlNode(el('gate', { kind: 'MemoGateway', construct: 'part' }), registries)).toBe(true);
    });

    it('classifies the same kind as nothing when the ontology does not bind it', () => {
        expect(activityNodeType(el('review', { kind: 'ReviewStep', construct: 'part' }))).toBeUndefined();
    });

    it('survives a cyclic ontology chain rather than looping', () => {
        const cyclic: OntologyRegistriesDTO = {
            relationships: [],
            kinds: [
                { name: 'A', label: 'A', layer: 'x', construct: 'part def', superType: 'B' },
                { name: 'B', label: 'B', layer: 'x', construct: 'part def', superType: 'A' },
            ],
        };
        expect(activityNodeType(el('a', { kind: 'A', construct: 'part' }), cyclic)).toBeUndefined();
    });
});

describe('drift alarms on the bindings that are stated rather than derived', () => {
    it('binds controlKind to exactly the metamodel\'s ControlNode subtypes', () => {
        // A fifth control node upstream fails here rather than going silently
        // unclassified on the canvas.
        expect(controlKindMetaclassesAreControlNodes()).toBe(true);
    });

    it('anchors every role on a metaclass that exists', () => {
        for (const role of ACTIVITY_NOTATION_ROLES) {
            expect(SYSML_METACLASSES[role.metaclass], `${role.role} anchor`).toBeDefined();
        }
    });
});
