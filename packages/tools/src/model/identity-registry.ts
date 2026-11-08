// ─── Element identity registry ───────────────────────────────────────────────
//
// Persists the identifiers a model does NOT author: the sequential `shortId`
// (REQ-1, HZD-2), the technical `uuid`, and a view's `viewShortId` (INT-7).
//
// All are assigned by the compiler, and all are quoted outside the model — in
// reports, review comments, deep links and external trace tables. An identifier
// that is recomputed from current content cannot survive the edits those
// references need it to survive:
//
//   * `shortId` numbering needs to know which numbers were already handed out,
//     including to elements since deleted, or it reuses a retired number.
//   * `uuid` was derived from `file + kind + name`, so moving a file or
//     renaming an element silently minted a new identity for the same thing.
//
// So they are written to `memo.identity.yaml` beside `memo.lock.yaml` and read
// back on every build. The file is generated but NOT regenerable — deleting it
// does not reproduce it, it re-mints every identity. It belongs in version
// control for the same reason a lockfile does.
//
// The name is deliberately NOT hidden and deliberately not inside `.memo/`.
// A dotfile is the kind of thing a person never notices and therefore never
// commits, and `.memo/` is defined by the native project format as regenerable
// and safe to delete — either would quietly lose the file, and losing it
// re-mints every identity. It sits in plain sight next to `memo.lock.yaml`,
// which is the file it most resembles in purpose and lifecycle.
//
// Elements are keyed by `package::name`, which is what "the same element"
// means across a rebuild. A rename is therefore a new identity, deliberately:
// the alternative is guessing that two differently-named elements are the same
// one, and a wrong guess silently transfers a traceability handle.
// ─────────────────────────────────────────────────────────────────────────────

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export const IDENTITY_FILENAME = 'memo.identity.yaml';

/** One element's persisted identity. */
export interface ElementIdentity {
    shortId?: string;
    uuid?: string;
    /**
     * Short ids this element held and no longer does (a usage that was `SYS-20` and is now `SYS-7:1`).
     * They stay in the ledger so their numbers stay retired: a number once handed out is never handed out
     * again, whichever element it was on.
     */
    retired?: string[];
    /**
     * A view's number in its view kind's family (`INT-7`), the id its permalink carries. Separate from
     * `shortId`: the view families share letters with element families (`INT` is also interfaces, `ACT`
     * also actions) but not numbers.
     */
    viewShortId?: string;
    /** View numbers this element held and no longer does, as `retired` is for `shortId`. */
    retiredViewShortIds?: string[];
}

/** `package::name` → identity. */
export type IdentityRegistry = Record<string, ElementIdentity>;

/**
 * The registry key for an element: its qualified id, which already carries the
 * declaring package as its first segment.
 *
 * It used to be `package` and the element's id joined, because an id was then a
 * bare short name. Joining them now would produce `Pump::Pump::motor`. For a
 * TOP-LEVEL element the two spellings are character-for-character identical —
 * `Pump::pump1` either way — which is why no existing entry moves. A NESTED
 * element's key gains the owner chain it always should have had, and
 * `priorIdentityFor` below adopts the old entry so no shortId or uuid is
 * re-minted by this change.
 */
export function identityKey(element: { id: string; package?: string }): string {
    return element.id;
}

/**
 * The identity an element already had, under this key or the one it used
 * before qualified ids.
 *
 * A nested element was keyed `package::shortName` when a short name was an id;
 * it is keyed `package::owner::shortName` now. Both are looked up, newest
 * first, so a project's `memo.identity.yaml` survives the change without being
 * rewritten and without a port silently acquiring a new `RMR-…`.
 */
export function priorIdentityFor(
    registry: IdentityRegistry,
    element: { id: string; package?: string; shortName?: string },
): ElementIdentity | undefined {
    const current = registry[identityKey(element)];
    if (current) return current;
    if (!element.package || !element.shortName) return undefined;
    return registry[`${element.package}::${element.shortName}`];
}

