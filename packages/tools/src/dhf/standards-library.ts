// ─── Standards Library Reader ─────────────────────────────────────────────────
//
// Reads the concrete RegulatoryStandard / StandardClause instances the ontology
// ships under `src/artifacts/standards/`, one file per standard.
//
// This is a reader, not a registry. Nothing about any particular standard is
// written down here: adding ISO 13485 is one SysML file in the ontology and no
// change to this file, which is the whole point of the standards axis. The
// three places that used to hold their own copy of "which clause does this
// document claim" — DHF_DOCUMENT_TYPES[].standards, the Architect's DHF_GROUPS,
// and the template resolver's directory list — now derive from template
// frontmatter checked against this library.
//
// Why parse the source rather than build a model: the same reason
// template-lint reads attribute declarations out of the registry's
// `sourceFile`. The clause packs are library content, not project content, so
// they are not in any project's element graph; a regex over declarations MEMO
// itself authors is both cheaper and honest about what it can see.
// ─────────────────────────────────────────────────────────────────────────────

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { resolve, join, dirname } from 'node:path';
import { resolveContentPackageRoot, VENDOR_ONTOLOGY_DIR } from '../model/paths.js';

/** Relative path (from a legacy tools checkout) to the shipped standards packs. */
export const VENDOR_STANDARDS_DIR = `${VENDOR_ONTOLOGY_DIR}/src/artifacts/standards`;

export interface StandardClauseInfo {
    /** SysML usage name, e.g. "iec62304Clause5_2_2" */
    name: string;
    /**
     * The `id` attribute, e.g. "STD-IEC-62304-5-2-2".
     *
     * Both this and `name` are carried because a ConformsTo edge addresses a
     * clause by whichever the project authored, and the clause instances are
     * library content that a consuming project's element index does not hold.
     */
    id?: string;
    /** The number a document cites, e.g. "5.2.2", "820.30(c)", "V.A" */
    clauseNumber: string;
    /** MEMO-authored scope phrase. Absent when MEMO has no verified reading. */
    title?: string;
    normativeStrength?: string;
    /** Designation of the standard this clause belongs to. */
    designation: string;
}

export interface RegulatoryStandardInfo {
    /** SysML usage name, e.g. "iec62304" */
    name: string;
    designation: string;
    edition?: string;
    issuer?: string;
    amendments: string[];
    /**
     * Submission regimes this standard has standing in, as bare
     * `RegulatoryRegimeKind` member names ("CE", "FDA_510k").
     *
     * Empty is authored, not missing: a method or reference standard that no
     * regime mandates. See `appliesToRegime` in the ontology package header —
     * the report prints these standards separately rather than dropping them.
     */
    regimes: string[];
    sourceFile: string;
    /** Clause number → clause, for every clause that composes into this standard. */
    clauses: Map<string, StandardClauseInfo>;
}

/** A regime citation in a pack that names no `RegulatoryRegimeKind` member. */
export interface UnknownRegimeCitation {
    /** Designation of the standard that cited it. */
    designation: string;
    /** The citation verbatim, e.g. "RegulatoryRegimeKind::EU_MDR" or "CE". */
    raw: string;
    reason: 'unqualified' | 'unknown-member';
}

export interface StandardsLibrary {
    /** Designation → standard. Designations are matched exactly, amendments included. */
    standards: Map<string, RegulatoryStandardInfo>;
    /** Clause instances that compose into no standard — a defect in a pack. */
    orphanClauses: StandardClauseInfo[];
    /**
     * `RegulatoryRegimeKind` members, read from the ontology's own enum
     * declaration. Never a list in this file: the regimes MEMO recognises are
     * ontology content, and a TypeScript copy would be a second place to
     * maintain them.
     */
    regimeVocabulary: string[];
    /** Regime citations that resolve to no member — a defect in a pack. */
    unknownRegimes: UnknownRegimeCitation[];
    /** Directory the packs were read from, or null when none was found. */
    sourceDir: string | null;
}

// ─── Locating the packs ───────────────────────────────────────────────────────

let cachedDir: string | null | undefined;

