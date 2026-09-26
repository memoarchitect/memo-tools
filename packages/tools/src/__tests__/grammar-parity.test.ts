// ─── Grammar parity corpus ───────────────────────────────────────────────────
//
// `bnf-coverage.test.ts` scores the grammar by NAME: a production is covered
// when a rule of that name exists. That says the grammar has somewhere to put
// the construct, not that it accepts it. This corpus is the acceptance half,
// one fixture per production, named after the normative production it shows:
//
//   supported/    MEMO parses it with no lexer or parser error. Every
//                 production the coverage report calls covered has one, so a
//                 rule cannot be credited without a construct it accepts.
//   unsupported/  MEMO rejects it. Each is a gap written down, so a grammar
//                 change that closes one fails here and the fixture moves
//                 across, rather than the gap closing (or opening) unnoticed.
//
// A file is `<Production>.sysml`, or `<Production>.<form>.sysml` when it shows
// one form of the production. The second spelling is what lets a production
// sit on both sides: `ConnectionUsage` is credited by name and parses inside a
// part usage, and `ConnectionUsage.in-definition-body` is the same construct
// inside a `part def`, which MEMO rejects. That split — surface present, a form
// refused — is precisely what the name-based count cannot see.
//
// Both directories are valid SysML v2 as the OMG specification defines it — the
// normative BNF beside the coverage report, and the specification's constraints.
// That is what makes a fixture in unsupported/ a gap in MEMO's grammar rather
// than input MEMO is right to refuse. `scripts/check-syside-gate.mjs` also runs
// `syside check --diagnose all --warnings-as-errors` over both, as the
// compatibility check. If SysIDE ever rejects a fixture the specification
// admits, that is a SysIDE gap: board it with the production that settles it
// and leave the fixture as the specification writes it. Never re-spell a
// fixture to suit either tool.
// ─────────────────────────────────────────────────────────────────────────────

import { readdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { EmptyFileSystem } from 'langium';
import { parseHelper } from 'langium/test';
import { describe, expect, it } from 'vitest';
import { runBnfCoverage } from '../conformance/bnf.js';
import { createMemoSysMLServices } from '../language/memo-sysml-module.js';
import type { Model } from '../language/generated/ast.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), 'fixtures/grammar-parity');
const parse = parseHelper<Model>(createMemoSysMLServices({ ...EmptyFileSystem }).MemoSysML);
const report = runBnfCoverage({ memoVersion: 'test' });
const byName = new Map(report.productions.map(production => [production.name, production]));

function fixtures(kind: 'supported' | 'unsupported'): string[] {
    return readdirSync(resolve(root, kind))
        .filter(file => file.endsWith('.sysml'))
        .map(file => file.slice(0, -'.sysml'.length))
        .sort();
}

/** `ConnectionUsage.in-definition-body` → `ConnectionUsage`. */
const productionOf = (fixture: string) => fixture.split('.')[0];

async function errorsIn(kind: 'supported' | 'unsupported', fixture: string): Promise<string[]> {
    const document = await parse(readFileSync(resolve(root, kind, `${fixture}.sysml`), 'utf-8'));
    return [...document.parseResult.lexerErrors, ...document.parseResult.parserErrors].map(error => error.message);
}

const supported = fixtures('supported');
const unsupported = fixtures('unsupported');

describe('the corpus is named by the normative grammar', () => {
    it('names every fixture after a production of the KerML or SysML textual BNF', () => {
        const unknown = [...supported, ...unsupported].filter(name => !byName.has(productionOf(name)));
        expect(unknown).toEqual([]);
    });

    it('has a supported fixture for every production the coverage report credits', () => {
        const shown = new Set(supported.map(productionOf));
        const credited = report.productions.filter(production => production.status === 'covered').map(p => p.name);
        expect(credited.filter(name => !shown.has(name))).toEqual([]);
    });
});

describe('supported productions parse', () => {
    it.each(supported)('%s', async fixture => {
        expect(await errorsIn('supported', fixture)).toEqual([]);
    });
});

describe('unsupported productions are rejected', () => {
    // A failure here is good news: the grammar now accepts this construct.
    // Move the fixture to supported/ and, if the production gained a rule of
    // its own name, re-baseline `corpus/baselines/bnf.json`.
    it.each(unsupported)('%s', async fixture => {
        expect((await errorsIn('unsupported', fixture)).length).toBeGreaterThan(0);
    });
});
