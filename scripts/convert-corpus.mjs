#!/usr/bin/env node
// ─── Corpus conversion ────────────────────────────────────────────────────────
//
// Runs `memo-architect convert` over every shipped example and template (design section
// 18.4, half A deliverable 2) and proves the conversion changed structure only.
//
//   node scripts/convert-corpus.mjs            # report the plan for each project
//   node scripts/convert-corpus.mjs --write    # convert, verifying each project
//
// The verification is the point. For every project that loads, the script
// exports the semantic model BEFORE conversion, converts, exports again, and
// compares the two. A restructuring that changes an element, a relationship, or
// a kind count has done something other than restructure, and the script fails
// rather than reporting it.
//
// Projects that do not load before conversion (templates carry `{{name}}`
// placeholders; extension packages are not projects and have no binding) are
// converted without the before/after comparison, and say so.
// ─────────────────────────────────────────────────────────────────────────────

import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const toolsRoot = resolve(here, '..');
const memoRoot = resolve(toolsRoot, '../memo');
const cli = resolve(toolsRoot, 'scripts/project-cli.mjs');   // the project commands: memo-architect's, `memo` only compiles and validates

const write = process.argv.includes('--write');

/** Every shipped project directory, in a stable order. */
function corpus() {
    const out = [];
    // A project names its entrypoint in memo.package.yaml. A directory without one is a reusable package another
    // project depends on (`robot-platform`): converting it would rename the package under its dependents.
    const isProject = (dir) => /^entrypoint:/m.test(readFileSync(join(dir, 'memo.package.yaml'), 'utf-8'));
    const add = (dir) => { if (existsSync(join(dir, 'model')) && existsSync(join(dir, 'memo.package.yaml')) && isProject(dir)) out.push(dir); };
    for (const name of readdirSync(join(memoRoot, 'examples')).sort()) {
        const dir = join(memoRoot, 'examples', name);
        if (name === 'extensions') {
            for (const ext of readdirSync(dir).sort()) add(join(dir, ext));
        } else {
            add(dir);
        }
    }
    for (const name of readdirSync(join(memoRoot, 'templates')).sort()) {
        add(join(memoRoot, 'templates', name));
    }
    return out;
}

function plan(dir) {
    const stdout = execFileSync('node', [cli, 'convert', dir, '--normalize-names', '--json'], {
        encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024,
    });
    return JSON.parse(stdout);
}

/**
 * The semantic facts a restructuring must not move.
 *
 * Element and relationship IDs, their kinds, and the counts — but not the
 * package a thing was declared in, because renaming packages is precisely what
 * the conversion does. Comparing package names would fail by design and prove
 * nothing.
 */
function semanticProjection(dir) {
    const out = resolve(tmpdir(), `memo-corpus-${Math.random().toString(36).slice(2)}.json`);
    try {
        execFileSync('node', [cli, 'export', 'json', '--output', out], {
            cwd: dir, stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 256 * 1024 * 1024,
        });
    } catch {
        return null;   // project does not load — reported by the caller
    }
    if (!existsSync(out)) return null;
    let model;
    try { model = JSON.parse(readFileSync(out, 'utf-8')); }
    catch { return null; }
    finally { rmSync(out, { force: true }); }

    // `export json` nests the model under `model`, with elements keyed by qualified id. The projection is by
    // the LAST segment of an id, because the conversion renames packages and so changes every qualified id's prefix.
    const body = model.model ?? model;
    const leaf = id => String(id).split('::').pop();
    const entries = Object.entries(body.elements ?? {});
    if (entries.length === 0) throw new Error('the export holds no elements, so nothing could be compared');
    const elements = entries.map(([id, e]) => `${leaf(id)}:${e.kind}`).sort();
    const relationships = (body.relationships ?? [])
        .map(r => `${r.type}:${leaf(r.sourceId)}->${leaf(r.targetId)}`).sort();
    const kindCounts = {};
    for (const [, e] of entries) kindCounts[e.kind] = (kindCounts[e.kind] ?? 0) + 1;
    return { elements, relationships, kindCounts };
}

/** What is in `a` and not in `b`, counting repeats: the same leaf name can legitimately occur in two packages. */
function subtract(a, b) {
    const left = new Map();
    for (const x of b) left.set(x, (left.get(x) ?? 0) + 1);
    return a.filter(x => { const n = left.get(x) ?? 0; if (n > 0) { left.set(x, n - 1); return false; } return true; });
}

function compare(before, after) {
    const diffs = [];
    const missing = subtract(before.elements, after.elements);
    const added = subtract(after.elements, before.elements);
    if (missing.length) diffs.push(`elements lost: ${missing.slice(0, 8).join(', ')}${missing.length > 8 ? ` … +${missing.length - 8}` : ''}`);
    if (added.length) diffs.push(`elements gained: ${added.slice(0, 8).join(', ')}${added.length > 8 ? ` … +${added.length - 8}` : ''}`);

    const relMissing = subtract(before.relationships, after.relationships);
    const relAdded = subtract(after.relationships, before.relationships);
    if (relMissing.length) diffs.push(`relationships lost: ${relMissing.length}`);
    if (relAdded.length) diffs.push(`relationships gained: ${relAdded.length}`);
    return diffs;
}

let failures = 0;
let converted = 0;

for (const dir of corpus()) {
    const label = dir.slice(memoRoot.length + 1);
    let p;
    try { p = plan(dir); }
    catch (e) { console.error(`FAIL ${label} — planning threw: ${e.message}`); failures++; continue; }

    if (p.collisions.length > 0) {
        console.error(`FAIL ${label} — ${p.collisions.length} collision(s):`);
        for (const c of p.collisions) console.error(`       [${c.code}] ${c.message}`);
        failures++;
        continue;
    }

    const moves = p.changes.filter(c => c.from !== c.to).length;
    const rewrites = p.changes.filter(c => c.from === c.to).length;
    const summary =
        `${moves} moved, ${rewrites} rewritten, ${p.newFiles.length} created, ${p.removals.length} removed`;

    if (p.alreadyConverted) { console.log(`OK   ${label} — already native`); continue; }
    if (!write) { console.log(`PLAN ${label} — ${summary}`); continue; }

    const before = semanticProjection(dir);
    execFileSync('node', [cli, 'convert', dir, '--normalize-names', '--write'], {
        stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024,
    });
    converted++;

    if (!before) {
        console.log(`OK   ${label} — ${summary} (does not load standalone; not compared)`);
        continue;
    }
    const after = semanticProjection(dir);
    if (!after) {
        console.error(`FAIL ${label} — loaded before conversion, does not load after`);
        failures++;
        continue;
    }
    const diffs = compare(before, after);
    if (diffs.length === 0) {
        console.log(`OK   ${label} — ${summary}; ${before.elements.length} elements identical`);
    } else {
        console.error(`FAIL ${label} — conversion changed the model, not only its structure:`);
        for (const d of diffs) console.error(`       ${d}`);
        failures++;
    }
}

// Idempotence over the whole corpus, not only per project: a second pass must
// find nothing to do anywhere.
if (write && failures === 0) {
    const dirty = corpus().filter(dir => !plan(dir).alreadyConverted);
    if (dirty.length > 0) {
        console.error(`FAIL not idempotent — a second pass still wants to change: ${dirty.join(', ')}`);
        failures++;
    } else {
        console.log('\nSecond pass finds nothing to convert — the corpus is at a fixed point.');
    }
}

console.log(failures === 0
    ? `\n${write ? `${converted} project(s) converted. ` : ''}No failures.`
    : `\n${failures} project(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
