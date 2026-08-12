import { describe, expect, it } from 'vitest';
import type { MemoElement, MemoModel, MemoRelationship } from '../model/semantic.js';
import { validateArchitecture } from '../validator/architecture-validator.js';

const part = (id: string): MemoElement => ({ id, name: id, kind: 'Block', construct: 'part', layer: 'logical', file: 'test.sysml', attributes: {} });
const rel = (type: string, sourceId: string, targetId: string): MemoRelationship => ({ id: `${type}-${sourceId}-${targetId}`, type, sourceId, targetId, sourceEnd: '', targetEnd: '', file: 'test.sysml' });

function model(elements: MemoElement[], relationships: MemoRelationship[]): MemoModel {
    const byId = new Map(elements.map(element => [element.id, element]));
    const outgoing = new Map<string, MemoRelationship[]>();
    const incoming = new Map<string, MemoRelationship[]>();
    for (const relationship of relationships) {
        outgoing.set(relationship.sourceId, [...(outgoing.get(relationship.sourceId) ?? []), relationship]);
        incoming.set(relationship.targetId, [...(incoming.get(relationship.targetId) ?? []), relationship]);
    }
    return { elements: byId, relationships, errors: [], packages: [], elementsByKind: new Map([['Block', elements]]), elementsByLayer: new Map(), relationshipsByType: new Map(), outgoing, incoming };
}

describe('AR-IBD-001 nested-part connectivity', () => {
    it('warns only the nested part with no IBD connector', () => {
        const result = validateArchitecture(model(
            [part('device'), part('sensor'), part('software'), part('battery')],
            [
                rel('composes', 'device', 'sensor'), rel('composes', 'device', 'software'), rel('composes', 'device', 'battery'),
                rel('exchangesWith', 'sensor', 'software'),
            ],
        ));
        expect(result.map(v => v.elementId)).toEqual(['battery']);
        expect(result[0].ruleId).toBe('AR-IBD-001');
        expect(result[0].severity).toBe('warning');
    });

    it('counts a connector on a child as a connection for its containing assembly', () => {
        const result = validateArchitecture(model(
            [part('device'), part('assembly'), part('module'), part('software')],
            [
                rel('composes', 'device', 'assembly'), rel('composes', 'assembly', 'module'), rel('composes', 'device', 'software'),
                rel('exchangesWith', 'module', 'software'),
            ],
        ));
        expect(result).toEqual([]);
    });
});
