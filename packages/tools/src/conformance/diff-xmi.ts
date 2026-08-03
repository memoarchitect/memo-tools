// ─── memo conformance diff-xmi ───────────────────────────────────────────────
//
// The differential oracle. For one normative library it asks: what does MEMO
// compute for this source, and how does that differ from what the reference
// implementation computed for the same source?
//
// The right-hand side is not a second opinion we are trusting on faith — it is
// `sysml.library.xmi.implied`, the Pilot's own output, published by the OMG as
// data at a pinned commit. Running the Pilot would give the same answer at the
// cost of a JVM (§1.3); reading its published answer costs nothing and is
// diffable in review.
//
// What is compared, and what deliberately is not. Two independent
// implementations agree on *which named elements exist, of what metaclass,
// under what qualified name*. They do not agree on UUIDs, on the ordering of
// unnamed memberships, or on how a documentation body is broken across lines —
// comparing those would produce thousands of differences that mean nothing.
// The comparison is therefore over named elements only, and every unnamed
// element the file contains is counted and reported rather than dropped
// silently.
//
// This is the acceptance harness for Track B B3. Today the internal grammar is
// a MEMO subset that does not accept `standard library package` at all, so the
// honest result is a large `missing-declared` count — which is the measurement,
// not a failure of the harness. Nothing here passes or fails on its own: the
// gate is a frozen baseline, and what it catches is a count that *moved*.
// ─────────────────────────────────────────────────────────────────────────────

import { basename, dirname } from 'node:path';
import type { MEMOConfig } from '../model/config.js';
import type { MemoElement } from '../model/semantic.js';
import { defaultRegistry } from '../toolchain/default-registry.js';
import { resolveToolchain } from '../toolchain/effective.js';
import { runLowering } from '../toolchain/operations.js';
import type { ProviderRegistry } from '../toolchain/registry.js';
import {
    LIBRARY_SOURCE_TREE,
    LIBRARY_XMI_IMPLIED_TREE,
    LIBRARY_XMI_TREE,
    corpusRelative,
    loadCorpus,
    modelSourcesIn,
    provenanceOf,
    verifyCorpus,
    xmiCounterpart,
    type Corpus,
    type CorpusProvenance,
} from './corpus.js';
import { readXmi, type XmiElement } from './xmi.js';

/**
 * How a single difference is classified.
 *
 *   missing-declared   the source declares it, the reference has it, MEMO does
 *                      not. A lowering gap — MEMO did not read the source.
 *   missing-implied    only the reference's *implied* pass produced it. A
 *                      derived-semantics gap: MEMO read the source but does not
 *                      compute what the source entails.
 *   extra              MEMO has an element neither XMI does. Something was
 *                      invented, or named differently than upstream names it.
 *   differing-derived  both have it; a derived value differs (today: metaclass
 *                      against MEMO's construct).
 *   qualified-name     the leaf name exists on both sides under different
 *                      containment paths. Reported apart from `missing`/`extra`
 *                      because it is one defect, not two, and it is a naming
 *                      gap rather than a missing element.
 */
export type DifferenceClass =
    | 'missing-declared'
    | 'missing-implied'
    | 'extra'
    | 'differing-derived'
    | 'qualified-name';

export const DIFFERENCE_CLASSES: readonly DifferenceClass[] =
    ['missing-declared', 'missing-implied', 'extra', 'differing-derived', 'qualified-name'];

export type DifferenceCounts = Record<DifferenceClass, number>;

export function emptyDifferenceCounts(): DifferenceCounts {
    return {
        'missing-declared': 0,
        'missing-implied': 0,
        'extra': 0,
        'differing-derived': 0,
        'qualified-name': 0,
    };
}

export interface Difference {
    class: DifferenceClass;
    qualifiedName: string;
    /** Reference metaclass, where the reference has the element. */
    metatype?: string;
    /** MEMO's construct, where MEMO has it. */
    construct?: string;
    /** Free-text only for `differing-derived` and `qualified-name`. */
    detail?: string;
}

