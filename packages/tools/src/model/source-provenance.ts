// ─── Source Provenance ────────────────────────────────────────────────────────
//
// Where a piece of semantic content came from, and whether the user may edit it.
//
// The rule that makes this trustworthy is that origin is decided by the
// RESOLVED DEPENDENCY ROOT a file sits under — never by what kind of construct
// it declares, what the file is called, or where it sits in a directory tree.
// `action def LocalCalibration` written in the workspace is project content;
// the same declaration inside a resolved methodology package is methodology
// content. Nothing about the declaration itself is consulted.
//
// This matters because the previous behaviour inferred ownership from
// configured filesystem roots, which made a project-local definition look like
// ontology content whenever the roots overlapped, and left every DTO unable to
// say which package a name actually came from.
//
// Design reference: sections 7.1-7.3.
// ─────────────────────────────────────────────────────────────────────────────

import { isAbsolute, resolve, sep } from 'node:path';

/**
 * Authority category of a source unit.
 *
 * `memo-core` is listed by the design as distinct from `ontology`, but core
 * currently ships INSIDE the ontology package rather than as its own resolved
 * artifact. Origin is assigned from roots, so core is reported as `ontology`
 * until it is separately resolvable — inferring it from the `memo::core::`
 * package prefix would be exactly the path/name heuristic this module exists to
 * avoid. The variant stays in the union so that the split needs no DTO change.
 */
export type SemanticOrigin =
    | 'standard-library'
    | 'memo-core'
    | 'ontology'
    | 'extension'
    | 'methodology'
    | 'project';

/** Provenance of one source file. */
export interface SourceProvenance {
    origin: SemanticOrigin;
    /** Package name from the manifest, e.g. "@memoarchitect/ontology". */
    packageName: string;
    /** Declared SysML package qualified name, when the file declares one. */
    packageQualifiedName?: string;
    packageVersion?: string;
    /** Absolute path of the file. */
    sourceUri: string;
    /** Path relative to the root that owns it — stable across checkouts. */
    sourceFile: string;
    /** Content hash, populated only where a caller needs change detection. */
    sourceHash?: string;
    /** False for anything under a resolved dependency root. */
    writable: boolean;
    /** Distance from the project in the resolved dependency graph; project is 0. */
    importDepth: number;
    importedBy?: string[];
    /** What brought this root into the graph (methodology id, module name, …). */
    selectedBy?: string;
}

/** A resolved dependency root: one package directory and what it contributes. */
export interface ResolvedRoot {
    /** Absolute directory of the package. */
    dir: string;
    origin: SemanticOrigin;
    packageName: string;
    packageVersion?: string;
    importDepth: number;
    selectedBy?: string;
}

/**
 * Map a package manifest `type:` to an authority category.
 *
 * `profile` is ontology content: it ships definitions that projects specialize,
 * and is frozen for the session exactly as the ontology is. `device` is what a
 * project declares about itself, so a device root is only ever the workspace.
 */
export function originForPackageType(type: string | undefined): SemanticOrigin {
    switch ((type ?? '').trim()) {
        case 'ontology':
        case 'profile':
            return 'ontology';
        case 'methodology':
            return 'methodology';
        case 'extension':
            return 'extension';
        case 'device':
            return 'project';
        default:
            // An unrecognized type is treated as ontology rather than project:
            // it arrived through dependency resolution, so it is not writable,
            // and calling it project content would wrongly offer edits on it.
            return 'ontology';
    }
}

/** Origins whose content is frozen for the lifetime of a runtime session. */
const REUSABLE_ORIGINS: ReadonlySet<SemanticOrigin> = new Set<SemanticOrigin>([
    'standard-library', 'memo-core', 'ontology', 'extension', 'methodology',
]);

/** True when a change to this origin requires a runtime restart (section 13.3). */
export function isReusableOrigin(origin: SemanticOrigin): boolean {
    return REUSABLE_ORIGINS.has(origin);
}

/** Classify a watched source path from the resolved provenance table. */
export function classifySourceChange(
    filePath: string,
    provenance: ProvenanceTable,
): 'project' | 'reusable' | 'unknown' {
    const source = provenance.lookup(filePath);
    if (!source) return 'unknown';
    return isReusableOrigin(source.origin) ? 'reusable' : 'project';
}

/**
 * Resolves any file path to its provenance.
 *
 * Roots may nest — a project can contain a vendored dependency under
 * `node_modules/` — so the LONGEST matching root wins. A path under no
 * dependency root but under the workspace is project content; a path under
 * neither is reported as unknown rather than guessed at.
 */
