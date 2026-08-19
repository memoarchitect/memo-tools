import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { globSync } from 'node:fs';

// ─── Reversed connection-end lint ────────────────────────────────────────────
//
// `connection : HostedBy connect hostAssembly ::> a to processingNode ::> b;`
// looks like it binds each reference to the end it names. It does not — the
// builder binds by POSITION, and `HostedBy` declares `processingNode` as its
// source. So that usage produces an edge pointing the opposite way from what it
// reads like, and nothing complains: the type is right, both references
// resolve, and `syside check` is happy because SysML has no opinion about which
// end name you write first.
//
// Measured 2026-08-18 across the ontology and EPModel: 3 usages out of ~880 had
// their ends reversed — two `HostedBy` and one `Validates`. Three wrong edges
// in the graph, invisible for as long as nobody drew that diagram.
//
// The named-end syntax is what makes this possible, so the lint is the price of
// keeping it.
// ─────────────────────────────────────────────────────────────────────────────

const ONTOLOGY = resolve(__dirname, '../../../../../memo');

/** Declared (source, target) end names for every connection/allocation def. */
function declaredEnds(): Map<string, [string, string]> {
    const ends = new Map<string, [string, string]>();
    for (const rel of globSync('src/**/*.sysml', { cwd: ONTOLOGY })) {
        const source = readFileSync(join(ONTOLOGY, rel), 'utf8');
        const defs = source.matchAll(/(?:connection|allocation) def (\w+)[^{]*\{(.*?)\n {4}\}/gs);
        for (const def of defs) {
            const roles = new Map<string, string>();
            for (const end of def[2].matchAll(/end (\w+)\s*(?::[^;]*?)?:>> (source|target)/g)) {
                roles.set(end[2], end[1]);
            }
            const s = roles.get('source'), t = roles.get('target');
            if (s && t) ends.set(def[1], [s, t]);
        }
    }
    return ends;
}

describe('connection usages name their ends in declaration order', () => {
    it('no usage writes its ends reversed', () => {
        if (!existsSync(ONTOLOGY)) return;
        const ends = declaredEnds();
        expect(ends.size).toBeGreaterThan(20); // the scan itself still works

        const reversed: string[] = [];
        const files = globSync('{src,examples,templates,extensions}/**/*.sysml',
            { cwd: ONTOLOGY });
        for (const file of files) {
            const usages = readFileSync(join(ONTOLOGY, file), 'utf8').matchAll(
                /connection\s*\w*\s*:\s*(\w+)\s+connect\s+(\w+)\s*::>\s*\S+\s+to\s+(\w+)\s*::>/g);
            for (const [, type, sourceEnd, targetEnd] of usages) {
                const declared = ends.get(type);
                if (!declared) continue;
                if (sourceEnd === declared[1] && targetEnd === declared[0]) {
                    reversed.push(`${file}: ${type} `
                        + `writes ${sourceEnd} first, but ${declared[0]} is the source`);
                }
            }
        }
        expect(reversed, 'these edges point the opposite way from how they read').toEqual([]);
    });
});
