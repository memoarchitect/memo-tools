// ─── Package / Project Manifest Reading ───────────────────────────────────────
//
// One place that reads MEMO's YAML manifests, using a YAML parser.
//
// These files still carry semantics today (which methodology, which ontologies,
// which modules). Session 3 deletes those readers outright. Until then they are
// parsed properly rather than pattern-matched: the previous readers matched
// line shapes with regexes, so `extends:` written as a flow sequence, a quoted
// scalar, a multi-line string, or with a trailing comment either parsed as
// something else or silently vanished — and a vanished dependency reads as a
// missing ontology, not as an error.
//
// Parsing here also makes session 3's job a deletion rather than a rewrite:
// every semantic field is read through one of the accessors below, so the set
// of fields to remove is enumerable (see `SEMANTIC_MANIFEST_FIELDS`).
// ─────────────────────────────────────────────────────────────────────────────

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse as parseYaml } from 'yaml';

/** Manifest filenames, in the order MEMO searches for them. */
export const CONFIG_SEARCH_ORDER = [
    'memo.package.yaml',
    'memo.package.yml',
    'memo.config.yaml',
    'memo.config.yml',
] as const;

/**
 * Manifest fields that currently carry engineering-model meaning.
 *
 * This is the worklist for session 3 (design section 18.1 deliverable 9): each
 * one must move into portable SysML and then be rejected here. Fields NOT in
 * this list are application settings and legitimately stay in YAML.
 */
export const SEMANTIC_MANIFEST_FIELDS = [
    'methodology',   // selects the methodology package → ProjectMethodBinding
    'extends',       // package dependency edge → native import
    'ontologies',    // additional ontology packages → native import
    'modules',       // opt-in optional modules → methodology includedModule
    'optionalModules', // declares which modules a package offers
    'sysmlDir',      // where a package's SysML lives → resolver adapter (borderline)
    'type',          // package authority category → resolved from the import graph
    'usage',         // what the package contributes
] as const;

export interface MemoManifest {
    name?: string;
    version?: string;
    type?: string;
    description?: string;
    extends?: string[];
    sysmlDir?: string;
    ontologies?: string[];
    modules?: string[];
    optionalModules?: string[];
    usage?: string[];
    projectName?: string;
    projectType?: string;
    methodology?: string;
    /** Everything as parsed, for callers needing a field not modelled above. */
    raw: Record<string, unknown>;
}

const EMPTY: MemoManifest = { raw: {} };

/** Parse a manifest file. Returns an empty manifest when absent or malformed. */
export function readManifest(filePath: string): MemoManifest {
    if (!filePath || !existsSync(filePath)) return EMPTY;
    let raw: unknown;
    try {
        raw = parseYaml(readFileSync(filePath, 'utf-8'));
    } catch {
        // A manifest that does not parse is treated as absent, matching the
        // previous readers' behaviour. Session 3 turns this into a diagnostic.
        return EMPTY;
    }
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return EMPTY;
    const doc = raw as Record<string, unknown>;
    return {
        name: str(doc.name),
        version: str(doc.version),
        type: str(doc.type),
        description: str(doc.description),
        extends: packageNames(doc.extends),
        sysmlDir: str(doc.sysmlDir),
        ontologies: ontologyNames(doc.ontologies),
        modules: packageNames(doc.modules),
        optionalModules: packageNames(doc.optionalModules),
        usage: strList(doc.usage),
        projectName: str(doc.projectName),
        projectType: str(doc.projectType),
        methodology: str(doc.methodology),
        raw: doc,
    };
}

/** Find and parse the manifest for a package directory. */
export function readPackageManifest(pkgDir: string): { path?: string; manifest: MemoManifest } {
    for (const name of CONFIG_SEARCH_ORDER) {
        const path = join(pkgDir, name);
        if (existsSync(path)) return { path, manifest: readManifest(path) };
    }
    return { manifest: EMPTY };
}

/**
 * Strip an optional version range from a package reference.
 *
 * `@memoarchitect/methodology-default@^1.0` names a package and a range; only
 * the LAST `@` separates them, because the leading one is the npm scope.
 */
export function stripVersionRange(reference: string): string {
    const lastAt = reference.lastIndexOf('@');
    return lastAt > 0 ? reference.slice(0, lastAt) : reference;
}

/** Apply MEMO's default scope to a bare package name. */
export function qualifyPackageName(name: string): string {
    const bare = stripVersionRange(name.trim());
    return bare.startsWith('@') ? bare : `@memoarchitect/${bare}`;
}

/** Semantic fields present in a manifest — the per-file session-3 worklist. */
export function semanticFieldsIn(manifest: MemoManifest): string[] {
    return SEMANTIC_MANIFEST_FIELDS.filter(field => manifest.raw[field] !== undefined);
}

// ─── coercion ────────────────────────────────────────────────────────────────
//
// Manifests in the wild use scalars where the schema allows a list and vice
// versa, so each accessor normalizes rather than assuming one shape.

function str(value: unknown): string | undefined {
    if (typeof value === 'string') return value.trim() || undefined;
    if (typeof value === 'number' || typeof value === 'boolean') return String(value);
    return undefined;
}

function strList(value: unknown): string[] | undefined {
    if (value === undefined || value === null) return undefined;
    const items = Array.isArray(value) ? value : [value];
    const out = items.map(str).filter((v): v is string => Boolean(v));
    return out.length > 0 ? out : undefined;
}

/** `extends`/`modules` accept a scalar or a sequence of package references. */
function packageNames(value: unknown): string[] | undefined {
    return strList(value);
}

/**
 * `ontologies` is a sequence of `{ name: … }` entries, but tolerate bare
 * strings — several fixtures use them and the previous regex accepted both.
 */
function ontologyNames(value: unknown): string[] | undefined {
    if (value === undefined || value === null) return undefined;
    const items = Array.isArray(value) ? value : [value];
    const out: string[] = [];
    for (const item of items) {
        if (typeof item === 'string') {
            const name = str(item);
            if (name) out.push(name);
        } else if (item && typeof item === 'object') {
            const name = str((item as Record<string, unknown>).name);
            if (name) out.push(name);
        }
    }
    return out.length > 0 ? out : undefined;
}
