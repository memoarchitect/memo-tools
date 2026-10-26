#!/usr/bin/env node
// ─── Section 13.3 runtime budget gate ─────────────────────────────────────────
//
// Measures the design's runtime ceilings on GPCA and FAILS when one is
// exceeded. Section 13.3 calls restart cost "a first-class non-functional
// requirement", and section 18.4 deliverable 9 asks for the budgets "enforced
// in CI as a gate, not a report" — so this exits non-zero rather than printing
// a number for someone to notice.
//
//   node scripts/runtime-budgets.mjs            # measure and gate
//   node scripts/runtime-budgets.mjs --report   # measure without failing
//
// What is measured, and what that measurement is worth:
//
//   coldBootstrap             a real `memo-architect export json` over GPCA. It resolves
//                             the import closure, parses every ontology and
//                             project file, builds the registries and the
//                             model — exactly what a runtime restart redoes.
//                             Includes node startup, so it over-reports.
//   incrementalProjectRebuild a real edit to one GPCA catalog file, recompiled
//                             through the OpenSysML provider with the rest of
//                             the closure warm — the save-to-revision path.
//                             Run on a copy of GPCA, so the checkout is never
//                             edited. Needs OPENSYSML_BINARY.
//
// `supervisedRestart` is deliberately NOT simulated here. It is a process
// teardown plus the cold-bootstrap path, and inventing a number for it would
// report a measurement nothing performed. The live runtime measures it against
// the same ceiling in `dev.ts`, which is where the real event happens.
// ─────────────────────────────────────────────────────────────────────────────

import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const toolsRoot = resolve(here, '..');
const cli = resolve(toolsRoot, 'scripts/project-cli.mjs');   // the project commands: memo-architect's, `memo` only compiles and validates
const gpca = resolve(toolsRoot, '../memo/examples/gpca-pump');

const report = process.argv.includes('--report');
const RUNS = 3;

if (!existsSync(cli)) {
    console.error('CLI not built. Run: pnpm build');
    process.exit(1);
}
if (!existsSync(gpca)) {
    console.error(`GPCA example not found at ${gpca}`);
    process.exit(1);
}

const { RUNTIME_BUDGET_MS } = await import(
    resolve(toolsRoot, 'packages/tools/lib/server/runtime-budget.js')
);
const { findSysmlFiles } = await import(
    resolve(toolsRoot, 'packages/tools/lib/model/sysml-files.js')
);
const { discoverProjectSources } = await import(
    resolve(toolsRoot, 'packages/tools/lib/model/native-project.js')
);
const { compileWithOpenSysML } = await import(
    resolve(toolsRoot, 'packages/tools/lib/toolchain/providers/opensysml-lowering.js')
);

if (!process.env.OPENSYSML_BINARY) {
    console.error('OPENSYSML_BINARY is not set: the incremental rebuild is measured through OpenSysML.');
    process.exit(1);
}

const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];

// ── coldBootstrap ────────────────────────────────────────────────────────────
function measureColdBootstrap() {
    const samples = [];
    for (let i = 0; i < RUNS; i++) {
        const out = resolve(tmpdir(), `memo-budget-${i}.json`);
        const start = process.hrtime.bigint();
        execFileSync('node', [cli, 'export', 'json', '--output', out], {
            cwd: gpca, stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 256 * 1024 * 1024,
        });
        samples.push(Number(process.hrtime.bigint() - start) / 1e6);
        rmSync(out, { force: true });
    }
    return samples;
}

// ── incrementalProjectRebuild ────────────────────────────────────────────────
// One file changes; everything else stays warm. That is the save-to-published-
// revision path, and the only one with a sub-second ceiling.
async function measureIncrementalRebuild() {
    const root = mkdtempSync(join(tmpdir(), 'memo-budget-gpca-'));
    cpSync(gpca, root, { recursive: true, filter: source => !/[\\/](\.memo|\.venv|node_modules)([\\/]|$)/.test(source) });
    try {
        const sources = discoverProjectSources(root);
        const options = {
            config: { modelName: 'x', toolchain: { compiler: 'opensysml', opensysml: { binary: process.env.OPENSYSML_BINARY } } },
            projectDir: root,
            libraryDirs: [...new Set(sources.libraryRoots.map(r => r.sysmlDir))],
            projectFiles: new Set(sources.projectFiles.map(file => relative(root, file))),
            resolveProject: true,
            cacheDir: join(root, '.memo', 'stage1'),
            force: true,
        };
        const files = findSysmlFiles(root);
        const target = files.find(f => f.endsWith('gpca_risk.sysml')) ?? files[0];
        const original = readFileSync(target, 'utf-8');
        const compile = async () => {
            const result = await compileWithOpenSysML(options);
            if (!result.accepted) throw new Error('GPCA did not compile; the budget cannot be measured.');
        };

        await compile();   // warm the closure — not measured
        // The service reports an edit narrow only once it has seen the documents twice, so two unmeasured edits first.
        for (let i = 0; i < 2; i++) { writeFileSync(target, `${original}\n// budget warm-up ${i}\n`); await compile(); }

        const samples = [];
        for (let i = 0; i < RUNS; i++) {
            writeFileSync(target, `${original}\n// budget probe ${i}\n`);
            const start = process.hrtime.bigint();
            await compile();
            samples.push(Number(process.hrtime.bigint() - start) / 1e6);
        }
        return samples;
    } finally {
        rmSync(root, { recursive: true, force: true });
    }
}

const measured = [
    ['coldBootstrap', measureColdBootstrap()],
    ['incrementalProjectRebuild', await measureIncrementalRebuild()],
];

let failures = 0;
console.log(`Section 13.3 runtime budgets — GPCA, median of ${RUNS}\n`);
for (const [path, samples] of measured) {
    const value = median(samples);
    const budget = RUNTIME_BUDGET_MS[path];
    const ok = value <= budget;
    if (!ok) failures++;
    console.log(`  ${ok ? 'OK  ' : 'FAIL'} ${path}`);
    console.log(`         samples: ${samples.map(s => `${s.toFixed(0)}ms`).join(', ')}`);
    console.log(`         median:  ${value.toFixed(0)}ms / ${budget}ms `
        + `(${(value / budget * 100).toFixed(0)}% of ceiling)`);
}
console.log(`\n  note  supervisedRestart (${RUNTIME_BUDGET_MS.supervisedRestart}ms) is measured by the `
    + 'live runtime in dev.ts,\n        where the restart actually happens; it is not simulated here.');

if (failures > 0 && !report) {
    console.error(`\n${failures} budget(s) exceeded — design section 13.3 ceilings are a gate.`);
    process.exit(1);
}
console.log(failures === 0 ? '\nAll measured budgets within ceiling.' : '\n(report mode — not failing)');
