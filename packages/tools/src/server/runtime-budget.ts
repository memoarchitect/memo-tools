/**
 * Ceilings for the runtime paths of design section 13.3, enforced by `scripts/runtime-budgets.mjs` on GPCA.
 *
 * Raised from 5s / 5s / 0.5s on 2026-10-26, at the maintainer's decision, when the paths were re-measured through
 * OpenSysML (median of 3, macOS arm64): cold bootstrap 8.4s and incremental rebuild 2.5s. The old figures were set
 * for the compiler that was removed. A shared CI runner is slower than that machine, so each ceiling is about
 * 1.5x the measurement; the save-to-revision ceiling is therefore no longer sub-second, and a change that makes
 * the compile faster should lower these again.
 */
export const RUNTIME_BUDGET_MS = {
    coldBootstrap: 12_000,
    supervisedRestart: 12_000,
    incrementalProjectRebuild: 4_000,
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
