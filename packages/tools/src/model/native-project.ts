// ─── Native Project Resolution ────────────────────────────────────────────────
//
// What a project selects, decided entirely from SysML.
//
// Before the flip, `memo.config.yaml: methodology/extends/ontologies` and
// `memo.package.yaml: type/extends/usage` chose the model's content. They no
// longer do — nothing here reads them, and `settings-boundary.ts` rejects them
// if a project still carries them. Selection now comes from two native facts:
//
//   1. the project's own `.sysml` import graph, rooted at the entrypoint
//      `model/catalog/project.sysml`, and
//   2. the `ProjectMethodBinding` that entrypoint declares, whose
//      `selectedMethodology` is a typed SysML reference.
//
// Application settings still say *where* a package's source sits on disk. That
// is a locator, not a selection: a package a settings file can point at but
// that no import reaches contributes nothing. If the two disagree — a manifest
// resolves a package the import graph never names, or an import names a package
// no locator can find — this module reports a resolution diagnostic rather than
// quietly preferring one.
//
// Design reference: sections 5.1, 5.3, 6.2, 9.
// ─────────────────────────────────────────────────────────────────────────────

import { existsSync, readdirSync, realpathSync, statSync } from 'node:fs';
import { dirname, extname, join, relative, resolve, sep } from 'node:path';
import { readPackageManifest } from './package-manifest.js';
import { discoverMemoManifests, findMemoManifests, resolveManifestPath } from './manifest.js';
import { importKpar } from '../commands/package.js';
import type { SemanticOrigin } from './source-provenance.js';

/**
 * SysML v2 standard-library packages.
 *
 * These are supplied by the selected compiler and the package manager, not by a MEMO
 * package, so an import of one resolves to nothing on disk and that is correct.
 * Reporting it as an unresolved import would bury the real diagnostics under
 * one line per file.
 */
const STANDARD_LIBRARY_PACKAGES = new Set([
    'ScalarValues', 'Base', 'Occurrences', 'Objects', 'Performances', 'Transfers',
    'Parts', 'Items', 'Ports', 'Connections', 'Interfaces', 'Actions', 'States',
    'Constraints', 'Requirements', 'Cases', 'AnalysisCases', 'VerificationCases',
    'UseCases', 'Views', 'Metadata', 'Metaobjects', 'Allocations', 'Calculations', 'Attributes',
    'Collections', 'SequenceFunctions', 'ControlFunctions', 'BaseFunctions',
    'NumericalFunctions', 'StringFunctions', 'BooleanFunctions', 'DataFunctions',
    'ISQ', 'SI', 'Quantities', 'MeasurementReferences', 'Time', 'SpatialFrames',
]);

/** Conventional template value for the required project root descriptor. */
export const PROJECT_ENTRYPOINT = join('model', 'catalog', 'project.sysml');

/**
 * Resolve the project's required native entrypoint. `entrypoint` is a project locator:
 * it names the SysML file from which project identity and import scope start;
 * it does not contribute any model semantics itself.
 *
 * There is NO conventional fallback. A project without an `entrypoint` in its
 * `memo.package.yaml` is not a project, even if a file happens to sit at
 * `model/catalog/project.sysml` — that path is a scaffolding default, not a
 * location the resolver assumes. Callers must report the missing locator
 * rather than a missing file, because the file is usually there.
 */
export function projectEntrypoint(projectRoot: string): string | undefined {
    const root = resolve(projectRoot);
    const configured = readPackageManifest(root).manifest.entrypoint;
    if (!configured) return undefined;
    // A manifest may only point inside its own project. Keep a malformed path
    // visible to the caller as a missing entrypoint instead of escaping root.
    const candidate = resolve(root, configured);
    if (candidate !== root && !candidate.startsWith(root + sep)) return configured;
    return relative(root, candidate);
}

/** Where a resolvable SysML package's source lives. */
export interface LibraryRoot {
    /** Absolute package directory (the one carrying the descriptor). */
    dir: string;
    /** Absolute directory holding the package's .sysml sources. */
    sysmlDir: string;
    packageName: string;
    packageVersion?: string;
}

