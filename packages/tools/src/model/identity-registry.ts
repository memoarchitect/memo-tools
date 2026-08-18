// ─── Element identity registry ───────────────────────────────────────────────
//
// Persists the two identifiers a model does NOT author: the sequential
// `shortId` (REQ-1, HZD-2) and the technical `uuid`.
//
// Both are assigned by the compiler, and both are quoted outside the model — in
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
}

/** `package::name` → identity. */
export type IdentityRegistry = Record<string, ElementIdentity>;

/** The registry key for an element. */
export function identityKey(element: { id: string; package?: string }): string {
    return element.package ? `${element.package}::${element.id}` : element.id;
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
    const merged: IdentityRegistry = { ...prior, ...assigned };
    writeFileSync(join(projectRoot, IDENTITY_FILENAME), serializeIdentityRegistry(merged));
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
        if (!entry?.shortId && !entry?.uuid) continue;
        out += `  "${key}":\n`;
        if (entry.shortId) out += `    shortId: "${entry.shortId}"\n`;
        if (entry.uuid) out += `    uuid: "${entry.uuid}"\n`;
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
        const fieldMatch = line.match(/^ {4}(shortId|uuid): "(.*)"$/);
        if (fieldMatch && current) {
            registry[current][fieldMatch[1] as 'shortId' | 'uuid'] = fieldMatch[2];
        }
    }
    return registry;
}

/**
 * The prior `shortId` assignments for one prefix family, as
 * `assignSequentialShortIds` expects them: element id → shortId.
 *
 * Keys are un-qualified here because assignment happens per prefix over element
 * ids; the qualified key is only the persistence form.
 */
export function priorShortIds(registry: IdentityRegistry): Map<string, string> {
    const out = new Map<string, string>();
    for (const [key, entry] of Object.entries(registry)) {
        if (!entry.shortId) continue;
        out.set(key.includes('::') ? key.slice(key.lastIndexOf('::') + 2) : key, entry.shortId);
    }
    return out;
}
