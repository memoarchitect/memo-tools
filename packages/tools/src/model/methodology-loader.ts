// ─── Methodology Descriptor ───────────────────────────────────────────────────
//
// The methodology content a project resolved, as a DTO the server can publish.
//
// The scan reads the documents the compiler's handoff holds, not whatever
// `.sysml` files sit under a `methodology/` directory — a folder convention is
// not a selection mechanism. The descriptor carries the *effective*
// methodology and rule set, so a client can show the inheritance and policy
// chain rather than re-deriving it from raw parts.
//
// Design reference: sections 9.1, 10.3, 15.2 deliverables 4-5.
// ─────────────────────────────────────────────────────────────────────────────

import { basename, relative } from 'node:path';
import type { NativeMethodology, NativeProjectResolution } from './native-project.js';
import {
    resolveEffectiveMethodology,
    type EffectiveMethodology,
} from './methodology-resolver.js';
import type { ApiModel } from '../stage2/api-model.js';
import { apiMethodologyDocuments } from '../stage2/methodology-from-api.js';

/** Primitive value pulled out of a SysML attribute literal. */
export type MethodologyAttrValue = string | number | boolean;

/** A `part <name> : <Type> { ... }` usage from resolved source. */
export interface MethodologyPart {
    partName: string;
    partType: string;
    attributes: Record<string, MethodologyAttrValue>;
    multiAttributes: Record<string, MethodologyAttrValue[]>;
    sourceFile: string;
    namespace?: string;
}

/** A `part def Foo :> Bar { ... }` declaration in resolved methodology source. */
export interface MethodologyPartDef {
    name: string;
    superType?: string;
    sourceFile: string;
    namespace?: string;
}

/** One methodology-supplying source unit. */
export interface MethodologyFolderInfo {
    /** Package name supplying the methodology content. */
    name: string;
    /** Absolute path of the root that supplied it. */
    rootDir: string;
    sourceFiles: string[];
    namespaces: string[];
    partDefs: MethodologyPartDef[];
    parts: Record<string, MethodologyPart[]>;
}

/** Top-level descriptor exposed to clients. */
export interface MethodologyDescriptor {
    folders: MethodologyFolderInfo[];
    errors: string[];
    /** The resolved chain, merged selection, and policy chain. */
    effective?: EffectiveMethodology;
    /** Methodologies visible in the closure, by usage name. */
    available?: NativeMethodology[];
}

// ─── AST reading ──────────────────────────────────────────────────────────────

/**
 * Build the methodology descriptor for a project.
 *
 * A source unit appears here when it supplies methodology content the project
 * resolved — that is, when a package in the import closure declares a
 * methodology part. Discovery is not "a directory called `methodology/`":
 * that convention meant a package could ship methodology content the project
 * never imported and have it load anyway.
 */
export async function loadMethodologyDescriptor(
    projectRoot: string,
    resolution: NativeProjectResolution | undefined,
    /** The stage 1 handoff the resolution was read from. */
    api: ApiModel,
): Promise<MethodologyDescriptor> {
    if (!resolution) {
        return { folders: [], errors: [`No project resolved under ${projectRoot}, so there is no methodology to describe.`] };
    }
    const resolved = resolution;
    const errors = resolved.diagnostics.map(d => `${d.code}: ${d.message}`);

    const METHODOLOGY_TYPES = new Set([
        'MethodologyLibrary', 'MethodologyDefinition', 'ProjectMethodBinding', 'RulePolicy',
        'ElementUsageRule', 'RelationUsageRule', 'ModelingPattern', 'MethodologyWorkflowStep',
        'QualityGate', 'DhfDocumentBinding', 'Archetype', 'ResolvedMethodology',
    ]);

    const byRoot = new Map<string, MethodologyFolderInfo>();
    const fileToPackage = new Map<string, string>();
    for (const pkg of resolved.closure.values()) {
        for (const file of pkg.files) fileToPackage.set(file, pkg.qualifiedName);
    }

    const walkedDocuments = [...apiMethodologyDocuments(api, resolved.projectRoot)];
    for (const [filePath, walked] of walkedDocuments) {
        const pkgName = fileToPackage.get(filePath);
        if (!pkgName) continue;           // outside the import closure
        const pkg = resolved.closure.get(pkgName);
        const { partDefs, parts, namespaces } = walked;
        const relevant = parts.filter(p => METHODOLOGY_TYPES.has(p.partType));
        if (relevant.length === 0 && partDefs.length === 0) continue;
        if (relevant.length === 0) continue;

        const key = pkg?.root?.dir ?? resolved.projectRoot;
        let folder = byRoot.get(key);
        if (!folder) {
            folder = {
                name: pkg?.root?.packageName ?? basename(resolved.projectRoot),
                rootDir: key,
                sourceFiles: [],
                namespaces: [],
                partDefs: [],
                parts: {},
            };
            byRoot.set(key, folder);
        }
        const rel = relative(resolved.projectRoot, filePath) || basename(filePath);
        if (!folder.sourceFiles.includes(rel)) folder.sourceFiles.push(rel);
        for (const ns of namespaces) if (!folder.namespaces.includes(ns)) folder.namespaces.push(ns);
        folder.partDefs.push(...partDefs);
        for (const part of relevant) {
            (folder.parts[part.partType] ??= []).push(part);
        }
    }

    for (const folder of byRoot.values()) {
        folder.namespaces.sort();
        folder.sourceFiles.sort();
    }

    const effective = resolveEffectiveMethodology(
        resolved.binding,
        resolved.methodologies,
        new Set(resolved.filePackages.values()),
    );
    for (const d of effective.diagnostics) errors.push(`${d.code}: ${d.message}`);

    return {
        folders: [...byRoot.values()],
        errors,
        effective,
        available: [...resolved.methodologies.values()],
    };
}
