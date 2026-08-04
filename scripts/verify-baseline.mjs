#!/usr/bin/env node
// ─── Session-1 baseline verification ──────────────────────────────────────────
//
// Re-runs the capture and diffs against the frozen baselines. Session 1 is
// behaviour-preserving, so any difference here is a regression unless it was
// deliberately intended and the baseline was re-frozen with a stated reason.
//
//   node scripts/verify-baseline.mjs
//
// Exits non-zero on any difference.
// ─────────────────────────────────────────────────────────────────────────────

import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FIXTURES, capture, materializeDefault } from './capture-baseline.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const baselineDir = resolve(here, '../packages/tools/src/__tests__/fixtures/baseline-s1');

let failures = 0;
let verified = 0;
for (const spec of FIXTURES) {
    const baselinePath = resolve(baselineDir, `${spec.id}.json`);
    if (!existsSync(baselinePath)) {
        console.error(`MISSING baseline for ${spec.id} — run capture-baseline.mjs`);
        failures++;
        continue;
    }
    const expected = JSON.parse(readFileSync(baselinePath, 'utf-8'));
    const fixture = spec.init ? { ...spec, dir: materializeDefault() } : spec;
    const actual = capture(fixture);

    const diffs = diff(expected, actual);
    if (diffs.length === 0) {
        console.log(`OK   ${spec.id}`);
        verified++;
    } else {
        failures++;
        console.error(`FAIL ${spec.id}`);
        for (const d of diffs.slice(0, 20)) console.error(`       ${d}`);
        if (diffs.length > 20) console.error(`       … ${diffs.length - 20} more`);
    }
}

if (verified !== FIXTURES.length) {
    failures++;
    console.error(`INCOMPLETE baseline verification: checked ${verified}/${FIXTURES.length} fixtures.`);
}

console.log(failures === 0 ? '\nAll baselines match.' : `\n${failures} fixture(s) diverged.`);
process.exit(failures === 0 ? 0 : 1);

/** Structural diff limited to the projected facts, reported as dotted paths. */
function diff(expected, actual, path = '') {
    if (JSON.stringify(expected) === JSON.stringify(actual)) return [];
    if (expected === null || actual === null || typeof expected !== 'object' || typeof actual !== 'object') {
        return [`${path || '(root)'}: ${JSON.stringify(expected)} → ${JSON.stringify(actual)}`];
    }
    if (Array.isArray(expected) !== Array.isArray(actual)) {
        return [`${path}: array/object shape changed`];
    }
    if (Array.isArray(expected)) {
        if (expected.length !== actual.length) {
            return [`${path}: length ${expected.length} → ${actual.length}`];
        }
        return expected.flatMap((item, i) => diff(item, actual[i], `${path}[${i}]`));
    }
    const keys = new Set([...Object.keys(expected), ...Object.keys(actual)]);
    return [...keys].flatMap(key =>
        diff(expected[key], actual[key], path ? `${path}.${key}` : key));
}
