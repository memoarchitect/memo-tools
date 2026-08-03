// ─── The conformance corpus ──────────────────────────────────────────────────
//
// A pinned, checksummed copy of the OMG's own published artifacts, vendored
// under `corpus/sysml-v2-release/` by `scripts/vendor-corpus.mjs`.
//
// Why static artifacts rather than a spawned reference implementation: they are
// versioned, deterministic, diffable in review, and carry no runtime, licence
// or startup cost — and MEMO's dependency graph stays free of a JVM (§1.3).
// The `xmi.implied` tree is the Pilot's own *computed* output published as
// data, which is the part that could not otherwise be had without running it.
//
// What a static corpus cannot do is judge source nobody has seen before. That
// is what an external live validator is for, and why `conformance run` takes a
// provider rather than grading MEMO against MEMO.
// ─────────────────────────────────────────────────────────────────────────────

import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, posix, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Textual model sources. `.kerml` is half the Kernel libraries. */
export const MODEL_EXTENSIONS = ['.sysml', '.kerml'] as const;

/** The XMI serializations, declared and with implied elements. */
export const XMI_EXTENSIONS = ['.sysmlx', '.kermlx'] as const;

export const LIBRARY_SOURCE_TREE = 'sysml.library';
export const LIBRARY_XMI_TREE = 'sysml.library.xmi';
export const LIBRARY_XMI_IMPLIED_TREE = 'sysml.library.xmi.implied';
/** The normative textual and graphical grammars. */
export const BNF_TREE = 'bnf';

export interface CorpusFileEntry {
    sha256: string;
    bytes: number;
}

export interface CorpusTree {
    id: string;
    path: string;
    role: string;
    files: number;
    bytes: number;
}

export interface CorpusManifest {
    repository: string;
    /** The Release commit every result is recorded against. */
    commit: string;
    commitDate: string;
    vendoredAt: string;
    /** Library name → version, read off the KPAR filenames. */
    libraryVersions: Record<string, string>;
    /** One roll-up over every file's path and hash. */
    digest: string;
    trees: CorpusTree[];
    files: Record<string, CorpusFileEntry>;
}

export interface Corpus {
    root: string;
    manifest: CorpusManifest;
}

/**
 * The provenance stamped on every conformance result.
 *
 * §5.1 item 3: a conformance number that does not say which Release it was
 * taken against is not a conformance number. It travels with the report so a
 * baseline comparison can refuse to compare across pins rather than silently
 * report a regression that is really a corpus change.
 */
export interface CorpusProvenance {
    repository: string;
    commit: string;
    commitDate: string;
    digest: string;
    libraryVersions: Record<string, string>;
}

export function provenanceOf(corpus: Corpus): CorpusProvenance {
    const { repository, commit, commitDate, digest, libraryVersions } = corpus.manifest;
    return { repository, commit, commitDate, digest, libraryVersions };
}

export class CorpusNotFoundError extends Error {
    constructor(readonly dir: string) {
        super(
            `No conformance corpus at "${dir}" — expected a manifest.json beside the vendored trees. `
            + 'Run `node scripts/vendor-corpus.mjs` in memo-tools, or pass --corpus <dir>.',
        );
        this.name = 'CorpusNotFoundError';
    }
}

/**
 * Where the vendored corpus lives, relative to this module.
 *
 * `src/conformance/` and `lib/conformance/` sit at the same depth below the
 * package root, so one expression serves both the compiled and the sources
 * build without a build-time constant.
 */
export function defaultCorpusDir(): string {
    return resolve(dirname(fileURLToPath(import.meta.url)), '../../../../corpus/sysml-v2-release');
}

export function loadCorpus(dir?: string): Corpus {
    const root = resolve(dir ?? defaultCorpusDir());
    const manifestPath = join(root, 'manifest.json');
    if (!existsSync(manifestPath)) throw new CorpusNotFoundError(root);
    return { root, manifest: JSON.parse(readFileSync(manifestPath, 'utf-8')) as CorpusManifest };
}

export interface ChecksumMismatch {
    path: string;
    reason: 'missing' | 'changed';
}

/**
 * Check vendored content against the manifest.
 *
 * `trees` narrows the check — hashing 150 MB to run a report over 1.4 MB of
 * textual sources costs more than the report. The full sweep is what the
 * corpus-integrity test runs.
 */
export function verifyCorpus(corpus: Corpus, trees?: readonly string[]): ChecksumMismatch[] {
    const mismatches: ChecksumMismatch[] = [];
    for (const [rel, entry] of Object.entries(corpus.manifest.files)) {
        if (trees && !trees.some(tree => rel === tree || rel.startsWith(`${tree}/`))) continue;
        const full = join(corpus.root, rel.split(posix.sep).join(sep));
        if (!existsSync(full)) { mismatches.push({ path: rel, reason: 'missing' }); continue; }
        const actual = createHash('sha256').update(readFileSync(full)).digest('hex');
        if (actual !== entry.sha256) mismatches.push({ path: rel, reason: 'changed' });
    }
    return mismatches;
}

