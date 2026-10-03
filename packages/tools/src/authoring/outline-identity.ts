// ─── Identities from the source outline ──────────────────────────────────────
//
// An authoring write names its target by an identity: the file, the
// declaration's key in it and its metaclass —
// `model/catalog/project.sysml#Plant::pump:PartUsage`
// (plans/memo-write-back-from-handoff.md). It is minted from a source outline,
// so it reads the same whether a stage 1 handoff or MEMO's parse built the
// outline, and it survives an insertion elsewhere in the file. A rename or a
// deletion makes it stale, and resolving a stale identity fails loudly rather
// than editing a neighbour.
// ─────────────────────────────────────────────────────────────────────────────

import { isAbsolute, relative } from 'node:path';
import { outlineNodes, type OutlineNode, type SourceOutline } from './source-outline.js';
import { StaleIrIdentityError } from '../model/ir-identity.js';

/** `file#key:metaclass`. */
export function outlineIdentity(file: string, node: Pick<OutlineNode, 'key' | 'metaclass'>): string {
    return `${file.replaceAll('\\', '/')}#${node.key}:${node.metaclass}`;
}

/** An identity's parts, or undefined for a string that is not one. */
export function parseOutlineIdentity(identity: string): { file: string; key: string; metaclass: string } | undefined {
    const hash = identity.indexOf('#');
    const colon = identity.lastIndexOf(':');
    if (hash <= 0 || colon <= hash + 1 || identity[colon - 1] === ':') return undefined;
    return { file: identity.slice(0, hash), key: identity.slice(hash + 1, colon), metaclass: identity.slice(colon + 1) };
}

/**
 * Every declaration of the outlines with an identity, by identity. A key that
 * two declarations of one file share addresses neither, so it is left out
 * rather than resolving to whichever came first.
 */
export function outlineIdentities(outlines: Iterable<SourceOutline>): Map<string, { outline: SourceOutline; node: OutlineNode }> {
    const found = new Map<string, { outline: SourceOutline; node: OutlineNode }>();
    const ambiguous = new Set<string>();
    for (const outline of outlines) {
        for (const node of outlineNodes(outline)) {
            const identity = outlineIdentity(outline.file, node);
            if (found.has(identity)) ambiguous.add(identity);
            else found.set(identity, { outline, node });
        }
    }
    for (const identity of ambiguous) found.delete(identity);
    return found;
}

/**
 * The element id → identity table a model update ships: an element is the
 * declaration whose key is its id, in its file.
 */
export function outlineIdentityTable(
    outlines: Iterable<SourceOutline>,
    elements: Iterable<{ id: string; file?: string }>,
    /** An element's file is absolute from some builders; the outline's is project-relative. */
    projectRoot?: string,
): Record<string, string> {
    const byFileKey = new Map<string, string>();
    for (const identity of outlineIdentities(outlines).keys()) {
        const parts = parseOutlineIdentity(identity)!;
        const fileKey = `${parts.file}#${parts.key}`;
        // One file and key with two metaclasses is no address either.
        byFileKey.set(fileKey, byFileKey.has(fileKey) ? '' : identity);
    }
    const table: Record<string, string> = {};
    for (const element of elements) {
        if (!element.file) continue;
        const file = projectRoot && isAbsolute(element.file) ? relative(projectRoot, element.file) : element.file;
        const identity = byFileKey.get(`${file.replaceAll('\\', '/')}#${element.id}`);
        if (identity) table[element.id] = identity;
    }
    return table;
}

/**
 * The declaration an identity names in the file's current outline, or a
 * `StaleIrIdentityError` saying why there is none.
 */
export function resolveOutlineIdentity(outline: SourceOutline, identity: string): OutlineNode {
    const parts = parseOutlineIdentity(identity);
    if (!parts) throw new StaleIrIdentityError(identity, 'it is not an identity this revision minted');
    if (parts.file !== outline.file.replaceAll('\\', '/')) {
        throw new StaleIrIdentityError(identity, `it names ${parts.file}, not ${outline.file}`);
    }
    const matches = [...outlineNodes(outline)].filter(node => node.key === parts.key);
    if (matches.length === 0) throw new StaleIrIdentityError(identity, 'no declaration in the file has that name now');
    if (matches.length > 1) throw new StaleIrIdentityError(identity, 'more than one declaration in the file has that name');
    const node = matches[0];
    if (node.metaclass !== parts.metaclass) {
        throw new StaleIrIdentityError(identity, `it now names a ${node.metaclass}, not a ${parts.metaclass}`);
    }
    return node;
}
