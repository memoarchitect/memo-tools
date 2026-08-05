// ─── IR identity: the address every authoring write is made against ──────────
//
// Session 3 made the canonical IR the ingestion boundary. Authoring still
// addressed elements the old way — by authored name, matched with a regular
// expression over the source text — so two declarations with the same name in
// different namespaces were the same target as far as a write was concerned,
// and a rename made the write silently miss.
//
// An IR identity is `file-URI + declaration path + metaclass`. It is positional
// by construction, which is the point: inserting a declaration ahead of another
// changes the second one's address, so an identity minted against an older
// revision is *detectably* old rather than quietly pointing at a neighbour.
// Every write therefore either resolves its identity against the current IR or
// fails loudly — `StaleIrIdentityError`, naming the identity and what it found.
//
// Nothing here reads the filesystem or spawns anything: it is a resolver over
// an IR that some lowering provider already produced.
// ─────────────────────────────────────────────────────────────────────────────

import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { SysmlIdentity, SysmlIR } from '../sysml-ir/index.js';

/**
 * A write was made against an identity the current IR does not have.
 *
 * Loud on purpose. The alternative — falling back to a name lookup — is how a
 * write ends up editing the wrong element, which is the failure this whole
 * module exists to make impossible.
 */
export class StaleIrIdentityError extends Error {
    constructor(readonly identityId: string, detail: string) {
        super(
            `The edit targets "${identityId}", which is not in the current model revision: ${detail}. `
            + 'Reload the element and repeat the edit; no file was written.',
        );
        this.name = 'StaleIrIdentityError';
    }
}

/** The wire form: what a client needs to name an element in a later write. */
export type IrIdentityTable = Record<string, string>;

/** What an index knows about one addressable declaration. */
export interface IrIdentityEntry {
    identity: SysmlIdentity;
    /** The Memo element it projects to, when the projection mapped it. */
    memoElementId?: string;
}

export interface IrIdentityIndex {
    /** Memo element ID → IR identity ID, for elements the projection mapped. */
    readonly byMemoElement: IrIdentityTable;
    /** IR identity ID → the declaration it names. */
    readonly byIdentity: ReadonlyMap<string, IrIdentityEntry>;
}

/**
 * Index one IR for identity resolution.
 *
 * Both directions are needed and neither is derivable cheaply from the other:
 * the client holds Memo element IDs and has to mint an identity from one, and
 * the server holds an identity and has to find what it names.
 */
export function buildIrIdentityIndex(ir: SysmlIR | undefined): IrIdentityIndex {
    const byMemoElement: IrIdentityTable = {};
    const byIdentity = new Map<string, IrIdentityEntry>();
    for (const element of ir?.elements ?? []) {
        const memoElementId = element.kind === 'mapped' ? element.memoElementId : undefined;
        byIdentity.set(element.identity.id, { identity: element.identity, memoElementId });
        if (memoElementId) byMemoElement[memoElementId] = element.identity.id;
    }
    return { byMemoElement, byIdentity };
}

/**
 * Rebuild an index from the compact table alone.
 *
 * The whole IR is not shipped with a model update — `standardProperties` carry
 * every declared property of every node, and a surface that only needs to
 * *address* an element does not need its contents. The identity ID is a
 * self-describing string, so the table is enough to reconstruct everything the
 * resolver uses.
 */
export function indexFromIdentityTable(table: IrIdentityTable | undefined): IrIdentityIndex {
    const byMemoElement: IrIdentityTable = {};
    const byIdentity = new Map<string, IrIdentityEntry>();
    for (const [memoElementId, identityId] of Object.entries(table ?? {})) {
        const identity = parseSysmlIdentityId(identityId);
        if (!identity) continue;
        byMemoElement[memoElementId] = identityId;
        byIdentity.set(identityId, { identity, memoElementId });
    }
    return { byMemoElement, byIdentity };
}

/**
 * Read an identity ID back into its parts.
 *
 * `file:///…/model/a.sysml#members[0]/members[2]:PartUsage`. The file URI may
 * itself contain `#` only if percent-encoded, and the metaclass never contains
 * `:`, so splitting at the first `#` and the last `:` is unambiguous.
 */
