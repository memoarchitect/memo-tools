// ─── Conformance baselines ───────────────────────────────────────────────────
//
// A conformance number is only useful against a previous one. The baseline is a
// committed report; CI re-runs the sweep and fails on any count that moved.
//
// Three rules make the comparison mean something:
//
// 1. **Improvement fails too, and says so.** A count that drops is progress, and
//    progress that nobody re-froze the baseline for is indistinguishable from a
//    sweep that silently stopped analysing half the corpus. The gate is
//    "changed", not "worse"; re-freezing is one command and one reviewable diff.
// 2. **A different corpus is not a regression.** Moving the Release pin changes
//    what conformance means. Comparing across pins would report a wall of
//    differences that are really a corpus bump, so it refuses to compare at all
//    and says which pin each side was taken against.
// 3. **Only counts are compared.** Sample findings and per-run detail move with
//    message wording; gating on them would make a prose change a CI failure.
// ─────────────────────────────────────────────────────────────────────────────

import { DIAGNOSTIC_DOMAINS, type ConformanceReport } from './run.js';
import { DIFFERENCE_CLASSES, type DiffXmiReport } from './diff-xmi.js';

export interface BaselineDifference {
    path: string;
    baseline: number | string;
    current: number | string;
}

export interface BaselineComparison {
    comparable: boolean;
    /** Why not, when `comparable` is false. */
    reason?: string;
    differences: BaselineDifference[];
}

function pinOf(report: { corpus: { commit: string; digest: string } }): string {
    return `${report.corpus.commit}/${report.corpus.digest}`;
}

function incomparable(baseline: string, current: string, what: string): BaselineComparison {
    return {
        comparable: false,
        reason:
            `${what} differs — baseline "${baseline}", current "${current}". `
            + 'A conformance count is only comparable against the same corpus pin and report format. '
            + 'Re-freeze the baseline rather than reading this as a regression.',
        differences: [],
    };
}

/** Counts moved, in either direction. See rule 1 above. */
function compareCounts(
    path: string,
    baseline: Record<string, number>,
    current: Record<string, number>,
    keys: readonly string[],
    into: BaselineDifference[],
): void {
    for (const key of keys) {
        const before = baseline?.[key] ?? 0;
        const after = current?.[key] ?? 0;
        if (before !== after) into.push({ path: `${path}.${key}`, baseline: before, current: after });
    }
}

export function compareConformanceBaseline(
    baseline: ConformanceReport,
    current: ConformanceReport,
): BaselineComparison {
    if (baseline.reportVersion !== current.reportVersion) {
        return incomparable(baseline.reportVersion, current.reportVersion, 'Report format version');
    }
    if (pinOf(baseline) !== pinOf(current)) {
        return incomparable(pinOf(baseline), pinOf(current), 'Corpus pin');
    }

    const differences: BaselineDifference[] = [];
    for (const role of ['validator', 'lowering'] as const) {
        if (baseline.toolchain[role] !== current.toolchain[role]) {
            differences.push({
                path: `toolchain.${role}`,
                baseline: baseline.toolchain[role],
                current: current.toolchain[role],
            });
        }
    }
    compareCounts('totals.byDomain', baseline.totals.byDomain, current.totals.byDomain, DIAGNOSTIC_DOMAINS, differences);
    for (const key of ['files', 'outsideUnit'] as const) {
        if (baseline.totals[key] !== current.totals[key]) {
            differences.push({
                path: `totals.${key}`,
                baseline: baseline.totals[key],
                current: current.totals[key],
            });
        }
    }

    const currentUnits = new Map(current.units.map(unit => [unit.id, unit]));
    for (const unit of baseline.units) {
        const now = currentUnits.get(unit.id);
        if (!now) {
            differences.push({ path: `units.${unit.id}`, baseline: 'present', current: 'absent' });
            continue;
        }
        currentUnits.delete(unit.id);
        for (const key of ['files', 'outsideUnit'] as const) {
            if (unit[key] !== now[key]) {
                differences.push({ path: `units.${unit.id}.${key}`, baseline: unit[key], current: now[key] });
            }
        }
        compareCounts(`units.${unit.id}.byDomain`, unit.byDomain, now.byDomain, DIAGNOSTIC_DOMAINS, differences);
    }
    for (const id of currentUnits.keys()) {
        differences.push({ path: `units.${id}`, baseline: 'absent', current: 'present' });
    }

    return { comparable: true, differences };
}

export function compareDiffXmiBaseline(
    baseline: DiffXmiReport,
    current: DiffXmiReport,
): BaselineComparison {
    if (baseline.reportVersion !== current.reportVersion) {
        return incomparable(baseline.reportVersion, current.reportVersion, 'Report format version');
    }
    if (pinOf(baseline) !== pinOf(current)) {
        return incomparable(pinOf(baseline), pinOf(current), 'Corpus pin');
    }

    const differences: BaselineDifference[] = [];
    compareCounts('totals.counts', baseline.totals.counts, current.totals.counts, DIFFERENCE_CLASSES, differences);

    const currentLibraries = new Map(current.libraries.map(library => [library.source, library]));
    for (const library of baseline.libraries) {
        const now = currentLibraries.get(library.source);
        if (!now) {
            differences.push({ path: `libraries.${library.source}`, baseline: 'present', current: 'absent' });
            continue;
        }
        currentLibraries.delete(library.source);
        if ((library.failure ?? '') !== (now.failure ?? '')) {
            differences.push({
                path: `libraries.${library.source}.failure`,
                baseline: library.failure ?? '(none)',
                current: now.failure ?? '(none)',
            });
        }
        compareCounts(
            `libraries.${library.source}.counts`,
            library.counts, now.counts, DIFFERENCE_CLASSES, differences,
        );
    }
    for (const source of currentLibraries.keys()) {
        differences.push({ path: `libraries.${source}`, baseline: 'absent', current: 'present' });
    }

    return { comparable: true, differences };
}

export function formatBaselineComparison(comparison: BaselineComparison): string {
    if (!comparison.comparable) return `INCOMPARABLE — ${comparison.reason}`;
    if (comparison.differences.length === 0) return 'OK — every count matches the baseline.';
    const lines = [`${comparison.differences.length} count(s) moved against the baseline:`];
    for (const difference of comparison.differences.slice(0, 40)) {
        lines.push(`  ${difference.path}: ${difference.baseline} → ${difference.current}`);
    }
    if (comparison.differences.length > 40) {
        lines.push(`  … ${comparison.differences.length - 40} more`);
    }
    lines.push('If the change is intended, re-freeze with --update-baseline and review the diff.');
    return lines.join('\n');
}