/**
 * Read the registry. A missing file is an empty registry, not an error: the
 * first build of a project legitimately has no prior identities.
 */
export function readIdentityRegistry(projectRoot: string): IdentityRegistry {
    const path = join(projectRoot, IDENTITY_FILENAME);
    if (!existsSync(path)) return {};
    return parseIdentityRegistry(readFileSync(path, 'utf-8'));
}

/**
 * Write the registry, preserving entries whose elements are no longer present.
 *
 * Retired entries are what stop a number being reused, so they are kept rather
 * than pruned. They are cheap, and dropping them is the one change that would
 * make the file unsafe.
 */
export function writeIdentityRegistry(
    projectRoot: string,
    assigned: IdentityRegistry,
    prior: IdentityRegistry = {},
): void {
    const merged: IdentityRegistry = { ...prior };
    for (const [key, entry] of Object.entries(assigned)) {
        merged[key] = withRetired(entry, prior[key]);
    }
    writeFileSync(join(projectRoot, IDENTITY_FILENAME), serializeIdentityRegistry(merged));
}

/**
 * Record the identities a build assigned, and return the registry as it now stands (the next build's
 * prior). Called by every command that builds a model and accepts it, so a project written against an
 * older version is brought up to date by the first build under the new one: the ids it now computes are
 * recorded, and the ones they replace are retired. Nothing is written when the file already says the
 * same, which keeps a rebuild from touching the file a watcher is watching.
 */
export function persistIdentities(
    projectRoot: string,
    elements: Iterable<{ id: string; package?: string; shortId?: string; uuid?: string; viewShortId?: string; provenance?: { declaration: { origin?: string } } }>,
    prior: IdentityRegistry = {},
): IdentityRegistry {
    const merged: IdentityRegistry = { ...prior };
    for (const el of elements) {
        const key = identityKey(el);
        // Another package owns a dependency's identities; this model's registry does not hold them. A view
        // number is this model's own: it is minted in this model's sequence, whoever declares the view.
        if (el.provenance?.declaration.origin === 'dependency') {
            if (el.viewShortId) merged[key] = withRetired({ viewShortId: el.viewShortId }, prior[key]);
            continue;
        }
        if (!el.shortId && !el.uuid && !el.viewShortId) continue;
        merged[key] = withRetired({ shortId: el.shortId, uuid: el.uuid, viewShortId: el.viewShortId }, prior[key]);
    }
    const path = join(projectRoot, IDENTITY_FILENAME);
    const text = serializeIdentityRegistry(merged);
    try {
        if (!existsSync(path) || readFileSync(path, 'utf-8') !== text) writeFileSync(path, text);
    } catch {
        // A read-only checkout still builds; it just cannot record identities. A degraded mode, not a failure.
    }
    return merged;
}

/** The ids retired once an element holding `was` holds `current`, given the ones already retired. */
function retiredIds(current: string | undefined, was: string | undefined, earlier: readonly string[]): string[] {
    const retired = new Set(earlier);
    if (was && was !== current) retired.add(was);
    if (current) retired.delete(current);
    return [...retired].sort();
}

/** `entry`, plus every short id or view number `before` held that `entry` does not: those numbers are retired. */
export function withRetired(entry: ElementIdentity, before: ElementIdentity | undefined): ElementIdentity {
    if (!before) return entry;
    const retired = retiredIds(entry.shortId, before.shortId, [...(before.retired ?? []), ...(entry.retired ?? [])]);
    const retiredViewShortIds = retiredIds(entry.viewShortId, before.viewShortId,
        [...(before.retiredViewShortIds ?? []), ...(entry.retiredViewShortIds ?? [])]);
    return {
        ...entry,
        ...(retired.length > 0 ? { retired } : {}),
        ...(retiredViewShortIds.length > 0 ? { retiredViewShortIds } : {}),
    };
}

