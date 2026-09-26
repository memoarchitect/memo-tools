#!/usr/bin/env node
// ─── SysIDE compatibility gate ──────────────────────────────────────────────
//
// The OMG SysML v2 specification is the authority on SysML, and neither MEMO's
// Langium grammar nor SysIDE is. A tools-suite pass also requires SysIDE — the
// compatibility check — to accept the ontology, the extensions and the
// examples, less the gaps `memo/validator-exceptions.json` lists. Keep this as a separate pre-test command
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

// The grammar parity corpus (`packages/tools/src/__tests__/fixtures/grammar-parity`)
// is written to the OMG SysML v2 specification, which is what defines it as
// valid — the `unsupported/` fixtures included. SysIDE checks it for
// compatibility. A fixture SysIDE rejects but the specification admits is a
// SysIDE gap to board, not a fixture to rewrite: list that diagnostic in the
// corpus's own `validator-exceptions.json` and keep the specification's form.
const parityRoot = resolve(toolsRoot, 'packages/tools/src/__tests__/fixtures/grammar-parity');
const parityRoots = ['supported', 'unsupported'];

for (const sourceRoot of sourceRoots) {
    if (!existsSync(resolve(memoRoot, sourceRoot))) {
        console.error(`✖ SysIDE gate cannot find ontology source root: ${resolve(memoRoot, sourceRoot)}`);
        process.exit(1);
    }
}

// Through `memo toolchain check`, never a spawned tool: the validator is
// memo-tools' selected provider — SysIDE unless MEMO_VALIDATOR names another —
// so this gate, memo's build and its portability check all run the same
// engine with the same `validator-exceptions.json`, and switching engines is
// one variable. SYSIDE_EXECUTABLE still reaches the SysIDE provider, which is
// how the gate's own test substitutes a failing binary.
//
// The CLI is the compiled one, so this gate checks what `pnpm build` last
// produced. It refuses to run without a build rather than skip.
const cli = resolve(toolsRoot, 'packages/tools/lib/bin/memo.js');
const validator = process.env.MEMO_VALIDATOR || 'syside';
if (!existsSync(cli)) {
    console.error(`✖ SysIDE gate: ${cli} is not built. Run \`pnpm build\` first; the gate does not skip.`);
    process.exit(1);
}

function check(project, roots) {
    const args = [cli, 'toolchain', 'check', '--project', project, `--toolchain.validator=${validator}`];
    if (process.env.SYSIDE_EXECUTABLE) args.push(`--toolchain.syside.executable=${process.env.SYSIDE_EXECUTABLE}`);
    const result = spawnSync(process.execPath, [...args, ...roots], { stdio: 'inherit' });
    if (result.status !== 0) {
        console.error(
            `✖ SysIDE gate failed in ${project} (exit ${result.status ?? 'unknown'}). `
            + 'A licence error is environment setup — see "The SysIDE licence" in AGENTS.md; do not skip the gate.');
        process.exit(result.status ?? 1);
    }
}

check(memoRoot, sourceRoots);
check(parityRoot, parityRoots);

console.log('✔ SysIDE gate: ontology, extensions, examples, and the grammar parity corpus resolve cleanly.');