/** One SysML package the resolver found, and where it came from. */
export interface ResolvedPackage {
    /** Declared SysML package name, e.g. "memo_methodology_core". */
    qualifiedName: string;
    /** Files declaring it. A package may be split across files. */
    files: string[];
    /** The library root that supplied it, or undefined for project-owned source. */
    root?: LibraryRoot;
    origin: SemanticOrigin;
    /** Shortest import distance from the project entrypoint; project source is 0. */
    importDepth: number;
    /** Packages that import this one. */
    importedBy: string[];
}

/** The project's method binding, read from SysML. */
export interface NativeMethodBinding {
    /** Usage name, e.g. "uiScreenRegionsBinding". */
    usageName: string;
    /** `id` attribute, when authored. */
    bindingId?: string;
    projectName?: string;
    /** Name the `selectedMethodology` reference resolves to. */
    selectedMethodologyName?: string;
    scopeMode?: ScopeMode;
    includedModules: string[];
    /** Usage names the `includedExtension` references resolve to: extensions, by their methodologies. */
    includedExtensions: string[];
    rulePolicies: NativeRulePolicy[];
    sourceFile: string;
    packageQualifiedName?: string;
}

export type ScopeMode = 'allAvailable' | 'explicit';

/** A `RulePolicy` usage, read from SysML. */
export interface NativeRulePolicy {
    usageName: string;
    /** Type name of the referenced `constraint def`, from `ref :>> targetRule : X`. */
    targetRuleType?: string;
    /** The standard whose rules the policy selects: its name as written, qualified or not. */
    targetStandard?: string;
    /** A layer namespace: selects the rules whose subject kind sits in it. */
    targetCategory?: string;
    replacementRuleType?: string;
    disposition?: 'enabled' | 'disabled' | 'replaced';
    severityOverride?: 'error' | 'warning' | 'info';
    rationaleText?: string;
    authority?: string;
    approvalReference?: string;
    approvedBy?: string;
    approvedOn?: string;
    sourceFile: string;
}

/** A `MethodologyDefinition` usage, read from SysML. */
export interface NativeMethodology {
    usageName: string;
    methodologyId?: string;
    displayName?: string;
    version?: string;
    /** Name the `baseMethodology` reference resolves to, when there is one. */
    baseMethodologyName?: string;
    scopeMode?: ScopeMode;
    includedLayers: string[];
    includedModules: string[];
    /** Usage names the `includedExtension` references resolve to: extensions, by their methodologies. */
    includedExtensions: string[];
    includedStandards: string[];
    includedArtifactKinds: string[];
    includedViewpoints: string[];
    rulePolicies: NativeRulePolicy[];
    sourceFile: string;
    packageQualifiedName?: string;
}

export interface NativeDiagnostic {
    code:
        | 'no-entrypoint'
        | 'no-binding'
        | 'multiple-bindings'
        | 'unresolved-methodology'
        | 'unresolved-import'
        | 'unresolved-module'
        | 'entrypoint-not-compiled'
        | 'scope-mode-conflict'
        | 'settings-graph-mismatch'
        | 'invalid-kpar';
    message: string;
    file?: string;
}

export interface NativeProjectResolution {
    projectRoot: string;
    entrypoint?: string;
    binding?: NativeMethodBinding;
    /** Methodologies visible anywhere in the resolved closure, by usage name. */
    methodologies: Map<string, NativeMethodology>;
    /** Packages reachable from the project entrypoint, by qualified name. */
    closure: Map<string, ResolvedPackage>;
    /** Library roots that actually contributed a package to the closure. */
    selectedRoots: LibraryRoot[];
    /** Roots a locator offered that no import reached. */
    unusedRoots: LibraryRoot[];
    /**
     * File → the SysML package it declares, for every parsed file.
     *
     * Wider than `closure`, deliberately: a caller asking "which package owns
     * this rule?" needs an answer for every file that was loaded, and whether
     * that package is in scope is a separate question with its own answer.
     */
    filePackages: Map<string, string>;
    /**
     * Package → the packages it imports publicly, for every parsed package.
     * The selection a methodology makes is the public imports of the package
     * that declares it, followed transitively; see `publicImportClosure`.
     */
    publicImports: Map<string, ReadonlySet<string>>;
    diagnostics: NativeDiagnostic[];
}

