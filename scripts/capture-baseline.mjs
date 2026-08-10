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
import { mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, symlinkSync } from 'node:fs';
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
 * BASELINE RE-FROZEN 2026-08-02 — all four fixtures, end of session 4.
 *
 * The baselines had been red since the session-3 flip and were never re-frozen,
 * which meant the regression oracle could no longer detect anything: every run
 * failed for known reasons, so a NEW difference would have hidden among them.
 * An oracle nobody can read is not an oracle. Every difference below is
 * accounted for; anything not on this list is a regression.
 *
 * | Fixture | Difference | Why |
 * | --- | --- | --- |
 * | all | `package` renamed on most elements | Session 4 moved project content into `model/catalog/` and renamed packages to mirror the tree. The projection records the declaring package, so every relocated element shows one. |
 * | gpca | -1 element, -1 relationship | `MethodologyScope` and `ResolvedMethodology` were deleted as a second scope authority (session 2 deliverable 6); `ProjectMethodBinding` was added. Net -1. |
 * | gpca | kind counts move; `layerCounts.unknown` 605 → 26 | Export now resolves the ontology through the native import closure. It previously ran with no registries and could not place a kind, so almost everything read `unknown`. Placing them is the fix, not a loss. |
 * | gpca | cybersecurity violations gone | Deliberate. The GPCA methodology excludes cybersecurity, and rules no longer evaluate over elements the methodology did not select. |
 * | ui-regions | +1 element, `layerCounts` populated | Same two causes: the binding is new project content, and layers now resolve. |
 * | default | +1 element (`ProjectMethodBinding`); 22 violations | The binding is project content that did not exist pre-flip. The violation count is real evaluation against the local ontology 0.6.5. |
 * | default | `errors` back to 0 | A fresh project used to fail its own ontology-version check: the lock recorded `@memoarchitect/ontology` twice (installed 0.6.4 and linked 0.6.5) and pinned the older one. `createLockFile` now keeps one entry per package name. |
 * | gpca | 108 → 106 violations, 3 → 1 errors | Two `VW-003` view-conformance violations cleared. `document_architecture_description_view` and `document_dhf_index_view` each name three governing viewpoints, which SysIDE requires be written as three subsetting members rather than three redefinitions. The MEMO grammar did not accept that form, so the extra bindings were invisible and the views looked unconformant. The grammar now accepts what SysIDE accepts. |
 * | extension-clinical | export refuses, 2 errors | An extension package is not a project: it has no method binding, so there is nothing to resolve. It is exercised as a resolvable package by the portability gate instead. |
 *
 * The GPCA content fixes made in session 4 — `longDescription` collapsed into
 * `description`, 19 duplicated attribute declarations removed, 4 `direction`
 * attributes dropped from `FunctionalExchange` — are all below this
 * projection's granularity and move no count here. They show up only in
 * `syside check`, which is where they were failing.
 */

/**
 * BASELINE RE-FROZEN 2026-08-10 — three fixtures, start of the ARCADIA
 * native-coverage programme (plans/memo-arcadia-native-coverage.md, session 1).
 *
 * The baselines had gone red again for work that landed between the 2026-08-02
 * re-freeze and now: the standards-conformance engine, the UI-screen-regions
 * relationships, the lean rearchitecture's relation unification, and the
 * removal of the COV-* coverage rules. Every "byte-identical" gate in the
 * ARCADIA plan and in memo-native-requirement-relations reads this oracle, and
 * an oracle that fails for four known reasons cannot report a fifth. Each
 * difference below was traced to the change that caused it before re-freezing;
 * anything not on this list is a regression.
 *
 * | Fixture | Difference | Why |
 * | --- | --- | --- |
 * | gpca | +4 elements, all `MarkdownDocumentSource` in layer `artifacts` | `gpca_standards.sysml` declares the four DHF document sources (HRS, RMF, SAD, SRS) the clause tables trace into. Standards-conformance work, "Un-park the clause-traceability tables and give them edges to show". |
 * | gpca | +31 `conformsTo`, +8 `tracesToDocument` | The clause-traceability edges those tables exist to carry. Same change; they were declared but unreachable before. |
 * | gpca | 6 `allocateTo` → 6 `allocatedTo` | Rename, not a re-link: same six source/target pairs. The `connection def` is `AllocatedTo`, so the registry's camelCase name is `allocatedTo`, and the native `allocate … to …` builder path now agrees with it. `allocateTo` was the defect — the two spellings of one statement were producing two different edge types. |
 * | gpca | violations unchanged (106, 1 error) | Nothing above is rule-visible, which is the check that the additions are content and not behaviour. |
 * | ui-regions | +2 relationships (`changes`, `tracesRisk`, both `uiElement12` → `reqDrugIdentityDisplay`) | "Add UI screen regions relationships" — project content, and the last two edges the screen-region example needed to trace a UI element to its requirement and its risk. |
 * | default | 22 violations → 0 (18 errors, 4 warnings gone) | All 22 were `COV-*` standards-coverage rules, and `memo_rules_coverage` now declares none: regulatory coverage is project-profile dependent, so it is computed by the coverage report rather than asserted as a universal per-element constraint. A fresh project no longer fails for not having implemented every standard pack. |
 *
 * `extension-clinical` did not move.
 */

