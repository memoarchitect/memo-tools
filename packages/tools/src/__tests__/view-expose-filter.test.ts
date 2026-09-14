// ─── `expose x::*[@Metaclass]` narrows a view's membership ────────────────────

import { describe, expect, it } from 'vitest';
import { deriveModelViews } from '../model/view-deriver.js';
import type { MemoElement, MemoModel } from '../model/semantic.js';

const element = (id: string, over: Partial<MemoElement> = {}): MemoElement => ({
    id, name: id, kind: 'SoftwareSystem', construct: 'part',
    layer: 'software_structure', file: 'test.sysml', attributes: {}, ...over,
} as MemoElement);

const modelOf = (els: MemoElement[]) => ({
    elements: new Map(els.map(e => [e.id, e])), relationships: [], incoming: new Map(),
    packages: [], errors: [],
} as unknown as MemoModel);

/** subsystem owns a node (which owns a port) and two boundary ports of its own. */
const subsystem = () => [
    element('subsystem'),
    element('node', { kind: 'RosNode', owner: 'subsystem' }),
    element('nodePort', { kind: 'RosPublisher', construct: 'port', owner: 'node' }),
    element('boundaryOut', { kind: 'RosPublisher', construct: 'port', owner: 'subsystem' }),
    element('boundaryIn', { kind: 'RosSubscriber', construct: 'port', owner: 'subsystem' }),
    element('PortType', { kind: 'RosPublisher', construct: 'port', isDefinition: true, owner: 'subsystem' }),
];

function idsOf(attributes: Record<string, string>): string[] {
    const view = element('v', { kind: 'DiagramView', construct: 'view', attributes });
    const [diagram] = deriveModelViews(modelOf([...subsystem(), view])).diagrams;
    expect(diagram).toBeDefined();
    return [...(diagram!.elementIds ?? [])].sort();
}

describe('expose filter condition', () => {
    it('without a filter, exposes the part and everything it directly owns', () => {
        expect(idsOf({ expose: 'subsystem::*' }))
            .toEqual(['PortType', 'boundaryIn', 'boundaryOut', 'node', 'subsystem']);
    });

    it('[@SysML::PortUsage] keeps only the port usages the part owns', () => {
        // A subsystem's boundary ports, inferred from structure: its own
        // ports, not the ports of the nodes nested inside it.
        expect(idsOf({ expose: 'subsystem::*', 'exposeFilter.0': 'SysML::PortUsage' }))
            .toEqual(['boundaryIn', 'boundaryOut']);
    });

    it('a Definition metaclass keeps only definitions', () => {
        expect(idsOf({ expose: 'subsystem::*', 'exposeFilter.0': 'PortDefinition' }))
            .toEqual(['PortType']);
    });

    it('a filter narrows only the expose it is written on', () => {
        expect(idsOf({
            expose: 'subsystem::*,node::*',
            'exposeFilter.0': 'SysML::PortUsage',
        })).toEqual(['boundaryIn', 'boundaryOut', 'node', 'nodePort']);
    });
});