// ─── Project root ─────────────────────────────────────────────────────────────

/**
 * Find the project root by walking up for a root descriptor whose explicit
 * `entrypoint` names an existing SysML root file.
 */
export function findProjectRoot(startDir: string): string | undefined {
    // A real path, so every caller that names files from the root names them as
    // a compiler does (see `canonicalPath`).
    let dir = canonicalPath(startDir);
    while (true) {
        const entrypoint = projectEntrypoint(dir);
        if (entrypoint && existsSync(join(dir, entrypoint))) return dir;
        const parent = dirname(dir);
        if (parent === dir) return undefined;
        dir = parent;
    }
}

/**
 * The real path of a directory, symbolic links resolved. A compiler names the
 * files it read by their real paths; a project reached through a symlink (macOS
 * `/tmp` and `/var`, a linked home) would otherwise never match them, and
 * resolve to nothing.
 */
export function canonicalPath(path: string): string {
    try {
        return realpathSync.native(resolve(path));
    } catch {
        return resolve(path);
    }
}

// ─── Library roots (locators only) ────────────────────────────────────────────

/**
 * Collect the library roots a project could resolve packages from.
 *
 * This is deliberately generous: it lists what is *available*, and the import
 * closure decides what is *selected*. A root listed here and never imported
 * contributes nothing to the model.
 */
export function discoverLibraryRoots(projectRoot: string): LibraryRoot[] {
    const roots = new Map<string, LibraryRoot>();

    const add = (dir: string) => {
        const abs = resolve(dir);
        if (roots.has(abs)) return;
        const { path, manifest } = readPackageManifest(abs);
        if (!path) return;
        const sysmlDir = manifest.sysmlDir ? resolve(abs, manifest.sysmlDir) : abs;
        if (!existsSync(sysmlDir)) return;
        roots.set(abs, {
            dir: abs,
            sysmlDir,
            packageName: manifest.name ?? abs.split(sep).pop() ?? abs,
            packageVersion: manifest.version,
        });
    };

    // Distribution manifests map a package name to a directory. They are an
    // application/distribution setting: they make a package available, they do
    // not select it.
    for (const found of [...findMemoManifests(projectRoot), ...discoverMemoManifests([projectRoot])]) {
        for (const subpath of Object.values(found.manifest.packages ?? {})) {
            add(resolveManifestPath(found, subpath));
        }
        // Extensions are reusable ontology packages, so they are library roots
        // on the same terms as any other package: available, not selected.
        // They were reachable only as example directories before, which meant
        // a project could import an extension, resolve it under an external compiler, and
        // still have every extension type come back unregistered — no layer,
        // no supertype, no legality. Listing them here is what makes an
        // extension mean something to the tools and not just to the compiler.
        for (const subpath of Object.values(found.manifest.extensions ?? {})) {
            add(resolveManifestPath(found, subpath));
        }
    }

    // Imported KPARs are immutable, restart-scoped library roots.  Their cache
    // is intentionally not part of the project source walk; only an explicit
    // SysML import can select content from one of these roots.
    const kparCache = join(resolve(projectRoot), '.memo', 'libraries', 'kpar', 'cache');
    if (existsSync(kparCache)) {
        try {
            for (const entry of readdirSync(kparCache, { withFileTypes: true })) {
                if (!entry.isDirectory()) continue;
                const dir = join(kparCache, entry.name);
                // KPARs that use a SysAnd descriptor instead of a MEMO package
                // descriptor are still searchable at their extraction root.
                const { path, manifest } = readPackageManifest(dir);
                const sysmlDir = path && manifest.sysmlDir ? resolve(dir, manifest.sysmlDir) : dir;
                if (!existsSync(sysmlDir)) continue;
                roots.set(dir, { dir, sysmlDir, packageName: manifest.name ?? entry.name, packageVersion: manifest.version });
            }
        } catch { /* unavailable cache is simply an empty library source */ }
    }

    let dir = resolve(projectRoot);
    while (true) {
        for (const container of ['node_modules/@memoarchitect', 'packages', 'memo_packages']) {
            const base = join(dir, container);
            if (!existsSync(base)) continue;
            try {
                for (const entry of readdirSync(base, { withFileTypes: true })) {
                    if (entry.isDirectory() || entry.isSymbolicLink()) add(join(base, entry.name));
                }
            } catch { /* unreadable container */ }
        }
        if (existsSync(join(dir, '.git'))) break;
        const parent = dirname(dir);
        if (parent === dir) break;
        dir = parent;
    }

    return [...roots.values()];
}

