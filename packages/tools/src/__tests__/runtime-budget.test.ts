import { describe, expect, it } from 'vitest';
import { enforceRuntimeBudget, RUNTIME_BUDGET_MS } from '../server/runtime-budget.js';

describe('runtime performance gates', () => {
    it('accepts measurements at each ceiling', () => {
        for (const [path, budget] of Object.entries(RUNTIME_BUDGET_MS)) {
            expect(enforceRuntimeBudget(path as keyof typeof RUNTIME_BUDGET_MS, budget, true).passed).toBe(true);
        }
    });

    it('fails CI when a ceiling is exceeded', () => {
        const ceiling = RUNTIME_BUDGET_MS.incrementalProjectRebuild;
        expect(() => enforceRuntimeBudget('incrementalProjectRebuild', ceiling + 1, true))
            .toThrow(`budget is ${ceiling}ms`);
    });
});
