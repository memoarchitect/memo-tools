#!/usr/bin/env node
// ─── Session-1 baseline capture ───────────────────────────────────────────────
//
// Freezes the effective model output of the four reference projects so that
// sessions 1-4 can prove they changed nothing they did not intend to.
//
// The design (section 18.1, deliverable 8) calls these the regression oracle.
// They are captured from a pristine tree BEFORE any session-1 change lands;
// `verify-baseline.mjs` re-runs the same extraction and diffs against them.
//
// What is captured is the *semantic* result — kinds, elements, relationships,
// rules, views, violations — not the DTO verbatim. Session 1 deliberately ADDS
// provenance fields to those DTOs, so a byte-for-byte DTO comparison would
// fail by design. The projection below is the part that must not move.
// ─────────────────────────────────────────────────────────────────────────────

import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const toolsRoot = resolve(here, '..');
const metaRoot = resolve(toolsRoot, '..');
const memoRoot = resolve(metaRoot, 'memo');
const cli = resolve(toolsRoot, 'packages/tools/lib/bin/memo.js');
const outDir = resolve(toolsRoot, 'packages/tools/src/__tests__/fixtures/baseline-s1');

/**
 * The four reference projects named in design section 18.1.
 *
 * `default` is materialized with `memo init` rather than read from
 * `templates/default`, because the template still carries `{{name}}`
 * placeholders and is not itself a loadable project.
 */
export const FIXTURES = [
    { id: 'gpca', dir: resolve(memoRoot, 'examples/gpca-pump') },
    { id: 'ui-regions', dir: resolve(memoRoot, 'examples/ui-screen-regions') },
    { id: 'default', init: true },
    { id: 'extension-clinical', dir: resolve(memoRoot, 'examples/extensions/clinical') },
];

/**
 * Materialize a fresh default project so the baseline covers `memo init` output.
 *
 * BASELINE RE-FROZEN 2026-08-01 (deliberate, one fixture).
 *
 * The first capture recorded `validation: null` here: `memo init` resolves the
 * published @memoarchitect/ontology (0.6.4), 16 of whose rules carry
 * predicateExpressions the constraint parser cannot compile, and a single
 * failure threw out of collectNativeConstraints and killed the whole command.
 * `memo validate` therefore crashed on a freshly initialized project.
 *
 * Session 1 made rule loading resilient: a rule that fails to compile is
 * skipped and reported loudly instead of being fatal. This fixture now
 * validates and produces 24 violations, so its baseline was re-frozen. The
 * other three fixtures are unchanged.
 *
 * The underlying content defect is NOT fixed here — it is fixed in the
 * unreleased local ontology 0.6.5 and needs a release. Against 0.6.5 all 32
 * rules load; against published 0.6.4, 16 do not.
 */
export function materializeDefault() {
    const dir = resolve(tmpdir(), 'memo-baseline-default-project');
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(dir, { recursive: true });
    execFileSync('node', [cli, 'init', 'baseline-default'], {
        cwd: dir, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'],
    });
    return resolve(dir, 'baseline-default');
}

function run(args, cwd) {
    return execFileSync('node', [cli, ...args], {
        cwd,
        encoding: 'utf-8',
        maxBuffer: 256 * 1024 * 1024,
        stdio: ['ignore', 'pipe', 'pipe'],
    });
}

/**
 * Reduce a model DTO to the facts that must survive every session.
 *
 * Sorted throughout: the baseline must be stable against map iteration order,
 * which is not part of the contract and would otherwise produce phantom diffs.
 */
export function projectModel(model) {
    const elements = Object.values(model.elements ?? {});
    const relationships = Object.values(model.relationships ?? {});
    return {
        elements: elements
            .map(e => ({ id: e.id, kind: e.kind, construct: e.construct, layer: e.layer, package: e.package ?? null }))
            .sort((a, b) => a.id.localeCompare(b.id)),
        relationships: relationships
            .map(r => ({ type: r.type, sourceId: r.sourceId, targetId: r.targetId }))
            .sort((a, b) => `${a.type}|${a.sourceId}|${a.targetId}`.localeCompare(`${b.type}|${b.sourceId}|${b.targetId}`)),
        kindCounts: countBy(elements, e => e.kind),
        layerCounts: countBy(elements, e => e.layer),
        diagrams: (model.diagrams ?? []).map(d => d.id).sort(),
    };
}