// ─── Import closure ───────────────────────────────────────────────────────────

export interface PackageIndexEntry {
    qualifiedName: string;
    files: Set<string>;
    /** Every package it imports from, at any visibility: what the closure walks. */
    imports: Set<string>;
    /**
     * The packages it imports PUBLICLY, a subset of `imports`. An `Import`
     * carries a visibility (SysML-textual-bnf.kebnf:149-153, `visibility =
     * VisibilityIndicator`), and only a public one makes the imported members
     * visible to whoever imports this package in turn (KerML
     * `Namespace::visibleMemberships`). It is therefore what a package passes
     * on: the selection a methodology's or a project's package states.
     */
    publicImports: Set<string>;
    root?: LibraryRoot;
}

function collectSysmlFiles(dir: string, out: string[] = []): string[] {
    let entries: string[] = [];
    try { entries = readdirSync(dir); } catch { return out; }
    for (const name of entries) {
        if (name === 'node_modules' || name === '.git' || name === '.venv' || name === 'output' || name === '.sysand') continue;
        const full = join(dir, name);
        let st;
        try { st = statSync(full); } catch { continue; }
        if (st.isDirectory()) collectSysmlFiles(full, out);
        else if (name.endsWith('.sysml')) out.push(full);
    }
    return out;
}

/**
 * Classify a resolved package's authority.
 *
 * Origin comes from the resolved root a file sits under, never from what the
 * file declares — `action def LocalCalibration` is project content in the
 * workspace and methodology content inside a resolved methodology package.
 * Before the flip this read `type:` out of the package manifest; that field is
 * gone, so a reusable root is classified by whether it supplies a methodology.
 */
function originFor(root: LibraryRoot | undefined, suppliesMethodology: boolean): SemanticOrigin {
    if (!root) return 'project';
    if (suppliesMethodology) return 'methodology';
    return 'ontology';
}

// ─── Resolution ───────────────────────────────────────────────────────────────

/**
 * Resolve a project from its native SysML alone.
 *
 * The closure walk starts at the entrypoint's package and follows imports.
 * Anything it does not reach is not part of the model, however many manifests
 * point at it.
 */
/**
 * What resolution finds on disk before reading any SysML: the entrypoint, the
 * project's source files and every library root a locator offers, each file
 * with the root it sits under.
 */
export interface ProjectSources {
    projectRoot: string;
    entrypointPath?: string;
    entrypoint?: string;
    libraryRoots: LibraryRoot[];
    projectFiles: string[];
    libraryFiles: string[];
    fileToRoot: Map<string, LibraryRoot | undefined>;
    diagnostics: NativeDiagnostic[];
}