export interface LibraryDiff {
    /** Source file, corpus-relative. */
    source: string;
    /** The two XMI counterparts, corpus-relative; absent when upstream has none. */
    declaredXmi?: string;
    impliedXmi?: string;
    /** Named elements each side computed. */
    referenceDeclared: number;
    referenceImplied: number;
    memo: number;
    /**
     * Unnamed elements in the reference serialization.
     *
     * Not compared — see the module header — but reported, because "we compared
     * 19 of 336 elements" is a materially different claim from "we compared the
     * file", and only one of them is true.
     */
    referenceAnonymous: number;
    counts: DifferenceCounts;
    /** Capped sample, sorted, so a baseline stays reviewable. */
    differences: Difference[];
    /** Set when the library could not be compared at all. */
    failure?: string;
}

export interface DiffXmiReport {
    reportVersion: string;
    memoVersion: string;
    corpus: CorpusProvenance & { root: string };
    toolchain: { lowering: string };
    totals: { libraries: number; counts: DifferenceCounts };
    libraries: LibraryDiff[];
}

export const DIFF_REPORT_VERSION = '1.0.0';

/** Differences listed per library. Enough to act on, not a dump of 20 000. */
const SAMPLE_LIMIT = 25;

/**
 * MEMO's qualified name for an element.
 *
 * MEMO's model is flat: an element carries the package it was declared in, and
 * nesting is not part of its identity. The reference's is a containment path.
 * Joining package and id with `::` is the closest honest translation, and where
 * it does not line up the difference lands in `qualified-name` rather than
 * being hidden — which is the point of having that class.
 */
export function memoQualifiedName(element: MemoElement): string {
    return element.package ? `${element.package}::${element.id}` : element.id;
}

/** Last segment of a `::`-joined name. */
function leaf(qualifiedName: string): string {
    const index = qualifiedName.lastIndexOf('::');
    return index < 0 ? qualifiedName : qualifiedName.slice(index + 2);
}

/**
 * Whether a reference metaclass and a MEMO construct describe the same thing.
 *
 * MEMO's `construct` is the SysML keyword (`part`, `action`, `requirement`);
 * the reference's metatype is the metaclass (`PartUsage`, `PartDefinition`,
 * `ActionUsage`). Comparing them exactly would report every element as
 * differing, which is noise. The test is containment of the keyword in the
 * metaclass name, case-folded — deliberately loose, because this is the first
 * derived value compared and a strict mapping table belongs with the canonical
 * IR (Session 3), not here.
 */
export function derivedValuesAgree(metatype: string, construct: string | undefined): boolean {
    if (!construct) return true;
    return metatype.toLowerCase().includes(construct.toLowerCase());
}

export interface DiffXmiOptions {
    config: MEMOConfig;
    projectDir: string;
    corpusDir?: string;
    /**
     * Library sources to compare, as corpus-relative paths or bare filenames.
     * Empty compares every library source that has an XMI counterpart.
     */
    libraries?: readonly string[];
    registry?: ProviderRegistry;
    memoVersion: string;
    verify?: boolean;
    onLibrary?: (source: string, index: number, total: number) => void;
}

