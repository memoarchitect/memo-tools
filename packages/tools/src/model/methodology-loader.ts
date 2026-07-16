// ─── Methodology Loader (Phase B) ─────────────────────────────────────────────
//
// Parses methodology SysML files (e.g. ontology/methodology/<name>/*.sysml) into
// a typed MethodologyDescriptor. Methodology in MEMO = a curated bundle that
// selects from the architecture/viewpoints/views/compliance ontologies and adds
// rules / gates / patterns / workflow / profile metadata.
//
// SysML shape consumed:
//   part def Viewpoint :> ... { attribute purpose : String; ... }
//   part swArchView : Viewpoint {
//       attribute id   = "VP-002";
//       attribute name = "SoftwareArchitectureView";
//       attribute purpose = "...";
//       ...
//   }
//
// The loader does a regex-based scan (matching the style of ontology-loader's
// parseConstructsInFile) and is independent of the Langium grammar so that
// methodology files load even while grammar work is in flight.
// ─────────────────────────────────────────────────────────────────────────────

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { resolve, join, basename, relative } from 'node:path';
import { findOntologyPackageDirs, resolvePackageSysmlDir, getPackageMetadata } from './ontology-loader.js';

/** Primitive value pulled out of a SysML attribute literal. */
export type MethodologyAttrValue = string | number | boolean;

/** A `part <name> : <Type> { ... }` instance from a methodology file. */
export interface MethodologyPart {
    /** SysML local name, e.g. "swArchView". */
    partName: string;
    /** Type of the part, e.g. "Viewpoint", "WorkflowStep". */
    partType: string;
    /** Attributes captured from the body (`attribute k = v;` lines). */
    attributes: Record<string, MethodologyAttrValue>;
    /** Multi-valued attributes (repeated keys). Each key maps to all values in order. */
    multiAttributes: Record<string, MethodologyAttrValue[]>;
    /** Source file path relative to the project root, for traceability. */
    sourceFile: string;
    /** Fully-qualified SysML namespace, e.g. "memo::methodology::profiles". */
    namespace?: string;
}

/** A `part def Foo :> Bar { ... }` declaration discovered in methodology files. */
export interface MethodologyPartDef {
    name: string;
    superType?: string;
    sourceFile: string;
    namespace?: string;
}

/** One self-contained methodology folder (e.g. `ontology/methodology/memo`). */
export interface MethodologyFolderInfo {
    /** Folder name = methodology id (e.g. "memo"). */
    name: string;
    /** Absolute path to the methodology folder. */
    rootDir: string;
    /** Files scanned (relative to project root). */
    sourceFiles: string[];
    /** Distinct SysML packages declared across the folder's files. */
    namespaces: string[];
    /** All `part def`s discovered locally. */
    partDefs: MethodologyPartDef[];
    /** All part instances, grouped by partType. */
    parts: Record<string, MethodologyPart[]>;
}

/** Top-level descriptor exposed to the web app. */
export interface MethodologyDescriptor {
    /** Methodology folders discovered (project may pin one in future Phase C). */
    folders: MethodologyFolderInfo[];
    /** Errors / warnings during methodology scan (non-fatal). */
    errors: string[];
}

// ─── Regex helpers ───────────────────────────────────────────────────────────

/** `part def Foo :> Bar { ... }` */
const PART_DEF_RE = /^\s*part\s+def\s+(\w+)(?:\s*:>\s*([\w:]+))?\s*\{/gm;

/** `part name : Type { body }` — body is captured to be parsed for attributes. */
const PART_INSTANCE_RE = /^\s*part\s+(\w+)\s*:\s*(\w+)\s*\{([\s\S]*?)\n\s*\}/gm;

/** `attribute key = value;` — value can be string literal, enum ref, integer, boolean. */
const ATTR_RE = /attribute\s+(\w+)\s*=\s*(?:"([^"]*)"|(\w+(?:::\w+)*)|(-?\d+(?:\.\d+)?)|(true|false))\s*;/g;

