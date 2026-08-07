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
    sourceFile: string;
    /** Clause number → clause, for every clause that composes into this standard. */
    clauses: Map<string, StandardClauseInfo>;
}

export interface StandardsLibrary {
    /** Designation → standard. Designations are matched exactly, amendments included. */
    standards: Map<string, RegulatoryStandardInfo>;
    /** Clause instances that compose into no standard — a defect in a pack. */
    orphanClauses: StandardClauseInfo[];
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
}

// ─── Parsing ──────────────────────────────────────────────────────────────────

// `item <name> : <Def> {` … matching braces. Instances are flat data — one
// level of braces — so a non-greedy match to the first closing brace at the
// declaration's own indentation is enough, and a nested brace would show up as
// a missing attribute rather than as silently wrong data.
const INSTANCE_RE = /^\s*item\s+(\w+)\s*:\s*(RegulatoryStandard|StandardClause)\s*\{([\s\S]*?)^\s*\}/gm;
const COMPOSES_RE = /^\s*connection\s+\w+\s*:\s*Composes\s+connect\s+parent\s*::>\s*(\w+)\s+to\s+child\s*::>\s*(\w+)\s*;/gm;

function attr(body: string, name: string): string | undefined {
    const m = body.match(new RegExp(`attribute\\s+:>>\\s+${name}\\s*=\\s*"([^"]*)"`));
    return m?.[1];
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
    if (!dir) return { standards: new Map(), orphanClauses: [], sourceDir: null };

    const standardsByUsage = new Map<string, RegulatoryStandardInfo>();
    const clausesByUsage = new Map<string, StandardClauseInfo>();
    /** child usage name → parent usage name */
    const parentOf = new Map<string, string>();

    let files: string[];
    try {
        files = readdirSync(dir).filter(f => f.endsWith('.sysml')).sort();
    } catch {
        return { standards: new Map(), orphanClauses: [], sourceDir: dir };
    }

    for (const file of files) {
        const path = join(dir, file);
        let source: string;
        try { source = readFileSync(path, 'utf-8'); } catch { continue; }

        for (const m of source.matchAll(INSTANCE_RE)) {
            const [, name, def, body] = m;
            if (def === 'RegulatoryStandard') {
                const designation = attr(body, 'designation');
                if (!designation) continue;
                standardsByUsage.set(name, {
                    name,
                    designation,
                    edition: attr(body, 'edition'),
                    issuer: attr(body, 'issuer'),
                    amendments: attrAll(body, 'amendments'),
                    sourceFile: path,
                    clauses: new Map(),
                });
            } else {
                const clauseNumber = attr(body, 'clauseNumber');
                if (!clauseNumber) continue;
                clausesByUsage.set(name, {
                    name,
                    clauseNumber,
                    title: attr(body, 'title'),
                    normativeStrength: attr(body, 'normativeStrength'),
                    designation: '',
                });
            }
        }

        for (const m of source.matchAll(COMPOSES_RE)) parentOf.set(m[2], m[1]);
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

    return { standards, orphanClauses, sourceDir: dir };
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
