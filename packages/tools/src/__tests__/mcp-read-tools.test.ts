// ─── The read tools the MCP server and the Model Assistant share ─────────────
//
// Allocation and interfaces are read from how the ontology says each relationship is written, never
// from relationship names; validation can be narrowed to one element; elements carry the link the
// caller gives; a tool whose service the caller lacks says so.
// ─────────────────────────────────────────────────────────────────────────────

import { describe, it, expect } from 'vitest';
import { listTools, runReadTool, architectLink, type ReadToolContext } from '../mcp/tools.js';
import type { QueryContext } from '../dhf/query-engine.js';

const elements = [
    { id: 'p::motor', shortId: 'HW-1', idFamily: 'HW', name: 'Motor', kind: 'HardwareAssembly', layer: 'physical' },
    { id: 'p::motor::portIn', shortId: 'PT-1', idFamily: 'PT', name: 'portIn', kind: 'PhysicalPort', layer: 'physical' },
    { id: 'p::drive', shortId: 'FN-1', idFamily: 'FN', name: 'Drive motor', kind: 'SystemFunction', layer: 'functional' },
    { id: 'p::controller', shortId: 'HW-2', idFamily: 'HW', name: 'Controller', kind: 'HardwareAssembly', layer: 'physical' },
];
const relationships = [
    { id: 'r1', type: 'allocatedTo', sourceId: 'p::drive', targetId: 'p::motor' },
    { id: 'r2', type: 'motorLink', sourceId: 'p::controller', targetId: 'p::motor::portIn' },
    { id: 'r3', type: 'mitigates', sourceId: 'p::controller', targetId: 'p::motor' },
];
const violations = [
    { severity: 'warning', ruleId: 'R-1', description: 'needs a test', elementId: 'p::drive', elementKind: 'SystemFunction', layer: 'functional' },
    { severity: 'info', ruleId: 'R-2', description: 'a note', elementId: 'p::drive', elementKind: 'SystemFunction', layer: 'functional' },
    { severity: 'error', ruleId: 'R-3', description: 'broken', elementId: 'p::motor', elementKind: 'HardwareAssembly', layer: 'physical' },
];
const ctx = {
    element: (id: string) => elements.find(e => e.id === id),
    allRelationships: () => relationships,
    violationsBySeverity: (severity: string) => violations.filter(v => v.severity === severity),
    errorCount: () => 1,
    warningCount: () => 1,
} as unknown as QueryContext;

const context: ReadToolContext = {
    ctx,
    ontology: { kinds: {}, relationshipTypes: [] },
    registries: {
        kinds: [],
        relationships: [
            // The SysML `allocate` statement, and a typed interface: how each is written, not its name, decides.
            { name: 'allocatedTo', sysmlName: 'AllocatedTo', label: 'Allocated to', layer: 'x', nativeKeyword: 'allocate', sourceEnd: { name: 'a' }, targetEnd: { name: 'b' } },
            { name: 'motorLink', sysmlName: 'MotorLink', label: 'Motor link', layer: 'x', sysmlConstruct: 'interface def', sourceEnd: { name: 'a' }, targetEnd: { name: 'b' } },
            { name: 'mitigates', sysmlName: 'Mitigates', label: 'Mitigates', layer: 'x', sourceEnd: { name: 'a' }, targetEnd: { name: 'b' } },
        ],
    },
    services: { link: architectLink('http://localhost:4000/') },
};

const run = (name: string, input: Record<string, unknown>, at: ReadToolContext = context) => runReadTool(name, input, at) as Promise<any>;

describe('the shared read tools', () => {
    it('list allocations by how the ontology writes them, with links', async () => {
        const result = await run('memo_allocation', { id: 'p::motor' });
        expect(result.allocatedFrom.map((a: any) => a.relationshipId)).toEqual(['r1']);
        expect(result.allocatedFrom[0].other.link).toBe('http://localhost:4000/catalog/FN/FN-1');
        expect(result.allocatedTo).toEqual([]);
    });

    it('list the interfaces of a part through its ports', async () => {
        const result = await run('memo_interfaces', { id: 'p::motor' });
        expect(result.interfaces.map((c: any) => [c.relationshipId, c.end, c.other.name])).toEqual([['r2', 'p::motor::portIn', 'Controller']]);
        expect(result.flows).toEqual([]);
    });

    it('narrow validation to one element, info included', async () => {
        const result = await run('memo_validate', { element: 'p::drive' });
        expect(result.violations.map((v: any) => v.rule)).toEqual(['R-1', 'R-2']);
        expect(result.violations[0].link).toBe('http://localhost:4000/catalog/FN/FN-1');
        expect((await run('memo_validate', { rule: 'R-3' })).total).toBe(1);
    });

    it('say a service is missing rather than answer without it', async () => {
        await expect(run('memo_guide', {}, { ...context, services: {} })).rejects.toThrow(/not available/);
        await expect(run('memo_change_impact', {}, { ...context, services: {} })).rejects.toThrow(/not available/);
        await expect(run('memo_allocation', { id: 'p::motor' }, { ...context, registries: undefined })).rejects.toThrow(/not available/);
    });

    it('offer the session tools and, only when edits are allowed, the proposal tools', () => {
        const read = listTools(false).map(tool => tool.name);
        expect(read).toEqual(expect.arrayContaining(['memo_guide', 'memo_change_impact', 'memo_allocation', 'memo_interfaces', 'memo_systems', 'memo_select_system']));
        expect(read.some(name => name.startsWith('propose_'))).toBe(false);
        expect(listTools(true).some(tool => tool.name === 'propose_create_element')).toBe(true);
    });
});
