// ─── The relationship types Architect's views name are declared ───────────────
//
// Architect selects relationships through `relationshipsOfType` (a literal-free
// way to say it is guarded in memo-architect). That checks a name when a view
// runs, against a model that carries registries; this checks every literal
// written at a call site against the resolved ontology's, at test time, so a
// type the ontology never declared (or no longer declares) fails here and not as
// an empty view. `checkSelectorVocabulary` is the same check for the selectors a
// model authors.
//
// A literal the ontology does not declare yet is registered below with the view
// that holds it, as a validator gap is: the test fails on any undeclared literal
// that is not listed, and on any listed one that is declared now or is gone from
// the source, so the register cannot outlive the gap.
// ─────────────────────────────────────────────────────────────────────────────

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { toModelType } from '../model/naming.js';
import { undeclaredRelationshipTypes } from '../model/relation-selection.js';
import { compiledExample, compilerConfigured, examplesPresent } from './helpers/compile-source.js';

const web = resolve(__dirname, '../../../../../memo-architect/packages/web/src');

/** Undeclared literals Architect still names: `<file relative to web/src>: name`. */
const KNOWN_UNDECLARED: Record<string, string[]> = {
    // Names from before the ontology's relations were renamed or removed; each view
    // selects nothing in every model. On the board: "Architect views select
    // relationship types the ontology does not declare".
    'views/ComplianceWizard.tsx': ['verify', 'traceTo'],
    'views/templates/geometry-view.ts': ['navigatesTo'],
    'views/templates/sequence-view.ts': ['realizesScenario'],
};

function sources(dir: string, out: string[] = []): string[] {
    for (const name of readdirSync(dir)) {
        const full = join(dir, name);
        if (statSync(full).isDirectory()) {
            if (name !== '__tests__' && name !== 'node_modules') sources(full, out);
        } else if (/\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name)) {
            out.push(full);
        }
    }
    return out;
}

/** The string literals handed to the selecting calls, with the file each is in. */
function selectedLiterals(): { file: string; name: string }[] {
    const calls = /\b(?:relationshipsOfType\(\s*[\w.?]+|byType\(|relatedIds\(\s*[\w.?]+)((?:\s*,?\s*'[^']*')+)\s*\)/g;
    return sources(web).flatMap(path => {
        const text = readFileSync(path, 'utf8');
        return [...text.matchAll(calls)].flatMap(match =>
            [...match[1].matchAll(/'([^']*)'/g)].map(literal => ({ file: relative(web, path), name: literal[1] })));
    });
}

describe.runIf(compilerConfigured && examplesPresent && existsSync(web))('the relationship types Architect names', () => {
    it('are declared by the ontology, or registered here', async () => {
        const literals = selectedLiterals();
        expect(literals.length).toBeGreaterThan(10); // the scan found the call sites

        // The ontology and its extensions are in every project's handoff.
        const { registries } = await compiledExample('gpca-pump');
        const declared = registries?.relationshipRegistry?.relTypeNames() ?? [];
        expect(declared.length).toBeGreaterThan(50);

        const missing = new Set(undeclaredRelationshipTypes([...new Set(literals.map(l => l.name))], declared).map(u => toModelType(u.name)));
        const actual = literals.filter(l => missing.has(toModelType(l.name)));
        const found = [...new Set(actual.map(l => `${l.file}: ${toModelType(l.name)}`))].sort();
        const registered = Object.entries(KNOWN_UNDECLARED).flatMap(([file, names]) => names.map(n => `${file}: ${toModelType(n)}`)).sort();
        expect({ undeclared: found.filter(f => !registered.includes(f)), noLongerUndeclared: registered.filter(r => !found.includes(r)) })
            .toEqual({ undeclared: [], noLongerUndeclared: [] });
    }, 300_000);
});
