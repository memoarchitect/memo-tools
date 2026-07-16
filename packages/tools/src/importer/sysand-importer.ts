// ─── SysAnd Importer ─────────────────────────────────────────────────────────
//
// Reads a SysAnd project directory (.project.json + SysML files) and
// populates KindRegistry + RelationshipRegistry. Used for round-trip
// verification: export → import → diff = clean.
//
// Usage:
//   const result = await importSysandProject(projectDir);
// ─────────────────────────────────────────────────────────────────────────────

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { resolve, join, relative } from 'node:path';
import { KindRegistry } from '../model/kind-registry.js';
import { RelationshipRegistry } from '../model/relationship-registry.js';
import { parseFiles } from '../model/parser-utils.js';

/** .project.json format from SysAnd */
export interface SysAndProjectJson {
    name?: string;
    publisher?: string;
    version?: string;
    type?: string;
    usage?: string[];
}

/** .meta.json format from SysAnd export */
export interface SysAndMetaJson {
    index?: Record<string, string>;
    created?: string;
    checksum?: Record<string, { value: string; algorithm: string }>;
}

/** Result of importing a SysAnd project */
export interface SysAndImportResult {
    /** Project metadata from .project.json */
    projectJson: SysAndProjectJson;
    /** Meta information from .meta.json (if present) */
    metaJson?: SysAndMetaJson;
    /** Populated KindRegistry */
    kindRegistry: KindRegistry;
    /** Populated RelationshipRegistry */
    relationshipRegistry: RelationshipRegistry;
    /** Number of SysML files parsed */
    fileCount: number;
    /** All SysML file paths (relative to project dir) */
    sysmlFiles: string[];
    /** Package directories found */
    packageDirs: string[];
    /** Warnings */
    warnings: string[];
    /** Errors */
    errors: string[];
    /** Statistics */
    stats: {
        kinds: number;
        relationships: number;
        packages: number;
        sysmlFiles: number;
    };
}

/**
 * Recursively collect all .sysml files under a directory,
 * excluding index.sysml (which is just imports).
 */
function collectSysmlFiles(dir: string): string[] {
    const files: string[] = [];
    try {
        for (const entry of readdirSync(dir, { withFileTypes: true })) {
            const full = join(dir, entry.name);
            if (entry.isDirectory() && entry.name !== 'node_modules') {
                files.push(...collectSysmlFiles(full));
            } else if (entry.name.endsWith('.sysml') && entry.name !== 'index.sysml') {
                files.push(full);
            }
        }
    } catch {
        // skip
    }
    return files;
}

/**
 * Import a SysAnd project from a directory.
 *
 * Reads .project.json for metadata, then finds and parses all SysML files
 * to populate KindRegistry and RelationshipRegistry.
 *
 * The project directory may have:
 * - A flat structure: .project.json + sysml/ directory
 * - A packages/ structure: .project.json + packages/<name>/sysml/ directories
 */
