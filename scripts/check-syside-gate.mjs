#!/usr/bin/env node
// ─── Compiler-of-record gate ────────────────────────────────────────────────
//
// MEMO's Langium grammar is intentionally not the authority on SysML
// conformance. A tools-suite pass therefore also requires SysIDE to resolve the
// ontology and every extension source. Keep this as a separate pre-test command
// so a compiler failure stops the same `pnpm test` invocation agents use.
// ─────────────────────────────────────────────────────────────────────────────

import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

const toolsRoot = resolve(import.meta.dirname, '..');
const memoRoot = resolve(toolsRoot, '../memo');
// SCOPE: the ontology and the extensions — NOT `memo/examples`, which is shipped
// to users by `memo init --example` and does not currently pass SysIDE. That gap
// is epic R8 in memo-meta/plans; `examples` joins this list in R8-S4, and this
// comment goes with it. Anything checked by neither gate is a place a red build
// can hide behind a green suite, which is the gap R0 existed to close.
const sourceRoots = ['src', 'extensions'];
const executable = process.env.SYSIDE_EXECUTABLE || 'syside';

for (const sourceRoot of sourceRoots) {
    if (!existsSync(resolve(memoRoot, sourceRoot))) {
        console.error(`✖ SysIDE gate cannot find ontology source root: ${resolve(memoRoot, sourceRoot)}`);
        process.exit(1);
    }
}

// Run from the ontology root, exactly as `memo/scripts/build-kpar.sh` does.
// Besides preserving project-relative import resolution, this lets SysIDE read
// MEMO's checked-in configuration rather than treating the source roots as two
// unrelated ad-hoc projects.
// `pipe` rather than `inherit` so a licence failure can be told apart from a
// model failure. SysIDE's output is replayed either way, so nothing is hidden.
const result = spawnSync(executable, ['check', ...sourceRoots], {
    cwd: memoRoot,
    encoding: 'utf8',
});
if (result.error) {
    console.error(`✖ SysIDE gate could not start ${executable}: ${result.error.message}`);
    process.exit(1);
}
if (result.stdout) process.stdout.write(result.stdout);
if (result.stderr) process.stderr.write(result.stderr);

if (result.status !== 0) {
    // An agent with no keyring — a sandbox, container, or CI runner — reaches
    // this with a licence error rather than a model error. Saying so is the
    // difference between a one-time provisioning step and a debugging session
    // spent looking for a defect in the ontology.
    if (/[Ll]icense check failed|[Ff]ailed to load license key/.test(result.stderr + result.stdout)) {
        console.error(
            '\n✖ SysIDE gate: no licence, so the ontology was never checked.\n' +
            '  This is an environment gap, not a model error — SysIDE reads its licence\n' +
            '  from the system keyring, which a sandbox or CI runner does not have.\n' +
            '  Fix: set SYSIDE_LICENSE_KEY_FILE (preferred) or SYSIDE_LICENSE_KEY.\n' +
            '  See "The SysIDE licence" in AGENTS.md. Do NOT skip or stub this gate.',
        );
        process.exit(result.status ?? 1);
    }
    console.error(`✖ SysIDE gate failed (exit ${result.status ?? 'unknown'}).`);
    process.exit(result.status ?? 1);
}

console.log('✔ SysIDE gate: ontology and extensions resolve cleanly.');
