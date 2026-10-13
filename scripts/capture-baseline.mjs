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
import { RECOMMENDED_COMPILER } from '../packages/tools/lib/toolchain/providers/recommended.js';

// The baselines were frozen under a stage 1 compiler, and the projects name no
// compiler of their own, so the capture says which one it runs under (a caller
// may still set another and expect a divergence). The recommended compiler is set in one
// place, packages/tools/src/toolchain/providers/recommended.ts.
process.env.MEMO_TOOLCHAIN_COMPILER ??= RECOMMENDED_COMPILER;

const here = dirname(fileURLToPath(import.meta.url));
const toolsRoot = resolve(here, '..');
const metaRoot = resolve(toolsRoot, '..');
const memoRoot = resolve(metaRoot, 'memo');
const cli = resolve(toolsRoot, 'packages/tools/lib/bin/memo.js');
// `memo` compiles and validates; the other commands are memo-architect's, driven through their registration.
const projectCli = resolve(toolsRoot, 'scripts/project-cli.mjs');
const cliFor = command => (['compile', 'validate', 'pack', 'toolchain', 'ship-library'].includes(command) ? cli : projectCli);
const outDir = resolve(toolsRoot, 'packages/tools/src/__tests__/fixtures/baseline-s1');

/**
 * The four reference projects named in design section 18.1.
 *
 * `default` is materialized with `memo-architect init` rather than read from
 * `templates/default`, because the template still carries `{{name}}`
 * placeholders and is not itself a loadable project.
 */
export const FIXTURES = [
    { id: 'gpca', dir: resolve(memoRoot, 'examples/gpca-pump') },
    { id: 'ui-regions', dir: resolve(memoRoot, 'examples/ui-screen-regions') },
    { id: 'default', init: true },
    { id: 'extension-clinical', dir: resolve(memoRoot, 'extensions/clinical') },
];

/**
 * BASELINE RE-FROZEN 2026-10-12 — `gpca`, `ui-regions`, `default`.
 *
 * The method binding was renamed `ProjectMethodBinding` → `ModelMethodBinding`
 * (product-family plan O1; the old name stays as a deprecated specialization
 * until 0.15.0), and the examples and the init template were migrated. The
 * binding element's kind and the two kind counts are all that moved; its short
 * id keeps the PRJ family. `extension-clinical` is unchanged.
 */
/**
 * BASELINE RE-FROZEN 2026-10-04 — one fixture, `ui-regions`.
 *
 * Thirteen rules were written for clauses of ISO 14971 and IEC 62304 that the
 * model can check (plans/memo-rules-domain-trace-and-editor.md, Step 5). On this
 * fixture CR-MED-005 reports five hazards that reach no hazardous situation:
 * InfusionAtIncorrectRate, TherapyConfiguredForWrongDrug,
 * UnexpectedTherapyInterruptionFromPowerLoss, IncorrectDeliveredVolumeAssessment
 * and IncorrectTherapyEventChronology. Violations 4 → 9, warnings 3 → 8, nothing
 * else moved. They are real gaps in the example, authored as warnings and left;
 * the other three fixtures are unchanged.
 */
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
 * native-coverage programme (the ARCADIA programme, session 1 (plans/reference/memo-r1-arcadia-residue.md)).
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
 * were typed on part-only bases and KerML forbids a behaviour from
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
 * (the ARCADIA programme, session 2 (plans/reference/memo-r1-arcadia-residue.md)): PhysicalPort and
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
 * BASELINE RE-FROZEN 2026-08-10 (fifth time today) — one fixture, for Track A3:
 * the exchanges became flows.
 *
 * | Fixture | Difference | Why |
 * | --- | --- | --- |
 * | gpca | +46 relationships, all `flow` | One named flow per ComponentExchange, ends at the PORTS. The flow is the edge; the part above it carries the budget and assurance attributes. |
 *
 * ZERO removals: `ExchangesWith` keeps the component-level dependency it always
 * carried, because AADL distinguishes that granularity from the port-level one
 * and so does this. The DSM is unchanged in all four example projects.
 *
 * No element moved at all — the 46 exchange parts stay, which is the point of
 * the split. The flows are named with their exchanges, and that shared
 * identifier is the binding between the two halves; CR-ONT-076 checks it, and
 * `exchange-flow-binding.test.ts` proves the rule rejects both an exchange with
 * no flow and one whose flow is named something else. As with CR-ONT-074/075,
 * the rule does not evaluate under GPCA's own methodology scope (only three
 * rule ids do), so the unit test is what proves it fires — the pre-existing
 * scope behaviour recorded in the plan's §18.4, not a defect in the rule.
 */