/** Find a project's sources: no SysML is read. */
export function discoverProjectSources(projectRoot: string): ProjectSources {
    const diagnostics: NativeDiagnostic[] = [];
    const root = canonicalPath(projectRoot);
    const entrypointPath = projectEntrypoint(root);
    const entrypoint = entrypointPath ? resolve(root, entrypointPath) : undefined;
    const includes = readPackageManifest(root).manifest.include ?? [];

    // `include` accepts SysML source roots and interoperable KPAR archives.
    // Archive import is intentionally local and content-addressed: it copies
    // the archive into .memo, validates its ZIP boundaries, and extracts it
    // once. The import graph below still decides whether any package in it is
    // selected.
    for (const include of includes) {
        const path = resolve(root, include);
        if (extname(path).toLowerCase() !== '.kpar') continue;
        try {
            importKpar(root, path);
        } catch (error) {
            diagnostics.push({
                code: 'invalid-kpar',
                message: `Could not import KPAR ${include}: ${error instanceof Error ? error.message : String(error)}`,
                file: path,
            });
        }
    }

    const libraryRoots = discoverLibraryRoots(root);
    const fileToRoot = new Map<string, LibraryRoot | undefined>();

    // Match the `include` source-root contract exactly: only explicitly included
    // directories are project model source. Includes may name a sibling OTS
    // repository; imports, rather than physical location, decide scope.
    const projectFiles = [...new Set(includes.filter(include => extname(include).toLowerCase() !== '.kpar').flatMap(include => {
        const sourceRoot = resolve(root, include);
        return collectSysmlFiles(sourceRoot);
    }))].filter(f => !libraryRoots.some(r => f.startsWith(r.sysmlDir + sep)));
    for (const f of projectFiles) fileToRoot.set(f, undefined);

    const libraryFiles: string[] = [];
    for (const lib of libraryRoots) {
        for (const f of collectSysmlFiles(lib.sysmlDir)) {
            if (fileToRoot.has(f)) continue;
            fileToRoot.set(f, lib);
            libraryFiles.push(f);
        }
    }

    return { projectRoot: root, entrypointPath, entrypoint, libraryRoots, projectFiles, libraryFiles, fileToRoot, diagnostics };
}

/**
 * Close a project's resolution over its package index and native usages,
 * however they were read: the import closure from the entrypoint, the library
 * roots it selects, and the method binding.
 */
