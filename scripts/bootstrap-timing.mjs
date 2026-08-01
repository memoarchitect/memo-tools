#!/usr/bin/env node
// ─── Cold bootstrap timing ────────────────────────────────────────────────────
//
// Session 1 deliverable 10. Design section 13.3 makes restart cost a
// first-class requirement, because restart is the answer to every reusable
// semantic change. Measuring it from session 1 means a later regression is
// attributable to the change that caused it.
//
//   node scripts/bootstrap-timing.mjs           # report
//   node scripts/bootstrap-timing.mjs --check   # fail if over budget
//
// Budget: cold bootstrap ≤ 5 s on GPCA (design section 13.3).
// ─────────────────────────────────────────────────────────────────────────────

import { execFileSync } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { rmSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const toolsRoot = resolve(here, '..');
const cli = resolve(toolsRoot, 'packages/tools/lib/bin/memo.js');
const gpca = resolve(toolsRoot, '../memo/examples/gpca-pump');

const COLD_BOOTSTRAP_BUDGET_MS = 5000;
const RUNS = 3;

function timeOnce() {
    const out = resolve(tmpdir(), 'memo-timing.json');
    const start = process.hrtime.bigint();
    execFileSync('node', [cli, 'export', 'json', '--output', out], {
        cwd: gpca, stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024,
    });
    const elapsed = Number(process.hrtime.bigint() - start) / 1e6;
    if (existsSync(out)) rmSync(out, { force: true });
    return elapsed;
}

if (!existsSync(cli)) {
    console.error('CLI not built. Run: pnpm build');
    process.exit(1);
}

// A full `memo export json` is the closest CLI proxy for a cold bootstrap: it
// resolves the import closure, parses every ontology and project file, builds
// the registries, and produces the model — which is exactly what a runtime
// restart redoes. It includes node startup, so it over-reports slightly; a
// budget met here is met in the runtime.
const samples = [];
for (let i = 0; i < RUNS; i++) samples.push(timeOnce());
samples.sort((a, b) => a - b);
const median = samples[Math.floor(samples.length / 2)];

console.log(`Cold bootstrap (GPCA, ${RUNS} runs)`);
console.log(`  samples: ${samples.map(s => `${s.toFixed(0)}ms`).join(', ')}`);
console.log(`  median:  ${median.toFixed(0)}ms`);
console.log(`  budget:  ${COLD_BOOTSTRAP_BUDGET_MS}ms (design section 13.3)`);
console.log(`  ${median <= COLD_BOOTSTRAP_BUDGET_MS ? 'WITHIN BUDGET' : 'OVER BUDGET'} — ${(median / COLD_BOOTSTRAP_BUDGET_MS * 100).toFixed(0)}% of ceiling`);

if (process.argv.includes('--check') && median > COLD_BOOTSTRAP_BUDGET_MS) {
    console.error('\nCold bootstrap exceeds the section 13.3 budget.');
    process.exit(1);
}
