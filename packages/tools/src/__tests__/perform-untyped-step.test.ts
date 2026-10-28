import { describe, expect, it } from 'vitest';
import { compilerConfigured, examplesPresent, withExample } from './helpers/compile-source.js';

// SysML lets an action `perform` any action usage. A functional-chain step (`action step :> fnX`) has no
// MEMO type, and the builder used to report it as the wrong end kind of `performs`.

const source = `package seeded_perform {
    private import memo_architecture_operational_activities::*;
    private import memo_architecture_functional_functions::*;
    action fnSense : SystemFunction;
    action chain : FunctionalFlow {
        action stepSense :> fnSense;
    }
    action oaRequest : OperativeAction {
        perform chain.stepSense;
    }
}`;

describe.runIf(compilerConfigured && examplesPresent)('perform of an untyped chain step', () => {
    it('is not an end-kind finding', async () => {
        await withExample({ 'model/catalog/seeded_perform.sysml': source }, project => {
            const performs = project.model.relationships.filter(r => r.type === 'performs');
            expect(performs.map(r => r.targetId.split('::').slice(1).join('::'))).toContain('chain::stepSense');
            expect(project.model.errors.filter(e => e.code === 'relationship-end-kind')).toEqual([]);
        });
    }, 180_000);
});