/**
 * BASELINE RE-FROZEN 2026-08-10 (sixth time today) — Session 3, part 2.
 *
 * | Fixture | Difference | Why |
 * | --- | --- | --- |
 * | gpca | 5 `User` usages: `construct` `part` → `actor`; 19 `Transition` usages: `part` → `transition` | Native SysML spellings replace MEMO's compatibility usages; ids, kinds, layers, packages, attributes, and existing edges are unchanged. |
 * | gpca | +9 `realizes` | New FunctionalFlowStep → WorkflowStep `<refinement>` dependencies close §13.1's IEC 62366 user-task-to-system-function trace. |
 *
 * The complete sorted relationship set was compared before re-freezing: there
 * are zero removals and the nine rows above are the only additions. UI-regions,
 * default, and extension-clinical do not carry migrated content and did not move.
 */

/**
 * BASELINE RE-FROZEN 2026-08-11 — metaclass-wrapper and ROS correction.
 *
 * | Fixture | Difference | Why |
 * | --- | --- | --- |
 * | gpca | 6 action usages resolve from generic `ActionUsage` to their concrete action-definition kinds; behavior 29 → 23, functional 85 → 91 | The six GPCA action definitions now specialize the MEMO action wrapper through `FunctionalAction`. Their usages were already typed by those definitions; valid action ancestry now lets the resolver classify them. |
 * | ui-regions | 5 `RiskControlMeasure` usages: `construct` `item` → `part` | `RiskControlMeasure` is structurally a `MemoPart`; each usage now matches its definition's native metaclass. IDs, kinds, layers, and relationships are unchanged. |
 *
 * `default` and `extension-clinical` did not move. ROS is not one of the four
 * frozen fixtures.
 */

/**
 * BASELINE RE-FROZEN 2026-08-11 — R1-S1 mode-conditioned configuration.
 *
 * | Fixture | Difference | Why |
 * | --- | --- | --- |
 * | gpca | +5 `ModeConfiguration` elements, +4 `variant` relationships | The GPCA therapy-mode example now makes one active configuration a native `variation` choice point. Four selectable configurations bind basal, square-bolus, patient-bolus, and paused/KVO to their existing `ModeState`; the fifth element is the choice point itself. The four new edges retain those alternatives for DSMs and views instead of dropping `variant` memberships during projection. |
 *
 * `ui-regions`, `default`, and `extension-clinical` do not use configurations
 * and are byte-identical.
 */

/**
 * BASELINE RE-FROZEN 2026-08-11 — R1-S2 native message.
 *
 * | Fixture | Difference | Why |
 * | --- | --- | --- |
 * | gpca | +1 `flow` relationship | `alarmNotification` is the native SysML `message` from the safety-monitoring component to the operator interface. `Message : FlowUsage` lowers to the same consumable flow edge as MEMO's compatibility messaging vocabulary. |
 */

/**
 * BASELINE RE-FROZEN 2026-08-11 — R3-S1 scenario-family collapse.
 *
 * | Fixture | Difference | Why |
 * | --- | --- | --- |
 * | gpca | 6 `OperativeScenario`, 2 `FunctionalScenario`, and 1 `ThreatScenario` usages become 9 `MemoScenario` usages | The three name-only scenario families are now selected by `scenarioKind`; their existing ids, action construct, and relationships are unchanged. Functional and threat examples now inherit the base kind's operational layer, which is the intentional cost of one shared definition. |
 * | gpca | 19 native `Transition` usages change `layer` `functional` → `unknown` | This is pre-existing R1-S1 native-transition residue exposed by the re-capture: native transitions are usages, not ontology definitions, so no kind registry entry assigns them a layer. It is recorded here rather than hidden by a stale baseline. |
 *
 * `ui-regions`, `default`, and `extension-clinical` are byte-identical.
 */

/**
 * BASELINE RE-FROZEN 2026-08-11 — R3-S2 behaviour-state collapse.
 *
 * GPCA's nine `ModeState` usages are now `MemoState[stateKind=mode]`; ids,
 * state construct, and relationships are unchanged. The shared state base is
 * defined in core, so the projection's layer changes from `functional` to
 * `core` as an intentional consequence of eliminating the taxonomy.
 */

/**
 * BASELINE RE-FROZEN 2026-10-04 — MEMO's own compiler retired.
 *
 * The capture now runs under a stage 1 compiler (OpenSysML), not the Langium
 * parser, so the model is built from a handoff.
 *
 * | Fixture | Difference | Why |
 * | --- | --- | --- |
 * | gpca | -1 element: `gpcaMethodDefinition` (`MethodologyDefinition`) | The example's `methodology/` directory is a library root, so the compiler's handoff marks its documents `library`; the old parser read every resolved file as project content. A methodology is configuration the project selects, not model content (the same rule `e2e-workflow` states for the ontology's own). |
 *
 * default, extension-clinical and ui-regions are unchanged.
 */
