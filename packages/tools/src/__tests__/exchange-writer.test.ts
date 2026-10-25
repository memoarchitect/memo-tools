import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { removeRelationship } from '../server/relationship-writer.js';
import { compilerConfigured, directoryOutlines } from './helpers/compile-source.js';

// ─── Architect deletes the native exchange forms ─────────────────────────────
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