export class ProvenanceTable {
    private readonly roots: ResolvedRoot[];
    private readonly projectRoot: string;
    private readonly cache = new Map<string, SourceProvenance | undefined>();

    constructor(projectRoot: string, roots: readonly ResolvedRoot[]) {
        this.projectRoot = normalizeDir(projectRoot);
        // Longest first so nested roots resolve before their parents.
        this.roots = [...roots]
            .map(root => ({ ...root, dir: normalizeDir(root.dir) }))
            .sort((a, b) => b.dir.length - a.dir.length);
    }

    /** All dependency roots, longest path first. */
    getRoots(): readonly ResolvedRoot[] {
        return this.roots;
    }

    /**
     * Provenance for one file, or undefined when it belongs to no known root.
     *
     * Undefined is deliberate: a caller that cannot establish origin must say
     * so rather than defaulting to project (which would offer edits on library
     * content) or to ontology (which would hide a real project file).
     */
    lookup(filePath: string): SourceProvenance | undefined {
        // Parsers retain project-relative paths for transport. Resolve those
        // against the project that owns this table, never the CLI's own cwd.
        const absolute = isAbsolute(filePath) ? resolve(filePath) : resolve(this.projectRoot, filePath);
        if (this.cache.has(absolute)) return this.cache.get(absolute);
        let provenance = this.compute(absolute);
        // Registry entries originating from package scans may retain a path
        // relative to their package root. Try every resolved root only after
        // the project-relative interpretation, so authored project paths keep
        // their normal meaning.
        if (!provenance && !isAbsolute(filePath)) {
            for (const root of this.roots) {
                provenance = this.compute(resolve(root.dir, filePath));
                if (provenance) break;
            }
        }
        this.cache.set(absolute, provenance);
        return provenance;
    }

    /**
     * Provenance for a file that must have one.
     *
     * Falls back to project so that a caller in the middle of building a model
     * is not forced to handle undefined; use `lookup` where the distinction
     * between "project" and "unknown" carries meaning.
     */
    lookupOrProject(filePath: string): SourceProvenance {
        const absolute = isAbsolute(filePath) ? resolve(filePath) : resolve(this.projectRoot, filePath);
        return this.lookup(absolute) ?? this.projectProvenance(absolute);
    }

    private compute(absolute: string): SourceProvenance | undefined {
        for (const root of this.roots) {
            if (!isUnder(absolute, root.dir)) continue;
            return {
                origin: root.origin,
                packageName: root.packageName,
                packageVersion: root.packageVersion,
                sourceUri: absolute,
                sourceFile: relativeTo(root.dir, absolute),
                writable: root.origin === 'project',
                importDepth: root.importDepth,
                selectedBy: root.selectedBy,
            };
        }
        if (isUnder(absolute, this.projectRoot)) return this.projectProvenance(absolute);
        return undefined;
    }

    private projectProvenance(absolute: string): SourceProvenance {
        return {
            origin: 'project',
            packageName: '(project)',
            sourceUri: absolute,
            sourceFile: relativeTo(this.projectRoot, absolute),
            writable: true,
            importDepth: 0,
        };
    }
}

/** Identity of a definition, sufficient to name it unambiguously. */
export interface DefinitionIdentity {
    qualifiedName: string;
    shortName: string;
    stableId?: string;
    provenance?: SourceProvenance;
}

/**
 * Provenance of a model element, keeping declaration and classification apart.
 *
 * A project usage typed by an ontology definition is project-owned content that
 * happens to be classified by library content. Collapsing the two is what made
 * Architect label project usages as read-only ontology elements.
 */
export interface SemanticElementProvenance {
    /** Source that declares this definition or usage. */
    declaration: SourceProvenance;
    /** Definition that types the usage; absent for an untyped declaration. */
    classifier?: DefinitionIdentity;
    /** Full specialization chain, nearest definition first. */
    classifierChain?: DefinitionIdentity[];
}

function normalizeDir(dir: string): string {
    const resolved = resolve(dir);
    return resolved.endsWith(sep) ? resolved.slice(0, -sep.length) : resolved;
}

/**
 * Containment test on path segments.
 *
 * A plain `startsWith` would place `/a/project-old/x` under `/a/project`, so the
 * boundary must land on a separator.
 */
function isUnder(absolute: string, dir: string): boolean {
    return absolute === dir || absolute.startsWith(dir + sep);
}

function relativeTo(dir: string, absolute: string): string {
    const rel = absolute === dir ? '' : absolute.slice(dir.length + sep.length);
    return rel.split(sep).join('/');
}