export async function importSysandProject(projectDir: string): Promise<SysAndImportResult> {
    const kindRegistry = new KindRegistry();
    const relationshipRegistry = new RelationshipRegistry();
    const warnings: string[] = [];
    const errors: string[] = [];

    // Read .project.json
    const projectJsonPath = resolve(projectDir, '.project.json');
    let projectJson: SysAndProjectJson = {};
    if (existsSync(projectJsonPath)) {
        try {
            projectJson = JSON.parse(readFileSync(projectJsonPath, 'utf-8'));
        } catch (e) {
            errors.push(`Failed to parse .project.json: ${e}`);
        }
    } else {
        warnings.push('No .project.json found in project directory');
    }

    // Read .meta.json if present
    const metaJsonPath = resolve(projectDir, '.meta.json');
    let metaJson: SysAndMetaJson | undefined;
    if (existsSync(metaJsonPath)) {
        try {
            metaJson = JSON.parse(readFileSync(metaJsonPath, 'utf-8'));
        } catch {
            warnings.push('Failed to parse .meta.json');
        }
    }

    // Find SysML files — look in multiple locations
    const packageDirs: string[] = [];
    const allSysmlFiles: string[] = [];

    // 1. Direct sysml/ directory
    const directSysmlDir = resolve(projectDir, 'sysml');
    if (existsSync(directSysmlDir)) {
        packageDirs.push(projectDir);
        allSysmlFiles.push(...collectSysmlFiles(directSysmlDir));
    }

    // 2. packages/<name>/sysml/ directories
    const packagesDir = resolve(projectDir, 'packages');
    if (existsSync(packagesDir)) {
        try {
            for (const entry of readdirSync(packagesDir, { withFileTypes: true })) {
                if (!entry.isDirectory()) continue;
                const pkgSysmlDir = resolve(packagesDir, entry.name, 'sysml');
                if (existsSync(pkgSysmlDir)) {
                    packageDirs.push(resolve(packagesDir, entry.name));
                    allSysmlFiles.push(...collectSysmlFiles(pkgSysmlDir));
                }
            }
        } catch {
            // skip
        }
    }

    if (allSysmlFiles.length === 0) {
        errors.push('No .sysml files found in the SysAnd project');
        return {
            projectJson,
            metaJson,
            kindRegistry,
            relationshipRegistry,
            fileCount: 0,
            sysmlFiles: [],
            packageDirs: [],
            warnings,
            errors,
            stats: { kinds: 0, relationships: 0, packages: 0, sysmlFiles: 0 },
        };
    }

    // Parse all SysML files
    const parseResult = await parseFiles(allSysmlFiles, '');
    for (const err of parseResult.errors) {
        errors.push(`${err.file}${err.line ? `:${err.line}` : ''}: ${err.message}`);
    }

    // Populate registries
    kindRegistry.populateFromDocuments(parseResult.documents);
    relationshipRegistry.populateFromDocuments(parseResult.documents);

    const relativeSysmlFiles = allSysmlFiles.map(f => relative(projectDir, f));

    return {
        projectJson,
        metaJson,
        kindRegistry,
        relationshipRegistry,
        fileCount: allSysmlFiles.length,
        sysmlFiles: relativeSysmlFiles,
        packageDirs: packageDirs.map(d => relative(projectDir, d) || '.'),
        warnings,
        errors,
        stats: {
            kinds: kindRegistry.size,
            relationships: relationshipRegistry.size,
            packages: packageDirs.length,
            sysmlFiles: allSysmlFiles.length,
        },
    };
}

/**
 * Verify round-trip: compare an exported SysAnd project's registries
 * against the original registries.
 *
 * Returns a diff report. Empty arrays = clean round-trip.
 */
export function verifySysandRoundTrip(
    originalKinds: KindRegistry,
    originalRels: RelationshipRegistry,
    importedKinds: KindRegistry,
    importedRels: RelationshipRegistry,
): SysAndRoundTripDiff {
    const missingKinds: string[] = [];
    const extraKinds: string[] = [];
    const missingRels: string[] = [];
    const extraRels: string[] = [];

    // Check kinds
    for (const name of originalKinds.kindNames()) {
        if (!importedKinds.has(name)) {
            missingKinds.push(name);
        }
    }
    for (const name of importedKinds.kindNames()) {
        if (!originalKinds.has(name)) {
            extraKinds.push(name);
        }
    }

    // Check relationships
    for (const name of originalRels.relTypeNames()) {
        if (!importedRels.has(name)) {
            missingRels.push(name);
        }
    }
    for (const name of importedRels.relTypeNames()) {
        if (!originalRels.has(name)) {
            extraRels.push(name);
        }
    }

    return {
        isClean: missingKinds.length === 0 && extraKinds.length === 0 &&
                 missingRels.length === 0 && extraRels.length === 0,
        missingKinds,
        extraKinds,
        missingRels,
        extraRels,
    };
}

export interface SysAndRoundTripDiff {
    /** True if export → import round-trip is clean */
    isClean: boolean;
    /** Kinds in original but not in imported */
    missingKinds: string[];
    /** Kinds in imported but not in original */
    extraKinds: string[];
    /** Relationships in original but not in imported */
    missingRels: string[];
    /** Relationships in imported but not in original */
    extraRels: string[];
}
