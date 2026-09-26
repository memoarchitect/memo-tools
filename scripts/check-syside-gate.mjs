#!/usr/bin/env node
// ─── SysIDE compatibility gate ──────────────────────────────────────────────
//
// The OMG SysML v2 specification is the authority on SysML, and neither MEMO's
// Langium grammar nor SysIDE is. A tools-suite pass also requires SysIDE — the
// compatibility check — to accept the ontology, the extensions and the
// examples, less the SysIDE gaps `memo/syside-exceptions.json` lists. Keep this as a separate pre-test command
// so a compiler failure stops the same `pnpm test` invocation agents use.
// ─────────────────────────────────────────────────────────────────────────────

import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

const toolsRoot = resolve(import.meta.dirname, '..');
const memoRoot = resolve(toolsRoot, '../memo');
// SCOPE: the ontology, the extensions, AND `memo/examples` — everything MEMO
// ships. `examples` is shipped to users by `memo init --example` and was
// checked by neither gate until R8-S4, which is how 733 SysIDE errors and two
// defects introduced by R0 and R1 themselves survived a green build and 1858
// green tests. Anything checked by neither gate is a place a red build can hide
// behind a green suite, which is the gap R0 existed to close.
const sourceRoots = ['src', 'extensions', 'examples'];
const executable = process.env.SYSIDE_EXECUTABLE || 'syside';

// The grammar parity corpus (`packages/tools/src/__tests__/fixtures/grammar-parity`)
// is written to the OMG SysML v2 specification, which is what defines it as
// valid — the `unsupported/` fixtures included. SysIDE checks it for
// compatibility. A fixture SysIDE rejects but the specification admits is a
// SysIDE gap to board, not a fixture to rewrite: list that diagnostic in the
// corpus's own `syside-exceptions.json` and keep the specification's form.
const parityRoot = resolve(toolsRoot, 'packages/tools/src/__tests__/fixtures/grammar-parity');
const parityRoots = ['supported', 'unsupported'];

for (const sourceRoot of sourceRoots) {
    if (!existsSync(resolve(memoRoot, sourceRoot))) {
        console.error(`✖ SysIDE gate cannot find ontology source root: ${resolve(memoRoot, sourceRoot)}`);
        process.exit(1);
    }
}

// One implementation of the check, in the ontology repo, so this gate and
// `memo/scripts/build-kpar.sh` except exactly the same SysIDE gaps. It runs
// `syside check --diagnose all --warnings-as-errors` and fails on any
// diagnostic its register does not list, and on any listed one that no longer
// occurs. Run from each root so SysIDE reads that tree's own configuration.
const sysideCheck = resolve(memoRoot, 'scripts/syside-check.mjs');

function check(cwd, roots) {
    const result = spawnSync(process.execPath, [sysideCheck, '--exceptions', 'syside-exceptions.json', ...roots], {
        cwd,
        stdio: 'inherit',
        env: { ...process.env, SYSIDE_EXECUTABLE: executable },
    });
    if (result.status !== 0) {
        console.error(`✖ SysIDE gate failed in ${cwd} (exit ${result.status ?? 'unknown'}). See "The SysIDE licence" in AGENTS.md if it is a licence error.`);
        process.exit(result.status ?? 1);
    }
}

check(memoRoot, sourceRoots);
check(parityRoot, parityRoots);

console.log('✔ SysIDE gate: ontology, extensions, examples, and the grammar parity corpus resolve cleanly.');
