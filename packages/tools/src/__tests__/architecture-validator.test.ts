import { describe, expect, it } from 'vitest';
import { compilerConfigured, examplesPresent, withExample } from './helpers/compile-source.js';
import type { MemoElement, MemoModel, MemoRelationship, PortSpec } from '../model/semantic.js';
import { validateArchitecture } from '../validator/architecture-validator.js';
import { toElementIndex } from '../model/element-index.js';
import { validateModel } from '../validator/rule-engine.js';
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

// ─── AR-EXCH-001 and AR-EXCH-002 ─────────────────────────────────────────────
//
// Direction is written on the ports; an exchange is held to it, so the two cannot disagree.

const port = (id: string, direction?: PortSpec['direction'], isConjugated = false): MemoElement =>
    ({ id, name: id, kind: 'SoftwarePort', construct: 'port', layer: 'logical', file: 'test.sysml', attributes: {}, portSpec: { type: 'T', direction, isConjugated } });

describe('an exchange agrees with the ports it joins', () => {
    const check = (type: string, source: MemoElement, target: MemoElement) =>
        validateArchitecture(model([source, target], [rel(type, source.id, target.id)])).filter(v => v.ruleId.startsWith('AR-EXCH'));

    it('accepts a binding of two ports of one direction, and an exchange from an out port to an in port', () => {
        expect(check('bind', port('a', 'in'), port('b', 'in'))).toEqual([]);
        expect(check('bind', port('a', 'out'), port('b', 'out'))).toEqual([]);
        expect(check('interface', port('a', 'out'), port('b', 'in'))).toEqual([]);
        expect(check('flow', port('a', 'inout'), port('b', 'in'))).toEqual([]);
    });

    it('rejects a binding of an in port to an out port', () => {
        const found = check('bind', port('a', 'in'), port('b', 'out'));
        expect(found.map(v => [v.ruleId, v.severity, v.elementId])).toEqual([['AR-EXCH-001', 'error', 'a']]);
    });

    it('rejects an exchange that leaves an in port or enters an out port', () => {
        expect(check('interface', port('a', 'in'), port('b', 'in')).map(v => v.ruleId)).toEqual(['AR-EXCH-002']);
        expect(check('flow', port('a', 'out'), port('b', 'out')).map(v => v.ruleId)).toEqual(['AR-EXCH-002']);
    });

    it('reads a conjugated port from the other side', () => {
        // `~` turns an `in` port into one that sends: out -> ~in is legal, and ~in -> ~in is not.
        expect(check('interface', port('a', 'out'), port('b', 'out', true))).toEqual([]);
        expect(check('interface', port('a', 'in', true), port('b', 'in'))).toEqual([]);
        expect(check('bind', port('a', 'in', true), port('b', 'out'))).toEqual([]);
        expect(check('bind', port('a', 'in', true), port('b', 'in')).map(v => v.ruleId)).toEqual(['AR-EXCH-001']);
    });

    it('does not judge a port that states no direction, or an end that is not a port', () => {
        expect(check('bind', port('a'), port('b', 'out'))).toEqual([]);
        expect(check('interface', port('a'), port('b'))).toEqual([]);
        expect(check('interface', part('p'), port('b', 'out'))).toEqual([]);
    });

    it('is raised by the rule engine, whose delegated rules need no tailoring to run', () => {
        const result = validateModel(model([port('a', 'in'), port('b', 'out')], [rel('bind', 'a', 'b')]));
        expect(result.violations.map(v => v.ruleId)).toContain('AR-EXCH-001');
    });
});

describe.runIf(compilerConfigured && examplesPresent)('AR-EXCH-001 and AR-EXCH-002 on a compiled model', () => {
    // Port direction as the compiler states it, conjugation included: a contradiction written in source is found.
    const SEEDED = `package seeded_directions {
    private import memo_architecture_logical_interfaces::*;
    private import memo_architecture_logical_structure::*;
    part station : LogicalComponent {
        part sender : LogicalComponent { out port tx : SoftwarePort; }
        part receiver : LogicalComponent { in port rx : SoftwarePort; out port ry : SoftwarePort; }
        // tx sends and rx receives: legal. rx sends: not.
        interface okExchange connect sender.tx to receiver.rx;
        interface wrongWay connect receiver.rx to sender.tx;
        binding okBinding bind receiver.ry = sender.tx;
        binding wrongBinding bind receiver.rx = sender.tx;
    }
}`;
    it('finds an interface that leaves an in port and a binding of an in port to an out port, and not the legal ones', async () => {
        await withExample({ 'model/catalog/seeded_directions.sysml': SEEDED }, project => {
            const found = validateArchitecture(project.model).filter(v => v.ruleId.startsWith('AR-EXCH'));
            expect(found.map(v => [v.ruleId, v.elementId.split('::').pop()]).sort()).toEqual([['AR-EXCH-001', 'rx'], ['AR-EXCH-002', 'rx']]);
        }, 'gpca-pump');
    }, 300_000);
});

