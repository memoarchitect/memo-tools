// ─── IR identity: the address every authoring write is made against ──────────
//
// An authoring write names its target by an identity: `file#key:metaclass`,
// minted from the file's source outline (authoring/outline-identity.ts,
// plans/memo-write-back-from-handoff.md). Before that it was a declaration's
// position in MEMO's syntax tree, which tied write-back to MEMO's grammar.
//
// This is the index a write resolves against — every identity of a revision,
// and each element's — and the error a stale one raises. A write either
// resolves its identity against the revision it was built against and the
// file as it is now, or fails loudly with `StaleIrIdentityError`, naming the
// identity and what it found.
// ─────────────────────────────────────────────────────────────────────────────

import type { SysmlIdentity } from '../sysml-ir/index.js';

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
    /** The identity, and the metaclass of the declaration it names. */
    identity: Pick<SysmlIdentity, 'id' | 'metaclass'>;
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
        // `file#key:metaclass` (authoring/outline-identity.ts).
        const hash = identityId.indexOf('#');
        const colon = identityId.lastIndexOf(':');
        if (hash <= 0 || colon <= hash + 1) continue;
        byMemoElement[memoElementId] = identityId;
        byIdentity.set(identityId, { identity: { id: identityId, metaclass: identityId.slice(colon + 1) }, memoElementId });
    }
    return { byMemoElement, byIdentity };
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
