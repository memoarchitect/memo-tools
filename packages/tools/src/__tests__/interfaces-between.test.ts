import { describe, it, expect } from 'vitest';
import { interfacesBetween } from '../analysis/interfaces-between.js';
import type { MemoElement, MemoModelDTO } from '../model/semantic.js';

const el = (id: string, owner?: string, kind = 'Thing'): MemoElement =>
    ({ id, name: id, kind, layer: 'logical', construct: 'part' as const, doc: '', attributes: {}, file: 'a.sysml', owner });

function model(): MemoModelDTO {
    return {
        errors: [],
        elements: {
            lidar: el('lidar'), nav: el('nav'), safety: el('safety'),
            'lidar::pub': el('lidar::pub', 'lidar'), 'nav::sub': el('nav::sub', 'nav'),
            'safety::sub': el('safety::sub', 'safety'), 'nav::pub': el('nav::pub', 'nav'),
            'nav::inner': el('nav::inner', 'nav'), 'nav::inner::port': el('nav::inner::port', 'nav::inner'),
        },
        relationships: [
            { id: 'topic1', type: 'interface', kind: 'RosTopicInterface', sourceId: 'lidar::pub', targetId: 'nav::sub', sourceEnd: 'source', targetEnd: 'target', file: '', attributes: { direction: 'output' } },
            { id: 'topic2', type: 'interface', kind: 'RosTopicInterface', sourceId: 'lidar::pub', targetId: 'safety::sub', sourceEnd: 'source', targetEnd: 'target', file: '' },
            { id: 'svc', type: 'interface', kind: 'RosServiceInterface', sourceId: 'nav::pub', targetId: 'lidar::pub', sourceEnd: 'source', targetEnd: 'target', file: '' },
            { id: 'nested', type: 'interface', kind: 'PhysicalInterface', sourceId: 'nav::inner::port', targetId: 'safety::sub', sourceEnd: 'source', targetEnd: 'target', file: '' },
            { id: 'flow1', type: 'flow', sourceId: 'lidar::pub', targetId: 'nav::sub', sourceEnd: '', targetEnd: '', file: '' },
        ],
    };
}

describe('interfacesBetween', () => {
    it('finds every interface between two elements, in either direction', () => {
        const found = interfacesBetween(model(), 'lidar', 'nav');
        expect(found.map(f => f.id)).toEqual(['svc', 'topic1']);
        expect(found.find(f => f.id === 'svc')?.reversed).toBe(true);
        expect(found.find(f => f.id === 'topic1')?.reversed).toBe(false);
    });
    it('ignores other relationship types and interfaces to a third element', () => {
        expect(interfacesBetween(model(), 'lidar', 'nav').some(f => f.id === 'flow1' || f.id === 'topic2')).toBe(false);
    });
    it('counts a port on something nested inside the element, unless told not to', () => {
        expect(interfacesBetween(model(), 'nav', 'safety').map(f => f.id)).toEqual(['nested']);
        expect(interfacesBetween(model(), 'nav', 'safety', { includeNested: false })).toEqual([]);
    });
    it('filters by kind through the ontology specialization chain', () => {
        const conforms = (kind: string, ancestor: string) => ancestor === 'SoftwareInterface' && kind.startsWith('Ros');
        const ros = interfacesBetween(model(), 'lidar', 'nav', { kind: 'SoftwareInterface', kindConforms: conforms });
        expect(ros.map(f => f.id)).toEqual(['svc', 'topic1']);
        expect(interfacesBetween(model(), 'nav', 'safety', { kind: 'SoftwareInterface', kindConforms: conforms })).toEqual([]);
    });
});