/** Locate the ontology's standards directory. Cached after first hit. */
export function findVendorStandardsDir(startDir: string = process.cwd()): string | null {
    if (cachedDir !== undefined) return cachedDir;

    try {
        const installed = join(resolveContentPackageRoot(), 'src/artifacts/standards');
        if (existsSync(installed)) { cachedDir = installed; return installed; }
    } catch {
        // Fall through for dependency-free legacy source checkouts.
    }

    let dir = resolve(startDir);
    while (true) {
        const candidate = join(dir, VENDOR_STANDARDS_DIR);
        if (existsSync(candidate)) { cachedDir = candidate; return candidate; }
        const parent = dirname(dir);
        if (parent === dir) break;
        dir = parent;
    }

    cachedDir = null;
    return null;
}

/** Test hook: reset the cached standards directory. */
export function resetStandardsDirCache(): void {
    cachedDir = undefined;
    cachedRegimeVocabulary = undefined;
}

// ─── The regime vocabulary ────────────────────────────────────────────────────

const ENUM_DEF_RE = (name: string) =>
    new RegExp(`enum\\s+def\\s+${name}\\s*\\{([\\s\\S]*?)\\}`, 'm');

let cachedRegimeVocabulary: string[] | undefined;

/**
 * Read the members of an ontology `enum def` out of the ontology source.
 *
 * The packs are at `<ontology>/src/artifacts/standards`, so the ontology's
 * `src/` root is two levels up; the enum is found by walking it rather than by
 * naming the file that happens to hold it today. What is hardcoded here is a
 * locator, never a value: the members themselves come from the ontology, which
 * is the whole reason a regime is an enum and not a string convention.
 */
export function readEnumMembers(standardsDir: string, enumName: string): string[] {
    const srcRoot = resolve(standardsDir, '..', '..');
    const stack = [srcRoot];
    while (stack.length > 0) {
        const dir = stack.pop()!;
        let entries;
        try { entries = readdirSync(dir, { withFileTypes: true }); } catch { continue; }
        for (const entry of entries) {
            const path = join(dir, entry.name);
            if (entry.isDirectory()) { stack.push(path); continue; }
            if (!entry.name.endsWith('.sysml')) continue;
            let source: string;
            try { source = readFileSync(path, 'utf-8'); } catch { continue; }
            const body = source.match(ENUM_DEF_RE(enumName))?.[1];
            if (!body) continue;
            return [...body.matchAll(/^\s*enum\s+(\w+)\s*;/gm)].map(m => m[1]);
        }
    }
    return [];
}

// ─── Parsing ──────────────────────────────────────────────────────────────────

/**
 * Every `item <name> : RegulatoryStandard|StandardClause` declaration, with the
 * attribute lines that belong to it.
 *
 * This was a non-greedy brace match over the whole body, on the stated
 * assumption that instances are "flat data — one level of braces". Nesting
 * broke that: a clause that CONTAINS a sub-clause has its match terminated by
 * the child's closing brace, and the reader lost 7 of IEC 62304's 21 clauses
 * without erroring. A declaration's own attributes always precede its first
 * nested child, so the body is taken as the lines up to the next declaration at
 * any depth.
 */
function instances(source: string): Array<{ name: string; def: string; body: string }> {
    const lines = source.split('\n');
    const found: Array<{ name: string; def: string; body: string }> = [];
    for (let i = 0; i < lines.length; i++) {
        const m = /^[ \t]*item\s+(\w+)\s*:\s*(RegulatoryStandard|StandardClause)\b/.exec(lines[i]);
        if (!m) continue;
        const body: string[] = [];
        for (let j = i + 1; j < lines.length; j++) {
            if (/^[ \t]*item\s+\w+\s*:/.test(lines[j])) break;
            body.push(lines[j]);
        }
        found.push({ name: m[1], def: m[2], body: body.join('\n') });
    }
    return found;
}
// Clause membership is NESTING now — `item iec62304 { item clause4 { … } }` —
// since R10-S7 deleted the `Composes` connection. Parentage comes from
// indentation depth, which is what nesting is in the text.
const DECL_RE = /^([ \t]*)item\s+(\w+)\s*:\s*(RegulatoryStandard|StandardClause)\b/;

