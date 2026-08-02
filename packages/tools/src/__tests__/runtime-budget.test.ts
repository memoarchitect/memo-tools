import { describe, expect, it } from 'vitest';
import { enforceRuntimeBudget, RUNTIME_BUDGET_MS } from '../server/runtime-budget.js';

describe('runtime performance gates', () => {
    it('accepts measurements at each ceiling', () => {
        for (const [path, budget] of Object.entries(RUNTIME_BUDGET_MS)) {
            expect(enforceRuntimeBudget(path as keyof typeof RUNTIME_BUDGET_MS, budget, true).passed).toBe(true);
        }
    });

    it('fails CI when a ceiling is exceeded', () => {
        expect(() => enforceRuntimeBudget('incrementalProjectRebuild', 501, true))
            .toThrow('budget is 500ms');
    });
});
