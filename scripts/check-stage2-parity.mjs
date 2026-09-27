#!/usr/bin/env node
// ─── Stage 2 parity ──────────────────────────────────────────────────────────
//
// For each example: the MEMO graph MEMO's own compiler builds (`memo export
// json`) against the graph stage 2 builds from SysIDE's stage 1 handoff
// (`python/memo_stage1_syside.py`), compared by scripts/diff-memo-graph.mjs.
// This is milestone 2's acceptance check (plans/memo-compiler-stages-opensysml.md).
//
// Needs a built package (`pnpm build`) and a Python with SysIDE's licensed API:
// MEMO_SYSIDE_PYTHON names it (default `python3`).
//
// Usage: node scripts/check-stage2-parity.mjs [--elements-only] [example …]
// With no example named, every directory under memo/examples is checked.
// ─────────────────────────────────────────────────────────────────────────────

import { mkdtempSync, readdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const toolsRoot = resolve(import.meta.dirname, '..');
const memoRoot = resolve(toolsRoot, '../memo');
const lib = join(toolsRoot, 'packages/tools/lib');
const python = process.env.MEMO_SYSIDE_PYTHON ?? 'python3';

const args = process.argv.slice(2);
const elementsOnly = args.includes('--elements-only');
const named = args.filter(a => !a.startsWith('--'));
const examples = named.length ? named : readdirSync(join(memoRoot, 'examples'), { withFileTypes: true })
    .filter(d => d.isDirectory()).map(d => d.name).sort();

const { ApiModel, buildElementsFromApi, loadOntologyRegistries } = await import(join(lib, 'index.js'));
const work = mkdtempSync(join(tmpdir(), 'memo-stage2-parity-'));
let failures = 0;

for (const example of examples) {
    const root = join(memoRoot, 'examples', example);
    if (!existsSync(join(root, 'memo.package.yaml'))) continue;
    const baseline = join(work, `${example}.baseline.json`);
    const stage1 = join(work, `${example}.stage1.json`);
    const candidate = join(work, `${example}.candidate.json`);

    const exported = spawnSync('node', [join(lib, 'bin/memo.js'), 'export', 'json', '-o', baseline], { cwd: root, encoding: 'utf8' });
    if (exported.status !== 0) { console.log(`✘ ${example}: memo export json failed\n${exported.stderr}`); failures++; continue; }

    const handoff = spawnSync(python, [join(toolsRoot, 'packages/tools/python/memo_stage1_syside.py'),
        '--library', join(memoRoot, 'src'), '--library', join(memoRoot, 'extensions'), '--out', stage1, root], { encoding: 'utf8' });
    if (handoff.status !== 0) { console.log(`✘ ${example}: stage 1 reported errors\n${handoff.stderr.slice(0, 2000)}`); failures++; continue; }

    const api = new ApiModel(JSON.parse(readFileSync(stage1, 'utf8')));
    const { registries } = await loadOntologyRegistries(root);
    const { elements } = buildElementsFromApi(api, registries);
    writeFileSync(candidate, JSON.stringify({ model: { elements: Object.fromEntries(elements), relationships: [] }, validation: { violations: [] } }));

    const diff = spawnSync('node', [join(toolsRoot, 'scripts/diff-memo-graph.mjs'), baseline, candidate, '--limit', '8',
        '--by-meaning', ...(elementsOnly ? ['--elements-only'] : [])], { encoding: 'utf8' });
    if (diff.status === 0) console.log(`✔ ${example}`);
    else { console.log(`✘ ${example}\n${diff.stdout.replace(/^/gm, '    ')}`); failures++; }
}
console.log(failures ? `${failures} of ${examples.length} differ (work files in ${work})` : `all ${examples.length} equal`);
process.exit(failures ? 1 : 0);