/** `child -> parent` for every nested standard/clause declaration in a file. */
function nestedParents(source: string): Array<[string, string]> {
    const pairs: Array<[string, string]> = [];
    const stack: Array<[number, string]> = [];
    for (const line of source.split('\n')) {
        const m = DECL_RE.exec(line);
        if (!m) continue;
        const [, indent, name] = m;
        while (stack.length > 0 && stack[stack.length - 1][0] >= indent.length) stack.pop();
        if (stack.length > 0) pairs.push([name, stack[stack.length - 1][1]]);
        stack.push([indent.length, name]);
    }
    return pairs;
}

function attr(body: string, name: string): string | undefined {
    const m = body.match(new RegExp(`attribute\\s+:>>\\s+${name}\\s*=\\s*"([^"]*)"`));
    return m?.[1];
}

/**
 * Read an enum-valued attribute, single or set-literal:
 *
 *   attribute :>> appliesToRegime = RegulatoryRegimeKind::CE;
 *   attribute :>> appliesToRegime = (RegulatoryRegimeKind::CE, RegulatoryRegimeKind::MDR);
 *
 * Entries are returned verbatim so the caller can report an unqualified or
 * misspelled one. The bare member name is not accepted anywhere in MEMO —
 * one spelling, the qualified one — so it is returned and rejected rather
 * than quietly matched.
 */
function attrEnumEntries(body: string, name: string): string[] {
    const m = body.match(new RegExp(`attribute\\s+:>>\\s+${name}\\s*=\\s*([^;]+);`));
    if (!m) return [];
    return m[1].replace(/^\s*\(|\)\s*$/g, '').split(',').map(s => s.trim()).filter(Boolean);
}

function attrAll(body: string, name: string): string[] {
    const values: string[] = [];
    for (const m of body.matchAll(new RegExp(`attribute\\s+:>>\\s+${name}\\s*=\\s*"([^"]*)"`, 'g'))) {
        values.push(m[1]);
    }
    return values;
}

/**
 * Read every standards pack under the ontology's `src/artifacts/standards/`.
 *
 * Clause-to-standard membership comes from the `Composes` links the packs
 * declare, walked transitively, rather than from "one file, one standard" —
 * containment is a modelled fact and reading it back is what keeps the pack
 * and the library agreeing.
 */