/**
 * A unit of the corpus that is run and reported as one.
 *
 * The library units line up one-for-one with the ten published KPARs, so a
 * count can be read against the thing the OMG actually ships rather than
 * against a partition invented here. The examples are two more.
 */
export interface CorpusUnit {
    id: string;
    /** Directory, relative to the corpus root, in upstream's own path shape. */
    path: string;
    kind: 'library' | 'examples';
    /** Absolute paths of the model sources in this unit, sorted. */
    files: string[];
    bytes: number;
}

function slug(segment: string): string {
    return segment.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function isModelSource(name: string): boolean {
    return MODEL_EXTENSIONS.some(extension => name.endsWith(extension));
}

/** Every model source under `dir`, absolute and sorted. */
export function modelSourcesIn(dir: string): string[] {
    const out: string[] = [];
    const walk = (current: string): void => {
        for (const entry of readdirSync(current, { withFileTypes: true })) {
            const full = join(current, entry.name);
            if (entry.isDirectory()) walk(full);
            else if (isModelSource(entry.name)) out.push(full);
        }
    };
    if (existsSync(dir)) walk(dir);
    return out.sort();
}

function unitAt(root: string, relPath: string, kind: CorpusUnit['kind'], id: string): CorpusUnit {
    const files = modelSourcesIn(join(root, relPath.split(posix.sep).join(sep)));
    return {
        id,
        path: relPath,
        kind,
        files,
        bytes: files.reduce((n, file) => n + statSync(file).size, 0),
    };
}

/**
 * Partition the corpus into units.
 *
 * A library group whose own directory holds sources is one unit (the Systems
 * Library); otherwise each child directory is (Kernel Libraries, Domain
 * Libraries). That rule is what produces the ten-way split matching the KPARs,
 * without this file carrying a hardcoded list of library names that a Release
 * bump would silently invalidate.
 */
export function corpusUnits(corpus: Corpus): CorpusUnit[] {
    const units: CorpusUnit[] = [];
    const libraryRoot = join(corpus.root, LIBRARY_SOURCE_TREE);
    if (existsSync(libraryRoot)) {
        for (const group of readdirSync(libraryRoot, { withFileTypes: true })
            .filter(entry => entry.isDirectory())
            .sort((a, b) => (a.name < b.name ? -1 : 1))) {
            const groupPath = posix.join(LIBRARY_SOURCE_TREE, group.name);
            const groupDir = join(libraryRoot, group.name);
            const ownSources = readdirSync(groupDir).some(isModelSource);
            if (ownSources) {
                units.push(unitAt(corpus.root, groupPath, 'library', `library/${slug(group.name)}`));
                continue;
            }
            for (const library of readdirSync(groupDir, { withFileTypes: true })
                .filter(entry => entry.isDirectory())
                .sort((a, b) => (a.name < b.name ? -1 : 1))) {
                units.push(unitAt(
                    corpus.root,
                    posix.join(groupPath, library.name),
                    'library',
                    `library/${slug(group.name)}/${slug(library.name)}`,
                ));
            }
        }
    }
    for (const [relPath, id] of [['sysml/src', 'examples/sysml'], ['kerml/src', 'examples/kerml']] as const) {
        if (existsSync(join(corpus.root, relPath.split(posix.sep).join(sep)))) {
            units.push(unitAt(corpus.root, relPath, 'examples', id));
        }
    }
    return units.filter(unit => unit.files.length > 0);
}

/**
 * Select units by id, accepting a prefix so `--unit library` means all of them.
 *
 * An unmatched selector is an error rather than an empty run: a conformance
 * command that reports zero findings because it ran nothing is the worst
 * possible false green.
 */
export function selectUnits(units: readonly CorpusUnit[], selectors: readonly string[]): CorpusUnit[] {
    if (selectors.length === 0) return [...units];
    const selected = new Map<string, CorpusUnit>();
    for (const selector of selectors) {
        const matches = units.filter(unit => unit.id === selector || unit.id.startsWith(`${selector}/`));
        if (matches.length === 0) {
            throw new Error(
                `No corpus unit matches "${selector}". Available: ${units.map(u => u.id).join(', ')}.`,
            );
        }
        for (const match of matches) selected.set(match.id, match);
    }
    return [...selected.values()];
}

/**
 * The XMI file that serializes a given library source.
 *
 * Upstream mirrors the tree exactly and swaps the extension —
 * `sysml.library/Systems Library/Parts.sysml` becomes
 * `sysml.library.xmi.implied/Systems Library/Parts.sysmlx`.
 */
export function xmiCounterpart(corpus: Corpus, source: string, tree: string): string | undefined {
    const relPath = relative(join(corpus.root, LIBRARY_SOURCE_TREE), source);
    if (relPath.startsWith('..')) return undefined;
    const candidate = join(corpus.root, tree, `${relPath}x`);
    return existsSync(candidate) ? candidate : undefined;
}

/** Corpus-relative path, in upstream's own separator, for reports. */
export function corpusRelative(corpus: Corpus, path: string): string {
    return relative(corpus.root, path).split(sep).join(posix.sep);
}