/**
 * BASELINE RE-FROZEN 2026-08-13 — R10-S4 `IncludedIn` retired.
 *
 * | Fixture | Difference | Why |
 * | --- | --- | --- |
 * | gpca | -5 `includedIn` relationships | `gpca_trace.sysml`'s five `IncludedIn` edges to `rmfView`/`vvView`/`usabilityView`/`hazardAnalysisView` were the last real usages left; view membership for those five is now carried by native `expose` members on the views themselves, which contribute no relationship (expose is model-element data, not an edge). |
 *
 * `ui-regions`, `default`, and `extension-clinical` do not declare `IncludedIn`
 * and are byte-identical. `syside check src extensions examples` and every
 * example's rendered element set (proven with the migration's own equality
 * assertion, since removed) are unchanged by the swap.
 */

/**
 * BASELINE RE-FROZEN 2026-08-13 — R10-S6 `Initiates`/`ParticipatesIn` retired.
 *
 * | Fixture | Difference | Why |
 * | --- | --- | --- |
 * | gpca | 1 `initiates` edge (actorNurse → ucDeliverPcaTherapy) becomes a `participatesIn` edge instead | `Initiates` and `ParticipatesIn` collapsed onto the single native `actor` keyword, which does not distinguish an initiating actor from a participating one; `gpca_operational.sysml`'s `ucDeliverPcaTherapy` now declares all four actors (`actor nurseInitiator = actorNurse;` etc.) natively, and the builder projects every one of them onto `participatesIn` (R10-S6, `resolveActorParticipation` in builder.ts). |
 *
 * `ui-regions`, `default`, and `extension-clinical` do not declare `Initiates`
 * or `ParticipatesIn` and are byte-identical.
 */

/**
 * BASELINE RE-FROZEN 2026-08-13 — R10-S6 `ModuleUses`/`MonitorsChannel`
 * retired, generic `dependency` edge added.
 *
 * | Fixture | Difference | Why |
 * | --- | --- | --- |
 * | gpca | +19 relationships | Neither connection def was used in gpca, but gpca's 19 existing `#refinement dependency` statements now ALSO produce a generic `dependency` edge alongside `realizes` — a refinement IS a dependency (R10-S6), so both are emitted. Before this a bare (non-`#refinement`) `dependency` built to nothing at all, which is what `ModuleUses`/`MonitorsChannel`'s migration needed fixed; making `#refinement dependency` emit the generic edge too, rather than only when unclassified, is what keeps one dependency statement's meaning from depending on which edge type happens to be looking. |
 *
 * `ui-regions`, `default`, and `extension-clinical` declare no `dependency`
 * of any kind and are byte-identical.
 */

/**
 * BASELINE RE-FROZEN 2026-08-13 — R10-S6 `InvolvesFunction`/
 * `ActionInvokesFunction`/`Precedes` retired.
 *
 * | Fixture | Difference | Why |
 * | --- | --- | --- |
 * | gpca | -9 relationships | 11 `InvolvesFunction` edges deleted with no replacement: `fcPatientBolus`/`fcAlarmStop` already named every one of those functions via their existing `perform <step>;` chain plus each step's own `ref :>> function`, so the connection was a flattened restatement, not new information. `fcStartup` had no step chain, so its 2 functions became direct `perform` statements on `fcStartup` itself. Net -11 + 2 = -9. `Precedes` → `succession` (4 edges) is a 1:1 type swap with no count change. |
 * | ui-regions | 3 `actionInvokesFunction` edges become `performs` edges, ends renamed (`uiAction`/`systemFunction` → `performer`/`performed`) | `ActionInvokesFunction` collapsed onto native `perform`, the same collapse `Initiates`/`ParticipatesIn` had onto `actor`. |
 *
 * `default` and `extension-clinical` declare none of the three and are
 * byte-identical.
 */

/**
 * BASELINE RE-FROZEN 2026-08-13 — R10-S6 `ConnectsPhysically` retired.
 *
 * | Fixture | Difference | Why |
 * | --- | --- | --- |
 * | gpca | 4 relationships renamed `connectsPhysically` → `connect` | `ConnectsPhysically` is deleted in favour of the untyped native connection; `resolveConnection` (builder.ts) no longer bails on a missing `conn.type` and stamps `connect` instead — the same fix shape as `dependency`'s bare form, and before it a bare `connection connect a to b;` built to nothing at all. |
 *
 * `ui-regions`, `default`, and `extension-clinical` declare no
 * `ConnectsPhysically` and are byte-identical.
 */