export function loadStandardsLibrary(startDir?: string): StandardsLibrary {
    const dir = findVendorStandardsDir(startDir);
    if (!dir) {
        return {
            standards: new Map(), orphanClauses: [],
            regimeVocabulary: [], unknownRegimes: [], sourceDir: null,
        };
    }

    if (cachedRegimeVocabulary === undefined) {
        cachedRegimeVocabulary = readEnumMembers(dir, 'RegulatoryRegimeKind');
    }
    const regimeVocabulary = cachedRegimeVocabulary;
    const unknownRegimes: UnknownRegimeCitation[] = [];

    const standardsByUsage = new Map<string, RegulatoryStandardInfo>();
    const clausesByUsage = new Map<string, StandardClauseInfo>();
    /** child usage name → parent usage name */
    const parentOf = new Map<string, string>();

    let files: string[];
    try {
        files = readdirSync(dir).filter(f => f.endsWith('.sysml')).sort();
    } catch {
        return { standards: new Map(), orphanClauses: [], regimeVocabulary, unknownRegimes, sourceDir: dir };
    }

    for (const file of files) {
        const path = join(dir, file);
        let source: string;
        try { source = readFileSync(path, 'utf-8'); } catch { continue; }

        for (const { name, def, body } of instances(source)) {
            if (def === 'RegulatoryStandard') {
                const designation = attr(body, 'designation');
                if (!designation) continue;
                const regimes: string[] = [];
                for (const entry of attrEnumEntries(body, 'appliesToRegime')) {
                    const parts = entry.split('::');
                    if (parts.length !== 2 || parts[0] !== 'RegulatoryRegimeKind') {
                        unknownRegimes.push({ designation, raw: entry, reason: 'unqualified' });
                        continue;
                    }
                    if (!regimeVocabulary.includes(parts[1])) {
                        unknownRegimes.push({ designation, raw: entry, reason: 'unknown-member' });
                        continue;
                    }
                    regimes.push(parts[1]);
                }
                standardsByUsage.set(name, {
                    name,
                    designation,
                    edition: attr(body, 'edition'),
                    issuer: attr(body, 'issuer'),
                    amendments: attrAll(body, 'amendments'),
                    regimes,
                    sourceFile: path,
                    clauses: new Map(),
                });
            } else {
                const clauseNumber = attr(body, 'clauseNumber');
                if (!clauseNumber) continue;
                clausesByUsage.set(name, {
                    name,
                    id: attr(body, 'id'),
                    clauseNumber,
                    title: attr(body, 'title'),
                    normativeStrength: attr(body, 'normativeStrength'),
                    designation: '',
                });
            }
        }

        for (const [child, parent] of nestedParents(source)) parentOf.set(child, parent);
    }

    const orphanClauses: StandardClauseInfo[] = [];
    for (const clause of clausesByUsage.values()) {
        // Walk up the containment chain to the standard the clause belongs to.
        // The visited set keeps a mis-authored cycle from hanging the reader.
        const visited = new Set<string>([clause.name]);
        let cursor: string | undefined = parentOf.get(clause.name);
        let owner: RegulatoryStandardInfo | undefined;
        while (cursor && !visited.has(cursor)) {
            visited.add(cursor);
            owner = standardsByUsage.get(cursor);
            if (owner) break;
            cursor = parentOf.get(cursor);
        }
        if (!owner) { orphanClauses.push(clause); continue; }
        clause.designation = owner.designation;
        owner.clauses.set(clause.clauseNumber, clause);
    }

    const standards = new Map<string, RegulatoryStandardInfo>();
    for (const std of standardsByUsage.values()) standards.set(std.designation, std);

    return { standards, orphanClauses, regimeVocabulary, unknownRegimes, sourceDir: dir };
}

// ─── The clause-reference grammar ─────────────────────────────────────────────

export interface ClauseReference {
    /** Standard designation the citation resolves against. */
    designation: string;
    clauseNumber: string;
    /** The frontmatter entry this came from, verbatim. */
    raw: string;
    /** True when the entry carried its own designation rather than inheriting one. */
    qualified: boolean;
}

/**
 * Parse one `clauses:` frontmatter entry.
 *
 *   "5.4"                  → relative: the document's own `standard:`
 *   "ISO 14971:2019 §7"    → qualified: designation before §, clause after
 *
 * An entry containing "§" is qualified and nothing else is. That is the whole
 * grammar, and it is written into the ontology's package header too — the two
 * shapes were both already in use before Phase 2, one of them undocumented.
 */
export function parseClauseReference(entry: string, documentStandard?: string): ClauseReference {
    const raw = String(entry).trim();
    const sign = raw.indexOf('§');
    if (sign >= 0) {
        return {
            designation: raw.slice(0, sign).trim(),
            clauseNumber: raw.slice(sign + 1).trim(),
            raw,
            qualified: true,
        };
    }
    return { designation: (documentStandard ?? '').trim(), clauseNumber: raw, raw, qualified: false };
}

/** Render a clause reference the way document metadata cites it. */
export function formatClauseReference(ref: ClauseReference): string {
    return `${ref.designation} §${ref.clauseNumber}`;
}

export type ClauseResolution =
    | { ok: true; ref: ClauseReference; clause: StandardClauseInfo }
    | { ok: false; ref: ClauseReference; reason: 'unknown-standard' | 'unknown-clause' };

/** Resolve one citation against the library. */
export function resolveClause(
    library: StandardsLibrary,
    entry: string,
    documentStandard?: string,
): ClauseResolution {
    const ref = parseClauseReference(entry, documentStandard);
    const std = library.standards.get(ref.designation);
    if (!std) return { ok: false, ref, reason: 'unknown-standard' };
    const clause = std.clauses.get(ref.clauseNumber);
    if (!clause) return { ok: false, ref, reason: 'unknown-clause' };
    return { ok: true, ref, clause };
}
