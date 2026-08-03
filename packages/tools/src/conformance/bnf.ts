// ─── memo conformance bnf — grammar coverage against the normative BNF ───────
//
// Track B B5 says to grow the Langium grammar toward `bnf/KerML-textual-bnf.kebnf`
// and `bnf/SysML-textual-bnf.kebnf`, and it says why those files rather than a
// reading of the spec prose: they are machine-readable, so coverage against
// them is measurable rather than a judgment call. This is the measurement.
//
// **What is being counted, stated precisely.** A normative production is
// "covered" when the Langium grammar declares a rule of the same name. That is
// a claim about *surface* — the grammar has somewhere to put this construct —
// and emphatically not a claim that the rule accepts everything the production
// accepts. A rule named `PackageDeclaration` that parses a third of what the
// normative `PackageDeclaration` parses counts as covered here.
//
// A weaker measure than one might want, and it is the honest one available:
// judging acceptance would mean comparing two grammars for language
// equivalence, which is undecidable in general and impractical here. What this
// measure is good for is exactly what B5 needs — a number that moves when a
// production is taken on, a list of what has not been touched, and a baseline
// that fails CI when coverage silently drops. The corpus parse counts in
// `memo conformance run` are the complementary measure, and they *do* judge
// acceptance, on real files.
//
// The two measures disagreeing is informative rather than contradictory: high
// name coverage with a failing corpus means the rules are shallow, which is
// precisely the situation this grammar is in today.
// ─────────────────────────────────────────────────────────────────────────────

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    BNF_TREE,
    corpusRelative,
    loadCorpus,
    provenanceOf,
    type Corpus,
    type CorpusProvenance,
} from './corpus.js';

/** The two normative textual grammars, corpus-relative. */
export const TEXTUAL_BNF_FILES = [
    `${BNF_TREE}/KerML-textual-bnf.kebnf`,
    `${BNF_TREE}/SysML-textual-bnf.kebnf`,
] as const;

/** One production of a normative grammar. */
export interface BnfProduction {
    name: string;
    /** Corpus-relative file it is declared in. */
    source: string;
    /** 1-indexed line of the declaration. */
    line: number;
    /**
     * True for lexical productions — `LINE_TERMINATOR`, `DECIMAL_VALUE`.
     *
     * Reported apart from syntactic ones because a Langium grammar implements
     * them as terminals, not as parser rules, so scoring them against rule
     * names would count a category error as a gap.
     */
    lexical: boolean;
}

export type CoverageStatus = 'covered' | 'missing';

export interface ProductionCoverage extends BnfProduction {
    status: CoverageStatus;
    /** The Langium rule or terminal that covers it, when one does. */
    implementedBy?: string;
}

export interface BnfCoverageReport {
    reportVersion: string;
    memoVersion: string;
    corpus: CorpusProvenance;
    grammar: { path: string; parserRules: number; terminals: number };
    totals: {
        syntactic: { total: number; covered: number };
        lexical: { total: number; covered: number };
        /** Langium rules with no counterpart in either normative grammar. */
        nonNormativeRules: number;
    };
    productions: ProductionCoverage[];
    /**
     * Rules the Langium grammar has that the normative grammars do not name.
     *
     * Not a defect on its own — MEMO's grammar has helper rules and MEMO-specific
     * constructs — but worth listing, because a rule invented where a normative
     * production already exists is how a grammar drifts from the standard while
     * its coverage number goes up.
     */
    nonNormativeRules: string[];
}

export const BNF_REPORT_VERSION = '1.0.0';

/**
 * A production declaration opens at column zero as `Name =` or `Name : Type =`.
 *
 * Everything else in these files is a continuation line, a comment, or prose.
 * The `: Type` form declares the abstract-syntax class a production produces
 * (`PackageDeclaration : Package =`); the production's own name is what is
 * being scored, so the type is read and discarded.
 */
const PRODUCTION = /^([A-Za-z][A-Za-z0-9_]*)\s*(?::\s*[A-Za-z][A-Za-z0-9_]*\s*)?=\s*$/;

/** An ALL_CAPS name is a lexical production by the files' own convention. */
function isLexical(name: string): boolean {
    return /^[A-Z][A-Z0-9_]*$/.test(name);
}

export function readBnfProductions(path: string, source: string): BnfProduction[] {
    const productions: BnfProduction[] = [];
    const seen = new Set<string>();
    for (const [index, line] of readFileSync(path, 'utf-8').split('\n').entries()) {
        const match = PRODUCTION.exec(line);
        if (!match || seen.has(match[1])) continue;
        seen.add(match[1]);
        productions.push({ name: match[1], source, line: index + 1, lexical: isLexical(match[1]) });
    }
    return productions;
}

export interface LangiumGrammar {
    path: string;
    parserRules: string[];
    terminals: string[];
}

/**
 * Rule and terminal names declared by a Langium grammar.
 *
 * A deliberately shallow read of the `.langium` file: this scores *names*, so
 * loading Langium's own grammar services to get the same list would add a
 * dependency and a build step for no extra information.
 */