/**
 * BASELINE RE-FROZEN 2026-08-13 — R10-S7 `Composes` → native nesting.
 *
 * Every hand-authored architecture/functional/operational/workflow/UI
 * decomposition across the examples moved from flat parts plus an explicit
 * `Composes` edge to real nesting. `buildMemoModel`'s Phase 3f, which
 * synthesizes a `composes` relationship from a nested part's `owner` chain
 * (R10-S3), was extended to do the same from a nested action's
 * `parentAction` chain — CR-ONT-065/066 already sanction an action-typed
 * composes end alongside a part, and without this an entire natively nested
 * function or activity tree loses the `composes` edges DSM and traceability
 * consumers read, the exact silent-drop shape this epic exists to close.
 *
 * | Fixture | Difference | Why |
 * | --- | --- | --- |
 * | gpca | -73 `composes` (port targets), no replacement | GPCA_Device's, GPCA_HW_Sensors's, GPCA_HW_Actuators's, and every software module's ports moved from a flat declaration plus a `Composes` edge (`gpca_interfaces.sysml` / `gpca_trace.sysml`) to nesting inside their owning part's body (`gpca_architecture.sysml`). Nested ports were already established practice with no synthesized edge before this story landed — `interconnection_view.sysml` nests ports with zero `Composes` lines — so this is the same pattern reaching the one file that had not yet been migrated to it, not a new gap. |
 * | gpca | +22 `composes`, all pre-existing action nesting (`infusionDeliveryFlow`'s six steps, five scenario activities' internal steps) | These nestings already existed; nobody had written an explicit `Composes` edge for them because nothing needed one before a `composes`-reading consumer existed for the action case. The Phase 3f extension now synthesizes them the same as any other nested action, which is a completion of the pattern, not new content. |
 * | gpca | 73 elements: `package` moves from `gpca_interfaces` to `gpca_architecture` | The 73 ports physically relocated into their owning part's body, in the file that part is declared in. |
 * | ui-regions | 0 net change (111 → 106 → 111 before the Phase 3f extension, back to 111 after) | `elMainScreen`'s and `fnManageInfusionDisplay`'s trees moved from flat-plus-`Composes` to nesting. The four part-typed edges (`elMainScreen`/`elDrugSelectorRegion`/…) synthesized immediately, matching R10-S3's existing part coverage; the five action-typed edges (`fnManageInfusionDisplay` → its five children) did not until the Phase 3f extension landed, which is what the extension was for. `uiElement12`'s and the comment-reply's two `Composes` edges are untouched — `Composes` survives for exactly this: content memo-architect's own UI (`UiScreensWorkspace.tsx`, `UnifiedPropertiesPanel.tsx`) appends at runtime as a flat element plus a relationship edge, which is a graph write, not a source-text nesting edit; rewriting the editor to do the latter is out of scope here. |
 *
 * `default` and `extension-clinical` declare no example content this story
 * touched and are byte-identical, including through the Phase 3f extension —
 * neither nests one action inside another.
 */

