// AST → canonical SysML IR → Memo projection.  The builder remains the
// projection implementation while the IR owns ingestion completeness.
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
    sysmlIdentity,
    type GenericSysmlElementIR,
    type IngestedSysmlElementIR,
    type MappedSysmlElementIR,
    type SysmlIR,
    type SysmlSourceRange,
} from '../sysml-ir/index.js';
import type { ParsedDocument } from './parser-utils.js';
import type { MemoModelDTO } from './semantic.js';

export const SYSML_IR_VERSION = '2.0.0';

/** Build the canonical record stream before exposing Memo's legacy projection. */
export function lowerAstToSysmlIr(documents: ParsedDocument[], model: MemoModelDTO, projectRoot = process.cwd()): SysmlIR {
    const elements: IngestedSysmlElementIR[] = [];
    const diagnostics: SysmlIR['diagnostics'] = [];
    const projected = new Set<string>();

    for (const document of documents) {
        // Langium's EmptyFileSystem assigns ephemeral document URIs. Identity
        // must instead name the authored file, identically in-process and over
        // sysmlc's pipe.
        const uri = pathToFileURL(resolve(projectRoot, document.filePath)).href;
        const visitPackage = (pkg: any, path: string, packageName: string): void => {
            for (const [index, member] of (pkg.members ?? []).entries()) {
                const memberPath = `${path}/members[${index}]`;
                if (member.$type === 'PackageDeclaration') {
                    visitPackage(member, memberPath, packageName ? `${packageName}::${member.name}` : member.name);
                    continue;
                }
                // Imports, metadata and constraints are declarations too. They
                // cannot disappear merely because the current Memo projection
                // has no shape for them.
                const name = member.name ?? member.$type;
                const range = sourceRange(document, member);
                const identity = sysmlIdentity(uri, memberPath, member.$type);
                const candidate = Object.entries(model.elements).find(([, element]) =>
                    element.file === document.filePath && element.id === name && element.package === (packageName || undefined));
                if (candidate && !projected.has(candidate[0])) {
                    projected.add(candidate[0]);
                    const mapped: MappedSysmlElementIR = {
                        kind: 'mapped', identity, source: range,
                        standardProperties: declaredProperties(member), providerProperties: {}, effectiveTypes: [], memoElementId: candidate[0],
                    };
                    elements.push(mapped);
                } else {
                    const unmappable = `Memo has no projection for ${member.$type} '${name}'`;
                    const generic: GenericSysmlElementIR = {
                        kind: 'generic', identity, source: range,
                        standardProperties: declaredProperties(member), providerProperties: {}, effectiveTypes: [], unmappable,
                    };
                    elements.push(generic);
                    diagnostics.push({ domain: 'memo-ingest', severity: 'warning', code: 'unmapped-sysml-element', message: unmappable, elementId: identity.id, file: document.filePath, range });
                }
            }
        };
        for (const [index, member] of (document.document.parseResult.value.members ?? []).entries()) {
            // The package's own name is where the qualified name starts. Passing
            // '' here matched every element against `package === undefined`, so
            // nothing inside a top-level package ever projected: conservation
            // still held — every declaration was reported — but as a file full
            // of unmapped generics rather than the elements MEMO does model.
            if (member.$type === 'PackageDeclaration') visitPackage(member, `members[${index}]`, member.name);
            else {
                // A top-level non-package declaration is rare but valid input;
                // preserve it with the same guarantee.
                const range = sourceRange(document, member);
                const identity = sysmlIdentity(uri, `members[${index}]`, member.$type);
                const message = `Memo has no projection for ${member.$type} '${(member as any).name ?? member.$type}'`;
                elements.push({ kind: 'generic', identity, source: range, standardProperties: declaredProperties(member), providerProperties: {}, effectiveTypes: [], unmappable: message });
                diagnostics.push({ domain: 'memo-ingest', severity: 'warning', code: 'unmapped-sysml-element', message, elementId: identity.id, file: document.filePath, range });
            }
        }
    }
    return { irVersion: SYSML_IR_VERSION, elements, diagnostics };
}

function declaredProperties(node: any): Record<string, unknown> {
    const properties: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(node)) {
        if (!key.startsWith('$') && typeof value !== 'function' && value !== undefined) properties[key] = jsonProperty(value);
    }
    return properties;
}

/** AST nodes contain parent links; retain their declared shape without leaking a cycle into IR JSON. */
function jsonProperty(value: any): unknown {
    if (value === null || ['string', 'number', 'boolean'].includes(typeof value)) return value;
    if (Array.isArray(value)) return value.map(jsonProperty);
    if (typeof value === 'object') {
        const result: Record<string, unknown> = {};
        for (const [key, child] of Object.entries(value)) {
            if (!key.startsWith('$') && typeof child !== 'function' && child !== undefined) result[key] = jsonProperty(child);
        }
        return result;
    }
    return String(value);
}

function sourceRange(document: ParsedDocument, node: any): SysmlSourceRange {
    const offset = node.$cstNode?.range?.start ?? 0;
    const position = document.document.textDocument.positionAt(offset);
    const start = { line: position.line + 1, ...(Number.isFinite(position.character) ? { column: position.character + 1 } : {}) };
    return { file: document.filePath, start };
}

/** Memo is now explicitly a projection of IR, rather than its ingestion boundary. */
export function projectSysmlIrToMemo(ir: SysmlIR, model: MemoModelDTO): MemoModelDTO {
    return { ...model, sysmlIr: ir };
}
