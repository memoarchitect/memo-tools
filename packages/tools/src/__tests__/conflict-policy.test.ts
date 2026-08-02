// Concurrent web/file edit conflicts (design section 13.5).
//
// These are the two section-20 conflict rows:
//
//   project source                          → scoped notice + draft; other files still editable
//   reusable source / uncomputable closure  → mutation lockout + mandatory relaunch
//
// The distinction is the whole design. Editing SysML in SysIDE beside Architect
// is the workflow this exists to enable, so a stale hash on a project file must
// NOT end the session — and a stale hash on ontology source must, because the
// reusable environment is frozen as one coherent unit at bootstrap.

import { describe, it, expect } from 'vitest';
import { classifyConflict, isSessionFatal, type ConflictInput } from '../server/conflict-policy.js';

const clean: ConflictInput = {
    commandSessionId: 'session-1',
    currentSessionId: 'session-1',
    expectedSourceHash: 'abc',
    currentSourceHash: 'abc',
    origin: 'project',
    dependencyClosureComputable: true,
};

const stale = { ...clean, currentSourceHash: 'def' };

describe('no conflict', () => {
    it('accepts a write whose file has not moved', () => {
        expect(classifyConflict(clean)).toEqual({ outcome: 'accept' });
    });

    it('does not treat an independent edit to another file as a conflict', () => {
        // Section 13.5: independent edits are not conflicts merely because they
        // happened at the same time. Each is judged against its own hash.
        expect(classifyConflict({ ...clean, origin: 'project' }).outcome).toBe('accept');
    });
});

describe('scoped conflict — project source', () => {
    it('rejects the write without ending the session', () => {
        const decision = classifyConflict(stale);
        expect(decision.outcome).toBe('scoped-reject');
        expect(isSessionFatal(decision)).toBe(false);
    });

    it('says the draft is preserved, because the server never applies it', () => {
        const decision = classifyConflict(stale);
        expect(decision.outcome === 'scoped-reject' && decision.reason).toContain('draft');
    });

    it('leaves a subsequent write to an unaffected file acceptable', () => {
        // The blast radius is one file. This is the property that makes
        // SysIDE-alongside-Architect usable at all.
        classifyConflict(stale);
        expect(classifyConflict({ ...clean, expectedSourceHash: 'xyz', currentSourceHash: 'xyz' }).outcome)
            .toBe('accept');
    });
});

describe('session conflict — escalation', () => {
    it('escalates a change to ontology source', () => {
        const decision = classifyConflict({ ...stale, origin: 'ontology' });
        expect(decision.outcome).toBe('lockout');
        expect(decision.outcome === 'lockout' && decision.escalation).toBe('reusable-source-changed');
    });

    it.each(['memo-core', 'ontology', 'extension', 'methodology'] as const)(
        'escalates a change to %s source', origin => {
            expect(classifyConflict({ ...stale, origin }).outcome).toBe('lockout');
        });

    it('does not escalate for a standard-library or project origin', () => {
        expect(classifyConflict({ ...stale, origin: 'project' }).outcome).toBe('scoped-reject');
        expect(classifyConflict({ ...stale, origin: 'standard-library' }).outcome).toBe('scoped-reject');
    });

    it('escalates when the change alters the reusable import graph', () => {
        // A project file can still be session-fatal: changing the binding or an
        // import re-decides what the frozen environment contains.
        const decision = classifyConflict({ ...stale, altersReusableGraph: true });
        expect(decision.outcome === 'lockout' && decision.escalation).toBe('reusable-graph-altered');
    });

    it('escalates when the dependency closure cannot be computed', () => {
        const decision = classifyConflict({ ...stale, dependencyClosureComputable: false });
        expect(decision.outcome === 'lockout' && decision.escalation)
            .toBe('dependency-closure-uncomputable');
    });

    it('escalates when independence cannot be established', () => {
        const decision = classifyConflict({ ...clean, repeatedUnmatchedWrites: true });
        expect(decision.outcome === 'lockout' && decision.escalation).toBe('independence-unprovable');
    });

    it('escalates when the workspace session changed underneath the browser', () => {
        const decision = classifyConflict({ ...clean, commandSessionId: 'session-0' });
        expect(decision.outcome === 'lockout' && decision.escalation).toBe('workspace-session-changed');
    });
});

describe('ordering', () => {
    it('escalates reusable-source changes rather than scope-rejecting them', () => {
        // If the hash check ran first, a stale ontology file would be scoped to
        // one file — and the session would carry on against an environment that
        // no longer matches disk.
        const decision = classifyConflict({ ...stale, origin: 'methodology' });
        expect(decision.outcome).toBe('lockout');
    });

    it('checks the session before anything else', () => {
        // A restarted runtime invalidates every revision the browser holds, so
        // even a file whose hash still matches cannot be written against it.
        const decision = classifyConflict({ ...clean, commandSessionId: 'other' });
        expect(decision.outcome).toBe('lockout');
    });
});

describe('what the policy never does', () => {
    it('offers no merge, no last-writer-wins, and no continue path', () => {
        // Every reachable outcome is accept, scoped-reject, or lockout. There is
        // deliberately no fourth option, and this test exists so adding one
        // fails here rather than passing review.
        const outcomes = new Set([
            classifyConflict(clean).outcome,
            classifyConflict(stale).outcome,
            classifyConflict({ ...stale, origin: 'ontology' }).outcome,
            classifyConflict({ ...stale, dependencyClosureComputable: false }).outcome,
            classifyConflict({ ...clean, commandSessionId: 'x' }).outcome,
        ]);
        expect([...outcomes].sort()).toEqual(['accept', 'lockout', 'scoped-reject']);
    });
});