/**
 * BASELINE RE-FROZEN 2026-09-21 — all four fixtures, for qualified element ids.
 *
 * The baselines had been red since `an element's id is its qualified name`
 * (memo-tools 58d0ed9) and were never re-frozen. Every id in every fixture
 * changed shape at once, and this file's differ walks the element and
 * relationship arrays BY POSITION — so one re-spelling reported 463 changed
 * elements in ui-regions and made the oracle unreadable for five weeks. An
 * oracle nobody can read is not an oracle; the same sentence is already in the
 * 2026-08-02 note above, and this is the second time it has been true.
 *
 * Read the delta by leaf name, not by position. Matching `pkg::owner::name`
 * against the old bare `name` is what turns the noise back into a diff, and
 * every difference below was traced to the commit that caused it before
 * re-freezing. Anything not on this list is a regression.
 *
 * WHAT THE RE-SPELLING ITSELF DID. An id is now `package::name`, nested as
 * `owner::child`; the declared name stays on `shortName`. **ui-regions and
 * default moved by nothing else at all** — 0 elements added, removed or
 * changed, 0 relationship deltas, on 66 and 3 elements. That is the evidence
 * that this was a re-spelling and not a re-modelling, and it is why gpca's
 * deltas below can be attributed to content rather than to identity.
 *
 * | Fixture | Difference | Why |
 * | --- | --- | --- |
 * | all | every `id` becomes qualified; leaf names unchanged | `an element's id is its qualified name` (58d0ed9). |
 * | extension-clinical | the refusal text changes wording only | A project is located by the `entrypoint` in `memo.package.yaml` now, not by a hard-coded `model/catalog/project.sysml`. Still 2 errors, still not a project. |
 *
 * GPCA ELEMENTS, 729 → 735 (+11 added, −5 removed).
 *
 * | Difference | Why |
 * | --- | --- |
 * | −1 `gpcaMission`; `gpcaIntendedUse` layer `requirements` → `operational` | `Mission` is retired — it had no medical-device meaning and duplicated intended use — and `IntendedUse` becomes the operational-world root (memo b530ecc). |
 * | −4 `WorkflowStep` (`wsProgram`, `wsRequestBolus`, `wsRespondAlarm`, `wsStart`) | `WorkflowStep` removed; a workflow performs `OperativeAction`s natively (memo eab2672). |
 * | +9 `MemoState` (`modeOFF` … `modePAUSED`), layer `core` | The mode machine's nested state usages are extracted as elements (memo-tools c20c677), with identity entries registered for them (memo 2a439ae). They were authored all along and reached the model as nothing. |
 * | +2 definitions: `SensorDataInterface` (`DataInterface`) and `SensorInputPort` (`SensorPort`) | `A definition the project declares is model content` (memo-tools 8ba6593). Both have been in `gpca_interfaces.sysml` since long before the freeze; only `action def` and `item def` were ever given elements. A definition carries the ontology kind it specializes, which is why these read `DataInterface`/`SensorPort` and not `InterfaceDefinition`/`PortDefinition`. |
 * | 14 `OperationalActivity` → `OperativeAction` | `OperationalActivity`/`UserTask`/`SystemAction`/`TaskStep` merged onto one definition (memo 1d63a67). Rename, same ids. |
 * | 9 `MemoScenario` → `OperativeScenario` | Rename (memo 3f07883). |
 * | 6 action defs `ActionDefinition` → `FunctionalAction`, layer `behavior` → `functional` | `ActionDefinition` is a SysML metaclass, not a MEMO kind; a definition carries the ontology kind it specializes (memo-tools 7e9902a). |
 * | 6 action usages `AcquireSensorData`/… → `ActionUsage`, layer → `unknown` | Consequence of the same two commits, and deliberate: the def is an ELEMENT now rather than a registered kind, so a usage typed by it reports the metaclass and keeps the def reference in `actionType` (`extractActionUsage`, builder.ts). |
 * | 17 more action usages, layer `behavior` → `unknown` | `an element's layer is where it was authored, not a literal` (memo-tools 2d31fed). `'behavior'` was invented in builder.ts — the ontology has no behavior layer, EXPL-011 places behaviour inside functional. gpca is authored flat under `model/catalog/`, which the layer convention does not cover, so `unknown` is the honest answer and is reported as a finding downstream. |
 * | 3 functional flows (`fcStartup`, `fcPatientBolus`, `fcAlarmStop`) `part` → `action` | A functional flow is a behaviour and now says so (memo 5aabec6). |
 * | `bolusByProxyMisuse` layer `requirements` → `safety_risk` | `ReasonablyForeseeableMisuse` filed where it belongs (memo a3f2efe). |
 *
 * GPCA RELATIONSHIPS, 794 → 810 (+51 added, −35 removed). Seven of the ten
 * groups are type swaps over the SAME endpoint pairs, so they cancel:
 *
 * | Difference | Why |
 * | --- | --- |
 * | 6 `interactsWith` → `connect` | `InteractsWith` migrated and deleted; the operational-context package already scopes the ends (memo 9a9c780). |
 * | 1 `analyzedBy` → `dependency` (`pumpMotorAssembly` → `fmeaDelivery`) | `AnalyzedBy` becomes a native dependency (memo 931d250). |
 * | 9 `dependency` and 9 `realizes` re-point `fcs*` → `ws*` onto `fcs*` → `oa*` | Same `#refinement dependency` statements, re-aimed at the OperativeActions that replaced the deleted WorkflowSteps (memo eab2672, 931d250). |
 * | 3 `supports` (workflow → use case) → 3 `realizesUseCase` | The spine traces became first-class relations instead of refs (memo 2fef918). |
 * | 3 `supports` (activity → capability) → 2 `requiresCapability` + 2 `enablesUseCase` | Same commit, and a deliberate re-aiming rather than a rename: a capability is tied to the USE CASE, not to individual activities, so three activity-level edges become two intended-use→capability edges and two capability→use-case edges. Net +1. |
 * | −4 `composes` (workflow → WorkflowStep) | The four deleted steps. |
 * | +9 `composes` over the mode tree | The nine extracted `MemoState`s, synthesized from nesting as any nested usage is. |
 * | +6 `composes` (workflow → OperativeScenario) | `HasScenario` becomes nesting — a scenario belongs to exactly one workflow, so containment is exclusive (memo 931d250, a8686b1). |
 * | +4 `commitsUseError` | Four string fields that stood in for a relation, written as the relation the ontology declares (memo 80589ab). |
 *
 * VIOLATIONS. gpca 108 → 81, ui-regions 1 → 10, and the rule sets share
 * nothing, so this is not a count that drifted. Four independent causes, and
 * none of them is a model that got better or worse on its own:
 *
 * | Difference | Why |
 * | --- | --- |
 * | gpca −89 `XL-002`, −1 `CR-MED-031` | Both were FALSE. `memo validate` narrowed the model before evaluating — it dropped out-of-scope elements from `elements` while leaving `outgoing`/`incoming` pointing at the full model — so every rule that navigates a trace saw nothing. 374 of 723 elements were dropped and all 110 `satisfiedBy` edges lost an endpoint (memo-tools 73da34d). `vcAuthenticatedServiceAccess`'s `verifiedBy` edge was there the whole time and is in the capture. |
 * | gpca −17 `BV-001` | Deleted as a duplicate of CR-MED-022 and CR-ONT-074, which gpca's own methodology declines — BV-001 applied to every action usage over the top of that methodology (memo-tools edb5dd0). |
 * | gpca −1 `BV-002` | Not deleted: it is `CR-MED-023` in the ontology now (same commit), which is why CR-MED-023 appears below. |
 * | gpca +81, ui-regions +9, all first-time | `a layer entry names a namespace, not a package` (memo-tools aa6718e). Under `scopeMode = explicit` every layer entry matched nothing, so 25 rules were dropped before evaluation — 33 evaluated / 0 violations became 58 / 81. gpca: CR-ONT-076 ×46, CR-ONT-040 ×13, CR-MED-023 ×13, CR-ONT-043 ×5, CR-ONT-041 ×2, CR-ONT-077 ×1, CR-ONT-079 ×1. ui-regions: CR-MED-023 ×5, CR-ONT-081 ×4. |
 *
 * **The 81 and the 9 are frozen as FINDINGS, not as approved.** They are on the
 * board — "35 findings from rules that had never run", which owns gpca's
 * non-CR-ONT-076 35 and points the 46 at "Native exchanges" — and freezing
 * them here is what makes the oracle able to report the 82nd. It is not a
 * verdict on any of them, and re-freezing is not triage.
 */

