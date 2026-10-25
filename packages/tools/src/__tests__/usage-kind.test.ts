import { describe, expect, it } from 'vitest';
import { compilerConfigured, examplesPresent, withExample } from './helpers/compile-source.js';

// ─── A usage is not its definition's metaclass ───────────────────────────────
//
// A usage takes the MEMO kind of the definition it is typed by. A definition that specializes no MEMO
// kind is a `RequirementDefinition`, which says what the definition is, not what its usage is; the
// usage used to inherit that name, so a query by kind mixed definitions and usages.
// ─────────────────────────────────────────────────────────────────────────────

const SEEDED = `package seeded_usage_kind {
    private import memo_assurance_requirements::*;
    requirement def Plain;
    requirement def Strict :> Requirement;
    requirement plain1 : Plain;
    requirement strict1 : Strict;
}`;

describe.runIf(compilerConfigured && examplesPresent)('the kind of a requirement usage', () => {
    it('is its type when no MEMO kind sits above it, and the MEMO kind when one does', async () => {
        await withExample({ 'model/seeded_usage_kind.sysml': SEEDED }, project => {
            const kindOf = (id: string) => project.model.elements.get(`seeded_usage_kind::${id}`)?.kind;
            expect(kindOf('Plain')).toBe('RequirementDefinition');
            expect(kindOf('plain1')).toBe('Plain');
            expect(kindOf('strict1')).toBe('Requirement');
        }, 'robot-cell-family');
    }, 180_000);
});
