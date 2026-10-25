import { describe, expect, it } from 'vitest';
import { compilerConfigured, examplesPresent, withExample } from './helpers/compile-source.js';

// ─── A function carries a precondition and a postcondition ───────────────────
//
// `MemoFunction` specializes `MemoConstrainedOccurrence`: two native `constraint` features, each
// guarding one end of the function. A usage redefines them with its own expression; the builder
// emits the redefinition as a constraint owned by the function.
// ─────────────────────────────────────────────────────────────────────────────

const SEEDED = `package seeded_function_conditions {
    private import ScalarValues::*;
    private import memo_architecture_functional_functions::*;
    action fnDose : SystemFunction {
        in rate : Real;
        out cmd : Real;
        constraint :>> precondition { rate >= 0 and rate <= 10 }
        constraint :>> postcondition { cmd >= 0 }
    }
    action fnPlain : SystemFunction;
}`;

describe.runIf(compilerConfigured && examplesPresent)('a function\'s conditions', () => {
    it('are constraints owned by the function, with their expressions', async () => {
        await withExample({ 'model/seeded_function_conditions.sysml': SEEDED }, project => {
            const owned = [...project.model.elements.values()].filter(e => e.construct === 'constraint' && e.owner === 'seeded_function_conditions::fnDose');
            expect(owned.map(c => c.attributes.expression).sort()).toEqual(['cmd >= 0', 'rate >= 0 and rate <= 10']);
            const plain = [...project.model.elements.values()].filter(e => e.construct === 'constraint' && e.owner === 'seeded_function_conditions::fnPlain');
            expect(plain).toEqual([]);
        }, 'robot-cell-family');
    }, 180_000);
});
