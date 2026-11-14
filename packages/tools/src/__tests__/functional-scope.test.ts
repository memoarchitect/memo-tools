import { describe, expect, it } from 'vitest';
import type { MemoModelDTO } from '../model/semantic.js';
import { functionalScope, functionalDisplayIds } from '../model/functional-scope.js';
import { functionalStructure } from '../model/functional-structure.js';

function model(): MemoModelDTO {
    const elements = Object.fromEntries(['A', 'B', 'SoS', 'a', 'b', 'sharedRoot', 'local', 'foreign', 'foreignChild', 'override', 'sharedChild', 'pin', 'cycle1', 'cycle2'].map(id => [id, { id, name: id, kind: ['A', 'B', 'SoS', 'a', 'b'].includes(id) ? 'System' : 'SystemFunction', file: 'model.sysml', attributes: {} }]));
    elements.pin.kind = 'DataPort';
    const edge = (type: string, sourceId: string, targetId: string) => ({ id: `${type}:${sourceId}:${targetId}`, type, sourceId, targetId });
    return { elements, registries: { kinds: [{ name: 'MemoFunction' }, { name: 'SystemFunction', superType: 'MemoFunction' }], relationships: [] },
        relationships: [edge('composes', 'SoS', 'a'), edge('allocatedTo', 'sharedRoot', 'a'), edge('allocatedTo', 'sharedRoot', 'b'),
            ...['local', 'foreign', 'sharedChild'].map(id => edge('composes', 'sharedRoot', id)), edge('composes', 'foreign', 'foreignChild'), edge('composes', 'foreign', 'override'), edge('composes', 'foreignChild', 'pin'),
            edge('allocatedTo', 'local', 'a'), edge('allocatedTo', 'foreign', 'b'), edge('allocatedTo', 'override', 'a'), edge('composes', 'cycle1', 'cycle2'), edge('composes', 'cycle2', 'cycle1')],
        workspaceMembership: { workspaces: [{ root: 'A', scope: 'system' }, { root: 'B', scope: 'system' }, { root: 'SoS', scope: 'sos' }], definitionOf: { a: 'A', b: 'B' }, membership: Object.fromEntries(Object.keys(elements).map(id => [id, ['A', 'B']])), unassigned: [] },
    } as unknown as MemoModelDTO;
}

describe('allocation boundaries in a functional decomposition', () => {
    it('overrides shared ancestry with explicit allocation, and inherits a foreign allocation through unallocated children', () => {
        const scope = functionalScope(model(), 'A');
        expect([...scope.members].sort()).toEqual(['local', 'override', 'sharedChild', 'sharedRoot']);
        expect(scope.context.has('foreign')).toBe(true); // path to the explicitly local override
        expect(scope.visible.has('foreignChild')).toBe(false);
        expect(scope.shared.has('sharedChild')).toBe(true);
        expect(scope.shared.has('local')).toBe(false);
    });
    it('does not place a system usage allocation into the system of systems that owns that usage', () => {
        expect(functionalScope(model(), 'SoS').members.size).toBe(0);
    });
    it('drops foreign function-owned parameters as well as the foreign branch and handles cycles', () => {
        const source = model(); const ids = functionalDisplayIds(source, 'A', new Set(Object.keys(source.elements)));
        expect(ids.has('pin')).toBe(false); expect(ids.has('cycle1')).toBe(false);
        expect(ids.has('override')).toBe(true); expect(ids.has('sharedChild')).toBe(true);
    });
    it('keeps a multiple-parent local path and distinguishes explicitly shared work', () => {
        const source = model(); source.relationships.push({ id: 'anotherParent', type: 'composes', sourceId: 'local', targetId: 'foreignChild' } as never);
        const scope = functionalScope(source, 'A');
        expect(scope.members.has('foreignChild')).toBe(true);
        expect(scope.shared.has('foreignChild')).toBe(true);
    });
    it('creates a distinct system root instead of adopting a shared global function or a definition', () => {
        const source = model(); source.elements.reusable = { ...source.elements.local, id: 'reusable', isDefinition: true };
        source.relationships.push({ id: 'defAlloc', type: 'allocatedTo', sourceId: 'reusable', targetId: 'a' } as never);
        const structure = functionalStructure(source, 'A');
        expect(structure.candidates.map(candidate => candidate.id).sort()).toEqual(['local', 'override']);
        expect(structure.adoptable).toBeUndefined(); expect(structure.home.id).toBe('A');
    });
});