function classify(
    reference: Map<string, XmiElement>,
    declaredNames: Set<string>,
    memo: Map<string, MemoElement>,
): { counts: DifferenceCounts; differences: Difference[] } {
    const counts = emptyDifferenceCounts();
    const differences: Difference[] = [];

    // Leaf-name index of what MEMO produced, so a containment-path mismatch is
    // recognised as one rather than counted twice (missing here, extra there).
    const memoByLeaf = new Map<string, MemoElement[]>();
    for (const element of memo.values()) {
        const key = leaf(memoQualifiedName(element));
        const bucket = memoByLeaf.get(key);
        if (bucket) bucket.push(element);
        else memoByLeaf.set(key, [element]);
    }
    const pairedByName = new Set<string>();

    for (const [qualifiedName, element] of reference) {
        const mine = memo.get(qualifiedName);
        if (mine) {
            if (!derivedValuesAgree(element.metatype, mine.construct)) {
                counts['differing-derived'] += 1;
                differences.push({
                    class: 'differing-derived',
                    qualifiedName,
                    metatype: element.metatype,
                    construct: mine.construct,
                    detail: `reference metaclass ${element.metatype}, MEMO construct ${mine.construct}`,
                });
            }
            continue;
        }
        const byLeaf = memoByLeaf.get(element.name)?.filter(candidate => !pairedByName.has(memoQualifiedName(candidate)));
        if (byLeaf && byLeaf.length > 0) {
            pairedByName.add(memoQualifiedName(byLeaf[0]));
            counts['qualified-name'] += 1;
            differences.push({
                class: 'qualified-name',
                qualifiedName,
                metatype: element.metatype,
                construct: byLeaf[0].construct,
                detail: `MEMO names it ${memoQualifiedName(byLeaf[0])}`,
            });
            continue;
        }
        const kind: DifferenceClass = declaredNames.has(qualifiedName)
            ? 'missing-declared'
            : 'missing-implied';
        counts[kind] += 1;
        differences.push({ class: kind, qualifiedName, metatype: element.metatype });
    }

    for (const element of memo.values()) {
        const qualifiedName = memoQualifiedName(element);
        if (reference.has(qualifiedName) || pairedByName.has(qualifiedName)) continue;
        counts.extra += 1;
        differences.push({ class: 'extra', qualifiedName, construct: element.construct });
    }

    // Sorted by class then name so two runs of the same corpus produce the same
    // sample, and a baseline diff shows real movement rather than reordering.
    differences.sort((a, b) =>
        DIFFERENCE_CLASSES.indexOf(a.class) - DIFFERENCE_CLASSES.indexOf(b.class)
        || (a.qualifiedName < b.qualifiedName ? -1 : a.qualifiedName > b.qualifiedName ? 1 : 0));
    return { counts, differences: differences.slice(0, SAMPLE_LIMIT) };
}

/** Compare one library source against its two XMI counterparts. */
export async function diffLibrary(
    source: string,
    corpus: Corpus,
    options: DiffXmiOptions,
): Promise<LibraryDiff> {
    const registry = options.registry ?? defaultRegistry;
    const declaredPath = xmiCounterpart(corpus, source, LIBRARY_XMI_TREE);
    const impliedPath = xmiCounterpart(corpus, source, LIBRARY_XMI_IMPLIED_TREE);
    const base: LibraryDiff = {
        source: corpusRelative(corpus, source),
        declaredXmi: declaredPath ? corpusRelative(corpus, declaredPath) : undefined,
        impliedXmi: impliedPath ? corpusRelative(corpus, impliedPath) : undefined,
        referenceDeclared: 0,
        referenceImplied: 0,
        referenceAnonymous: 0,
        memo: 0,
        counts: emptyDifferenceCounts(),
        differences: [],
    };
    if (!impliedPath) {
        return { ...base, failure: 'no sysml.library.xmi.implied counterpart for this source' };
    }

    try {
        const implied = readXmi(impliedPath);
        const declaredNames = declaredPath
            ? new Set(readXmi(declaredPath).byQualifiedName.keys())
            : new Set<string>();

        // One source file, lowered on its own. A library is a compilation unit
        // here, not a project: comparing a whole directory's model against one
        // file's XMI would charge every difference to the wrong file.
        const result = await runLowering({
            config: options.config,
            projectDir: dirname(source),
            files: [source],
            includeDirs: [`${corpus.root}/${LIBRARY_SOURCE_TREE}`],
            registry,
        });
        const memo = new Map<string, MemoElement>();
        for (const element of Object.values(result.ir.model.elements)) {
            memo.set(memoQualifiedName(element), element);
        }

        return {
            ...base,
            referenceDeclared: declaredNames.size,
            referenceImplied: implied.byQualifiedName.size,
            referenceAnonymous: implied.anonymousCount,
            memo: memo.size,
            ...classify(implied.byQualifiedName, declaredNames, memo),
        };
    } catch (error) {
        return { ...base, failure: error instanceof Error ? error.message : String(error) };
    }
}

