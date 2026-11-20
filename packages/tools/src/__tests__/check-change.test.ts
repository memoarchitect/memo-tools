// What fails a change check: what --fail-on names, judged on the change impact and the new findings.

import { describe, it, expect } from 'vitest';
import { changeFailures } from '../commands/check-change.js';

const check = (breaking: number, findings: string[], releases: boolean[]) => ({
    impact: {
        contract: { changes: [], summary: { breaking, compatible: 0, unknown: 0 } },
        releases: releases.map((needsNewRelease, i) => ({ id: `r${i}`, name: `R${i}`, status: 'released', commit: 'c', needsNewRelease })),
    },
    newFindings: findings.map(severity => ({ severity, ruleId: 'R', elementId: 'e', description: 'd' })),
    cleared: 0,
} as any);

describe('a change check', () => {
    it('fails on breaking interface changes and new errors by default', () => {
        expect(changeFailures(check(0, ['warning'], [true]), ['breaking', 'errors'])).toEqual([]);
        expect(changeFailures(check(2, ['error', 'warning'], []), ['breaking', 'errors'])).toEqual(['2 breaking interface changes', '1 new error']);
    });

    it('fails on warnings and releases only when asked', () => {
        expect(changeFailures(check(0, ['warning'], [true, false]), ['warnings', 'release'])).toEqual(['1 new warning', '1 release needing a new release']);
    });
});
