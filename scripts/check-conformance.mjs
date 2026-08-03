#!/usr/bin/env node
// ─── Conformance regression gate ──────────────────────────────────────────────
//
// Re-runs both conformance sweeps and fails on any count that moved against the
// frozen baselines in `corpus/baselines/`.
//
//   node scripts/check-conformance.mjs
//
// Kept out of `pnpm test` on purpose. The unit suite runs on every save and
// this reads 150 MB of vendored corpus; it belongs in CI beside
// `check:baselines`, not in the loop a developer is in. It also needs the built
// CLI, which the test suite does not.
//
// A moved count is a failure whether it went up or down — see
// `conformance/baseline.ts` for why improvement has to be re-frozen
// deliberately rather than accepted silently.
// ─────────────────────────────────────────────────────────────────────────────

import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const toolsRoot = resolve(here, '..');
const cli = resolve(toolsRoot, 'packages/tools/lib/bin/memo.js');

if (!existsSync(cli)) {
    console.error(`No built CLI at ${cli}. Run \`pnpm build\` first.`);
    process.exit(1);
}
if (!existsSync(resolve(toolsRoot, 'corpus/sysml-v2-release/manifest.json'))) {
    console.error('No vendored corpus. Run `node scripts/vendor-corpus.mjs`.');
    process.exit(1);
}

let failures = 0;
for (const args of [['conformance', 'run'], ['conformance', 'diff-xmi']]) {
    console.log(`\n── memo ${args.join(' ')} ──`);
    try {
        execFileSync('node', [cli, ...args, '--baseline'], { cwd: toolsRoot, stdio: 'inherit' });
    } catch {
        failures += 1;
    }
}

console.log(failures === 0
    ? '\nConformance matches both baselines.'
    : `\n${failures} conformance sweep(s) moved against their baseline.`);
process.exit(failures === 0 ? 0 : 1);
