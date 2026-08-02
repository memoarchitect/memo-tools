// Nothing outside an adapter knows a provider's name.
//
// This is the guard on §1.2. The old `model/toolchain.ts` failed it twice per
// role — `if (provider === 'internal') return undefined` and
// `if (provider !== 'syside') throw` — and that is exactly the shape that makes
// adding a provider a multi-file edit. Enforced the same way ontology name
// uniqueness is: by looking, not by hoping.
//
// The check is on *string literals*, which is the form a hardcoded roster takes.
// A file may still contain the word — `memo import sysand` is a command name for
// a different feature — so `.command('<id>')` is allowed and nothing else is.

import { readFileSync, readdirSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createDefaultRegistry } from '../toolchain/default-registry.js';

const SRC = resolve(__dirname, '..');
const ADAPTER_DIR = join(SRC, 'toolchain', 'providers');
const TEST_DIR = __dirname;

/** Naming a CLI subcommand is not selecting a provider. */
const ALLOWED_USAGES = [
    (id: string) => new RegExp(`\\.command\\((['"])${id}\\1\\)`, 'g'),
];

function sourceFiles(dir: string): string[] {
    return readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) {
            if (entry.name === 'generated' || entry.name === 'node_modules') return [];
            return sourceFiles(full);
        }
        return entry.name.endsWith('.ts') && !entry.name.endsWith('.d.ts') ? [full] : [];
    });
}

/**
 * Strip comments and allowed usages before looking.
 *
 * Prose that *names* a provider while explaining why the code must not is the
 * point of the comment, not a violation of it.
 */
function scannable(source: string, id: string): string {
    let text = source
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/^[ \t]*\/\/.*$/gm, '')
        .replace(/([^:"'`\\])\/\/.*$/gm, '$1');
    for (const usage of ALLOWED_USAGES) text = text.replace(usage(id), '');
    return text;
}

describe('provider IDs stay inside their adapters', () => {
    const registry = createDefaultRegistry();
    const ids = registry.allIds();

    it('has providers to check', () => {
        expect(ids.length).toBeGreaterThan(1);
    });

    for (const id of ids) {
        it(`"${id}" appears as a literal only in its own adapter`, () => {
            const literal = new RegExp(`(['"\`])${id}\\1`);
            const offenders: string[] = [];
            for (const file of sourceFiles(SRC)) {
                // Adapters own their ID; tests exercise selection by ID, which
                // is the public interface and the whole point.
                if (file.startsWith(ADAPTER_DIR) || file.startsWith(TEST_DIR)) continue;
                const text = scannable(readFileSync(file, 'utf8'), id);
                for (const [index, line] of text.split('\n').entries()) {
                    if (literal.test(line)) offenders.push(`${relative(SRC, file)}:${index + 1}: ${line.trim()}`);
                }
            }
            expect(offenders, `"${id}" is written outside ${relative(SRC, ADAPTER_DIR)}:\n  `
                + offenders.join('\n  ') + '\n').toEqual([]);
        });
    }

    it('has no closed union of provider IDs left anywhere', () => {
        const union = /'(internal|syside|sysand)'\s*\|\s*'/;
        const offenders = sourceFiles(SRC)
            .filter(file => !file.startsWith(TEST_DIR))
            .filter(file => union.test(readFileSync(file, 'utf8')));
        expect(offenders.map(f => relative(SRC, f))).toEqual([]);
    });
});