export function projectValidation(report) {
    const violations = report.violations ?? report.results ?? [];
    return {
        violations: violations
            .map(v => ({ rule: v.ruleId ?? v.rule ?? null, severity: v.severity ?? null, elementId: v.elementId ?? null }))
            .sort((a, b) => `${a.rule}|${a.elementId}`.localeCompare(`${b.rule}|${b.elementId}`)),
        counts: countBy(violations, v => v.severity ?? 'unknown'),
    };
}

/**
 * Reduce an error to a machine-stable one-liner.
 *
 * Absolute paths, line numbers, and stack frames differ per machine and per
 * build; keeping them would make the baseline unusable as a diff target.
 */
function normalizeError(error) {
    const text = [error?.stderr?.toString(), error?.stdout?.toString(), error?.message, String(error)]
        .filter(Boolean).join('\n');
    const line = text.split('\n').find(l => /^\s*Error:/.test(l)) ?? text.split('\n')[0] ?? '';
    return line.replace(/\/[^\s"']*\//g, '<path>/').trim().slice(0, 300);
}

function countBy(items, key) {
    const out = {};
    for (const item of items) {
        const k = key(item) ?? 'unknown';
        out[k] = (out[k] ?? 0) + 1;
    }
    return Object.fromEntries(Object.entries(out).sort(([a], [b]) => a.localeCompare(b)));
}

export function capture(fixture) {
    const result = { id: fixture.id, model: null, validation: null, errors: [] };
    // `memo export json` only writes to a file, so route it through a scratch
    // path rather than stdout.
    const scratch = resolve(tmpdir(), `memo-baseline-${fixture.id}.json`);
    try {
        run(['export', 'json', '--output', scratch], fixture.dir);
        const exported = JSON.parse(readFileSync(scratch, 'utf-8'));
        result.model = projectModel(exported.model ?? exported);
        result.summary = {
            elements: Object.keys(exported.model?.elements ?? {}).length,
            completeness: exported.completeness?.overall ?? null,
        };
    } catch (error) {
        result.errors.push(`model: ${String(error.message ?? error).slice(0, 400)}`);
    } finally {
        if (existsSync(scratch)) rmSync(scratch, { force: true });
    }
    // `memo validate` prints a banner before the JSON and exits non-zero when
    // violations exist, so route the report to a file and ignore the exit code.
    const report = resolve(tmpdir(), `memo-baseline-${fixture.id}-validation.json`);
    let runFailure;
    try {
        try {
            run(['validate', '--format', 'json', '--output', report], fixture.dir);
        } catch (error) {
            // A non-zero exit is normal when violations exist and the report is
            // still written. Keep the failure only in case it is not.
            runFailure = error;
        }
        if (!existsSync(report) && runFailure) throw runFailure;
        result.validation = projectValidation(JSON.parse(readFileSync(report, 'utf-8')));
    } catch (error) {
        // Normalize: raw messages carry absolute paths and stack frames, which
        // would make the baseline diff against itself on another machine.
        result.errors.push(`validation: ${normalizeError(error)}`);
    } finally {
        if (existsSync(report)) rmSync(report, { force: true });
    }
    return result;
}

if (import.meta.url === `file://${process.argv[1]}`) {
    if (!existsSync(cli)) {
        console.error(`CLI not built: ${cli}\nRun: pnpm build`);
        process.exit(1);
    }
    mkdirSync(outDir, { recursive: true });
    for (const spec of FIXTURES) {
        const fixture = spec.init ? { ...spec, dir: materializeDefault() } : spec;
        if (!existsSync(fixture.dir)) {
            console.error(`SKIP ${fixture.id}: ${fixture.dir} does not exist`);
            continue;
        }
        const result = capture(fixture);
        writeFileSync(resolve(outDir, `${fixture.id}.json`), JSON.stringify(result, null, 2) + '\n');
        const elements = result.model?.elements.length ?? 'ERR';
        const violations = result.validation?.violations.length ?? 'ERR';
        console.log(`${fixture.id}: ${elements} elements, ${violations} violations${result.errors.length ? ` [${result.errors.length} errors]` : ''}`);
        for (const error of result.errors) console.log(`    ${error}`);
    }
    console.log(`\nBaselines written to ${outDir}`);
}