/**
 * BASELINE RE-FROZEN 2026-09-24 (twice) — gpca only, for the two
 * native-exchange cutovers. ui-regions, default and extension-clinical did not
 * move either time.
 *
 * FIRST, §6.1: `FunctionalExchange` became an `abstract flow def`, and
 * gpca-pump's four exchanges are typed named flows between function
 * parameters (memo a42e15b).
 *
 * | Difference | Why |
 * | --- | --- |
 * | −4 elements `FunctionalExchange` (`lfSensorAcquisition` … `lfPrescriptionEntry`) | They are edges now, under the same qualified ids, so the four `allocate lf… to ex…` edges keep their source ids and do not move. |
 * | +4 relationships `flow` | The same four exchanges, between typed function parameters. |
 * | −5 `CR-MED-023` (`fnMonitorAlarm`, `fnAnnunciate`, `fnManageInfusion`, `fnCommandPump`, `fnValidatePrescription`) | Reachable through a flow now. The architecture plan's §9.2 predicted exactly this. |
 *
 * SECOND, §6.2: `ComponentExchange` became an `interface def`. Of gpca-pump's
 * 46, the 31 between two subcomponents are typed named interfaces between the
 * same ports their flows already joined, and the 15 from a GPCA_SW boundary
 * port into a subcomponent are named `binding`s that replace both the part
 * and the anonymous `bind` beside it.
 *
 * | Difference | Why |
 * | --- | --- |
 * | −46 elements `ComponentExchange` | Edges now: 31 `interface`, 15 named `bind`. |
 * | +3 elements `PhysicalPort` (`operatorKeypad::portPrescriptionOut`, `pumpMotorAssembly::portFlowCommandIn`, `audibleAlarm::portAlarmIn`) | CE-002/003/004 ended at a component. §6.2 requires a real boundary port, and CR-ONT-072/073 now enforce it. CE-001 reuses the AADL `snsSensorOut`. |
 * | +31 relationships `interface` | The 31 exchanges between subcomponents. The 15 named bindings replace the 15 anonymous ones one for one, so the `bind` count does not move. |
 * | −46 `CR-ONT-076` | The rule now asks for a flow between the interface's own two ports, compared as elements, where it used to ask for a flow of the same NAME as a part, which could not compile. All 31 interfaces carry one. The 15 bindings are not ComponentExchanges, so it does not apply to them. |
 *
 * CR-ONT-072/073/076 evaluating to zero was proved by breaking a scratch copy
 * rather than assumed: a part at one end raises CR-ONT-073, and a deleted flow
 * raises CR-ONT-076. That check found the scope defect fixed in the same change:
 * `memo validate`'s in-scope subject set held element ids only, so under
 * gpca-pump's explicit scope every rule scoped to a flow-def or interface-def
 * kind ran on nothing.
 */