export function readLangiumGrammar(path: string): LangiumGrammar {
    const text = readFileSync(path, 'utf-8');
    const parserRules: string[] = [];
    const terminals: string[] = [];
    for (const line of text.split('\n')) {
        const terminal = /^\s*(?:hidden\s+)?terminal\s+(?:fragment\s+)?([A-Za-z][A-Za-z0-9_]*)/.exec(line);
        if (terminal) {
            terminals.push(terminal[1]);
            continue;
        }
        const rule = /^([A-Za-z][A-Za-z0-9_]*)\s*(?:returns\s+[\w.<>[\]]+\s*)?(?:infers\s+[A-Za-z][A-Za-z0-9_]*\s*)?:/.exec(line);
        if (rule) parserRules.push(rule[1]);
    }
    return { path, parserRules: [...new Set(parserRules)], terminals: [...new Set(terminals)] };
}

/** Where the grammar lives, relative to the built or source module. */
export function defaultGrammarPath(): string {
    return resolve(dirname(fileURLToPath(import.meta.url)), '../../src/grammar/memo-sysml.langium');
}

export interface BnfCoverageOptions {
    corpusDir?: string;
    grammarPath?: string;
    memoVersion: string;
}

export function runBnfCoverage(options: BnfCoverageOptions): BnfCoverageReport {
    const corpus: Corpus = loadCorpus(options.corpusDir);
    const grammarPath = options.grammarPath ?? defaultGrammarPath();
    const grammar = readLangiumGrammar(grammarPath);

    // Deduplicated across the two files, not concatenated. KerML productions
    // that SysML extends are restated verbatim in the SysML grammar — 39 names
    // appear in both — and counting those twice would inflate the denominator
    // and make one rule score as two. The KerML file is read first, so the
    // KerML declaration is the one reported.
    const productions: BnfProduction[] = [];
    const byName = new Set<string>();
    for (const relative of TEXTUAL_BNF_FILES) {
        for (const production of readBnfProductions(`${corpus.root}/${relative}`, relative)) {
            if (byName.has(production.name)) continue;
            byName.add(production.name);
            productions.push(production);
        }
    }

    const rules = new Set(grammar.parserRules);
    const terminals = new Set(grammar.terminals);
    const claimed = new Set<string>();

    const covered: ProductionCoverage[] = productions.map(production => {
        // A lexical production is answered by a terminal, a syntactic one by a
        // parser rule. Accepting either for both would let a terminal named
        // `Package` report the package grammar as implemented.
        const pool = production.lexical ? terminals : rules;
        const hit = pool.has(production.name) ? production.name : undefined;
        if (hit) claimed.add(hit);
        return { ...production, status: hit ? 'covered' : 'missing', implementedBy: hit };
    });

    const nonNormativeRules = [...rules, ...terminals].filter(name => !claimed.has(name)).sort();
    const tally = (lexical: boolean) => {
        const subset = covered.filter(production => production.lexical === lexical);
        return { total: subset.length, covered: subset.filter(p => p.status === 'covered').length };
    };

    return {
        reportVersion: BNF_REPORT_VERSION,
        memoVersion: options.memoVersion,
        corpus: provenanceOf(corpus),
        grammar: {
            path: corpusRelative(corpus, grammarPath) === grammarPath
                ? grammarPath.split('/').slice(-3).join('/')
                : corpusRelative(corpus, grammarPath),
            parserRules: grammar.parserRules.length,
            terminals: grammar.terminals.length,
        },
        totals: { syntactic: tally(false), lexical: tally(true), nonNormativeRules: nonNormativeRules.length },
        productions: covered.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0)),
        nonNormativeRules,
    };
}

const percent = (covered: number, total: number) => (total === 0 ? '—' : `${Math.round((covered / total) * 100)}%`);

export function formatBnfCoverageReport(report: BnfCoverageReport, options: { missing?: boolean } = {}): string {
    const lines: string[] = [''];
    lines.push(`SysML v2 Release  ${report.corpus.commit.slice(0, 12)}  (${report.corpus.commitDate.slice(0, 10)})`);
    lines.push(`grammar           ${report.grammar.path}`);
    lines.push('');
    const { syntactic, lexical } = report.totals;
    lines.push(`syntactic productions   ${String(syntactic.covered).padStart(4)} / ${String(syntactic.total).padEnd(4)}  ${percent(syntactic.covered, syntactic.total)}`);
    lines.push(`lexical productions     ${String(lexical.covered).padStart(4)} / ${String(lexical.total).padEnd(4)}  ${percent(lexical.covered, lexical.total)}`);
    lines.push(`rules with no normative production   ${report.totals.nonNormativeRules}`);
    lines.push('');
    lines.push('A production counts as covered when the grammar declares a rule of that name.');
    lines.push('That measures surface, not acceptance — `memo conformance run` measures acceptance.');

    if (options.missing) {
        const missing = report.productions.filter(production => production.status === 'missing' && !production.lexical);
        lines.push('');
        lines.push(`Uncovered syntactic productions (${missing.length}):`);
        for (const production of missing) lines.push(`  ${production.name.padEnd(36)} ${production.source}:${production.line}`);
    }
    lines.push('');
    return lines.join('\n');
}