export function parseSysmlIdentityId(id: string): SysmlIdentity | undefined {
    const hash = id.indexOf('#');
    const colon = id.lastIndexOf(':');
    if (hash < 0 || colon < hash) return undefined;
    const fileUri = id.slice(0, hash);
    const declarationPath = id.slice(hash + 1, colon);
    const metaclass = id.slice(colon + 1);
    if (!fileUri || !declarationPath || !metaclass) return undefined;
    return { fileUri, declarationPath, metaclass, id };
}

/**
 * The compact table shipped with a model update.
 *
 * The whole IR is not sent: its `standardProperties` carry every declared
 * property of every node, and a client that only needs to address an element
 * does not need its contents.
 */
export function irIdentityTable(ir: SysmlIR | undefined): IrIdentityTable {
    return buildIrIdentityIndex(ir).byMemoElement;
}

/**
 * Resolve an identity ID against the current IR, or fail loudly.
 *
 * `expectedMemoElementId`, when given, is checked too: an identity that still
 * exists but now names a different element is exactly as stale as one that has
 * disappeared, and it is the more dangerous of the two.
 */
export function requireIrIdentity(
    index: IrIdentityIndex,
    identityId: string,
    expectedMemoElementId?: string,
): IrIdentityEntry {
    const found = index.byIdentity.get(identityId);
    if (!found) {
        throw new StaleIrIdentityError(identityId, 'no declaration in the current IR has that identity');
    }
    if (expectedMemoElementId !== undefined && found.memoElementId !== expectedMemoElementId) {
        throw new StaleIrIdentityError(
            identityId,
            `it now names ${found.memoElementId ? `element "${found.memoElementId}"` : 'a declaration Memo does not project'}, `
            + `not "${expectedMemoElementId}"`,
        );
    }
    return found;
}

/** The identity a client should quote when it writes to this element. */
export function identityForMemoElement(
    index: IrIdentityIndex,
    memoElementId: string,
): string | undefined {
    return index.byMemoElement[memoElementId];
}

// ─── Locating the declaration an identity names ─────────────────────────────

/** `members[3]/members[1]` → `[3, 1]`. Any other shape is not a path we minted. */
export function parseDeclarationPath(declarationPath: string): number[] | undefined {
    const segments = declarationPath.split('/').filter(Boolean);
    if (segments.length === 0) return undefined;
    const indexes: number[] = [];
    for (const segment of segments) {
        const match = /^members\[(\d+)\]$/.exec(segment);
        if (!match) return undefined;
        indexes.push(Number(match[1]));
    }
    return indexes;
}

/** The project-relative file an identity's URI names, given the project root. */
export function identityFile(identity: SysmlIdentity, projectRoot: string): string | undefined {
    const roots = pathToFileURL(resolve(projectRoot)).href.replace(/\/$/, '');
    if (!identity.fileUri.startsWith(`${roots}/`)) return undefined;
    return decodeURIComponent(identity.fileUri.slice(roots.length + 1));
}

/** True when this identity was minted for that project-relative file. */
export function identityNamesFile(
    identity: SysmlIdentity,
    projectRoot: string,
    relativePath: string,
): boolean {
    return identityFile(identity, projectRoot) === relativePath.replaceAll('\\', '/');
}

/**
 * Walk a parsed document to the declaration an identity addresses.
 *
 * The metaclass is verified, not assumed: a path that still resolves but to a
 * different kind of declaration means the file was edited underneath this
 * identity, and continuing would rewrite the wrong lines.
 */
export function resolveDeclarationByIdentity(
    root: { members?: unknown[] },
    identity: SysmlIdentity,
): { $type?: string; name?: string; $cstNode?: { offset: number; length: number } } {
    const path = parseDeclarationPath(identity.declarationPath);
    if (!path) {
        throw new StaleIrIdentityError(identity.id, `"${identity.declarationPath}" is not a declaration path`);
    }
    let node: any = root;
    for (const [depth, index] of path.entries()) {
        const members = node?.members;
        if (!Array.isArray(members) || index >= members.length) {
            throw new StaleIrIdentityError(
                identity.id,
                `the source no longer has a declaration at ${path.slice(0, depth + 1).map(i => `members[${i}]`).join('/')}`,
            );
        }
        node = members[index];
    }
    if (node?.$type !== identity.metaclass) {
        throw new StaleIrIdentityError(
            identity.id,
            `that position now holds a ${node?.$type ?? 'nothing'}, not a ${identity.metaclass}`,
        );
    }
    return node;
}
