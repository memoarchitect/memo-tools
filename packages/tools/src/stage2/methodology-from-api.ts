// ─── Methodology content from a stage 1 handoff ─────────────────────────────
//
// `loadMethodologyDescriptor` groups a project's methodology content — the
// part definitions and the typed part and action usages of every resolved
// file — by the root that supplied it. It reads them from MEMO's parse with
// `walkDocument`; this reads the same facts, file by file, from the API JSON
// a stage 1 compiler wrote, so a project compiled by an external compiler
// shows its methodology without MEMO parsing it.
// ─────────────────────────────────────────────────────────────────────────────

import { basename, relative } from 'node:path';
import type { MethodologyAttrValue, MethodologyPart, MethodologyPartDef } from '../model/methodology-loader.js';
import type { ApiElement, ApiModel, ApiValue } from './api-model.js';

export interface WalkedDocument {
    partDefs: MethodologyPartDef[];
    parts: MethodologyPart[];
    namespaces: string[];
}

const isPackage = (element: ApiElement) => element['@type'] === 'Package' || element['@type'] === 'LibraryPackage';
const PART_USAGES = new Set(['PartUsage', 'ActionUsage']);
const lastSegment = (name: string) => name.slice(name.lastIndexOf('::') + 2);
/** An enumeration value as a model writes it: `Kind::member`. */
const asWritten = (name: string) => name.split('::').slice(-2).join('::');

/** Each document's methodology facts, by absolute file, as `walkDocument` reads them. */
export function apiMethodologyDocuments(api: ApiModel, projectRoot: string): Map<string, WalkedDocument> {
    const out = new Map<string, WalkedDocument>();
    for (const root of api.ofType('Namespace')) {
        if (api.owner(root['@id'])) continue;
        const file = api.absoluteFile(root['@id']);
        if (!file) continue;
        const sourceFile = relative(projectRoot, file) || basename(file);
        const walked = out.get(file) ?? { partDefs: [], parts: [], namespaces: [] };
        out.set(file, walked);
        const visit = (node: ApiElement, ns?: string) => {
            if (isPackage(node)) {
                const name = api.declaredName(node['@id']);
                if (name && !walked.namespaces.includes(name)) walked.namespaces.push(name);
                for (const member of api.ownedMembers(node['@id'])) visit(member, name ?? ns);
                return;
            }
            if (node['@type'] === 'PartDefinition') {
                const general = api.superclassifiers(node['@id'])[0];
                const name = api.declaredName(node['@id']);
                if (name) {
                    walked.partDefs.push({
                        name,
                        superType: general ? api.name(general['@id']) : undefined,
                        sourceFile,
                        namespace: ns,
                    });
                }
                return;
            }
            if (PART_USAGES.has(String(node['@type']))) {
                const type = api.types(node['@id'])[0];
                const partType = type ? api.name(type['@id']) : undefined;
                const partName = api.declaredName(node['@id']);
                if (partType && partName) {
                    walked.parts.push({ partName, partType, ...readAttributes(api, node), sourceFile, namespace: ns });
                }
                for (const member of api.ownedMembers(node['@id'])) visit(member, ns);
            }
        };
        for (const member of api.ownedMembers(root['@id'])) visit(member);
    }
    return out;
}

/** A usage's attribute values, as `readBody` reads them from MEMO's parse. */
function readAttributes(api: ApiModel, usage: ApiElement): Pick<MethodologyPart, 'attributes' | 'multiAttributes'> {
    const attributes: Record<string, MethodologyAttrValue> = {};
    const multiAttributes: Record<string, MethodologyAttrValue[]> = {};
    const push = (key: string, value: MethodologyAttrValue) => {
        (multiAttributes[key] ??= []).push(value);
        attributes[key] = value;
    };
    for (const member of api.ownedMembers(usage['@id'])) {
        if (member['@type'] !== 'AttributeUsage') continue;
        const name = api.name(member['@id']);
        const value = name ? api.value(member['@id']) : undefined;
        if (!name || !value) continue;
        if (value.kind === 'sequence') {
            // Each item as written: a literal, or an enumeration value as `Kind::member`.
            for (const item of value.items) {
                const literal = item.kind === 'reference' ? asWritten(item.qualifiedName) : literalOf(item);
                if (literal !== undefined) push(name, literal);
            }
        } else if (value.kind === 'reference') {
            push(name, lastSegment(value.qualifiedName));
            attributes[`${name}__qualified`] = asWritten(value.qualifiedName);
        } else {
            const literal = literalOf(value);
            if (literal !== undefined) push(name, literal);
        }
    }
    return { attributes, multiAttributes };
}

function literalOf(value: ApiValue): MethodologyAttrValue | undefined {
    switch (value.kind) {
        case 'string': return value.value;
        case 'number': return value.value;
        case 'boolean': return value.value;
        default: return undefined;
    }
}
