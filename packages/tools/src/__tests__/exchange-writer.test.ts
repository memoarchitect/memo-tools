import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { removeRelationship, writeRelationship } from '../server/relationship-writer.js';
import { legalRelationshipDirections, type RelationshipDefinitionDTO } from '../model/relationship-legality.js';
import type { MemoElement } from '../model/semantic.js';
import { compilerConfigured, directoryOutlines } from './helpers/compile-source.js';

// ─── Architect writes and deletes the native exchange forms ─────────────────────────────
//
// Since 2026-09-24 an exchange is a typed named `flow` (FunctionalExchange), a typed named
// `interface … connect` (ComponentExchange), or a named `binding`. The writer looked a named
// relationship up among `ConnectionUsage` nodes only, so deleting any of them answered "was not
// found". Each is removed here and nothing else is: the ports, the sibling exchanges and the
// comments stay.
// ─────────────────────────────────────────────────────────────────────────────

const SOURCE = `package P {
    port def Pt;
    abstract interface def CE;
    abstract flow def FE;
    part def Comp;
    part a : Comp { port p : Pt; }
    part b : Comp { port q : Pt; }
    // the three exchanges
    interface ce1 : CE connect a.p to b.q;
    flow fe1 : FE from a.p to b.q;
    binding bd1 bind a.p = b.q;
}
`;

let root: string;
beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'exchange-writer-'));
    mkdirSync(join(root, 'model'));
    writeFileSync(join(root, 'model/p.sysml'), SOURCE);
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe.runIf(compilerConfigured)('removing a native exchange', () => {
    const cases: [string, string, string][] = [
        ['a ComponentExchange', 'ce1', 'interface ce1 : CE connect a.p to b.q;'],
        ['a FunctionalExchange', 'fe1', 'flow fe1 : FE from a.p to b.q;'],
        ['a named binding', 'bd1', 'binding bd1 bind a.p = b.q;'],
    ];
    for (const [label, name, declaration] of cases) {
        it(`removes ${label} and only it`, async () => {
            const result = await removeRelationship(
                { id: `P::${name}`, shortName: name, file: 'model/p.sysml', named: true } as never,
                { projectRoot: root, outlines: directoryOutlines(root, '') },
            );
            expect(result.success, result.error).toBe(true);
            const written = readFileSync(join(root, 'model/p.sysml'), 'utf8');
            expect(written).not.toContain(declaration);
            expect(written.split('\n').filter(line => cases.some(c => c[1] !== name && line.includes(c[2])))).toHaveLength(2);
            expect(written).toContain('part a : Comp { port p : Pt; }');
            expect(written).toContain('// the three exchanges');
        }, 60_000);
    }
});

// ─── Creating them ───────────────────────────────────────────────────────────
//
// An interface's ends are ports (`InterfaceEnd : PortUsage`, SysML-textual-bnf.kebnf:785); a flow's
// are features. Both are usages typed by the ontology's definition and take a name of their own.

const componentExchange: RelationshipDefinitionDTO = {
    name: 'ce', sysmlName: 'CE', label: 'CE', layer: 'logical', sysmlConstruct: 'interface def',
    sourceEnd: { name: 'source', construct: 'port' }, targetEnd: { name: 'target', construct: 'port' },
};
const functionalExchange: RelationshipDefinitionDTO = {
    name: 'fe', sysmlName: 'FE', label: 'FE', layer: 'functional', sysmlConstruct: 'flow def',
    sourceEnd: { name: 'source' }, targetEnd: { name: 'target' },
};

const BARE = SOURCE.split('\n').filter(line => !/^    (interface|flow|binding) /.test(line)).join('\n');
const element = (id: string, shortName: string, construct: MemoElement['construct'], owner?: string): MemoElement => ({
    id, name: shortName, shortName, kind: construct === 'port' ? 'SoftwarePort' : 'SoftwareComponent', construct,
    layer: 'logical', file: 'model/p.sysml', package: 'P', attributes: {}, ...(owner ? { owner } : {}),
}) as MemoElement;
const ELEMENTS = [
    element('P::a', 'a', 'part'), element('P::b', 'b', 'part'),
    element('P::a::p', 'p', 'port', 'P::a'), element('P::b::q', 'q', 'port', 'P::b'),
];
const model = () => ({ elements: Object.fromEntries(ELEMENTS.map(e => [e.id, e])), relationships: [] });

describe('legality of the exchange forms', () => {
    it('lets an interface join ports and nothing else, and a flow join anything', () => {
        const registries = { relationships: [], kinds: [] };
        expect(legalRelationshipDirections(ELEMENTS[2], componentExchange, registries)).toEqual(['outgoing', 'incoming']);
        expect(legalRelationshipDirections(ELEMENTS[0], componentExchange, registries)).toEqual([]);
        expect(legalRelationshipDirections(ELEMENTS[0], functionalExchange, registries)).toEqual(['outgoing', 'incoming']);
    });
});

describe.runIf(compilerConfigured)('creating a native exchange', () => {
    const cases: [string, RelationshipDefinitionDTO, string][] = [
        ['a ComponentExchange', componentExchange, 'interface'],
        ['a FunctionalExchange', functionalExchange, 'flow'],
    ];
    for (const [label, definition, keyword] of cases) {
        it(`writes ${label} as a named ${keyword} that compiles, once`, async () => {
            writeFileSync(join(root, 'model/p.sysml'), BARE);
            const result = await writeRelationship(
                { requestId: 'r', type: definition.name, sourceId: 'P::a::p', targetId: 'P::b::q', direction: 'outgoing' } as never,
                definition, model(), { projectRoot: root, outlines: directoryOutlines(root, '') });
            expect(result.error).toBeUndefined();
            expect(result.success).toBe(true);
            expect(result.relationshipId).toBeDefined();
            const written = readFileSync(join(root, 'model/p.sysml'), 'utf8');
            expect(written).toContain(`${keyword} ${result.relationshipId} : ${definition.sysmlName}`);
            expect(written).toContain('a.p to b.q;');
            expect(written.split(`${keyword} ${result.relationshipId}`)).toHaveLength(2);
            // No shadow part: the model gains no other declaration than the exchange.
            expect(written.replace(result.declaration!, '').replace(/\n\s*\n/g, '\n').trim())
                .toBe(BARE.replace(/\n\s*\n/g, '\n').trim());
        }, 60_000);
    }
});
