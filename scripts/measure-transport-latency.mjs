#!/usr/bin/env node
// ─── Transport latency: in-process vs. spawned memo-sysmlc ───────────────────
//
// §2.1's last exit test: measure live-refresh latency for a single-file edit
// before and after, and if the process transport misses the refresh budget,
// record that and keep in-process as the default until it does not.
//
//   node scripts/measure-transport-latency.mjs
//
// The budget is not invented here. `incrementalProjectRebuild: 500ms` is the
// existing section 13.3 ceiling for save-to-published-revision, and that is the
// number a transport has to live inside.
//
// What is measured, and what each number is worth:
//
//   incrementalProjectRebuild  the path live refresh actually uses today —
//                              IncrementalProjectParser reparsing one changed
//                              file with the rest of the closure warm. It does
//                              not go through the toolchain at all, so this
//                              session did not change it. Measured as the
//                              reference the other two are read against.
//   lowering / in-process      a full `lowerProject` in this process, warm.
//   lowering / process         the same work over a spawned `memo-sysmlc serve
//                              --stdio`, server already running. Spawn and
//                              handshake are excluded on purpose: they happen
//                              once, and charging them to every refresh would
//                              measure a design nobody proposed.
//
// The honest caveat, stated because the plan's exit test assumes otherwise:
// Architect's live refresh does not call the lowering provider today
// (`commands/dev.ts` builds the model directly). So the two lowering numbers
// are what a refresh *would* cost if it were routed through the provider, not
// a before/after of the running product.
// ─────────────────────────────────────────────────────────────────────────────

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const toolsRoot = resolve(here, '..');
const lib = resolve(toolsRoot, 'packages/tools/lib');
const gpca = resolve(toolsRoot, '../memo/examples/gpca-pump');

if (!existsSync(lib)) {
    console.error('Not built. Run: pnpm build');
    process.exit(1);
}
if (!existsSync(gpca)) {
    console.error(`GPCA example not found at ${gpca}`);
    process.exit(1);
}

const { RUNTIME_BUDGET_MS } = await import(resolve(lib, 'server/runtime-budget.js'));
const { IncrementalProjectParser } = await import(resolve(lib, 'model/parser-utils.js'));
const { findSysmlFiles } = await import(resolve(lib, 'model/sysml-files.js'));
const { loadProjectConfig } = await import(resolve(lib, 'toolchain/lowering.js'));
const { runLowering } = await import(resolve(lib, 'toolchain/operations.js'));
const { disposeSysmlcClients } = await import(resolve(lib, 'toolchain/sysmlc-client.js'));

const RUNS = 5;
const BUDGET = RUNTIME_BUDGET_MS.incrementalProjectRebuild;
const median = xs => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];

const files = findSysmlFiles(gpca);
const target = files.find(f => f.endsWith('gpca_risk.sysml')) ?? files[0];
const original = readFileSync(target, 'utf-8');
const relative = target.slice(gpca.length + 1);

/** Every sample follows one edit, because that is what a refresh follows. */
async function sample(run) {
    const samples = [];
    for (let i = 0; i < RUNS; i++) {
        writeFileSync(target, `${original}\n// transport probe ${i}\n`);
        const start = process.hrtime.bigint();
        await run(i);
        samples.push(Number(process.hrtime.bigint() - start) / 1e6);
    }
    return samples;
}

const config = loadProjectConfig(gpca);
const withTransport = transport => ({
    ...config,
    toolchain: { ...config.toolchain, internal: { transport } },
});

const measured = [];
try {
    const parser = new IncrementalProjectParser(gpca);
    await parser.parse(files);
    measured.push(['incrementalProjectRebuild', await sample(() => parser.parse(files, [relative]))]);

    const inProcess = withTransport('in-process');
    await runLowering({ config: inProcess, projectDir: gpca });
    measured.push(['lowering / in-process', await sample(
        () => runLowering({ config: inProcess, projectDir: gpca }))]);

    const spawned = withTransport('process');
    const coldStart = process.hrtime.bigint();
    await runLowering({ config: spawned, projectDir: gpca });
    const cold = Number(process.hrtime.bigint() - coldStart) / 1e6;
    measured.push(['lowering / process', await sample(
        () => runLowering({ config: spawned, projectDir: gpca }))]);

    console.log(`Transport latency — GPCA, one-file edit, median of ${RUNS}`);
    console.log(`Refresh budget: ${BUDGET}ms (section 13.3 incrementalProjectRebuild)\n`);
    for (const [name, samples] of measured) {
        const value = median(samples);
        console.log(`  ${value <= BUDGET ? 'OK  ' : 'OVER'} ${name}`);
        console.log(`         samples: ${samples.map(s => `${s.toFixed(0)}ms`).join(', ')}`);
        console.log(`         median:  ${value.toFixed(0)}ms `
            + `(${(value / BUDGET * 100).toFixed(0)}% of budget)`);
    }
    const [, inProcessSamples] = measured[1];
    const [, processSamples] = measured[2];
    const overhead = median(processSamples) - median(inProcessSamples);
    console.log(`\n  process-transport overhead per refresh: ${overhead.toFixed(0)}ms`);
    console.log(`  first request, including spawn and handshake: ${cold.toFixed(0)}ms`);
} finally {
    writeFileSync(target, original);
    await disposeSysmlcClients();
}
