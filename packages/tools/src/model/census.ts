// ─── Element census ──────────────────────────────────────────────────────────
//
// How many elements, of which kinds, did each source file put into the model?
//
// That question is the only one that catches a SILENT DROP — source that still
// parses, still validates, and quietly declares less than it did. Every other
// number a build prints moves the wrong way when content disappears: violations
// FALL because the elements carrying them are gone, and completeness RISES
// because the incomplete elements are the ones that vanished. Measured
// 2026-09-19: a file built 2 elements instead of 124 and `memo validate`
// reported "92% complete, 1583 violations, 32 rules passed", down from 1595,
// and the drop was read as progress.
//
// A census is therefore a COUNT ORACLE, not a snapshot: per file, per kind, per
// relationship type, frozen as a baseline and compared on every run. It says
// nothing about whether the model is good — only whether it still contains what
// it contained last time anyone looked.
//
// The comparison is deliberately asymmetric. A count going DOWN fails: content
// left the model and something has to say why. A count going UP is reported and
// passes, because adding content is the normal business of every example in the
// tree and a gate that fails on it would be re-frozen so often that nobody
// would read the diff. The cost of that choice is stated where it bites: see
// `compareCensus`.
//
// Not a replacement for `scripts/verify-baseline.mjs`, which freezes element
// IDS and relationship endpoints for the four reference projects. That oracle
// is finer and answers "did anything move?"; this one is coarse enough to run
// in the gate over every example on every test run, and answers "did anything
// LEAVE?".
// ─────────────────────────────────────────────────────────────────────────────

import { relative } from 'node:path';
import type { MemoModel } from './semantic.js';

/** How the builder marks a relationship well-formedness finding, having no code for it. */
const WELL_FORMEDNESS_PREFIX = '[well-formedness]';

/** Per-file counts. Every map is sorted by key so a baseline diffs cleanly. */
export interface FileCensus {
    /** Elements this file declares. */
    elements: number;
    /** Of those, DEFINITIONS (`part def Pump`) rather than usages. */
    definitions: number;
    /** Elements per ontology kind. */
    kinds: Record<string, number>;
    /** Relationships whose declaration this file carries. */
    relationships: number;
    /** Relationships per type, including the ones the builder synthesizes. */
    relationshipTypes: Record<string, number>;
    /** Packages declared here, empty ones included. */
    packages: number;
    /**
     * Parse errors reported against this file — the parser's own complaints,
     * which carry no diagnostic code.
     *
     * One of the two INVERTED measures in the census: more of these is worse,
     * and a rise fails the comparison the same way a falling element count
     * does. A file that stops parsing loses its elements in the same run, so
     * this is the measure that says WHY the count moved.
     */
    parseErrors: number;
    /**
     * Builder findings against this file — a short-name collision, an ambiguous
     * reference, a relationship whose ends do not conform to its declared
     * types.
     *
     * Counted apart from parse errors because they are a different failure with
     * a different cause, and because most of them are reported by nothing today
     * (the board row "Builder well-formedness findings are computed and
     * discarded"). Inverted for the same reason: more of them is worse.
     */
    builderFindings: number;
}

/** A census of one built model. */
export interface ProjectCensus {
    /** Identifier for the project, used in the baseline filename and messages. */
    project: string;
    /** Sums over every file. */
    totals: {
        files: number;
        elements: number;
        definitions: number;
        relationships: number;
        packages: number;
        parseErrors: number;
        builderFindings: number;
    };
    /** Per project-relative file path, sorted. */
    files: Record<string, FileCensus>;
}

/** What a census comparison found. */
export interface CensusFinding {
    /**
     * `drop` fails the gate: the model holds less than the baseline recorded.
     * `rise` passes and is reported, so the baseline can be re-frozen knowingly.
     */
    severity: 'drop' | 'rise';
    /** Project-relative file, or `(totals)` for a whole-project measure. */
    file: string;
    /** What was counted: `elements`, `kind:Hazard`, `relationshipType:flow`, … */
    measure: string;
    baseline: number;
    current: number;
    /** One line, already readable without the structured fields. */
    message: string;
}