export function finishResolution(
    sources: ProjectSources,
    index: Map<string, PackageIndexEntry>,
    bindings: NativeMethodBinding[],
    methodologyList: NativeMethodology[],
): NativeProjectResolution {
    const { projectRoot: root, entrypointPath, entrypoint, libraryRoots } = sources;
    const diagnostics = [...sources.diagnostics];

    if (!entrypoint || !existsSync(entrypoint)) {
        diagnostics.push({
            code: 'no-entrypoint',
            message:
                `No native entrypoint configured in memo.package.yaml${entrypointPath ? ` at ${entrypointPath}` : ''}. `
                + 'A MEMO project declares its identity and method binding in its configured SysML root file.',
            file: entrypoint,
        });
    }

    const filePackages = new Map<string, string>();
    const publicImports = new Map<string, ReadonlySet<string>>();
    for (const entry of index.values()) {
        for (const file of entry.files) filePackages.set(file, entry.qualifiedName);
        publicImports.set(entry.qualifiedName, entry.publicImports);
    }

    // The entrypoint, not every source file on disk, starts the closure. This
    // keeps an unimported source area out of explicit scope and makes the same
    // SysML file authoritative for Architect and the command-line tools.
    const closure = new Map<string, ResolvedPackage>();
    const queue: Array<{ name: string; depth: number; via?: string }> = [];
    for (const entry of index.values()) {
        if (entrypoint && entry.files.has(entrypoint)) queue.push({ name: entry.qualifiedName, depth: 0 });
    }
    if (entrypoint && existsSync(entrypoint) && queue.length === 0) {
        // The entrypoint is on disk and nothing that was compiled declares it, so
        // the project resolves to nothing. Said, not left as an empty model.
        diagnostics.push({
            code: 'entrypoint-not-compiled',
            message:
                `No compiled document declares the entrypoint ${entrypoint}, so nothing of the project could be resolved. `
                + 'A project reached through a symbolic link is the usual cause: open it by its real path.',
            file: entrypoint,
        });
    }

    const methodologyPackages = new Set<string>();
    const methodologies = new Map<string, NativeMethodology>();
    for (const meth of methodologyList) {
        methodologies.set(meth.usageName, meth);
        if (meth.packageQualifiedName) methodologyPackages.add(meth.packageQualifiedName);
    }

    while (queue.length > 0) {
        const { name, depth, via } = queue.shift()!;
        const entry = index.get(name);
        if (!entry) {
            if (via && !STANDARD_LIBRARY_PACKAGES.has(name.split('::')[0])) {
                diagnostics.push({
                    code: 'unresolved-import',
                    message:
                        `Package "${name}" is imported by "${via}" but no resolved source declares it. `
                        + `A locator can only say where a package lives; it cannot supply one the import graph names and disk does not have.`,
                });
            }
            continue;
        }
        const existing = closure.get(name);
        if (existing) {
            existing.importDepth = Math.min(existing.importDepth, depth);
            if (via && !existing.importedBy.includes(via)) existing.importedBy.push(via);
            continue;
        }
        closure.set(name, {
            qualifiedName: name,
            files: [...entry.files],
            root: entry.root,
            origin: originFor(entry.root, methodologyPackages.has(name)),
            importDepth: depth,
            importedBy: via ? [via] : [],
        });
        for (const imported of entry.imports) {
            queue.push({ name: imported, depth: depth + 1, via: name });
        }
    }

    const usedRootDirs = new Set(
        [...closure.values()].map(p => p.root?.dir).filter((d): d is string => Boolean(d)),
    );
    const selectedRoots = libraryRoots.filter(r => usedRootDirs.has(r.dir));
    const unusedRoots = libraryRoots.filter(r => !usedRootDirs.has(r.dir));

    // ── The binding ──────────────────────────────────────────────────────────
    const projectBindings = bindings.filter(b => b.sourceFile === entrypoint);
    let binding: NativeMethodBinding | undefined;
    if (projectBindings.length === 0) {
        if (entrypoint && existsSync(entrypoint)) {
            diagnostics.push({
                code: 'no-binding',
                message:
                    `No ProjectMethodBinding found in ${entrypointPath}. It must declare one; `
                    + `it is what selects the project's methodology.`,
                file: entrypoint,
            });
        }
    } else if (projectBindings.length > 1) {
        diagnostics.push({
            code: 'multiple-bindings',
            message:
                `${projectBindings.length} ProjectMethodBinding usages found (`
                + projectBindings.map(b => `${b.usageName} in ${relative(root, b.sourceFile)}`).join(', ')
                + `). A project binds exactly one methodology; which one applied would otherwise depend on load order.`,
        });
        binding = projectBindings[0];
    } else {
        binding = projectBindings[0];
    }

    if (binding) {
        if (!binding.selectedMethodologyName) {
            diagnostics.push({
                code: 'unresolved-methodology',
                message: `${binding.usageName} declares no selectedMethodology reference.`,
                file: binding.sourceFile,
            });
        } else if (!methodologies.has(binding.selectedMethodologyName)) {
            diagnostics.push({
                code: 'unresolved-methodology',
                message:
                    `${binding.usageName} selects methodology "${binding.selectedMethodologyName}", which no `
                    + `resolved package declares. Import the package that defines it.`,
                file: binding.sourceFile,
            });
        }
        if (binding.scopeMode === 'allAvailable'
            && (binding.includedModules.length > 0 || binding.includedExtensions.length > 0)) {
            diagnostics.push({
                code: 'scope-mode-conflict',
                message:
                    `${binding.usageName} sets scopeMode = allAvailable and also lists includedModule or `
                    + `includedExtension entries. `
                    + `Under allAvailable the lists must be empty, or the binding states its scope twice.`,
                file: binding.sourceFile,
            });
        }
    }

    return {
        projectRoot: root,
        entrypoint: entrypoint && existsSync(entrypoint) ? entrypoint : undefined,
        binding,
        methodologies,
        closure,
        selectedRoots,
        unusedRoots,
        filePackages,
        publicImports,
        diagnostics,
    };
}