/**
 * BASELINE RE-FROZEN 2026-10-13 - gpca only. gpca is a system and now says so:
 * `part def GpcaPumpSystem specializes System` owns the five logical components and
 * `part gpcaPump : GpcaPumpSystem` is its usage (a model is required to declare a
 * System). ui-regions, default and extension-clinical did not move. Compared by leaf
 * name: no element removed, no relationship removed.
 *
 * | Difference | Why |
 * | --- | --- |
 * | +2 elements `GpcaPumpSystem`, `gpcaPump` | The System definition and its usage. |
 * | +5 `composes` GpcaPumpSystem -> lc* | The five logical components are nested in it, so their ids move to `GpcaPumpSystem::lc*`. |
 * | +3 `AR-IBD-001` (lcDrugDelivery, lcPowerSubsystem, lcTherapyControl) | The rule fires now that the components sit inside a system with no connection; E0 has the same finding. |
 * | +2 `realizedBy` gpcaPump -> gpcaDevice, gpcaPump -> gpcaSoftware | The logical System is realized by the device and its software: a typed allocation (`RealizedBy`), nothing nested. |
 */

/**
 * BASELINE RE-FROZEN 2026-09-28 (third) — gpca only: 61 risk-analysis usages
 * are items. ui-regions, default and extension-clinical did not move.
 *
 * | Difference | Why |
 * | --- | --- |
 * | 61 elements `construct` `part` → `item` | Failure modes, causes, effects, hazards, hazard causes, hazardous situations, harms, sequences of events, minimal cut sets and the cyber hazard/vulnerability usages are typed by item defs (`FailureMode` is an `item def`), and a part must be typed by at least one part definition (SysML validatePartUsagePartDefinition, which OpenSysML checks). Ids, kinds, layers and relationships do not move. |
 */

/**
 * BASELINE RE-FROZEN 2026-09-28 (second) — gpca only: the physical interfaces
 * are wired. ui-regions, default and extension-clinical did not move.
 * Compared as multisets.
 *
 * | Difference | Why |
 * | --- | --- |
 * | −3 `Interface` elements, +3 `interface` relationships | `pumpMotorDrive`, `bolusButtonLine` and `occlusionAnalogLine` state their ends now (KerML validateConnectorRelatedFeatures), so each is the edge between its two ports, keeping its id and attributes; the bindings and refinements that name it are unchanged. |
 * | +2 `PhysicalPort` | `bolusButton.portPendantOut` and `occlusionSensor.portOcclusionOut`, the device-side ends; the motor drive reuses `pumpMotorAssembly.portFlowCommandIn`. |
 * | none for the other 11 interfaces | They are `abstract interface` now, which MEMO's grammar accepts as SysML does; still elements, unchanged. |
 */

/**
 * BASELINE RE-FROZEN 2026-09-28 — gpca only, for two connector corrections
 * OpenSysML's validator found (KerML validateConnectorRelatedFeatures and
 * validateFlowEndSubsetting, which SysIDE does not check). ui-regions, default
 * and extension-clinical did not move. Compared as multisets, not by position:
 * zero elements added or removed, 895 relationships before and after.
 *
 * | Difference | Why |
 * | --- | --- |
 * | relationship order | 41 connections in gpca_trace and gpca_cybersecurity wrote `connect` in their body, a nested connection that left the outer one relating nothing; the ends are in the head now (memo 7d7ceaa). Same edges, read in a different order. |
 * | 5 `flow` → `connect`, same ends and names | The Fig 2.1 context exchanges went part to part, and a flow end must name the feature that flows; the figure names no item, so each is a connection from source to receiver. |
 */

