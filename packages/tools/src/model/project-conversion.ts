// ─── Project conversion ──────────────────────────────────────────────────────
//
// Restructure a pre-native project into the section 6.2 catalog layout.
//
// This module is the risky half of session 4: it is the only code in MEMO that
// rewrites a user's authored model in bulk. Everything here is therefore built
// around one rule — PLANNING NEVER TOUCHES THE DISK. `planConversion` reads,
// classifies, and returns a complete description of what would change;
// `applyConversion` is the only function that writes, and it refuses outright
// when the plan reports a collision. A conversion that cannot be described
// exactly is not performed at all.
//
// The three things the plan decides, in order, because each depends on the one
// before it:
//
//   1. where each file belongs   (path classification)
//   2. what its package is then called   (namespace mirroring)
//   3. which references have to follow   (imports, `expose`, artifact URIs)
//
// Step 3 is why this is not a shell script. A package rename is not a textual
// event local to one file: every `import`, every `expose`, and every qualified
// reference anywhere in the project names the old package, including in files
// that do not themselves move.
//
// Design reference: sections 6.2, 6.3, 18.4 (half A, deliverable 1).
// ─────────────────────────────────────────────────────────────────────────────

import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';
import { findSysmlFiles, isIgnoredDirectory } from './sysml-files.js';
import { PROJECT_ENTRYPOINT } from './native-project.js';

// ─── Plan shape ───────────────────────────────────────────────────────────────

/** One file the conversion relocates, rewrites, or both. */
export interface ConversionFileChange {
    /** Path relative to the project root, before conversion. */
    from: string;
    /** Path relative to the project root, after conversion. */
    to: string;
    /** Declared SysML package before conversion, when the file declares one. */
    fromPackage?: string;
    /** Declared SysML package after conversion. */
    toPackage?: string;
    /** Full file text after conversion. Undefined for binary payloads. */
    content?: string;
    /** Why this file changed, for the diff header. */
    reasons: string[];
}

/** A file the conversion creates that had no pre-conversion counterpart. */
export interface ConversionNewFile {
    path: string;
    content: string;
    reason: string;
}

/**
 * A refusal. A plan carrying collisions is never applied.
 *
 * Collisions are reported as a complete list rather than thrown one at a time:
 * a user converting a real project wants to see every clash in one pass, not to
 * discover the second one after fixing the first.
 */
export interface ConversionCollision {
    code:
        | 'destination-conflict'
        | 'package-name-conflict'
        | 'destination-occupied'
        | 'no-project-prefix'
        | 'referenced-superseded-entrypoint'
        | 'unparsed-package';
    message: string;
    files: string[];
}

export interface ConversionWarning {
    code:
        | 'package-not-mirroring'
        | 'unclassified-view'
        | 'vendored-reusable-package'
        | 'legacy-settings-file'
        | 'superseded-entrypoint'
        | 'unresolved-import';
    message: string;
    file?: string;
}

export interface ConversionPlan {
    projectRoot: string;
    /** Package-name prefix every project package shares, e.g. `memo_examples_gpca_pump`. */
    projectPrefix: string;
    /** True when the project is already in the target layout: applying is a no-op. */
    alreadyConverted: boolean;
    changes: ConversionFileChange[];
    newFiles: ConversionNewFile[];
    /** Legacy semantic settings files the conversion consumes and deletes. */
    removals: string[];
    /** old package name → new package name, for every renamed package. */
    packageRenames: Map<string, string>;
    collisions: ConversionCollision[];
    warnings: ConversionWarning[];
}

// ─── Layout knowledge ─────────────────────────────────────────────────────────

const CATALOG_ROOT = join('model', 'catalog');

/**
 * Filenames that name their directory rather than a sibling concept.
 *
 * `viewpoints/risk/viewpoint.sysml` is the risk viewpoint's own file, so its
 * package is `…_viewpoints_risk`, not `…_viewpoints_risk_viewpoint`. Without
 * this the namespace grows a redundant segment at every index file.
 */
const INDEX_BASENAMES = new Set(['viewpoint', 'catalog', 'index']);

/**
 * Semantic YAML the flip removed (session 3). The converter deletes these
 * rather than leaving them beside a native project, because a settings file
 * carrying a semantic field is now a hard rejection at load: leaving one in
 * place would convert the project into one that refuses to open.
 */
const LEGACY_SEMANTIC_SETTINGS = [
    'memo.config.yaml', 'memo.rules.yaml', 'memo.viewpoints.yaml', 'memo.rendering.yaml',
];

/**
 * Where views that declare no governing viewpoint are collected.
 *
 * ISO 42010 puts every view under a viewpoint, and a view that names none has a
 * real gap in it. The conversion neither invents a viewpoint nor drops the view
 * — it puts them somewhere obvious and says so.
 */
const UNCLASSIFIED_VIEW_GROUP = 'unassigned';

/** Directories under the project root that hold vendored reusable packages. */
const VENDORED_REUSABLE_DIRS = new Set(['methodology', 'methodologies', 'extensions', 'profile', 'profiles']);

// ─── Source reading ───────────────────────────────────────────────────────────

/**
 * The package a file declares, and the constructs it holds.
 *
 * This is deliberately a light regex read rather than a Langium parse. The
 * converter's job is textual — move a file, rename a package, follow the
 * references — and it must work on files that do not fully parse, which is
 * exactly the state a stale pre-conversion project is in. Anything that needs
 * real semantics (which viewpoint a view belongs to) is read as a declaration,
 * not evaluated.
 */
