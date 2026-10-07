// ─── OpenSysML's compact api-json, read as the element array ─────────────────
//
// `ConvertRequest.compact` (capability `convert_compact`) writes the elements
// as one `api-json-compact/1` object: a table of the element ids, each once,
// and the elements with every reference an index into it. Everything MEMO
// reads from a conversion still reads the element array, so this expands the
// document into that array and nothing above it changes: an element's `@id`
// is its table entry, and a handle becomes `{ "@id": <that id> }`, sharing the
// table's string. Omitted derived properties are simply absent, as stage 2
// already computes ownership, typing and values from the owned ones.
// ─────────────────────────────────────────────────────────────────────────────

import type { ApiElement } from '../../stage2/api-model.js';

export const CONVERT_COMPACT = 'convert_compact';

export const COMPACT_API_JSON_FORMAT = 'api-json-compact/1';

/**
 * The derived properties of the metamodel the handoff and stage 2 still read:
 * the rest restate what the owned properties say.
 *   - `qualifiedName` names each element in the handoff's index;
 *   - `isLibraryElement` marks the standard library's elements, which the
 *     handoff references but does not carry;
 *   - `importedMembership` is the member a project's import names.
 */
export const KEPT_DERIVED_PROPERTIES: readonly string[] = ['qualifiedName', 'isLibraryElement', 'importedMembership'];

interface CompactDocument {
    format: string;
    ids: string[];
    elementCount: number;
    /** Every element's `elementId` is its id, and none writes it. */
    elementIdsAreIds?: boolean;
    referenceKeys: string[];
    elements: Record<string, unknown>[];
}

/** The element array a compact document stands for. */
export function expandCompactApiJson(text: string): ApiElement[] {
    const document = JSON.parse(text) as CompactDocument;
    if (document.format !== COMPACT_API_JSON_FORMAT) {
        throw new Error(`OpenSysML wrote ${String(document.format)}, expected ${COMPACT_API_JSON_FORMAT}`);
    }
    const { ids } = document;
    const bare = new Set(document.referenceKeys);
    const reference = (handle: number) => ({ '@id': ids[handle] });
    const elements: ApiElement[] = new Array(document.elements.length);
    for (let i = 0; i < document.elements.length; i++) {
        const element = document.elements[i];
        const expanded: ApiElement = { '@type': element['@type'] as string, '@id': ids[i] };
        if (document.elementIdsAreIds) expanded.elementId = ids[i];
        for (const key in element) {
            if (key === '@type') continue;
            const value = element[key];
            if (bare.has(key)) {
                expanded[key] = Array.isArray(value) ? value.map(item => reference(item as number)) : reference(value as number);
            } else if (Array.isArray(value)) {
                expanded[key] = value.map(item => handled(item, ids));
            } else {
                expanded[key] = handled(value, ids);
            }
        }
        elements[i] = expanded;
    }
    return elements;
}

/** A value outside a reference key: a reference spelled `{ "@id": handle }`, or a scalar as it is. */
function handled(value: unknown, ids: readonly string[]): unknown {
    if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
        const handle = (value as { '@id'?: unknown })['@id'];
        if (typeof handle === 'number') return { '@id': ids[handle] };
    }
    return value;
}

/** The elements of a conversion as the service wrote it: the compact document or the element array. */
export function parseApiJson(text: string): ApiElement[] {
    return text.trimStart().startsWith('{') ? expandCompactApiJson(text) : JSON.parse(text) as ApiElement[];
}