/**
 * BASELINE RE-FROZEN 2026-09-25 — gpca only, for two §4.1 conversions.
 * ui-regions, default and extension-clinical did not move. The first of the
 * two landed without a re-freeze (memo 261d07e, memo-tools 2823e3a) and left
 * this oracle red, because `pnpm test` does not run it; both are recorded here.
 * Compared by leaf name, not position: zero elements added or removed.
 *
 * FIRST: `BehaviorProperty`, `Contract` and `TimingConstraint` are requirement
 * defs, and a contract names its component and members natively.
 *
 * | Difference | Why |
 * | --- | --- |
 * | 27 elements `construct` `part` → `requirement` | The 20 properties, 3 timing constraints and 4 contracts. Ids, kinds, layers and attributes do not move. |
 * | +4 `hasSubject`, +3 `assumes`, +11 `requires` | Each contract's `subject` and its `assume`/`require` members. `verifiedBy` does not move: the 9 properties a case named as a subject are `verify` objectives now, which lower to the same edge. |
 *
 * SECOND: the `FunctionalFlowStep` wrapper is retired. A step is an action
 * nested in its flow that subsets the function it performs.
 *
 * | Difference | Why |
 * | --- | --- |
 * | 9 elements `kind` `FunctionalFlowStep` → `ActionUsage` | The steps, under nested qualified ids. A step takes its flow's layer, so layer counts do not move. |
 * | −9 `performs` flow → step, +9 `composes` flow → step | The flow owns its steps now instead of performing them. |
 * | +9 `performs` flow → function | An owned subsetting action is its function performed at that position. |
 * | +4 `flow` | Between two steps' item parameters where one step's output is the next one's input. |
 * | −2 `CR-MED-023` (`fnEnforceLimits`, `fnLogEvents`) | A functional chain performs them now; before, only a step's `ref function` string named them. |
 */

/**
 * BASELINE RE-FROZEN 2026-09-25 — gpca and ui-regions, for the builder's
 * relationship end-kind findings. default and extension-clinical did not move.
 * `memo validate` reports those findings now; every one in the examples was
 * triaged and fixed at its source (ontology or model). Compared by leaf name.
 * Violations are unchanged in both: gpca 8, ui-regions 4.
 *
 * | Fixture | Difference | Why |
 * | --- | --- | --- |
 * | gpca | −21 `tracesRisk` into a Risk; +7 `estimatedFor`, +7 `reducedBy`, +7 `evaluatedIn` | A risk is not a RiskItem, so TracesRisk refused every one. The three new relations say what the edges meant: estimated for a harm, reduced by a control, evaluated in the overall evaluation. |
 * | gpca | −4 `tracesRisk`, +4 `causes` | Use errors reach the chain through `Causes` with `useErrorLeadsToHazard`. |
 * | gpca | `deploysTo` gpcaSoftware → controllerBoard becomes gpcaFirmwareImage → mainController; +1 element `gpcaFirmwareImage`, +6 `buildsInto` | A system is not a deployment unit and a board is not a processing node. The modules build into the image, as in embedded-infusion-pump. |
 * | gpca | `impactsSafety` retargeted riskBefore → overdoseHazard | A security risk feeds safety risk management at the hazard it can cause. |
 * | ui-regions | −1 `tracesRisk`, −1 `changes` (UIE-012 → reqDrugIdentityDisplay) | Deleted by decision: a UI element is neither a risk item nor a change request, so the edges asserted nothing. |
 */

/**
 * Materialize a fresh default project so the baseline covers `memo-architect init` output.
 *
 * BASELINE RE-FROZEN 2026-08-01 (deliberate, one fixture).
 *
 * The first capture recorded `validation: null` here: `memo-architect init` resolves the
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
    execFileSync('node', [projectCli, 'init', 'baseline-default', '--no-install'], {
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
    return execFileSync('node', [cliFor(args[0]), ...args], {
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
    // `memo-architect export json` only writes to a file, so route it through a scratch
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
        result.errors.push(`model: ${normalizeError(error)}`);
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

/**
 * BASELINE RE-FROZEN 2026-10-11 — gpca only, for the interface split (memo).
 * `Interface` is abstract; each interface is a LogicalInterface, a
 * SoftwareInterface or a PhysicalInterface. Compared by leaf name: zero
 * elements added or removed.
 *
 * | Difference | Why |
 * | --- | --- |
 * | 9 `Interface` → `LogicalInterface` | The LI-* and SI-* interfaces state what is exchanged between components. |
 * | 2 `Interface` → `PhysicalInterface`, layer `logical` → `realization` | `hwSoftwareBus` and `batteryMonitorLine`; a hardware interface is a realization element. |
 */

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
