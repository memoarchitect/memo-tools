import { describe, expect, it } from 'vitest';
import { compiledExample, compilerConfigured, examplesPresent } from './helpers/compile-source.js';

// O9: every relation says how it places elements in a workspace
// (memo_core_relationships_workspace_membership). A relation without a row would be read as
// "places nothing" by the closure, silently, so the table is held to the registry in
// both directions: no relation without a row, no row for a relation that is not there.

// Edges the builder synthesizes from SysML keywords; they have no `connection def`, so
// the registry does not list them, but the closure meets them.
const BUILDER_EDGES = ['bind', 'flow', 'interface', 'succession', 'variant'];

// An `interface def` and a `flow def` are in the registry so a user can create one, but what the closure
// meets is the `interface` or `flow` edge a usage of it becomes, which BUILDER_EDGES already names.
const EXCHANGE_DEFINITIONS = ['interface def', 'flow def'];

describe.runIf(compilerConfigured && examplesPresent)('the workspace-membership table', () => {
    it('has a row for every relation and no row for anything else', async () => {
        const project = await compiledExample('robot-cell-family');
        const registry = project.registries!.relationshipRegistry!;
        const table = registry.workspaceMembership();
        const relations = [...registry.entries().filter(entry => !entry.isAbstract && !EXCHANGE_DEFINITIONS.includes(entry.sysmlConstruct ?? '')).map(entry => entry.name), ...BUILDER_EDGES];

        expect(relations.filter(name => !table.has(name)), 'relations with no row').toEqual([]);
        expect([...table.keys()].filter(name => !relations.includes(name)), 'rows naming no relation').toEqual([]);
    }, 120_000);

    it('keeps include, interface, flow and performs from placing anything', async () => {
        const table = (await compiledExample('robot-cell-family')).registries!.relationshipRegistry!.workspaceMembership();
        for (const relation of ['includesStep', 'interface', 'flow', 'performs']) expect(table.get(relation), relation).toBe('neither');
    }, 120_000);

    it('places a function with what it is allocated to, and a case with what it verifies', async () => {
        const table = (await compiledExample('robot-cell-family')).registries!.relationshipRegistry!.workspaceMembership();
        expect(table.get('allocatedTo')).toBe('sourceFollowsTarget');
        expect(table.get('satisfiedBy')).toBe('sourceFollowsTarget');
        expect(table.get('verifiedBy')).toBe('targetFollowsSource');
        expect(table.get('composes')).toBe('targetFollowsSource');
    }, 120_000);
});