/** Serialize to the same hand-written YAML subset the lockfile uses. */
export function serializeIdentityRegistry(registry: IdentityRegistry): string {
    let out = `# ${IDENTITY_FILENAME} — element identity registry (auto-generated)\n`;
    out += `# Assigned once and never reassigned. COMMIT THIS FILE: deleting it does\n`;
    out += `# not regenerate the same identities, it mints new ones, and every\n`;
    out += `# external reference to a shortId or uuid then points at nothing.\n`;
    out += `# Entries for deleted elements are retained so their numbers stay retired.\n\n`;
    out += `elements:\n`;
    for (const key of Object.keys(registry).sort()) {
        const entry = registry[key];
        if (!entry?.shortId && !entry?.uuid && !entry?.retired?.length && !entry?.viewShortId && !entry?.retiredViewShortIds?.length) continue;
        out += `  "${key}":\n`;
        if (entry.shortId) out += `    shortId: "${entry.shortId}"\n`;
        if (entry.uuid) out += `    uuid: "${entry.uuid}"\n`;
        if (entry.retired?.length) out += `    retired: "${entry.retired.join(',')}"\n`;
        if (entry.viewShortId) out += `    viewShortId: "${entry.viewShortId}"\n`;
        if (entry.retiredViewShortIds?.length) out += `    retiredViewShortIds: "${entry.retiredViewShortIds.join(',')}"\n`;
    }
    return out;
}

/** Parse the registry (hand-written for the simple two-field format). */
export function parseIdentityRegistry(content: string): IdentityRegistry {
    const registry: IdentityRegistry = {};
    let current: string | undefined;
    for (const rawLine of content.split('\n')) {
        const line = rawLine.replace(/\s+$/, '');
        if (!line || line.trimStart().startsWith('#') || line.startsWith('elements:')) continue;

        const keyMatch = line.match(/^ {2}"(.+)":$/);
        if (keyMatch) {
            current = keyMatch[1];
            registry[current] = {};
            continue;
        }
        const fieldMatch = line.match(/^ {4}(shortId|uuid|retired|viewShortId|retiredViewShortIds): "(.*)"$/);
        if (fieldMatch && current) {
            if (fieldMatch[1] === 'retired' || fieldMatch[1] === 'retiredViewShortIds') {
                registry[current][fieldMatch[1]] = fieldMatch[2].split(',').filter(Boolean);
            } else registry[current][fieldMatch[1] as 'shortId' | 'uuid' | 'viewShortId'] = fieldMatch[2];
        }
    }
    return registry;
}

/**
 * The prior `shortId` assignments for one prefix family, as
 * `assignSequentialShortIds` expects them: element id → shortId.
 *
 * Keys are the registry's own — an element's qualified id, which is what an
 * element id now is. They used to be stripped to the last segment, because an
 * id was then a bare short name and the two forms had to be bridged; stripping
 * them now would make every key ambiguous again, which is the thing qualified
 * ids exist to stop.
 *
 * An entry whose element is gone is kept: it matches nothing, and raising the
 * high-water mark is exactly what retires its number.
 */
export function priorShortIds(registry: IdentityRegistry): Map<string, string> {
    return numbersHandedOut(registry, entry => entry.shortId, entry => entry.retired);
}

/** The prior view numbers, in the same form: a view numbers apart from the elements sharing its letters. */
export function priorViewShortIds(registry: IdentityRegistry): Map<string, string> {
    return numbersHandedOut(registry, entry => entry.viewShortId, entry => entry.retiredViewShortIds);
}

function numbersHandedOut(
    registry: IdentityRegistry,
    held: (entry: ElementIdentity) => string | undefined,
    retiredOf: (entry: ElementIdentity) => string[] | undefined,
): Map<string, string> {
    const out = new Map<string, string>();
    for (const [key, entry] of Object.entries(registry)) {
        const current = held(entry);
        if (current) out.set(key, current);
        // A retired number matches no element, and raises the family's high-water mark like a deleted one.
        for (const retired of retiredOf(entry) ?? []) out.set(`${key}\0retired\0${retired}`, retired);
    }
    return out;
}