/**
 * Count one built model.
 *
 * `projectRoot` makes the recorded paths project-relative. Absolute paths are
 * what the model carries and would make a baseline machine-specific, so a root
 * is required for anything that gets committed.
 */
export function computeCensus(
    model: MemoModel,
    options: { project: string; projectRoot?: string },
): ProjectCensus {
    const files = new Map<string, FileCensus>();
    const at = (file: string): FileCensus => {
        const key = toRelative(file, options.projectRoot);
        let entry = files.get(key);
        if (!entry) {
            entry = {
                elements: 0, definitions: 0, kinds: {},
                relationships: 0, relationshipTypes: {},
                packages: 0, parseErrors: 0, builderFindings: 0,
            };
            files.set(key, entry);
        }
        return entry;
    };

    for (const element of model.elements.values()) {
        const entry = at(element.file);
        entry.elements++;
        if (element.isDefinition) entry.definitions++;
        entry.kinds[element.kind] = (entry.kinds[element.kind] ?? 0) + 1;
    }
    for (const relationship of model.relationships) {
        const entry = at(relationship.file);
        entry.relationships++;
        entry.relationshipTypes[relationship.type] =
            (entry.relationshipTypes[relationship.type] ?? 0) + 1;
    }
    // A package that declares nothing is still a package, and it is exactly the
    // thing a lowering change can drop without touching any other count — the
    // board row "An empty package vanishes in lowering with no diagnostic".
    for (const pkg of model.packages) at(pkg.file).packages++;
    // `model.errors` carries both. A coded diagnostic is the builder's; so is
    // the relationship well-formedness finding, which is recognized by its
    // message prefix because it carries no code — 73 of them in gpca-pump, and
    // counting them as parse errors would say a clean file does not parse. The
    // prefix goes when that finding gets a code, which is the board row
    // "Builder well-formedness findings are computed and discarded".
    for (const error of model.errors) {
        const entry = at(error.file);
        const fromBuilder = Boolean(error.code) || error.message.startsWith(WELL_FORMEDNESS_PREFIX);
        if (fromBuilder) entry.builderFindings++; else entry.parseErrors++;
    }

    const totals = {
        files: files.size,
        elements: 0, definitions: 0, relationships: 0, packages: 0,
        parseErrors: 0, builderFindings: 0,
    };
    for (const entry of files.values()) {
        totals.elements += entry.elements;
        totals.definitions += entry.definitions;
        totals.relationships += entry.relationships;
        totals.packages += entry.packages;
        totals.parseErrors += entry.parseErrors;
        totals.builderFindings += entry.builderFindings;
    }

    return {
        project: options.project,
        totals,
        files: Object.fromEntries([...files.entries()]
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([path, entry]) => [path, sortMaps(entry)])),
    };
}

/**
 * Diff a current census against a frozen one.
 *
 * Drops are the failure: a file that lost elements, a kind that lost instances,
 * a relationship type that lost edges, a file that disappeared from the model
 * entirely, or a file that gained parse errors.
 *
 * Rises are reported and do not fail, which has one cost worth being explicit
 * about: a baseline left un-refrozen after content is ADDED goes stale low, and
 * a later drop back to that stale number is not caught. Re-freeze after adding
 * content (`pnpm census:capture`) and the window closes; the check prints the
 * command every time it sees a rise, for that reason.
 */