/**
 * BASELINE RE-FROZEN 2026-08-10 (second time today) — two fixtures, for the
 * SystemFunction → `action def` move and the new ComponentFunction.
 *
 * A function is a behaviour. It was a `part def` only because relation ends
 * were typed on MemoPart/ArchitectureElement and KerML forbids a behaviour from
 * specializing a part-based type; Track A0 removed that cause earlier the same
 * day, so the split — and the `action def SystemAction` that existed to carry
 * the behaviour the part could not — is gone.
 *
 * | Fixture | Difference | Why |
 * | --- | --- | --- |
 * | gpca | 11 `SystemFunction` elements: `construct` `part` → `action` | The definition is now an `action def`. Same elements, same ids, same layer, same package — only the metaclass moved. |
 * | gpca | +3 elements, all `ComponentFunction`; `layerCounts.functional` 85 → 88 | `cfnMeasureFlowRate`, `cfnDetectAirInLine`, `cfnAggregateSensorStatus` — the worked example of the functional chain continuing past the system boundary: a flowmeter's responsibility, an air detector's, and a subassembly's. |
 * | gpca | +6 relationships (3 `composes`, 3 `allocatedTo`) | The decomposition of FUNC-001 into those three, and the component each is allocated to. Both relations already existed; A0's metaclass-neutral ends are what let an action stand at either end. |
 * | gpca | violations unchanged (106) | The move is a metaclass change, not a content change, and the new content is well-formed. |
 * | ui-regions | 6 `SystemFunction` elements: `construct` `part` → `action` | Same cause as gpca. No element or relationship count changes at all. |
 *
 * `default` and `extension-clinical` did not move.
 */

/**
 * BASELINE RE-FROZEN 2026-08-10 (third time today) — one fixture, for Track A1
 * (plans/memo-arcadia-native-coverage.md, session 2): PhysicalPort and
 * SoftwarePort became `port def`s.
 *
 * A port is a port. Both were `part def … specializes InterfaceElement` for one
 * reason — exchange endpoints were `MemoPart`-typed, so anything terminating an
 * exchange had to be a part, and CR-ONT-002 justified that typing by the ports
 * being parts. Track A0 cut the circle at the ends; KerML forbids a port from
 * specializing a part-based type, so the specialization moved to `MemoPort`.
 *
 * | Fixture | Difference | Why |
 * | --- | --- | --- |
 * | gpca | 29 elements: `construct` `part` → `port`, and NOTHING else | 22 PhysicalPort + 7 SoftwarePort usages. Same ids, same kinds, same layers, same packages, same counts — only the metaclass moved. |
 *
 * `ui-regions`, `default`, and `extension-clinical` did not move: none of them
 * declares a port.
 *
 * What deliberately did NOT move, and was checked rather than assumed: the DSM
 * (both `computeDSM`'s default functional projection and an all-kinds variant)
 * and the full per-type traceability tables — every relationship type with its
 * complete sorted (source → target) set — are byte-identical across all four
 * example projects that carry them. Exchanges are dependency edges; if the edge
 * shape had moved, those tables would show it.
 *
 * One consequence is invisible here and worth recording: `resolveConnection`
 * tags `sourcePortId`/`targetPortId` when an endpoint resolves to an element
 * with `construct === 'port'`. That path existed but had never fired on real
 * content — 0 tagged relationships before, 54 after. No builder change was
 * needed; A1 is simply what turns it on.
 */

/**
 * BASELINE RE-FROZEN 2026-08-10 (fourth time today) — one fixture, for the
 * removal of ComponentExchange's string port paths (§13.3, plan §19.4).
 *
 * `sourcePortPath` / `targetPortPath` were Strings — "TLM.TLM_MODE_OUT" and the
 * like. Nothing can follow a string to an element, so everything built on them
 * produced no traceability. Measured over the 92 sites before removal: 23 only
 * restated the endpoint the ref already named, and 69 named a port ON the
 * endpoint component, resolving to 49 distinct AADL features that existed
 * nowhere else in the model. Deleting the strings without first declaring those
 * 49 would have deleted the GPCA_SW.Impl feature topology from the example.
 *
 * | Fixture | Difference | Why |
 * | --- | --- | --- |
 * | gpca | +49 elements, all `SoftwarePort`; `layerCounts.logical` 126 → 175 | The 49 AADL software-module features, declared as real ports — which Track A1 making SoftwarePort a `port def` is what allows. |
 * | gpca | +49 `composes` | Each module owns the features it declares, the same shape as the existing gpcaSoftware → top-level-port composition. |
 * | gpca | violations unchanged | The additions are well-formed content, and CR-ONT-072/073 already resolve exchange endpoints through `allOfKind('MemoPort')`. |
 *
 * Nothing else moved, and the two checks that matter were run rather than
 * assumed: the DSM is unchanged in all four example projects, and across the
 * complete per-type traceability tables the ONLY delta is those +49 `composes`
 * — **zero removals**, so no pre-existing edge changed type, endpoints, or
 * disappeared. The 69 re-pointed exchange endpoints move an attribute value,
 * not an edge.
 *
 * `ui-regions`, `default`, and `extension-clinical` did not move.
 */

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
    // The baseline only needs the generated project content. Installing a
    // second dependency tree makes this test network-dependent and prevented
    // the verifier from ever reaching the remaining fixtures.
    execFileSync('node', [cli, 'init', 'baseline-default', '--no-install'], {
        cwd: dir, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'],
    });
    const projectDir = resolve(dir, 'baseline-default');
    // Resolve the generated project's declared packages through this checkout's
    // already-installed dependency tree. This is a read-only link, not an
    // installation, and makes the fixture deterministic offline.
    symlinkSync(resolve(toolsRoot, 'node_modules'), resolve(projectDir, 'node_modules'), 'dir');
    return projectDir;
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
