export const RUNTIME_BUDGET_MS = {
    coldBootstrap: 5_000,
    supervisedRestart: 5_000,
    incrementalProjectRebuild: 500,
} as const;

export type RuntimeBudgetPath = keyof typeof RUNTIME_BUDGET_MS;

/** Throw in CI when a measured runtime path exceeds its design ceiling. */
export function enforceRuntimeBudget(
    path: RuntimeBudgetPath,
    elapsedMs: number,
    ci = process.env.CI === 'true' || process.env.CI === '1',
): { path: RuntimeBudgetPath; elapsedMs: number; budgetMs: number; passed: boolean } {
    const budgetMs = RUNTIME_BUDGET_MS[path];
    const result = { path, elapsedMs, budgetMs, passed: elapsedMs <= budgetMs };
    if (!result.passed && ci) {
        throw new Error(`${path} took ${elapsedMs.toFixed(1)}ms; budget is ${budgetMs}ms.`);
    }
    return result;
}
