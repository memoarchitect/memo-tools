#!/usr/bin/env node
// ─── Session-1 baseline verification ──────────────────────────────────────────
//
// Re-runs the capture and diffs against the frozen baselines. Session 1 is
// behaviour-preserving, so any difference here is a regression unless it was
// deliberately intended and the baseline was re-frozen with a stated reason.
//
//   node scripts/verify-baseline.mjs
//
// Exits non-zero on any difference. The comparison is `baseline-diff.mjs`.
// ─────────────────────────────────────────────────────────────────────────────

import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FIXTURES, capture, materializeDefault } from './capture-baseline.mjs';
import { verify } from './baseline-diff.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const baselineDir = resolve(here, '../packages/tools/src/__tests__/fixtures/baseline-s1');

const { ok } = verify({
    fixtures: FIXTURES,
    baselineDir,
    capture,
    prepare: spec => (spec.init ? { ...spec, dir: materializeDefault() } : spec),
});
process.exit(ok ? 0 : 1);
