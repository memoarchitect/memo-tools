// ─── Package Locator Reading ──────────────────────────────────────────────────
//
// One place that reads MEMO's package descriptors — identity and location only.
//
// This file used to read `methodology`, `extends`, `ontologies`, `modules`,
// `type`, and `usage`, and those fields decided what a project's model
// contained. They do not any more. Selection is native: the project's SysML
// import graph and its `ProjectMethodBinding` decide what is loaded, and
// `settings-boundary.ts` rejects the removed fields with a diagnostic naming
// their replacement rather than reading them as a fallback.
//
// What survives is a locator. A descriptor may say what a package is called,
// what version it is, and where its source sits, because a resolver has to find
// the artifact an import refers to. It may not say whether that import happens.
//
// Design reference: sections 5.3, 5.5, 16.
// ─────────────────────────────────────────────────────────────────────────────

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse as parseYaml } from 'yaml';

/**
 * Descriptor filenames, in search order.
 *
 * `memo.config.yaml` is gone: it existed to carry project semantics, and every
 * field it carried now lives in `model/catalog/project.sysml`. A project that
 * still has one is told so by `checkSemanticFields`.
 */
export const CONFIG_SEARCH_ORDER = [
    'memo.package.yaml',
    'memo.package.yml',
] as const;

/** Package identity and location. Nothing here selects model content. */
export interface MemoManifest {
    name?: string;
    version?: string;
    description?: string;
    license?: string;
    tags?: string[];
    /** Where this package's .sysml sources sit, relative to the descriptor. */
    sysmlDir?: string;
    /** Project-relative native SysML entrypoint; absent uses MEMO's conventional path. */
    entrypoint?: string;
    /** Project-relative SysML source roots, using SysIDE's `include` vocabulary. */
    include?: string[];
    /** Everything as parsed, for the boundary check to inspect. */
    raw: Record<string, unknown>;
}

const EMPTY: MemoManifest = { raw: {} };

/** Parse a descriptor. Returns an empty one when absent or malformed. */
export function readManifest(filePath: string): MemoManifest {
    if (!filePath || !existsSync(filePath)) return EMPTY;
    let raw: unknown;
    try {
        raw = parseYaml(readFileSync(filePath, 'utf-8'));
    } catch {
        return EMPTY;
    }
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return EMPTY;
    const doc = raw as Record<string, unknown>;
    return {
        name: str(doc.name),
        version: str(doc.version),
        description: str(doc.description),
        license: str(doc.license),
        tags: strList(doc.tags),
        sysmlDir: str(doc.sysmlDir),
        entrypoint: str(doc.entrypoint),
        include: strList(doc.include),
        raw: doc,
    };
}

/** Find and parse the descriptor for a package directory. */
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

// ─── coercion ────────────────────────────────────────────────────────────────

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
