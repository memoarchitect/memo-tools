import { describe, expect, it } from 'vitest';
import { compilerConfigured, examplesPresent, withExample } from './helpers/compile-source.js';
import type { MemoElement, MemoModel, MemoRelationship } from '../model/semantic.js';
import { validateArchitecture } from '../validator/architecture-validator.js';
import { toElementIndex } from '../model/element-index.js';
import { RelationshipRegistry } from '../model/relationship-registry.js';

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
    return { elements: toElementIndex(byId), relationships, errors: [], packages: [], elementsByKind: new Map([['Block', elements]]), elementsByLayer: new Map(), relationshipsByType: new Map(), outgoing, incoming };
}

describe('AR-IBD-001 nested-part connectivity', () => {
    it('warns only the nested part with no IBD connector', () => {
        const result = validateArchitecture(model(
            [part('device'), part('sensor'), part('software'), part('battery')],
            [
                rel('composes', 'device', 'sensor'), rel('composes', 'device', 'software'), rel('composes', 'device', 'battery'),
                rel('flow', 'sensor', 'software'),
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
                rel('flow', 'module', 'software'),
            ],
        ));
        expect(result).toEqual([]);
    });

    it('counts a SysML interface usage as a connector', () => {
        const result = validateArchitecture(model(
            [part('lab'), part('mapping'), part('recording')],
            [
                rel('composes', 'lab', 'mapping'), rel('composes', 'lab', 'recording'),
                rel('interface', 'recording', 'mapping'),
            ],
        ));
        expect(result).toEqual([]);
    });

    // Which relations are connectors is the ontology's to say: `isConnector`, inherited along the supertype chain.
    const registry = () => {
        const r = new RelationshipRegistry();
        const entry = (sysmlName: string, rest: Record<string, unknown> = {}) => r.register({
            sysmlName, name: sysmlName[0].toLowerCase() + sysmlName.slice(1), label: sysmlName, layer: 'logical', ends: [], ...rest,
        } as never);
        entry('MemoRelationship', { isAbstract: true });
        entry('LogicalConnector', { superType: 'MemoRelationship', isConnector: true });
        entry('WiredLink', { superType: 'LogicalConnector' });
        entry('Mitigates', { superType: 'MemoRelationship' });
        return r;
    };
    const wired = (type: string, withRegistry = true) => validateArchitecture(model(
        [part('lab'), part('a'), part('b')],
        [rel('composes', 'lab', 'a'), rel('composes', 'lab', 'b'), rel(type, 'a', 'b')],
    ), undefined, undefined, withRegistry ? registry() : undefined).map(v => v.elementId);

    it('counts a relation the ontology declares a connector, and one that inherits the flag', () => {
        expect(wired('logicalConnector')).toEqual([]);
        expect(wired('wiredLink')).toEqual([]);
    });

    it('does not count a relation the ontology does not declare a connector', () => {
        expect(wired('mitigates').sort()).toEqual(['a', 'b']);
        expect(wired('satisfiedBy').sort()).toEqual(['a', 'b']);
    });

    it('sees only the native connectors without a relationship registry', () => {
        expect(wired('logicalConnector', false).sort()).toEqual(['a', 'b']);
        expect(wired('flow', false)).toEqual([]);
    });
});

describe.runIf(compilerConfigured && examplesPresent)('the connector flag as the ontology declares it', () => {
    it('is set on LogicalConnector and absent on a trace', async () => {
        await withExample({}, project => {
            const registry = project.registries!.relationshipRegistry!;
            expect(registry.isConnector('logicalConnector')).toBe(true);
            expect(registry.isConnector('mitigates')).toBe(false);
            // The rule sees the declared connectors in a real model, so an example's wired parts are not flagged.
            const connectors = new Set(project.model.relationships.filter(r => registry.isConnector(r.type)).map(r => r.type));
            expect([...connectors]).toEqual(['logicalConnector']);
        }, 'gpca-pump');
    }, 300_000);
});