/** Library sources named by `--library`, or every one with an XMI counterpart. */
export function selectLibraries(corpus: Corpus, selectors: readonly string[]): string[] {
    const all = modelSourcesIn(`${corpus.root}/${LIBRARY_SOURCE_TREE}`)
        .filter(source => xmiCounterpart(corpus, source, LIBRARY_XMI_IMPLIED_TREE) !== undefined);
    if (selectors.length === 0) return all;
    const selected = new Map<string, string>();
    for (const selector of selectors) {
        const matches = all.filter(source => {
            const relPath = corpusRelative(corpus, source);
            return relPath === selector
                || relPath === `${LIBRARY_SOURCE_TREE}/${selector}`
                || relPath.endsWith(`/${selector}`)
                || basename(source) === selector;
        });
        if (matches.length === 0) {
            throw new Error(
                `No library source matches "${selector}". `
                + `Pass a corpus-relative path or a bare filename, e.g. "Parts.sysml".`,
            );
        }
        for (const match of matches) selected.set(match, match);
    }
    return [...selected.values()];
}

export async function runDiffXmi(options: DiffXmiOptions): Promise<DiffXmiReport> {
    const corpus = loadCorpus(options.corpusDir);
    if (options.verify !== false) {
        const mismatches = verifyCorpus(corpus, [LIBRARY_SOURCE_TREE]);
        if (mismatches.length > 0) {
            throw new Error(
                `The vendored library sources do not match the manifest (${mismatches.length} file(s)). `
                + 'Run `node scripts/vendor-corpus.mjs --verify` to see which.',
            );
        }
    }

    const sources = selectLibraries(corpus, options.libraries ?? []);
    const libraries: LibraryDiff[] = [];
    for (const [index, source] of sources.entries()) {
        options.onLibrary?.(corpusRelative(corpus, source), index, sources.length);
        libraries.push(await diffLibrary(source, corpus, options));
    }

    const counts = emptyDifferenceCounts();
    for (const library of libraries) {
        for (const key of DIFFERENCE_CLASSES) counts[key] += library.counts[key];
    }

    return {
        reportVersion: DIFF_REPORT_VERSION,
        memoVersion: options.memoVersion,
        corpus: { ...provenanceOf(corpus), root: '.' },
        toolchain: { lowering: resolveToolchain(options.config, options.registry ?? defaultRegistry).lowering },
        totals: { libraries: libraries.length, counts },
        libraries,
    };
}

export function formatDiffXmiReport(report: DiffXmiReport): string {
    const lines: string[] = [];
    lines.push('');
    lines.push(`SysML v2 Release  ${report.corpus.commit.slice(0, 12)}  (${report.corpus.commitDate.slice(0, 10)})`);
    lines.push(`lowering          ${report.toolchain.lowering}`);
    lines.push('');
    const width = Math.max(28, ...report.libraries.map(library => library.source.length));
    lines.push(
        `${'library'.padEnd(width)}  ${'ref'.padStart(5)}  ${'memo'.padStart(5)}  `
        + `${'miss-d'.padStart(6)}  ${'miss-i'.padStart(6)}  ${'extra'.padStart(5)}  `
        + `${'deriv'.padStart(5)}  ${'name'.padStart(5)}`,
    );
    for (const library of report.libraries) {
        if (library.failure) {
            lines.push(`${library.source.padEnd(width)}  ! ${library.failure}`);
            continue;
        }
        const c = library.counts;
        lines.push(
            `${library.source.padEnd(width)}  ${String(library.referenceImplied).padStart(5)}  `
            + `${String(library.memo).padStart(5)}  `
            + `${String(c['missing-declared']).padStart(6)}  ${String(c['missing-implied']).padStart(6)}  `
            + `${String(c.extra).padStart(5)}  ${String(c['differing-derived']).padStart(5)}  `
            + `${String(c['qualified-name']).padStart(5)}`,
        );
    }
    const t = report.totals.counts;
    lines.push(
        `${'TOTAL'.padEnd(width)}  ${' '.repeat(5)}  ${' '.repeat(5)}  `
        + `${String(t['missing-declared']).padStart(6)}  ${String(t['missing-implied']).padStart(6)}  `
        + `${String(t.extra).padStart(5)}  ${String(t['differing-derived']).padStart(5)}  `
        + `${String(t['qualified-name']).padStart(5)}`,
    );
    lines.push('');
    return lines.join('\n');
}