export function compareCensus(baseline: ProjectCensus, current: ProjectCensus): CensusFinding[] {
    const findings: CensusFinding[] = [];

    const compare = (
        file: string, measure: string, before: number, after: number,
        inverted = false,
    ): void => {
        if (before === after) return;
        const worse = inverted ? after > before : after < before;
        findings.push({
            severity: worse ? 'drop' : 'rise',
            file, measure, baseline: before, current: after,
            message: `${file}: ${measure} ${before} → ${after}`,
        });
    };

    compare('(totals)', 'files', baseline.totals.files, current.totals.files);
    compare('(totals)', 'elements', baseline.totals.elements, current.totals.elements);
    compare('(totals)', 'definitions', baseline.totals.definitions, current.totals.definitions);
    compare('(totals)', 'relationships', baseline.totals.relationships, current.totals.relationships);
    compare('(totals)', 'packages', baseline.totals.packages, current.totals.packages);
    compare('(totals)', 'parseErrors', baseline.totals.parseErrors, current.totals.parseErrors, true);
    compare('(totals)', 'builderFindings',
        baseline.totals.builderFindings, current.totals.builderFindings, true);

    const empty: FileCensus = {
        elements: 0, definitions: 0, kinds: {},
        relationships: 0, relationshipTypes: {}, packages: 0,
        parseErrors: 0, builderFindings: 0,
    };
    for (const path of [...new Set([...Object.keys(baseline.files), ...Object.keys(current.files)])].sort()) {
        const before = baseline.files[path] ?? empty;
        const after = current.files[path] ?? empty;
        // A file present in the baseline and absent now contributed nothing at
        // all: report it as the single fact it is rather than as one finding
        // per kind it used to declare.
        if (!current.files[path]) {
            findings.push({
                severity: 'drop', file: path, measure: 'file',
                baseline: before.elements, current: 0,
                message: `${path}: gone from the model — it declared ${before.elements} element(s)`,
            });
            continue;
        }
        compare(path, 'elements', before.elements, after.elements);
        compare(path, 'definitions', before.definitions, after.definitions);
        compare(path, 'relationships', before.relationships, after.relationships);
        compare(path, 'packages', before.packages, after.packages);
        compare(path, 'parseErrors', before.parseErrors, after.parseErrors, true);
        compare(path, 'builderFindings', before.builderFindings, after.builderFindings, true);
        for (const kind of keysOf(before.kinds, after.kinds)) {
            compare(path, `kind:${kind}`, before.kinds[kind] ?? 0, after.kinds[kind] ?? 0);
        }
        for (const type of keysOf(before.relationshipTypes, after.relationshipTypes)) {
            compare(path, `relationshipType:${type}`,
                before.relationshipTypes[type] ?? 0, after.relationshipTypes[type] ?? 0);
        }
    }

    return findings;
}

/**
 * Render findings for a human, drops first.
 *
 * `limit` caps the listing: a shared-definition change moves hundreds of counts
 * at once, and a reader needs the first few plus the total, not the whole diff.
 */
export function formatCensusFindings(findings: CensusFinding[], limit = 25): string {
    const drops = findings.filter(f => f.severity === 'drop');
    const rises = findings.filter(f => f.severity === 'rise');
    const lines: string[] = [];
    if (drops.length > 0) {
        lines.push(`${drops.length} count(s) went DOWN — the model holds less than the baseline records:`);
        for (const f of drops.slice(0, limit)) lines.push(`  ${f.message}`);
        if (drops.length > limit) lines.push(`  … ${drops.length - limit} more`);
    }
    if (rises.length > 0) {
        lines.push(`${rises.length} count(s) went up (content added; re-freeze with \`pnpm census:capture\`):`);
        for (const f of rises.slice(0, limit)) lines.push(`  ${f.message}`);
        if (rises.length > limit) lines.push(`  … ${rises.length - limit} more`);
    }
    return lines.join('\n');
}

function keysOf(a: Record<string, number>, b: Record<string, number>): string[] {
    return [...new Set([...Object.keys(a), ...Object.keys(b)])].sort();
}

function sortMaps(entry: FileCensus): FileCensus {
    return {
        ...entry,
        kinds: sortRecord(entry.kinds),
        relationshipTypes: sortRecord(entry.relationshipTypes),
    };
}

function sortRecord(record: Record<string, number>): Record<string, number> {
    return Object.fromEntries(Object.entries(record).sort(([a], [b]) => a.localeCompare(b)));
}

/**
 * Project-relative, forward-slashed.
 *
 * A model carries absolute paths, which differ per checkout; a baseline keyed
 * by one would diff against itself on the next machine.
 */
function toRelative(file: string, projectRoot?: string): string {
    if (!file) return '(no file)';
    if (!projectRoot) return file;
    const rel = relative(projectRoot, file);
    return (rel && !rel.startsWith('..') ? rel : file).split('\\').join('/');
}
