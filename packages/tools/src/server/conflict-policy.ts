// ─── Concurrent edit conflict policy ─────────────────────────────────────────
//
// Decide what a rejected write invalidates: one file, or the session.
//
// Section 13.5 is emphatic that these are different events. Editing SysML in
// SysIDE alongside Architect is the workflow this design exists to enable, so a
// stale hash on one project file is EXPECTED — it gets a scoped rejection and
// the user keeps working on every other file. Escalation to mutation lockout is
// reserved for the three enumerated cases where the server cannot prove what
// the change means.
//
// The decision lives here, apart from the server, because it is the part worth
// testing: the section 20 conflict rows are claims about which route a given
// situation takes, and a decision embedded in a WebSocket handler closure can
// only be tested by driving a live server.
//
// There is no automatic merge, no last-writer-wins, and no Continue or Ignore
// on either route. The only difference is blast radius.
//
// Design reference: section 13.5.
// ─────────────────────────────────────────────────────────────────────────────

import type { SemanticOrigin } from '../model/source-provenance.js';

/** Origins whose change alters the frozen reusable environment (section 13.5). */
const REUSABLE_CONFLICT_ORIGINS: ReadonlySet<SemanticOrigin> = new Set<SemanticOrigin>([
    'memo-core', 'ontology', 'extension', 'methodology',
]);

export interface ConflictInput {
    /** Workspace session the browser believes it is writing against. */
    commandSessionId: string;
    currentSessionId: string;
    /** Hash the browser last saw for this file. */
    expectedSourceHash: string;
    /** Hash on disk right now. Empty when the file is gone. */
    currentSourceHash: string;
    /** Provenance origin of the file being written. */
    origin: SemanticOrigin;
    /** False when the reloaded file no longer parses or the snapshot cannot rebuild. */
    dependencyClosureComputable: boolean;
    /**
     * True when this source has produced repeated unmatched external writes
     * while a transaction was pending, so independence cannot be established.
     */
    repeatedUnmatchedWrites?: boolean;
    /** True when the change adds or removes a reusable import/binding. */
    altersReusableGraph?: boolean;
}

export type ConflictDecision =
    | { outcome: 'accept' }
    | { outcome: 'scoped-reject'; reason: string }
    | { outcome: 'lockout'; reason: string; escalation: LockoutCause };

export type LockoutCause =
    | 'reusable-source-changed'
    | 'reusable-graph-altered'
    | 'dependency-closure-uncomputable'
    | 'independence-unprovable'
    | 'workspace-session-changed';

/**
 * Classify a write against the current disk state.
 *
 * Order matters: the escalating conditions are checked before the scoped one,
 * because a stale hash on ontology source is a session event, not a file event.
 * A caller that checked the hash first would scope-reject a change that
 * invalidates the whole frozen environment.
 */
export function classifyConflict(input: ConflictInput): ConflictDecision {
    // A different workspace session means the runtime restarted underneath this
    // browser. Nothing it believes about revisions still holds.
    if (input.commandSessionId !== input.currentSessionId) {
        return {
            outcome: 'lockout',
            escalation: 'workspace-session-changed',
            reason: 'The workspace runtime changed; no write was made.',
        };
    }

    const changed = input.currentSourceHash !== input.expectedSourceHash;

    // Reusable semantics are frozen as one coherent environment at bootstrap
    // (section 13.3). A change to one cannot be applied to a running session at
    // any scope, so it escalates whether or not this particular write conflicts.
    if (changed && REUSABLE_CONFLICT_ORIGINS.has(input.origin)) {
        return {
            outcome: 'lockout',
            escalation: 'reusable-source-changed',
            reason: 'Reusable semantic source changed externally. Model mutations are locked; '
                + 'Relaunch Memo Architect.',
        };
    }

    if (changed && input.altersReusableGraph) {
        return {
            outcome: 'lockout',
            escalation: 'reusable-graph-altered',
            reason: 'The change alters the active reusable import or binding graph. '
                + 'Model mutations are locked; Relaunch Memo Architect.',
        };
    }

    if (changed && !input.dependencyClosureComputable) {
        return {
            outcome: 'lockout',
            escalation: 'dependency-closure-uncomputable',
            reason: 'The dependency closure of the change cannot be computed. '
                + 'Model mutations are locked; Relaunch Memo Architect.',
        };
    }

    if (input.repeatedUnmatchedWrites) {
        return {
            outcome: 'lockout',
            escalation: 'independence-unprovable',
            reason: 'The same source produced repeated external writes while a transaction was '
                + 'pending, so independence cannot be established. Relaunch Memo Architect.',
        };
    }

    // The ordinary case: one project file moved under the browser. Reject this
    // write, keep the draft, reload the file's closure, and carry on.
    if (changed) {
        return {
            outcome: 'scoped-reject',
            reason: 'The file changed on disk; no write was made. Your edit is preserved as a draft.',
        };
    }

    return { outcome: 'accept' };
}

/** True when a decision must stop every further mutation in the session. */
export function isSessionFatal(decision: ConflictDecision): boolean {
    return decision.outcome === 'lockout';
}
