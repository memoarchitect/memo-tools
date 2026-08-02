// ─── Methodology Descriptor ───────────────────────────────────────────────────
//
// The methodology content a project resolved, as a DTO the server can publish.
//
// Two things changed at the native flip. The scan is an AST walk over the
// documents the native resolver already parsed, not a regex pass over whatever
// `.sysml` files sat under a `methodology/` directory — a folder convention is
// not a selection mechanism. And the descriptor now carries the *effective*
// methodology and rule set, so a client can show the inheritance and policy
// chain rather than re-deriving it from raw parts.
//
// Design reference: sections 9.1, 10.3, 15.2 deliverables 4-5.
// ─────────────────────────────────────────────────────────────────────────────

import { basename, relative } from 'node:path';
import type { ParsedDocument } from './parser-utils.js';
import {
    resolveNativeProject,
    type NativeMethodology,
    type NativeProjectResolution,
} from './native-project.js';
import {
    resolveEffectiveMethodology,
    type EffectiveMethodology,
} from './methodology-resolver.js';

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

function literal(value: any): MethodologyAttrValue | undefined {
    if (!value) return undefined;
    switch (value.$type) {
        case 'StringValue':
            try { return JSON.parse(value.value ?? '""'); }
            catch { return String(value.value ?? '').replace(/^"|"$/g, ''); }
        case 'IntValue':
        case 'RealValue':
            return Number(value.value);
        case 'BooleanValue':
            return value.value === 'true' || value.value === true;
        case 'EnumValue': {
            const ref: string = value.enumRef ?? '';
            const idx = ref.lastIndexOf('::');
            return idx >= 0 ? ref.slice(idx + 2) : ref;
        }
        default:
            return undefined;
    }
}

function readBody(body: any[]): Pick<MethodologyPart, 'attributes' | 'multiAttributes'> {
    const attributes: Record<string, MethodologyAttrValue> = {};
    const multiAttributes: Record<string, MethodologyAttrValue[]> = {};
    const push = (key: string, v: MethodologyAttrValue) => {
        (multiAttributes[key] ??= []).push(v);
        attributes[key] = v;
    };
    for (const member of body ?? []) {
        if (member.$type !== 'AttributeMember' || !member.name || !member.value) continue;
        if (member.value.$type === 'SetLiteral') {
            for (const el of member.value.elements ?? []) {
                const raw = el.stringValue ?? el.value;
                if (typeof raw !== 'string') continue;
                try { push(member.name, JSON.parse(raw)); }
                catch { push(member.name, raw.replace(/^"|"$/g, '')); }
            }
        } else if (member.value.$type === 'EnumValue') {
            const ref: string = member.value.enumRef ?? '';
            const v = literal(member.value);
            if (v !== undefined) push(member.name, v);
            attributes[`${member.name}__qualified`] = ref;
        } else {
            const v = literal(member.value);
            if (v !== undefined) push(member.name, v);
        }
    }
    return { attributes, multiAttributes };
}

function shortName(qualified: string | undefined): string | undefined {
    if (!qualified) return undefined;
    const idx = qualified.lastIndexOf('::');
    return idx >= 0 ? qualified.slice(idx + 2) : qualified;
}

function walkDocument(doc: ParsedDocument, projectRoot: string): {
    partDefs: MethodologyPartDef[];
    parts: MethodologyPart[];
    namespaces: string[];
} {
    const partDefs: MethodologyPartDef[] = [];
    const parts: MethodologyPart[] = [];
    const namespaces: string[] = [];
    const model = doc.document.parseResult?.value as any;
    if (!model) return { partDefs, parts, namespaces };
    const sourceFile = relative(projectRoot, doc.filePath) || basename(doc.filePath);

    const visit = (node: any, ns?: string) => {
        if (!node) return;
        if (node.$type === 'PackageDeclaration') {
            if (node.name && !namespaces.includes(node.name)) namespaces.push(node.name);
            for (const m of node.members ?? []) visit(m, node.name ?? ns);
            return;
        }
        if (node.$type === 'PartDefinition') {
            partDefs.push({
                name: node.name,
                superType: shortName(node.specialization?.superType),
                sourceFile,
                namespace: ns,
            });
            return;
        }
        // `action` usages carry workflow steps, so they are read alongside parts.
        if (node.$type === 'PartUsage' || node.$type === 'PartMember' || node.$type === 'ActionUsage') {
            const partType = shortName(node.type);
            if (partType && node.name) {
                parts.push({
                    partName: node.name,
                    partType,
                    ...readBody(node.body ?? node.usageBody ?? []),
                    sourceFile,
                    namespace: ns,
                });
            }
            for (const m of node.body ?? []) visit(m, ns);
        }
    };

    for (const member of model.members ?? []) visit(member);
    return { partDefs, parts, namespaces };
}

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
    resolution?: NativeProjectResolution,
): Promise<MethodologyDescriptor> {
    const resolved = resolution ?? await resolveNativeProject(projectRoot);
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

    for (const doc of resolved.documents) {
        const pkgName = fileToPackage.get(doc.filePath);
        if (!pkgName) continue;           // outside the import closure
        const pkg = resolved.closure.get(pkgName);
        const { partDefs, parts, namespaces } = walkDocument(doc, resolved.projectRoot);
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
        const rel = relative(resolved.projectRoot, doc.filePath) || basename(doc.filePath);
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