/** `package memo::methodology::profiles {` — top-level namespace */
const PACKAGE_RE = /^\s*package\s+([\w:]+)\s*\{/m;

function parseAttributes(body: string): { attrs: Record<string, MethodologyAttrValue>; multi: Record<string, MethodologyAttrValue[]> } {
    const attrs: Record<string, MethodologyAttrValue> = {};
    const multi: Record<string, MethodologyAttrValue[]> = {};
    for (const m of body.matchAll(ATTR_RE)) {
        const key = m[1];
        let value: MethodologyAttrValue;
        if (m[2] !== undefined) {
            value = m[2];
        } else if (m[3] !== undefined) {
            const qualified = m[3];
            const short = qualified.includes('::') ? qualified.split('::').pop()! : qualified;
            value = short;
            attrs[`${key}__qualified`] = qualified;
        } else if (m[4] !== undefined) {
            value = Number(m[4]);
        } else if (m[5] !== undefined) {
            value = m[5] === 'true';
        } else {
            continue;
        }
        if (!multi[key]) multi[key] = [];
        multi[key].push(value);
        attrs[key] = value;
    }
    return { attrs, multi };
}

function parseMethodologyFile(absPath: string, projectRoot: string): {
    partDefs: MethodologyPartDef[];
    parts: MethodologyPart[];
    namespace?: string;
} {
    const partDefs: MethodologyPartDef[] = [];
    const parts: MethodologyPart[] = [];

    let content = '';
    try { content = readFileSync(absPath, 'utf-8'); } catch { return { partDefs, parts }; }

    const sourceFile = relative(projectRoot, absPath) || basename(absPath);
    const nsMatch = content.match(PACKAGE_RE);
    const namespace = nsMatch ? nsMatch[1] : undefined;

    for (const m of content.matchAll(PART_DEF_RE)) {
        partDefs.push({
            name: m[1],
            superType: m[2] || undefined,
            sourceFile,
            namespace,
        });
    }

    // Reset because PART_INSTANCE_RE has the `g` flag and content shares scope.
    PART_INSTANCE_RE.lastIndex = 0;
    for (const m of content.matchAll(PART_INSTANCE_RE)) {
        const partName = m[1];
        const partType = m[2];
        // Skip `part def` matches — PART_INSTANCE_RE doesn't, since `def` isn't excluded.
        // The PART_DEF_RE form has `def` after `part`; PART_INSTANCE_RE matches `part NAME :`,
        // but `part def Foo :> Bar { ... }` matches as partName="def", partType="Foo" — filter that.
        if (partName === 'def') continue;
        const { attrs, multi } = parseAttributes(m[3]);
        parts.push({
            partName,
            partType,
            attributes: attrs,
            multiAttributes: multi,
            sourceFile,
            namespace,
        });
    }

    return { partDefs, parts, namespace };
}

function listSysmlFiles(dir: string): string[] {
    const files: string[] = [];
    try {
        for (const entry of readdirSync(dir, { withFileTypes: true })) {
            const full = join(dir, entry.name);
            if (entry.isDirectory()) {
                files.push(...listSysmlFiles(full));
            } else if (entry.name.endsWith('.sysml') && entry.name !== 'index.sysml') {
                files.push(full);
            }
        }
    } catch { /* skip */ }
    return files;
}

export { extractScopeInfo, type MethodologyScopeInfo } from './dimension-filter.js';

/**
 * Discover all methodology folders reachable from a project config and parse them.
 *
 * For each ontology package on the extends chain, look for a `methodology/`
 * subdirectory under its sysml root. Each direct subdirectory of `methodology/`
 * is treated as one methodology (Phase A convention).
 */
export async function loadMethodologyDescriptor(
    configPath: string,
    projectRoot?: string,
): Promise<MethodologyDescriptor> {
    const root = projectRoot ?? resolve(configPath, '..');
    const folders: MethodologyFolderInfo[] = [];
    const errors: string[] = [];
    const seenFolders = new Set<string>();

    // Two discovery sources, deduped by package directory:
    //   1. extends chain (authoritative once project pins a methodology — Phase C)
    //   2. getPackageMetadata (every installed @memo package — covers transitional state
    //      where the project config still references retired ontology stubs)
    const pkgDirs = new Set<string>();
    try {
        for (const d of findOntologyPackageDirs(configPath)) pkgDirs.add(d);
    } catch (e) {
        errors.push(`methodology: failed to walk extends chain (${e instanceof Error ? e.message : e})`);
    }
    try {
        for (const pkg of getPackageMetadata(root)) {
            if (pkg.rootDir) pkgDirs.add(pkg.rootDir);
        }
    } catch (e) {
        errors.push(`methodology: failed to scan installed packages (${e instanceof Error ? e.message : e})`);
    }

    for (const pkgDir of pkgDirs) {
        const sysmlDir = resolvePackageSysmlDir(pkgDir);
        const methodologyRoot = join(sysmlDir, 'methodology');
        if (!existsSync(methodologyRoot)) continue;

        let entries: string[] = [];
        try {
            entries = readdirSync(methodologyRoot, { withFileTypes: true })
                .filter(e => e.isDirectory())
                .map(e => e.name);
        } catch { continue; }

        for (const name of entries) {
            const folderDir = join(methodologyRoot, name);
            if (seenFolders.has(folderDir)) continue;
            seenFolders.add(folderDir);

            const sysmlFiles = listSysmlFiles(folderDir);
            const partDefs: MethodologyPartDef[] = [];
            const partsByType: Record<string, MethodologyPart[]> = {};
            const namespaceSet = new Set<string>();

            for (const file of sysmlFiles) {
                const { partDefs: pds, parts, namespace } = parseMethodologyFile(file, root);
                if (namespace) namespaceSet.add(namespace);
                partDefs.push(...pds);
                for (const part of parts) {
                    if (!partsByType[part.partType]) partsByType[part.partType] = [];
                    partsByType[part.partType].push(part);
                }
            }

            folders.push({
                name,
                rootDir: folderDir,
                sourceFiles: sysmlFiles.map(f => relative(root, f) || basename(f)),
                namespaces: [...namespaceSet].sort(),
                partDefs,
                parts: partsByType,
            });
        }
    }

    return { folders, errors };
}
