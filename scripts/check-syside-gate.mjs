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
const result = spawnSync(executable, ['check', ...sourceRoots], { cwd: memoRoot, stdio: 'inherit' });
if (result.error) {
    console.error(`✖ SysIDE gate could not start ${executable}: ${result.error.message}`);
    process.exit(1);
}
if (result.status !== 0) {
    console.error(`✖ SysIDE gate failed (exit ${result.status ?? 'unknown'}).`);
    process.exit(result.status ?? 1);
}

console.log('✔ SysIDE gate: ontology and extensions resolve cleanly.');
