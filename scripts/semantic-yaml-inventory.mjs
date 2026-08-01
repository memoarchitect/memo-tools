#!/usr/bin/env node
// ─── Semantic YAML/JSON field inventory ───────────────────────────────────────
//
// Session 1 deliverable 9: enumerate every configuration field that currently
// reaches a semantic code path, so session 3 has a definitive worklist rather
// than a search-and-hope.
//
//   node scripts/semantic-yaml-inventory.mjs            # report
//   node scripts/semantic-yaml-inventory.mjs --check    # fail if the set grew
//
// `--check` is the CI mode. It does not require the count to be zero — session
// 1 removes no semantic YAML. It requires the set not to GROW, so that no new
// semantic field is added to YAML between now and the session-3 cutover, which
// is the failure this guard exists to prevent.
// ─────────────────────────────────────────────────────────────────────────────

import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { resolve, dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';

const here = dirname(fileURLToPath(import.meta.url));
const toolsRoot = resolve(here, '..');
const metaRoot = resolve(toolsRoot, '..');
const snapshotPath = resolve(toolsRoot, 'packages/tools/src/__tests__/fixtures/semantic-yaml-inventory.json');

/**
 * Fields that change the engineering model, per design section 5.1.
 *
 * Everything else in a manifest is an application setting (section 5.3) and
 * legitimately survives the cutover, so the inventory would be noise if it
 * listed them.
 */
const SEMANTIC_FIELDS = new Set([
    'methodology', 'extends', 'ontologies', 'modules', 'optionalModules',
    'sysmlDir', 'type', 'usage', 'projectType',
]);

/** Config files that carry semantics today, by filename. */
const SEMANTIC_FILES = [
    'memo.config.yaml', 'memo.config.yml',
    'memo.package.yaml', 'memo.package.yml',
    'memo.rendering.yaml', 'memo.rules.yaml', 'memo.viewpoints.yaml',
];

const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'lib', 'site', '.venv', 'output', '__pycache__']);

function walk(dir, out = []) {
    let entries;
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return out; }
    for (const entry of entries) {
        if (entry.isDirectory()) {
            if (SKIP_DIRS.has(entry.name)) continue;
            walk(join(dir, entry.name), out);
        } else if (SEMANTIC_FILES.includes(entry.name)) {
            out.push(join(dir, entry.name));
        }
    }
    return out;
}

function inventory() {
    const findings = [];
    for (const file of walk(metaRoot)) {
        let doc;
        try { doc = parseYaml(readFileSync(file, 'utf-8')); } catch { continue; }
        const rel = relative(metaRoot, file);
        if (rel.startsWith('..')) continue;

        // memo.rendering.yaml carries semantics in whole sections rather than
        // top-level scalars, so it is reported at section granularity.
        if (file.endsWith('memo.rendering.yaml')) {
            for (const section of ['layers', 'explorer', 'viewpoints', 'kinds']) {
                if (doc && typeof doc === 'object' && doc[section] !== undefined) {
                    findings.push({ file: rel, field: section, kind: 'rendering-section' });
                }
            }
            continue;
        }
        if (!doc || typeof doc !== 'object' || Array.isArray(doc)) continue;
        for (const field of Object.keys(doc)) {
            if (SEMANTIC_FIELDS.has(field)) {
                findings.push({ file: rel, field, kind: 'manifest-field' });
            }
        }
    }
    findings.sort((a, b) => `${a.file}|${a.field}`.localeCompare(`${b.file}|${b.field}`));
    return findings;
}

const findings = inventory();
const byField = {};
for (const f of findings) (byField[f.field] ??= []).push(f.file);

const check = process.argv.includes('--check');

if (!check) {
    console.log(`Semantic configuration fields reachable from a semantic code path\n`);
    for (const [field, files] of Object.entries(byField).sort()) {
        console.log(`  ${field.padEnd(16)} ${files.length} file(s)`);
    }
    console.log(`\n  TOTAL ${findings.length} occurrences across ${new Set(findings.map(f => f.file)).size} files`);
    console.log(`\nThis is the session-3 deletion worklist. Session 1 removes none of it.`);
    writeFileSync(snapshotPath, JSON.stringify({ capturedAt: 'session-1', findings }, null, 2) + '\n');
    console.log(`\nSnapshot written to ${relative(toolsRoot, snapshotPath)}`);
    process.exit(0);
}

if (!existsSync(snapshotPath)) {
    console.error('No inventory snapshot. Run without --check first.');
    process.exit(1);
}
const baseline = JSON.parse(readFileSync(snapshotPath, 'utf-8')).findings;
const key = f => `${f.file}|${f.field}`;
const known = new Set(baseline.map(key));
const added = findings.filter(f => !known.has(key(f)));

if (added.length > 0) {
    console.error('New semantic configuration fields appeared since the session-1 inventory:\n');
    for (const f of added) console.error(`  ${f.file}: ${f.field}`);
    console.error('\nSemantic meaning belongs in SysML (design section 5.1). If this is');
    console.error('deliberate, state why and re-snapshot; do not silently widen the surface.');
    process.exit(1);
}
const removed = baseline.filter(f => !new Set(findings.map(key)).has(key(f)));
console.log(`Semantic YAML inventory: ${findings.length} occurrences, none added since session 1.`);
if (removed.length > 0) console.log(`${removed.length} removed (expected as the cutover progresses).`);
process.exit(0);