interface SourceFacts {
    packageName?: string;
    /** `view <name> : <Type>` usages declared in the file. */
    viewUsages: string[];
    /** `viewpoint <name>` usages declared in the file. */
    viewpointUsages: string[];
    /** Name bound by `part :>> viewpointDefinition = <name>;`. */
    viewpointDefinition?: string;
    /** Package names this file imports. */
    imports: string[];
    /**
     * True when the package body holds imports and nothing else — a re-export
     * wrapper rather than model content.
     */
    declaresOnlyImports: boolean;
}

const PACKAGE_RE = /^\s*package\s+([A-Za-z_][A-Za-z0-9_]*)/m;
const VIEW_RE = /^\s*view\s+([A-Za-z_][A-Za-z0-9_]*)\s*:/gm;
/**
 * A viewpoint usage, in either spelling.
 *
 * MEMO declares viewpoints as `part <name> : Viewpoint`, not with the SysML
 * `viewpoint` keyword — `Viewpoint` is a MEMO part definition carrying the
 * ISO 42010 framing attributes. Matching only the keyword form found nothing in
 * the ontology, which silently sent every view to the name-derived fallback
 * group instead of the directory its viewpoint actually lives in.
 */
const VIEWPOINT_RE =
    /^\s*(?:(?:part\s+([A-Za-z_][A-Za-z0-9_]*)\s*:\s*\w*Viewpoint\b)|(?:viewpoint\s+([A-Za-z_][A-Za-z0-9_]*)\s*[:{]))/gm;
const VIEWPOINT_DEF_RE = /viewpointDefinition\s*=\s*([A-Za-z_][A-Za-z0-9_]*)/;
const IMPORT_RE = /^\s*(?:public|private)?\s*import\s+([A-Za-z_][A-Za-z0-9_]*)/gm;

export function readSourceFacts(text: string): SourceFacts {
    const facts: SourceFacts = { viewUsages: [], viewpointUsages: [], imports: [], declaresOnlyImports: false };
    facts.packageName = PACKAGE_RE.exec(text)?.[1];
    for (const m of text.matchAll(VIEW_RE)) facts.viewUsages.push(m[1]);
    for (const m of text.matchAll(VIEWPOINT_RE)) facts.viewpointUsages.push(m[1] ?? m[2]);
    facts.viewpointDefinition = VIEWPOINT_DEF_RE.exec(text)?.[1];
    for (const m of text.matchAll(IMPORT_RE)) facts.imports.push(m[1]);
    facts.declaresOnlyImports = facts.packageName !== undefined && text
        .split('\n')
        .map(line => line.replace(/\/\/.*$/, '').trim())
        .every(line =>
            line === '' || line === '}' || line === '{' ||
            /^package\s/.test(line) || /^(public|private)?\s*import\s/.test(line));
    return facts;
}

// ─── Naming ───────────────────────────────────────────────────────────────────

function snake(name: string): string {
    return name
        .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
        .replace(/[^A-Za-z0-9]+/g, '_')
        .toLowerCase()
        .replace(/^_+|_+$/g, '');
}

/**
 * Longest `_`-separated prefix shared by every project package.
 *
 * Derived rather than configured, because the prefix is already a fact about
 * the project's source: whatever the packages agree on is the project's
 * namespace. Trailing structural segments are dropped so that a project whose
 * packages are all called `x_model_catalog_*` yields `x`, not `x_model_catalog`
 * — those segments describe where files sit, and the whole point of the
 * conversion is that the directory tree carries that instead.
 */
export function deriveProjectPrefix(
    packageNames: string[],
    sharedDirSegments: string[] = [],
): string | undefined {
    const lists = packageNames.filter(Boolean).map(n => n.split('_'));
    if (lists.length === 0) return undefined;

    let common = lists[0];
    for (const parts of lists.slice(1)) {
        let i = 0;
        while (i < common.length && i < parts.length && common[i] === parts[i]) i++;
        common = common.slice(0, i);
    }

    // Trailing segments that only restate the directory EVERY file already sits
    // under are location, and the catalog tree carries location now.
    // `sysml-diagram-samples` keeps every file in `model/samples/`, so every
    // package shares `…_model_samples`; carrying that into the prefix would
    // reproduce the old paths inside the new names.
    //
    // The suffix is matched exactly against the shared directory path rather
    // than against a list of structural-sounding words, because those two are
    // not the same question: `samples` appears twice in that project's prefix,
    // once as part of its name and once as the directory, and only the second
    // may go.
    let tail = sharedDirSegments.length;
    while (tail > 0) {
        const suffix = sharedDirSegments.slice(sharedDirSegments.length - tail);
        if (common.length > suffix.length &&
            suffix.every((seg, i) => common[common.length - suffix.length + i] === seg)) {
            common = common.slice(0, common.length - suffix.length);
            break;
        }
        tail--;
    }
    while (common.length > 1 && ['model', 'catalog', 'src'].includes(common[common.length - 1])) {
        common = common.slice(0, -1);
    }
    return common.length > 0 ? common.join('_') : undefined;
}

/**
 * The directory path every project `.sysml` file sits under, as name segments.
 *
 * Empty for a project whose sources are spread across sibling directories,
 * which is the common case and correctly leaves the prefix alone.
 */
function sharedDirectorySegments(relPaths: string[]): string[] {
    if (relPaths.length === 0) return [];
    const dirs = relPaths.map(p => p.split(/[\\/]/).slice(0, -1));
    let common = dirs[0];
    for (const parts of dirs.slice(1)) {
        let i = 0;
        while (i < common.length && i < parts.length && common[i] === parts[i]) i++;
        common = common.slice(0, i);
    }
    return common.flatMap(seg => snake(seg).split('_')).filter(Boolean);
}

/**
 * The package name a file at `catalogRelPath` should declare.
 *
 * Namespace mirroring, mechanically: prefix, then the directory chain, then the
 * basename — except where the basename only restates the directory it sits in.
 */
export function derivePackageName(prefix: string, catalogRelPath: string): string {
    const segments = catalogRelPath.split(/[\\/]/).filter(Boolean);
    const file = segments.pop()!.replace(/\.sysml$/, '');
    const parent = segments[segments.length - 1];

    const redundant = INDEX_BASENAMES.has(file) || (parent !== undefined && file === parent);
    const parts = [prefix, ...segments, ...(redundant ? [] : [file])];
    return parts.map(snake).filter(Boolean).join('_');
}

/**
 * Whether an in-place file's declared package already mirrors its location.
 *
 * Two forms are accepted: the canonical one `derivePackageName` emits, and the
 * same name with the trailing basename segment dropped. Both place the package
 * at or under its directory's namespace, which is what mirroring means. The
 * short form is accepted rather than "corrected" because rewriting a package
 * name is a real edit to a user's model, and MEMO's own hand-authored catalog
 * uses it — a converter that churned those files would fail its own
 * idempotence test for a purely cosmetic reason.
 */
export function isMirroringPackageName(name: string, prefix: string, catalogRelPath: string): boolean {
    const canonical = derivePackageName(prefix, catalogRelPath);
    if (name === canonical) return true;
    const segments = catalogRelPath.split(/[\\/]/).filter(Boolean);
    segments.pop();
    const short = [prefix, ...segments].map(snake).filter(Boolean).join('_');
    return name === short;
}

// ─── Path classification ──────────────────────────────────────────────────────

export type FileRole =
    | 'catalog' | 'view' | 'viewpoint' | 'entrypoint' | 'vendored-reusable' | 'legacy-entrypoint';

/**
 * Where a source file belongs after conversion.
 *
 * The classification is structural — a file's current directory and the
 * constructs it declares — and never guesses at ontology layer. Deciding that
 * `gpca_risk.sysml` "is" safety/risk content would mean the converter forming
 * an opinion about model semantics, and getting that wrong silently relocates a
 * user's model into a namespace they did not choose. Files already inside the
 * catalog therefore keep their place; only files outside it, whose location is
 * unambiguously wrong under section 6.2, are moved.
 */
export function classifyFile(
    relPath: string,
    facts: SourceFacts,
    viewpointGroup: (viewpointUsage: string) => string,
): { role: FileRole; to: string } {
    const norm = relPath.split(sep).join('/');

    if (norm === CATALOG_ROOT.split(sep).join('/') + '/project.sysml') {
        return { role: 'entrypoint', to: relPath };
    }

    const top = norm.split('/')[0];
    if (VENDORED_REUSABLE_DIRS.has(top)) return { role: 'vendored-reusable', to: relPath };

    // A re-export wrapper sitting directly under `model/` is the pre-catalog
    // way of giving a project one public package to import. `project.sysml` is
    // that entrypoint now, so the wrapper is superseded rather than relocated —
    // moving it would put a second entrypoint inside the catalog, and every
    // shipped example carried one.
    if (facts.declaresOnlyImports && /^model\/[^/]+\.sysml$/.test(norm)) {
        return { role: 'legacy-entrypoint', to: relPath };
    }

    const isViewFile = facts.viewUsages.length > 0;
    const isViewpointFile = !isViewFile && facts.viewpointUsages.length > 0;
    const inViewsDir = /(^|\/)(views|viewpoints)\//.test(norm);

    if (isViewFile) {
        // A view's viewpoint is a declared fact in the file, and it is a better
        // grouping than the filename: GPCA's `behavior_action_flow_view.sysml`
        // is governed by the logical viewpoint, and `document_*` views spread
        // across six different viewpoints. Filename prefixes would have put all
        // of them in the wrong place.
        // A view that names no governing viewpoint cannot be filed against
        // one. Deriving a group from its filename would invent an ISO 42010
        // viewpoint the model never declared, so these collect under one
        // clearly-named group and are reported for an author to place.
        const group = facts.viewpointDefinition
            ? viewpointGroup(facts.viewpointDefinition)
            : UNCLASSIFIED_VIEW_GROUP;
        return { role: 'view', to: join(CATALOG_ROOT, 'viewpoints', group, 'views', basename(norm)) };
    }

    if (isViewpointFile || (inViewsDir && facts.viewpointUsages.length > 0)) {
        const group = facts.viewpointUsages.length > 0
            ? viewpointGroup(facts.viewpointUsages[0])
            : UNCLASSIFIED_VIEW_GROUP;
        return { role: 'viewpoint', to: join(CATALOG_ROOT, 'viewpoints', group, 'viewpoint.sysml') };
    }

    if (norm.startsWith('model/catalog/')) return { role: 'catalog', to: relPath };
    if (norm.startsWith('model/')) {
        return { role: 'catalog', to: join(CATALOG_ROOT, norm.slice('model/'.length)) };
    }
    return { role: 'catalog', to: join(CATALOG_ROOT, norm) };
}

/**
 * Directory name for the viewpoint a view is governed by.
 *
 * Prefers the directory the reusable viewpoint's own source sits in, so a
 * project's `viewpoints/risk/` lines up with the ontology's
 * `src/viewpoints/risk/`. Falls back to the usage name with its `Viewpoint`
 * suffix removed.
 */
export function viewpointGroupName(
    usageName: string,
    declaringFileByUsage: Map<string, string>,
): string {
    const declaring = declaringFileByUsage.get(usageName);
    if (declaring) {
        const dir = basename(dirname(declaring));
        if (dir && dir !== 'viewpoints' && dir !== 'src') return snake(dir);
    }
    return snake(usageName.replace(/Viewpoint$/, ''));
}

// ─── Reference rewriting ──────────────────────────────────────────────────────

/**
 * Rewrite package references in `text` according to `renames`.
 *
 * Word-boundary anchored and applied longest-name-first, because package names
 * nest: renaming `a_b` before `a_b_c` would corrupt every reference to the
 * longer name. Comments and doc strings are rewritten too — deliberately, since
 * a stale package name in a comment is a documentation defect the conversion
 * would otherwise create.
 */
export function rewritePackageReferences(text: string, renames: Map<string, string>): string {
    const ordered = [...renames.entries()].sort((a, b) => b[0].length - a[0].length);
    let out = text;
    for (const [from, to] of ordered) {
        if (from === to) continue;
        out = out.replace(new RegExp(`\\b${escapeRe(from)}\\b`, 'g'), to);
    }
    return out;
}

/**
 * Rewrite the file's own `package <name>` declaration.
 *
 * Separate from reference rewriting because a file's declaration is renamed
 * even when nothing else refers to it, and because the declaration is the one
 * occurrence that must change exactly once.
 */
export function rewritePackageDeclaration(text: string, toPackage: string): string {
    return text.replace(/^(\s*package\s+)([A-Za-z_][A-Za-z0-9_]*)/m, `$1${toPackage}`);
}

/**
 * Rewrite model-owned payload URIs to follow their payload files.
 *
 * Artifact identities carry a project-relative URI (`imageUri`, `uri`,
 * `payloadUri`, `sourceUri`). When the payload moves, an unrewritten URI leaves
 * the artifact pointing at nothing, and the hash check that would have caught
 * it passes vacuously because the file is simply absent. This is the quietest
 * failure the conversion could produce, so it is handled explicitly rather than
 * left to the package-reference pass.
 */
export function rewriteArtifactUris(text: string, moves: Map<string, string>): string {
    const ordered = [...moves.entries()].sort((a, b) => b[0].length - a[0].length);
    let out = text;
    for (const [from, to] of ordered) {
        if (from === to) continue;
        const fromPosix = from.split(sep).join('/');
        const toPosix = to.split(sep).join('/');
        out = out.replace(new RegExp(`"${escapeRe(fromPosix)}"`, 'g'), `"${toPosix}"`);
        // Also match a URI written relative to `model/`, which is how
        // pre-catalog projects addressed their own payloads.
        const fromShort = fromPosix.replace(/^model\//, '');
        const toShort = toPosix.replace(/^model\//, '');
        if (fromShort !== fromPosix) {
            out = out.replace(new RegExp(`"${escapeRe(fromShort)}"`, 'g'), `"${toShort}"`);
        }
    }
    return out;
}

function escapeRe(s: string): string {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function push<K, V>(map: Map<K, V[]>, key: K, value: V): void {
    const list = map.get(key);
    if (list) list.push(value); else map.set(key, [value]);
}

// ─── Payload discovery ────────────────────────────────────────────────────────

/** Non-SysML files under `model/` that are model-owned artifact payloads. */
function findPayloadFiles(projectRoot: string): string[] {
    const modelDir = join(projectRoot, 'model');
    if (!existsSync(modelDir)) return [];
    const out: string[] = [];
    const walk = (dir: string) => {
        let entries;
        try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
        for (const entry of entries) {
            const full = join(dir, entry.name);
            if (entry.isDirectory()) {
                if (!isIgnoredDirectory(entry.name)) walk(full);
            } else if (!entry.name.endsWith('.sysml')) {
                out.push(full);
            }
        }
    };
    walk(modelDir);
    return out;
}

/** Where a payload file belongs: alongside the assets catalog. */
function payloadTarget(relPath: string): string {
    const norm = relPath.split(sep).join('/');
    if (norm.startsWith('model/catalog/artifacts/')) return relPath;
    if (norm.startsWith('model/assets/')) {
        return join(CATALOG_ROOT, 'artifacts', 'assets', norm.slice('model/assets/'.length));
    }
    if (norm.startsWith('model/catalog/')) return relPath;
    return join(CATALOG_ROOT, norm.slice('model/'.length));
}

// ─── Planning ─────────────────────────────────────────────────────────────────

export interface PlanOptions {
    /**
     * Viewpoint usage name → file that declares it, across the resolved
     * reusable closure. Supplied by the command, which has already resolved the
     * project; the planner stays free of resolution so it can be tested on a
     * directory alone.
     */
    viewpointDeclarations?: Map<string, string>;
    /** Package name → the reusable package that declares that viewpoint usage. */
    viewpointPackages?: Map<string, string>;
    /**
     * Also rename packages of files that do not move but whose declared name
     * does not mirror their location.
     *
     * Off by default. Renaming a package a user chose is a real edit to their
     * model with no functional payoff — the file already sits where it belongs,
     * and only the spelling of its namespace is off. Reporting it as a warning
     * lets the owner decide. MEMO's own corpus turns it on, because a shipped
     * example whose packages still spell `…_model_catalog_…` is demonstrating
     * the layout the catalog replaced.
     */
    normalizeNames?: boolean;
}

/**
 * Describe, without writing anything, the conversion of `projectRoot`.
 *
 * Every disk write in this module happens in `applyConversion`. That split is
 * what makes `--dry-run` trustworthy: dry-run is not a flag threaded through
 * the write path that might be missed on one branch, it is the absence of a
 * call to the only function that writes.
 */
export function planConversion(projectRoot: string, options: PlanOptions = {}): ConversionPlan {
    const root = resolve(projectRoot);
    const collisions: ConversionCollision[] = [];
    const warnings: ConversionWarning[] = [];

    const sysmlFiles = findSysmlFiles(root).sort();
    const rel = (f: string) => relative(root, f);

    // 1. Read every file once.
    const facts = new Map<string, SourceFacts>();
    const text = new Map<string, string>();
    for (const file of sysmlFiles) {
        let content: string;
        try { content = readFileSync(file, 'utf-8'); } catch { continue; }
        text.set(rel(file), content);
        facts.set(rel(file), readSourceFacts(content));
    }

    // 2. The project's namespace prefix.
    const projectPackages = [...facts.entries()]
        .filter(([relPath]) => !VENDORED_REUSABLE_DIRS.has(relPath.split(sep)[0]))
        .map(([, f]) => f.packageName)
        .filter((n): n is string => Boolean(n));
    const projectPrefix = deriveProjectPrefix(projectPackages, sharedDirectorySegments([...facts.keys()]));
    if (!projectPrefix) {
        collisions.push({
            code: 'no-project-prefix',
            message: 'No project package prefix could be derived: no .sysml file declares a package.',
            files: [],
        });
        return emptyPlan(root, '', collisions, warnings);
    }

    // 3. Viewpoint grouping, from the reusable closure when the caller resolved
    //    one and from the project's own declarations otherwise.
    const declaringFileByUsage = new Map(options.viewpointDeclarations ?? []);
    for (const [relPath, f] of facts) {
        for (const vp of f.viewpointUsages) {
            if (!declaringFileByUsage.has(vp)) declaringFileByUsage.set(vp, relPath);
        }
    }
    const groupOf = (usage: string) => viewpointGroupName(usage, declaringFileByUsage);

    // 4. Classify, and derive the target package for anything that moves.
    const changes: ConversionFileChange[] = [];
    const packageRenames = new Map<string, string>();
    const destinations = new Map<string, string[]>();
    const viewpointGroupsSeen = new Map<string, string>();   // group → source viewpoint usage
    const supersededEntrypoints: string[] = [];

    for (const [relPath, f] of [...facts.entries()].sort()) {
        const { role, to } = classifyFile(relPath, f, groupOf);

        if (role === 'legacy-entrypoint') {
            // Only superseded if nothing else names it. A wrapper another file
            // imports is load-bearing, and deleting it would break that import
            // — so the plan refuses rather than removing it.
            const referrers = [...facts.entries()]
                .filter(([other, of_]) => other !== relPath && f.packageName
                    && (of_.imports.includes(f.packageName)))
                .map(([other]) => other);
            if (referrers.length > 0) {
                collisions.push({
                    code: 'referenced-superseded-entrypoint',
                    message:
                        `${relPath} is a re-export wrapper superseded by model/catalog/project.sysml, ` +
                        `but ${referrers.length} file(s) import ${f.packageName}. Repoint them at the ` +
                        'packages they actually need, then convert.',
                    files: [relPath, ...referrers],
                });
                continue;
            }
            supersededEntrypoints.push(relPath);
            warnings.push({
                code: 'superseded-entrypoint',
                file: relPath,
                message:
                    `${relPath} is removed: it is a re-export wrapper that gave the project one public ` +
                    'package to import, which is model/catalog/project.sysml\'s job now. Nothing imports it.',
            });
            continue;
        }

        if (role === 'vendored-reusable') {
            warnings.push({
                code: 'vendored-reusable-package',
                file: relPath,
                message:
                    `${relPath} is a project-vendored reusable package, not project catalog content. ` +
                    'It is left in place: relocating it into model/catalog/ would assert that the ' +
                    'methodology or extension it declares is project-owned, which is a semantic claim ' +
                    'the conversion is not entitled to make.',
            });
            continue;
        }

        push(destinations, to, relPath);

        const catalogRel = to.split(sep).join('/').replace(/^model\/catalog\//, '');
        const moved = to !== relPath;
        const reasons: string[] = [];
        if (moved) reasons.push(`relocated to the section 6.2 catalog layout (${role})`);

        let toPackage = f.packageName;
        if (f.packageName) {
            if (moved) {
                toPackage = derivePackageName(projectPrefix, catalogRel);
                if (toPackage !== f.packageName) {
                    reasons.push('package renamed to mirror its new namespace');
                    packageRenames.set(f.packageName, toPackage);
                }
            } else if (role === 'entrypoint'
                && [projectPrefix, `${projectPrefix}_project`, `${projectPrefix}_catalog`]
                    .includes(f.packageName)) {
                // The entrypoint's package IS the project's namespace root, and
                // it has several equally correct spellings. Rewriting one to
                // another would rename the package every import in the project
                // resolves through, to no end.
            } else if (!isMirroringPackageName(f.packageName, projectPrefix, catalogRel)) {
                const canonical = derivePackageName(projectPrefix, catalogRel);
                if (options.normalizeNames) {
                    toPackage = canonical;
                    reasons.push('package renamed to mirror its location');
                    packageRenames.set(f.packageName, canonical);
                } else {
                    warnings.push({
                        code: 'package-not-mirroring',
                        file: relPath,
                        message:
                            `${relPath} declares ${f.packageName}, which does not mirror its location ` +
                            `(expected ${canonical}). The file is not moving, so its declaration is left ` +
                            'alone; re-run with --normalize-names to rename it.',
                    });
                }
            }
        } else {
            collisions.push({
                code: 'unparsed-package',
                message: `${relPath} declares no SysML package, so its namespace cannot be placed.`,
                files: [relPath],
            });
        }

        if (role === 'view' && !facts.get(relPath)?.viewpointDefinition) {
            warnings.push({
                code: 'unclassified-view',
                file: relPath,
                message:
                    `${relPath} declares a view but no governing viewpoint, so it lands under ` +
                    `viewpoints/${UNCLASSIFIED_VIEW_GROUP}/. Give it a viewpointDefinition and move it ` +
                    'to that viewpoint — ISO 42010 puts every view under one.',
            });
        }

        if (role === 'view' || role === 'viewpoint') {
            // model/catalog/viewpoints/<group>/…
            const group = to.split(sep)[3];
            if (group && !viewpointGroupsSeen.has(group)) {
                viewpointGroupsSeen.set(group, f.viewpointDefinition ?? f.viewpointUsages[0] ?? group);
            }
        }

        if (reasons.length > 0 || moved) {
            changes.push({ from: relPath, to, fromPackage: f.packageName, toPackage, reasons });
        }
    }

    // 5. Payload files follow their artifact identities.
    const payloadMoves = new Map<string, string>();
    for (const file of findPayloadFiles(root)) {
        const from = rel(file);
        const to = payloadTarget(from);
        if (to === from) continue;
        payloadMoves.set(from, to);
        push(destinations, to, from);
        changes.push({ from, to, reasons: ['artifact payload follows its identity into artifacts/assets/'] });
    }

    // 6. Collisions: two sources landing on one destination, two packages
    //    taking one name, or a destination that already holds a different file.
    for (const [to, sources] of destinations) {
        if (sources.length > 1) {
            collisions.push({
                code: 'destination-conflict',
                message:
                    `${sources.length} files would be written to ${to}. The conversion refuses rather ` +
                    'than picking a winner or writing a suffixed duplicate; rename one of them first.',
                files: sources,
            });
        }
    }
    const byNewName = new Map<string, string[]>();
    for (const change of changes) {
        if (!change.toPackage) continue;
        push(byNewName, change.toPackage, change.from);
    }
    for (const [name, sources] of byNewName) {
        const others = [...facts.entries()]
            .filter(([relPath, f]) => f.packageName === name && !sources.includes(relPath)
                && !changes.some(c => c.from === relPath))
            .map(([relPath]) => relPath);
        if (sources.length + others.length > 1) {
            collisions.push({
                code: 'package-name-conflict',
                message:
                    `Package ${name} would be declared by ${sources.length + others.length} files. ` +
                    'Section 18.6 rejects overloaded names rather than ranking them.',
                files: [...sources, ...others],
            });
        }
    }
    for (const change of changes) {
        if (change.to === change.from) continue;
        const dest = join(root, change.to);
        if (existsSync(dest) && !changes.some(c => c.from === change.to)) {
            collisions.push({
                code: 'destination-occupied',
                message: `${change.to} already exists and is not itself being moved.`,
                files: [change.from, change.to],
            });
        }
    }

    // 7. Apply the rewrites to every file's text — including files that do not
    //    move, because a rename is a project-wide reference event.
    const allRewrites = new Map(packageRenames);
    for (const [relPath, content] of text) {
        if (supersededEntrypoints.includes(relPath)) continue;
        const change = changes.find(c => c.from === relPath);
        let out = content;
        if (change?.toPackage && change.toPackage !== change.fromPackage) {
            out = rewritePackageDeclaration(out, change.toPackage);
        }
        out = rewritePackageReferences(out, allRewrites);
        out = rewriteArtifactUris(out, payloadMoves);
        if (out === content && !change) continue;
        if (change) {
            change.content = out;
            if (out !== content && !change.reasons.some(r => r.includes('reference'))) {
                change.reasons.push('references to renamed packages rewritten');
            }
        } else {
            changes.push({
                from: relPath, to: relPath,
                fromPackage: facts.get(relPath)?.packageName,
                toPackage: facts.get(relPath)?.packageName,
                content: out,
                reasons: ['references to renamed packages rewritten'],
            });
        }
    }

    // 8. Files the conversion creates: viewpoint bindings for groups that
    //    gained views but have no viewpoint file, and the entrypoint.
    const newFiles: ConversionNewFile[] = [];
    const existingViewpointFiles = new Set(
        changes.filter(c => c.to.includes(`${sep}viewpoints${sep}`) && c.to.endsWith('viewpoint.sysml'))
            .map(c => c.to),
    );
    for (const [group, usage] of viewpointGroupsSeen) {
        const path = join(CATALOG_ROOT, 'viewpoints', group, 'viewpoint.sysml');
        if (existingViewpointFiles.has(path) || existsSync(join(root, path))) continue;
        const declaringPackage = options.viewpointPackages?.get(usage);
        newFiles.push({
            path,
            reason: `viewpoint binding for the ${group} views (ISO 42010: views sit beneath their viewpoint)`,
            content: renderViewpointBinding(projectPrefix, group, usage, declaringPackage),
        });
    }

    // 9. The entrypoint, when the project has none.
    const entrypoint = PROJECT_ENTRYPOINT;
    const hasEntrypoint = existsSync(join(root, entrypoint)) || changes.some(c => c.to === entrypoint);
    const finalPackages = collectFinalPackages(facts, changes, newFiles, supersededEntrypoints);
    if (!hasEntrypoint) {
        newFiles.push({
            path: entrypoint,
            reason: 'native entrypoint: project identity, imports, and method binding',
            content: renderEntrypoint(projectPrefix, root, finalPackages),
        });
    }

    // 10. Legacy semantic settings and superseded wrappers are consumed, not
    //     left beside the result.
    const removals: string[] = [...supersededEntrypoints];
    for (const name of LEGACY_SEMANTIC_SETTINGS) {
        if (!existsSync(join(root, name))) continue;
        removals.push(name);
        warnings.push({
            code: 'legacy-settings-file',
            file: name,
            message:
                `${name} is removed: it carries semantic fields that no longer participate in the ` +
                'model, and settings-boundary rejects them at load. Its selection is expressed by the ' +
                'entrypoint binding instead.',
        });
    }

    const alreadyConverted =
        changes.every(c => c.from === c.to && c.content === undefined) &&
        newFiles.length === 0 && removals.length === 0;

    return {
        projectRoot: root,
        projectPrefix,
        alreadyConverted,
        changes: changes.sort((a, b) => a.from.localeCompare(b.from)),
        newFiles,
        removals,
        packageRenames,
        collisions,
        warnings,
    };
}

function emptyPlan(
    root: string, prefix: string, collisions: ConversionCollision[], warnings: ConversionWarning[],
): ConversionPlan {
    return {
        projectRoot: root, projectPrefix: prefix, alreadyConverted: false,
        changes: [], newFiles: [], removals: [], packageRenames: new Map(), collisions, warnings,
    };
}

function collectFinalPackages(
    facts: Map<string, SourceFacts>,
    changes: ConversionFileChange[],
    newFiles: ConversionNewFile[],
    removed: string[],
): string[] {
    const names = new Set<string>();
    for (const [relPath, f] of facts) {
        if (removed.includes(relPath)) continue;
        const change = changes.find(c => c.from === relPath);
        const name = change?.toPackage ?? f.packageName;
        if (name) names.add(name);
    }
    for (const f of newFiles) {
        const name = readSourceFacts(f.content).packageName;
        if (name) names.add(name);
    }
    return [...names].sort();
}

// ─── Rendering ────────────────────────────────────────────────────────────────

function renderViewpointBinding(
    prefix: string, group: string, usage: string, declaringPackage: string | undefined,
): string {
    const pkg = derivePackageName(prefix, `viewpoints/${group}/viewpoint.sysml`);
    const importLine = declaringPackage
        ? `    public import ${declaringPackage}::*;`
        : `    // The reusable package declaring ${usage} could not be resolved during\n` +
          `    // conversion. Import it here so the views beneath this viewpoint resolve.`;
    return [
        `// ${group} viewpoint.`,
        '//',
        '// This project does not define its own viewpoint here; it binds the reusable',
        '// MEMO viewpoint that frames these concerns. The views it governs sit beneath',
        '// `views/`.',
        `package ${pkg} {`,
        importLine,
        '}',
        '',
    ].join('\n');
}

/**
 * The entrypoint a converted project gets when it had none.
 *
 * The binding is written with a placeholder methodology reference rather than a
 * guess. A conversion cannot know which methodology a legacy project intended —
 * `memo.config.yaml: methodology` held a package spec, not a usage name, and
 * resolving one to the other requires the methodology package to be present.
 * Emitting a name that does not resolve produces a source diagnostic the user
 * sees immediately, which is the correct failure: loud, local, and one edit
 * away from correct.
 */
function renderEntrypoint(prefix: string, root: string, packages: string[]): string {
    const pkg = `${prefix}_project`;
    const projectName = basename(root)
        .split(/[-_]/).map(s => s.charAt(0).toUpperCase() + s.slice(1)).join(' ');
    const idBase = prefix.split('_').slice(-2).join('-').toUpperCase();
    const own = packages.filter(p => p.startsWith(`${prefix}_`) && p !== pkg);

    return [
        `// ${projectName} — project identity and method binding.`,
        '//',
        '// The native entrypoint. The imports name what this project contains and the',
        '// binding names the methodology it is governed by. No YAML file participates.',
        `package ${pkg} {`,
        '    private import ScalarValues::*;',
        '',
        '    private import memo_core_enumerations::*;',
        '    private import memo_methodology_core::*;',
        '    private import memo_methodology_profiles::*;',
        '',
        '    // The project\'s own content, imported so the catalog is one reachable',
        '    // closure from a single entrypoint.',
        ...own.map(p => `    private import ${p}::*;`),
        '',
        `    part projectBinding : ProjectMethodBinding {`,
        `        attribute :>> id = "PMB-${idBase}-001";`,
        `        attribute :>> name = "${projectName.replace(/\s+/g, '')}ProjectMethodBinding";`,
        `        attribute :>> projectName = "${projectName}";`,
        '        ref :>> selectedMethodology = mdDefaultDefinition;',
        '        attribute :>> scopeMode = ScopeModeKind::explicit;',
        '    }',
        '}',
        '',
    ].join('\n');
}

// ─── Diff rendering ───────────────────────────────────────────────────────────

/**
 * A human-readable description of the plan.
 *
 * Deliberately not a unified content diff by default: the conversion's changes
 * are overwhelmingly moves and one-token renames, and a line-level diff of
 * twenty relocated files buries the two facts a reviewer needs — what moved,
 * and what got renamed. `--diff` adds the content hunks on top of this.
 */
export function renderPlan(plan: ConversionPlan, options: { diff?: boolean } = {}): string {
    const out: string[] = [];
    const rel = plan.projectRoot;

    if (plan.collisions.length > 0) {
        out.push('REFUSED — the conversion cannot be described unambiguously:', '');
        for (const c of plan.collisions) {
            out.push(`  [${c.code}] ${c.message}`);
            for (const f of c.files) out.push(`      ${f}`);
            out.push('');
        }
        return out.join('\n');
    }

    if (plan.alreadyConverted) {
        return `${rel}\n  Already in the native catalog layout. Nothing to convert.\n`;
    }

    out.push(`${rel}`, `  project namespace: ${plan.projectPrefix}`, '');

    const moves = plan.changes.filter(c => c.from !== c.to);
    const inPlace = plan.changes.filter(c => c.from === c.to && c.content !== undefined);

    if (moves.length > 0) {
        out.push(`  Moves (${moves.length}):`);
        for (const c of moves) {
            out.push(`    ${c.from}`);
            out.push(`      → ${c.to}`);
            if (c.fromPackage && c.toPackage && c.fromPackage !== c.toPackage) {
                out.push(`      package ${c.fromPackage} → ${c.toPackage}`);
            }
        }
        out.push('');
    }
    if (inPlace.length > 0) {
        out.push(`  Rewritten in place (${inPlace.length}):`);
        for (const c of inPlace) out.push(`    ${c.from} — ${c.reasons.join('; ')}`);
        out.push('');
    }
    if (plan.newFiles.length > 0) {
        out.push(`  Created (${plan.newFiles.length}):`);
        for (const f of plan.newFiles) out.push(`    ${f.path} — ${f.reason}`);
        out.push('');
    }
    if (plan.removals.length > 0) {
        out.push(`  Removed (${plan.removals.length}):`);
        for (const f of plan.removals) out.push(`    ${f}`);
        out.push('');
    }
    if (plan.warnings.length > 0) {
        out.push(`  Warnings (${plan.warnings.length}):`);
        for (const w of plan.warnings) out.push(`    [${w.code}] ${w.message}`);
        out.push('');
    }

    if (options.diff) {
        for (const c of plan.changes) {
            if (c.content === undefined) continue;
            let before: string;
            try { before = readFileSync(join(plan.projectRoot, c.from), 'utf-8'); } catch { continue; }
            const hunks = lineDiff(before, c.content);
            if (hunks.length === 0) continue;
            out.push(`--- a/${c.from}`, `+++ b/${c.to}`, ...hunks, '');
        }
        for (const f of plan.newFiles) {
            out.push(`--- /dev/null`, `+++ b/${f.path}`,
                ...f.content.split('\n').map(l => `+${l}`), '');
        }
    }

    return out.join('\n');
}

/** Changed lines with one line of context. Enough to review a rename. */
function lineDiff(before: string, after: string): string[] {
    const a = before.split('\n');
    const b = after.split('\n');
    const out: string[] = [];
    for (let i = 0; i < Math.max(a.length, b.length); i++) {
        if (a[i] === b[i]) continue;
        if (a[i] !== undefined) out.push(`-${a[i]}`);
        if (b[i] !== undefined) out.push(`+${b[i]}`);
    }
    return out;
}

// ─── Applying ─────────────────────────────────────────────────────────────────

export interface ApplyResult {
    written: string[];
    moved: string[];
    created: string[];
    removed: string[];
}

/**
 * The only function in this module that writes.
 *
 * It refuses a plan carrying collisions, and it refuses to duplicate: a move
 * writes the destination and removes the source, so a half-applied conversion
 * leaves one copy of each file rather than two divergent ones. Directories left
 * empty by the moves are pruned, because an empty `model/views/` beside
 * `model/catalog/viewpoints/` is exactly the superseded layout the conversion
 * exists to eliminate.
 */
export function applyConversion(plan: ConversionPlan): ApplyResult {
    if (plan.collisions.length > 0) {
        throw new Error(
            `Refusing to convert ${plan.projectRoot}: ${plan.collisions.length} collision(s). ` +
            plan.collisions.map(c => c.message).join(' '),
        );
    }

    const result: ApplyResult = { written: [], moved: [], created: [], removed: [] };
    const root = plan.projectRoot;

    for (const change of plan.changes) {
        const src = join(root, change.from);
        const dest = join(root, change.to);
        mkdirSync(dirname(dest), { recursive: true });
        if (change.content !== undefined) {
            writeFileSync(dest, change.content);
        } else if (src !== dest) {
            writeFileSync(dest, readFileSync(src));
        }
        if (src !== dest) {
            rmSync(src, { force: true });
            result.moved.push(`${change.from} → ${change.to}`);
        } else if (change.content !== undefined) {
            result.written.push(change.to);
        }
    }

    for (const file of plan.newFiles) {
        const dest = join(root, file.path);
        mkdirSync(dirname(dest), { recursive: true });
        writeFileSync(dest, file.content);
        result.created.push(file.path);
    }

    for (const name of plan.removals) {
        rmSync(join(root, name), { force: true });
        result.removed.push(name);
    }

    pruneEmptyDirs(join(root, 'model'));
    return result;
}

function pruneEmptyDirs(dir: string): void {
    if (!existsSync(dir)) return;
    let entries;
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
        if (entry.isDirectory()) pruneEmptyDirs(join(dir, entry.name));
    }
    try {
        if (readdirSync(dir).length === 0 && basename(dir) !== 'model') rmSync(dir, { recursive: true });
    } catch { /* raced or unreadable */ }
}
