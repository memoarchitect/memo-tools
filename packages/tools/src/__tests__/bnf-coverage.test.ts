// ─── Grammar coverage against the normative BNF (Track B B5) ─────────────────
//
// What is worth testing about a measurement is that it measures the thing it
// claims to. Two properties do the work here: a production declared in both
// normative files is one production rather than two, and a lexical production
// is answered by a terminal rather than by a parser rule with the same name.
// Both were wrong in the first draft and both inflate coverage when wrong.
// ─────────────────────────────────────────────────────────────────────────────

import { describe, expect, it } from 'vitest';
import { readLangiumGrammar, runBnfCoverage } from '../conformance/bnf.js';
import { defaultGrammarPath } from '../conformance/bnf.js';
import { memoVersion } from '../version.js';

const report = runBnfCoverage({ memoVersion: memoVersion() });

describe('normative production inventory', () => {
    it('counts a production declared in both grammars once', () => {
        const names = report.productions.map(production => production.name);
        expect(new Set(names).size).toBe(names.length);
        // `Package` is declared in the KerML grammar and restated in SysML's;
        // it must be one row, attributed to the KerML file.
        const pkg = report.productions.find(production => production.name === 'Package');
        expect(pkg?.source).toContain('KerML');
    });

    it('separates lexical productions from syntactic ones', () => {
        const lexical = report.productions.filter(production => production.lexical);
        expect(lexical.map(production => production.name)).toContain('LINE_TERMINATOR');
        expect(lexical.every(production => /^[A-Z][A-Z0-9_]*$/.test(production.name))).toBe(true);
        expect(report.totals.lexical.total).toBe(lexical.length);
        expect(report.totals.syntactic.total).toBe(report.productions.length - lexical.length);
    });
});

describe('coverage against MEMO\'s grammar', () => {
    it('credits a production only where a rule of that name exists', () => {
        const grammar = readLangiumGrammar(defaultGrammarPath());
        const rules = new Set(grammar.parserRules);
        for (const production of report.productions.filter(p => p.status === 'covered' && !p.lexical)) {
            expect(rules.has(production.name), production.name).toBe(true);
        }
    });

    it('does not let a parser rule answer a lexical production, or the reverse', () => {
        const grammar = readLangiumGrammar(defaultGrammarPath());
        const terminals = new Set(grammar.terminals);
        for (const production of report.productions.filter(p => p.status === 'covered' && p.lexical)) {
            expect(terminals.has(production.name), production.name).toBe(true);
        }
    });

    it('reports the package grammar as covered, since the grammar names it', () => {
        // `standard library package` was taken on this session; the production
        // MEMO implements it under is `PackageDeclaration`.
        const declaration = report.productions.find(production => production.name === 'PackageDeclaration');
        expect(declaration?.status).toBe('covered');
    });

    it('is a small fraction of the language, and says so rather than rounding up', () => {
        // The point of the number is that it is low. A change that made this
        // assertion fail by going *up* is welcome and should re-baseline; one
        // that made it pass by shrinking the denominator is a bug.
        expect(report.totals.syntactic.total).toBeGreaterThan(400);
        expect(report.totals.syntactic.covered).toBeLessThan(report.totals.syntactic.total / 2);
    });
});
