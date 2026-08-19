import { describe, it, expect } from 'vitest';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadOntologyRegistries } from '../model/ontology-loader.js';

// ─── Native-duplicate lint ───────────────────────────────────────────────────
//
// `memo/docs/reference/naming-and-native-constructs.md` records every MEMO
// construct that duplicates a SysML v2 one. It was prose, and prose drifts in
// BOTH directions:
//
//   * rows stay after the work is done — measured 2026-08-18, 12 of the 17
//     constructs listed had already been removed, some for six days, and the
//     table still read as a live backlog;
//   * duplicates found later never reach the table at all — the full audit
//     (plans/reference/memo-vs-sysml-audit-2026-08-18.md) found ~24 relations
//     the language already supplies, of which only five were written down.
//
// Neither direction was detectable, which is why the same rows kept being
// rediscovered and re-argued. So the table is a fixture here instead, and the
// ontology is measured against it every run.
//
// The lint deliberately fails when a construct is REMOVED but still listed. A
// stale "to do" is not harmless: it sends the next person to re-do finished
// work, and it hides how much is actually left.
// ─────────────────────────────────────────────────────────────────────────────

const GPCA_PROJECT = resolve(__dirname, '../../../../../memo/examples/gpca-pump');

type Status = 'present' | 'removed';

interface DuplicateRow {
    /** The native construct that already says this. */
    native: string;
    /** Whether the MEMO construct still exists in the ontology. */
    status: Status;
    /** Required while `present`: why it has not gone yet. */
    reason?: string;
}

/**
 * The audit table, mirrored from naming-and-native-constructs.md.
 *
 * Adding a row here is how a newly found duplicate becomes tracked. Flipping a
 * row to `removed` is how the burndown is recorded — and the test then enforces
 * that it stays removed.
 */
const NATIVE_DUPLICATES: Record<string, DuplicateRow> = {
    Composes: { native: 'nesting (native containment)', status: 'removed' },
    DerivesFrom: {
        native: '#derivation / #derive metadata',
        status: 'present',
        reason: 'Not yet migrated; bucket A of the 2026-08-18 audit.',
    },
    CommentsOn: {
        native: 'comment / doc',
        status: 'present',
        reason: 'Not yet migrated; bucket A of the 2026-08-18 audit.',
    },
    NotesOn: {
        native: 'comment / doc',
        status: 'present',
        reason: 'Not yet migrated; bucket A of the 2026-08-18 audit.',
    },
    RationaleFor: {
        native: 'standard Rationale metadata',
        status: 'present',
        reason: 'Not yet migrated; bucket A of the 2026-08-18 audit.',
    },
    // Deleted 2026-08-18 with zero usages anywhere — ontology, examples,
    // templates, extensions and both downstream projects.
    ComponentConnects: { native: 'connect', status: 'removed' },
    DataBinding: { native: 'bind', status: 'removed' },
    MemoLink: { native: 'dependency', status: 'removed' },
    NavigatesTo: { native: 'succession', status: 'removed' },
    RequiresResource: { native: 'dependency', status: 'removed' },
    ResolvesToMethodology: { native: 'dependency', status: 'removed' },
    Supports: { native: 'dependency (also a duplicate of Enables)', status: 'removed' },
    IncludedIn: { native: 'expose', status: 'removed' },
    Initiates: { native: 'actor', status: 'removed' },
    ParticipatesIn: { native: 'actor', status: 'removed' },
    Includes: { native: 'include use case', status: 'removed' },
    PresentsState: { native: 'exhibit state', status: 'removed' },
    InvolvesFunction: { native: 'perform action', status: 'removed' },
    ActionInvokesFunction: { native: 'perform action', status: 'removed' },
    Precedes: { native: 'succession / first … then', status: 'removed' },
    ModuleUses: { native: 'dependency', status: 'removed' },
    MonitorsChannel: { native: 'dependency', status: 'removed' },
    Realizes: { native: '#refinement metadata', status: 'removed' },
    ConnectsPhysically: { native: 'connect', status: 'removed' },
};

/**
 * Every MEMO definition the registries can see.
 *
 * Entries carrying a `nativeKeyword` are excluded, exactly as the
 * keyword-collision lint excludes them: once a relation is migrated to a native
 * construct its `sysmlName` stays registered as the graph edge type, so
 * `Realizes` and `ParticipatesIn` remain visible as edges long after the
 * `connection def` is gone. Counting those as survivors would report a
 * finished migration as unfinished — which is the failure this file exists to
 * prevent, in the other direction.
 */
async function ontologyDefinitionNames(): Promise<Set<string>> {
    const { registries } = await loadOntologyRegistries(GPCA_PROJECT);
    const names = new Set<string>();
    for (const entry of registries.kindRegistry?.entries() ?? []) names.add(entry.name);
    for (const entry of registries.relationshipRegistry?.entries() ?? []) {
        if (entry.nativeKeyword) continue;
        names.add(entry.sysmlName);
    }
    return names;
}

describe('MEMO constructs that duplicate a native SysML v2 one', () => {
    it('every row marked removed is really gone', async () => {
        if (!existsSync(GPCA_PROJECT)) return; // sibling ontology checkout absent
        const names = await ontologyDefinitionNames();
        const resurrected = Object.entries(NATIVE_DUPLICATES)
            .filter(([name, row]) => row.status === 'removed' && names.has(name))
            .map(([name, row]) => `${name} (use ${row.native})`);
        expect(resurrected, 'a construct recorded as removed is back in the ontology').toEqual([]);
    });

    it('every row marked present really is present', async () => {
        // The direction that actually rotted. Without this the table keeps
        // listing finished work and nobody can tell what is left.
        if (!existsSync(GPCA_PROJECT)) return;
        const names = await ontologyDefinitionNames();
        const stale = Object.entries(NATIVE_DUPLICATES)
            .filter(([name, row]) => row.status === 'present' && !names.has(name))
            .map(([name]) => name);
        expect(stale, 'this construct is gone — flip its row to "removed"').toEqual([]);
    });

    it('every surviving duplicate carries a reason', () => {
        const unexplained = Object.entries(NATIVE_DUPLICATES)
            .filter(([, row]) => row.status === 'present' && !row.reason?.trim())
            .map(([name]) => name);
        expect(unexplained, 'a duplicate that survives needs a recorded reason').toEqual([]);
    });

    it('names a native construct for every row', () => {
        const missing = Object.entries(NATIVE_DUPLICATES)
            .filter(([, row]) => !row.native?.trim())
            .map(([name]) => name);
        expect(missing).toEqual([]);
    });
});
