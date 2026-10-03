// ─── memo validate ───────────────────────────────────────────────────────────
//
// Parses all .sysml files, builds the model, evaluates closure rules,
// and prints a completeness report.
// ─────────────────────────────────────────────────────────────────────────────

import { relative, resolve } from 'node:path';
import { writeFileSync } from 'node:fs';
import chalk from 'chalk';
import { identityKey, writeIdentityRegistry } from '../model/identity-registry.js';
import type { IdentityRegistry } from '../model/identity-registry.js';
import {
    buildMemoModel,
    loadOntologyRegistries,
    loadProjectSettings,
    findProjectRoot,
    resolveEffectiveMethodology,
    resolveEffectiveRules,
    buildEffectiveScope,
    activeRuleCandidates,
    isRulePackageInScope,
    isInScope,
    scopedSubjectIds,
    checkSemanticFields,
    type RuleCandidate,
} from '@memoarchitect/tools';
import type { BuilderRegistries, ParsedDocument } from '@memoarchitect/tools';
import { ELEMENT_NAME_COLLISION, AMBIGUOUS_ELEMENT_REFERENCE, toElementIndex } from '@memoarchitect/tools';
import {
    validateModel, collectNativeConstraints, collectApiConstraints, type ConstraintDiagnostic,
} from '@memoarchitect/tools';
import { checkSelectorVocabulary, type SelectorVocabularyDiagnostic } from '@memoarchitect/tools';
import { computeCompleteness } from '@memoarchitect/tools';
import { checkLockFile } from '../lock.js';
import { runValidator } from '../toolchain/operations.js';
import { resolveToolchain } from '../toolchain/effective.js';
import { defaultRegistry } from '../toolchain/default-registry.js';
import {
    compileResolvedProject, compileServesValidator, selectedCompilerBuildsModel,
} from '../toolchain/operations.js';
import type { CompileModelResult } from '../toolchain/registry.js';
import { discoverProjectSources, type NativeProjectResolution } from '../model/native-project.js';
import { resolutionLoads } from '../stage2/project-from-api.js';
import { stage1CacheDir } from '../toolchain/project-model.js';
import { withToolchainOverrides } from '../toolchain/schema.js';
import { countBySeverity, formatDiagnosticsText, type Diagnostic } from '../toolchain/diagnostic.js';


export type ValidateFormat = 'text' | 'junit' | 'json';

export async function validateCommand(
    projectDir?: string,
    options?: { format?: ValidateFormat; output?: string } & Record<string, unknown>,
): Promise<void> {
    const format = options?.format || 'text';
    const cwd = resolve(projectDir || process.cwd());
    console.log(chalk.bold('\n📋 MEMO Validate\n'));

    // 1. Find the project by its native entrypoint, not by a settings file.
    const projectRoot = findProjectRoot(cwd);
    if (!projectRoot) {
        console.error(chalk.red(
            '❌ No MEMO project found. A project is located by the `entrypoint` in its '
            + '`memo.package.yaml`, which names the SysML file declaring its identity '
            + 'and method binding — run `memo init` to scaffold one.'));
        process.exit(1);
    }
    console.log(chalk.gray(`Project root: ${projectRoot}`));

    // 2. Reject semantic configuration before anything reads it.
    const rejections = checkSemanticFields(projectRoot);
    if (rejections.length > 0) {
        console.error(chalk.red(`\n❌ Semantic configuration found in application settings (${rejections.length}):\n`));
        for (const r of rejections) {
            console.error(chalk.red(`  ${r.file}`));
            console.error(chalk.gray(`    ${r.message}\n`));
        }
        process.exit(1);
    }

    const config = withToolchainOverrides(
        loadProjectSettings(projectRoot), options ?? {}, defaultRegistry);
    const effectiveToolchain = resolveToolchain(config, defaultRegistry);
    for (const note of effectiveToolchain.deprecations) console.log(chalk.yellow(`  ⚠ ${note}`));

    // 3. Resolve the project natively: imports and the method binding decide
    //    everything about what is loaded. A compiler that builds the model
    //    resolves it from what it compiled — every library root a locator
    //    offers, the import closure deciding which is the ontology — so MEMO
    //    parses nothing; MEMO's own compiler resolves by parsing.
    const compiler = effectiveToolchain.lowering;
    const validatorFromStage1 = compileServesValidator(config, defaultRegistry);
    let sysmlDiagnostics: Diagnostic[] = [];
    let ontologyRegistries: BuilderRegistries | undefined;
    let ontologyDocuments: ParsedDocument[] = [];
    let resolution: NativeProjectResolution | undefined;
    let stage1: CompileModelResult | undefined;
    let projectSourceCount = 0;
    if (selectedCompilerBuildsModel(config, defaultRegistry)) {
        projectSourceCount = discoverProjectSources(projectRoot).projectFiles.length;
        try {
            // Reuses a fresh `memo compile`.
            stage1 = await compileResolvedProject({ config, projectDir: projectRoot, cacheDir: stage1CacheDir(projectRoot) });
        } catch (error) {
            console.error(chalk.red(`\n❌ ${error instanceof Error ? error.message : error}\n`));
            process.exit(1);
        }
        if (!stage1) throw new Error(`${compiler} builds the model but compiled nothing`);
        console.log(chalk.gray(`Stage 1: ${compiler} ${stage1.providerVersion ?? ''} — ${stage1.accepted ? 'clean' : 'errors'}${stage1.cached ? ' (reused .memo/stage1)' : ''}`));
        if (validatorFromStage1) {
            sysmlDiagnostics = stage1.diagnostics;
            console.log(chalk.gray(`Validator: ${compiler} ${stage1.providerVersion ?? ''} (stage 1's check)`));
        }
        // A stage 1 that reports an error stops here: stage 2 and the rules
        // never run on a model that is not valid SysML.
        if (!stage1.accepted || !stage1.model) {
            const errors = stage1.diagnostics.filter(d => d.severity === 'error');
            console.error(chalk.red(`\n❌ Stage 1 (${compiler}) reported ${errors.length} error(s); stage 2 and the rules did not run.\n`));
            for (const d of errors) console.error(chalk.red(`  ${d.file}:${d.range?.start.line ?? '?'}:${d.range?.start.column ?? '?'} ${d.code ?? ''} ${d.message}`));
            process.exit(1);
        }
        resolution = stage1.resolution;
        ontologyRegistries = stage1.registries;
        const kr = ontologyRegistries?.kindRegistry;
        const rr = ontologyRegistries?.relationshipRegistry;
        console.log(chalk.gray(
            `Resolved: ${kr?.size ?? 0} kinds, ${rr?.size ?? 0} relationships `
            + `(from ${compiler}'s handoff, ${resolution?.closure.size ?? 0} packages)`));
        for (const d of resolution?.diagnostics ?? []) console.log(chalk.yellow(`  ⚠ ${d.code}: ${d.message}`));
    } else {
        const loadResult = await loadOntologyRegistries(projectRoot);
        resolution = loadResult.resolution;
        if (loadResult.fileCount > 0) {
            ontologyRegistries = { ...loadResult.registries, provenance: loadResult.provenance };
            ontologyDocuments = loadResult.parsedDocuments;
            const kr = loadResult.registries.kindRegistry;
            const rr = loadResult.registries.relationshipRegistry;
            console.log(chalk.gray(
                `Resolved: ${kr?.size ?? 0} kinds, ${rr?.size ?? 0} relationships `
                + `(${loadResult.fileCount} SysML files, ${loadResult.ontologyDirs.length} packages)`));
        }
        for (const err of loadResult.errors) console.log(chalk.yellow(`  ⚠ ${err}`));
    }

    if (resolution?.binding) {
        console.log(chalk.gray(
            `Binding: ${resolution.binding.projectName ?? resolution.binding.usageName} → `
            + `${resolution.binding.selectedMethodologyName ?? '(none)'}`));
    }

    // The validator's verdict is diagnostics, not an exception. A tool that
    // rejects the source has done its job and its complaints belong in the
    // report; only a tool that could not be run at all aborts the command,
    // because selecting a missing tool must never downgrade to another provider.
    // When the compiler's own stage 1 is the validator's check (one provider in
    // both roles), its diagnostics are taken from stage 1 below instead of
    // running the same tool twice.
    if (!validatorFromStage1) {
        try {
            const run = await runValidator({ config, projectDir: projectRoot, registry: defaultRegistry });
            sysmlDiagnostics = run.diagnostics;
            console.log(chalk.gray(
                `Validator: ${run.provider}${run.providerVersion ? ` ${run.providerVersion}` : ''}`));
        } catch (error) {
            console.error(chalk.red(`\n❌ ${error instanceof Error ? error.message : error}\n`));
            process.exit(1);
        }
    }

    const lockCheck = checkLockFile(projectRoot, (resolution?.selectedRoots ?? []).map(root => ({
        ...root,
        origin: 'ontology',
        importDepth: 1,
    })));
    if (!lockCheck.ok) {
        console.error(chalk.red(`\n❌ ${lockCheck.message}\n`));
        process.exit(1);
    }
    if (lockCheck.locked) {
        console.log(chalk.gray(`Ontology: locked to ${lockCheck.locked.ontology} v${lockCheck.locked.version}`));
    }

    // 4. The project's own source is everything parsed that belongs to no
    //    library root — selected OR unused.
    //
    //    Subtracting only the SELECTED roots was wrong, and stayed invisible
    //    while every reusable package a locator offered also happened to be
    //    imported. Listing extension packages as library roots produced the
    //    first counterexample: a project that imports no extension reached
    //    them through no import, so they were `unusedRoots` — and every usage
    //    they declare was counted as that project's own model content. A file
    //    from a root the project never imported is not project source; it is
    //    not in the model at all.
    const resolvedRoots = [...(resolution?.selectedRoots ?? []), ...(resolution?.unusedRoots ?? [])];
    const isProjectFile = (file: string) => !resolvedRoots.some(r => file.startsWith(r.sysmlDir));
    const documents = (resolution?.documents ?? []).filter(d => isProjectFile(d.filePath));
    // The same pass that produced those documents produced these, and they are
    // the project's own — a library that will not parse is a different report.
    const parseErrors = (resolution?.parseErrors ?? []).filter(e => isProjectFile(e.file));
    const projectFileCount = stage1 ? projectSourceCount : documents.length;
    if (projectFileCount === 0) {
        console.error(chalk.yellow('⚠️  No project .sysml files found.'));
        return;
    }
    console.log(chalk.gray(`Files: ${projectFileCount} project .sysml files\n`));

    // 5. Build model. Stage 1 built it when the compiler resolved the
    //    project; MEMO's own compiler builds it from its parse.
    const model: ReturnType<typeof buildMemoModel> = stage1?.model
        ?? buildMemoModel(documents, config, parseErrors, ontologyRegistries);
    console.log(chalk.cyan(`Model: ${model.elements.size} elements, ${model.relationships.length} relationships\n`));

    // A short-name collision belongs in this report for exactly the reason a
    // parse error does: an element the project declared is not in the model, so
    // every number below is computed over less than the source says.
    const missingContent = new Set([ELEMENT_NAME_COLLISION, AMBIGUOUS_ELEMENT_REFERENCE]);
    const diagnostics = [
        ...parseErrors,
        ...model.errors.filter(e =>
            e.code !== undefined && missingContent.has(e.code) && isProjectFile(e.file)),
    ];

    // Every other finding the builder raised: an edge whose end is the wrong
    // kind, an end that names nothing, a relationship name used twice. The
    // model loaded; it says something the ontology does not allow. These were
    // computed on every build and read by no command until 2026-09-25, when
    // surfacing them found 72 across three shipped examples. `model.errors`
    // begins with the parse errors it was given, which carry no code, so the
    // code is what tells a builder finding apart.
    const modelFindings = model.errors.filter(e =>
        e.code !== undefined && !missingContent.has(e.code) && isProjectFile(e.file));

    // A file the parser rejected declares less of the model than it says it
    // does, so every number below it — completeness, rules passed, violations
    // — is computed over a model that is missing content. Reported quietly,
    // that reads as PROGRESS: the elements carrying violations never loaded,
    // so the violation total FALLS. Measured 2026-09-19, one file with 805
    // parse errors built 2 elements instead of 124 and validate said "92%
    // complete, 1583 violations, 32 rules passed", down from 1595 — and the
    // drop was committed as work that had not landed.
    //
    // So it is printed before any of those numbers, and it fails the command.
    reportParseErrors(diagnostics, projectRoot);
    reportModelFindings(modelFindings, projectRoot);

    // A selector naming a kind, relationship or attribute the ontology never
    // declared matches nothing — in this model and in every other one, which is
    // why it survives review: an empty view looks exactly like an empty model.
    // Reported here, next to the parse errors, because both mean the report
    // below describes something other than what the source says.
    const selectorDiagnostics = checkSelectorVocabulary(model, {
        kindRegistry: ontologyRegistries?.kindRegistry,
        relationshipRegistry: ontologyRegistries?.relationshipRegistry,
    });
    reportSelectorDiagnostics(selectorDiagnostics, projectRoot);

    // Record the identities this build assigned. `validate` is the command that
    // runs most, so it is where a project first acquires memo.identity.yaml;
    // without this the registry would only appear on a pack or an Architect
    // build, and every validate in between would re-mint identities.
    try {
        const assigned: IdentityRegistry = {};
        for (const el of model.elements.values()) {
            if (!el.shortId && !el.uuid) continue;
            assigned[identityKey(el)] = { shortId: el.shortId, uuid: el.uuid };
        }
        writeIdentityRegistry(projectRoot, assigned, config.priorIdentities ?? {});
    } catch {
        // A read-only checkout still validates; it just cannot record identities.
    }

    // 6. Validate — native ontology constraints (constraint def bodies) + structural checks.
    //    Constraint defs live in the ontology packages (parsed by loadOntologyRegistries),
    //    so collect across both ontology and project documents.
    //    A stage 1 compiler's handoff carries the ontology too, so its rules are
    //    read from that handoff rather than from MEMO's own parse.
    const constraintDiagnostics: ConstraintDiagnostic[] = [];
    const stage1Api = stage1?.model ? stage1.api : undefined;
    // The rules resolution loads: the ontology's and the project's own.
    const loaded = resolution ? resolutionLoads(resolution) : () => true;
    const ruleFileLoaded = (file: string) => loaded(file) || isProjectFile(file);
    const nativeConstraints = stage1Api
        ? collectApiConstraints(stage1Api, constraintDiagnostics, resolution?.filePackages, ruleFileLoaded)
        : collectNativeConstraints([...ontologyDocuments, ...documents], constraintDiagnostics);
    if (nativeConstraints.length > 0) {
        const from = stage1Api ? `${compiler}'s handoff` : 'constraint def bodies';
        console.log(chalk.gray(`Native constraints: ${nativeConstraints.length} (from ${from})`));
    }
    // A rule that failed to load is a check that is not running. Report it
    // prominently: silence here reads as "all rules passed".
    if (constraintDiagnostics.length > 0) {
        console.log(chalk.red(
            `\n⚠  ${constraintDiagnostics.length} rule(s) could not be loaded and are NOT being evaluated:`));
        for (const d of constraintDiagnostics) {
            console.log(chalk.red(`   ${d.ruleId} (${d.file})`));
            console.log(chalk.gray(`     ${d.message}`));
        }
        console.log('');
    }
    // 6a. Effective methodology and the deterministic effective rule set.
    // A module is available when a resolved package supplies it. That is wider
    // than the import closure on purpose: a package the project resolved is
    // resolved in full, and whether the methodology selects it is the next
    // question, not this one.
    const availablePackages = new Set(resolution?.filePackages.values() ?? []);
    const effectiveMethodology = resolveEffectiveMethodology(
        resolution?.binding,
        resolution?.methodologies ?? new Map(),
        availablePackages,
    );
    const scope = buildEffectiveScope(effectiveMethodology);
    for (const d of effectiveMethodology.diagnostics) {
        console.log(chalk.yellow(`  ⚠ ${d.code}: ${d.message}`));
    }

    // Rule activation is shared with `memo rules list` so the two commands
    // cannot report different rule sets for one project.
    const ruleFileToPackage = resolution?.filePackages ?? new Map<string, string>();
    const kindRegistry = ontologyRegistries?.kindRegistry;
    const candidates: RuleCandidate[] = activeRuleCandidates(
        nativeConstraints, scope, ruleFileToPackage,
        kindName => kindRegistry?.getKind(kindName)?.sourceFile,
    );
    const effectiveRules = resolveEffectiveRules(candidates, effectiveMethodology.policyChain);

    // A rule-resolution diagnostic is not advisory. A policy that targets a
    // rule that is not there, or tries to disable an invariant, means the
    // effective rule set is not the one the methodology describes.
    if (effectiveRules.diagnostics.length > 0) {
        console.log(chalk.red.bold(`\nRule resolution (${effectiveRules.diagnostics.length}):`));
        for (const d of effectiveRules.diagnostics) {
            console.log(chalk.red(`  ${d.code}${d.ruleId ? ` [${d.ruleId}]` : ''}: ${d.message}`));
        }
        console.log();
        process.exitCode = 1;
    }

    const disabled = effectiveRules.rules.filter(r => r.disposition !== 'enabled');
    if (disabled.length > 0) {
        console.log(chalk.gray(`Tailored rules (${disabled.length}):`));
        for (const r of disabled) {
            const chain = r.policyChain.map(p => `${p.level}:${p.source}`).join(' → ');
            console.log(chalk.gray(`  ${r.sourceRuleId} ${r.disposition} by ${chain}`));
            if (r.rationaleText) console.log(chalk.gray(`    ${r.rationaleText}`));
        }
        console.log();
    }

    // Rules evaluate over in-scope elements only.
    //
    // A kind can be in scope while a specialization of it is not: GPCA selects
    // safety/risk and excludes cybersecurity, so `Hazard` is in scope and
    // `CyberHazard` is not. Evaluating a risk rule over a cyber hazard reports
    // a violation about content the methodology deliberately excluded, which is
    // noise the reader has to learn to ignore — and a rule set people ignore is
    // worse than one they do not have.
    //
    // The full model is still what gets reported and displayed; only the
    // subject set narrows.
    // Scope decides which elements rules RUN ON. It must not touch the model:
    // see narrowToScope below for what happened when it did.
    const inScopeIds = scope.mode === 'allAvailable' ? undefined : scopeElementIds(model);
    const subjectModel = scope.mode === 'allAvailable' ? model : narrowToScope(model);
    const result = validateModel(
        model, effectiveRules.activeConstraints, ontologyRegistries?.kindRegistry, effectiveRules.rules,
        inScopeIds && (element => inScopeIds.has(element.id)));
    // Completeness reports on what the methodology selected, which is the
    // scoped model — not on content the project deliberately excluded.
    const completeness = computeCompleteness(subjectModel, result);

    /** Subject ids the methodology selected: elements, and named typed edges. */
    function scopeElementIds(full: typeof model): Set<string> {
        return scopedSubjectIds(full, kind => {
            const sourceFile = kindRegistry?.getKind(kind)?.sourceFile;
            const declaringPackage = sourceFile ? ruleFileToPackage.get(sourceFile) : undefined;
            return !declaringPackage || isRulePackageInScope(scope, declaringPackage);
        });
    }

    // Still used for the COMPLETENESS report, which is a statement about what
    // the methodology selected. Rules no longer see it — see the note inside.
    function narrowToScope(full: typeof model): typeof model {
        const kept = new Map<string, typeof model extends { elements: Map<string, infer E> } ? E : never>();
        for (const [id, element] of full.elements) {
            const sourceFile = kindRegistry?.getKind(element.kind)?.sourceFile;
            const declaringPackage = sourceFile ? ruleFileToPackage.get(sourceFile) : undefined;
            // A kind the resolved ontology does not declare is project-local
            // content, which is always in its own project's scope.
            if (!declaringPackage || isRulePackageInScope(scope, declaringPackage)) kept.set(id, element);
        }
        const byKind = new Map<string, any[]>();
        const byLayer = new Map<string, any[]>();
        for (const element of kept.values()) {
            (byKind.get(element.kind) ?? byKind.set(element.kind, []).get(element.kind)!).push(element);
            (byLayer.get(element.layer) ?? byLayer.set(element.layer, []).get(element.layer)!).push(element);
        }
        // Narrow the SUBJECT SET, not the graph.
        //
        // This used to drop out-of-scope elements from `elements` and filter
        // `relationships` to edges with both endpoints kept — while leaving
        // `outgoing`, `incoming` and `relationshipsByType` pointing at the FULL
        // model. The result was a model that contradicted itself, and every
        // rule that NAVIGATES a trace silently saw nothing: `navigate` looks the
        // far endpoint up in `elements`, so an edge to a dropped element
        // returned no result.
        //
        // Measured on gpca-pump (2026-08-19): 374 of 723 elements dropped, and
        // ALL 110 `satisfiedBy` edges lost an endpoint — every architecture
        // element went, because `filePackages` maps every file, so the
        // module-scope test was applied to architecture kinds that
        // `includedLayer` governs instead. XL-002 then reported 89 requirements
        // as lacking requirements-to-architecture traceability that the source
        // plainly traces.
        //
        // The comment above already said the intent: "only the subject set
        // narrows". `subjectsForScope` reads `elementsByKind`, so narrowing
        // that alone is both sufficient and consistent.
        const relationships = full.relationships.filter(r => kept.has(r.sourceId) && kept.has(r.targetId));
        const relationshipsByType = new Map<string, typeof relationships>();
        const outgoing = new Map<string, typeof relationships>();
        const incoming = new Map<string, typeof relationships>();
        for (const r of relationships) {
            (relationshipsByType.get(r.type) ?? relationshipsByType.set(r.type, []).get(r.type)!).push(r);
            (outgoing.get(r.sourceId) ?? outgoing.set(r.sourceId, []).get(r.sourceId)!).push(r);
            (incoming.get(r.targetId) ?? incoming.set(r.targetId, []).get(r.targetId)!).push(r);
        }
        return {
            ...full,
            elements: toElementIndex(kept),
            elementsByKind: byKind,
            elementsByLayer: byLayer,
            relationships,
            relationshipsByType,
            outgoing,
            incoming,
        };
    }

    const errors = result.violations.filter(v => v.severity === 'error');
    const warnings = result.violations.filter(v => v.severity === 'warning');
    const infos = result.violations.filter(v => v.severity === 'info');
    // A validator rejection is a failed run even when every MEMO rule passed:
    // the report would otherwise say "0 errors" about source the toolchain
    // refused.
    const sysmlErrors = countBySeverity(sysmlDiagnostics).error;

    // ─── Output format dispatch ──────────────────────────────────────────────

    if (format === 'junit') {
        const xml = generateJUnit(
            result, completeness, config.projectName || 'memo', diagnostics, modelFindings);
        if (options?.output) {
            writeFileSync(resolve(cwd, options.output), xml);
            console.log(chalk.green(`JUnit XML written to ${options.output}`));
        } else {
            process.stdout.write(xml);
        }
        if (failed()) process.exitCode = 1;
        return;
    }

    if (format === 'json') {
        const jsonOutput = {
            projectName: config.projectName,
            timestamp: new Date().toISOString(),
            summary: {
                elements: model.elements.size,
                relationships: model.relationships.length,
                rulesEvaluated: result.rulesEvaluated,
                rulesPassed: result.rulesPassed,
                rulesVacuous: result.rulesVacuous,
                violations: result.violations.length,
                errors: errors.length,
                warnings: warnings.length,
                infos: infos.length,
                completeness: completeness.overall,
                rulesNotLoaded: constraintDiagnostics.length,
                sysmlErrors,
                parseErrors: diagnostics.length,
                filesNotParsed: filesWithParseErrors(diagnostics).size,
                modelFindings: modelFindings.length,
            },
            parseErrors: diagnostics,
            modelFindings,
            rulesNotLoaded: constraintDiagnostics,
            // The roles the settings fill; a packager is named only by a
            // project that packages.
            toolchain: Object.fromEntries(effectiveToolchain.selections.map(s =>
                [s.role === 'package' ? 'packager' : s.role, s.provider])),
            diagnostics: sysmlDiagnostics,
            violations: result.violations.map(v => ({
                ruleId: v.ruleId,
                severity: v.severity,
                elementId: v.elementId,
                elementKind: v.elementKind,
                elementName: v.elementName,
                description: v.description,
                provenance: v.provenance,
            })),
            completeness: {
                overall: completeness.overall,
                completeElements: completeness.completeElements,
                totalElements: completeness.totalElements,
                layers: completeness.layers.map(l => ({
                    id: l.layerId,
                    label: l.layerLabel,
                    percentage: l.percentage,
                    complete: l.completeElements,
                    total: l.totalElements,
                })),
            },
        };
        const jsonStr = JSON.stringify(jsonOutput, null, 2);
        if (options?.output) {
            writeFileSync(resolve(cwd, options.output), jsonStr);
            console.log(chalk.green(`JSON report written to ${options.output}`));
        } else {
            process.stdout.write(jsonStr + '\n');
        }
        if (failed()) process.exitCode = 1;
        return;
    }

    // ─── Default text output ─────────────────────────────────────────────────

    // GNU one-liners, so an editor or CI annotator that already understands
    // `file:line:col: severity:` picks them up without knowing anything about
    // MEMO. The trailing `[domain/provider]` is additive.
    if (sysmlDiagnostics.length > 0) {
        const counts = countBySeverity(sysmlDiagnostics);
        console.log(chalk.red.bold(
            `SysML diagnostics (${counts.error} error, ${counts.warning} warning, ${counts.info} info):`));
        console.log(formatDiagnosticsText(sysmlDiagnostics));
        console.log();
    }

    if (errors.length > 0) {
        console.log(chalk.red.bold(`Errors (${errors.length}):`));
        for (const v of errors) {
            console.log(chalk.red(`  ✖ [${v.ruleId}] ${v.elementKind}/${v.elementName}: ${v.description}`));
        }
        console.log();
    }

    if (warnings.length > 0) {
        console.log(chalk.yellow.bold(`Warnings (${warnings.length}):`));
        for (const v of warnings) {
            console.log(chalk.yellow(`  ⚠ [${v.ruleId}] ${v.elementKind}/${v.elementName}: ${v.description}`));
        }
        console.log();
    }

    if (infos.length > 0) {
        console.log(chalk.blue.bold(`Info (${infos.length}):`));
        for (const v of infos) {
            console.log(chalk.blue(`  ℹ [${v.ruleId}] ${v.elementKind}/${v.elementName}: ${v.description}`));
        }
        console.log();
    }

    console.log(chalk.bold('Completeness by Layer:'));
    for (const layer of completeness.layers) {
        if (layer.totalElements === 0) continue;
        const pct = layer.percentage;
        const color = pct >= 80 ? chalk.green : pct >= 50 ? chalk.yellow : chalk.red;
        const bar = makeBar(pct);
        console.log(`  ${layer.layerLabel.padEnd(22)} ${color(bar)} ${color(`${pct}%`)} (${layer.completeElements}/${layer.totalElements})`);
    }

    console.log();
    const overallColor = completeness.overall >= 80 ? chalk.green : completeness.overall >= 50 ? chalk.yellow : chalk.red;
    console.log(chalk.bold(`Overall: ${overallColor(completeness.overall + '%')} (${completeness.completeElements}/${completeness.totalElements} elements complete)`));
    console.log(chalk.gray(`Rules: ${result.rulesEvaluated} evaluated, ${result.rulesPassed} passed, `
        + `${result.rulesVacuous} ran on no subject, ${result.violations.length} violations`));
    const parseErrorFiles = filesWithParseErrors(diagnostics).size;
    console.log((diagnostics.length > 0 ? chalk.red : chalk.gray)(
        `Parse errors: ${diagnostics.length}`
        + (diagnostics.length > 0
            ? ` in ${parseErrorFiles} file(s) \u2014 this report describes an incomplete model`
            : '')));
    console.log((modelFindings.length > 0 ? chalk.red : chalk.gray)(
        `Model findings: ${modelFindings.length}`));
    console.log();

    if (failed()) {
        process.exitCode = 1;
    }

    /**
     * Whether this run is a failure.
     *
     * A parse error counts, and it counts first: a source file the parser
     * rejected cannot produce a success verdict, however healthy the numbers
     * computed from what did load happen to look.
     */
    function failed(): boolean {
        return errors.length > 0 || sysmlErrors > 0 || diagnostics.length > 0
            || modelFindings.length > 0 || selectorDiagnostics.length > 0;
    }
}

/** Parse errors grouped by the file that produced them. */
function filesWithParseErrors(
    parseErrors: readonly import('@memoarchitect/tools').ParseError[],
): Map<string, number> {
    const byFile = new Map<string, number>();
    for (const e of parseErrors) byFile.set(e.file, (byFile.get(e.file) ?? 0) + 1);
    return byFile;
}

/** How many individual errors are listed before the rest are summarised. */
const PARSE_ERRORS_LISTED = 10;

function reportParseErrors(
    parseErrors: readonly import('@memoarchitect/tools').ParseError[],
    projectRoot: string,
): void {
    if (parseErrors.length === 0) return;
    const show = (file: string) => (file.startsWith(projectRoot) ? relative(projectRoot, file) : file);
    const byFile = filesWithParseErrors(parseErrors);
    console.log(chalk.red.bold(
        `\u26d4 ${parseErrors.length} parse error(s) in ${byFile.size} file(s). `
        + 'Whatever those files declare past the error is missing from the model, '
        + 'so every count below is a count of less than the project:'));
    for (const [file, count] of byFile) {
        console.log(chalk.red(`   ${show(file)} (${count})`));
    }
    // GNU one-liners, the same prefix the SysML diagnostics use, so an editor
    // or CI annotator picks them up without knowing anything about MEMO.
    for (const e of parseErrors.slice(0, PARSE_ERRORS_LISTED)) {
        // A message may name a second location of its own — the other half of
        // a short-name collision does — so the same relativization is applied
        // inside it. An absolute path from a build machine is noise in a report
        // read next to relative ones.
        const message = e.message.split(`${projectRoot}/`).join('');
        console.log(chalk.gray(`     ${show(e.file)}:${e.line ?? 1}:${e.column ?? 1}: error: ${message}`));
    }
    if (parseErrors.length > PARSE_ERRORS_LISTED) {
        console.log(chalk.gray(`     \u2026 and ${parseErrors.length - PARSE_ERRORS_LISTED} more`));
    }
    console.log('');
}

/**
 * Print every builder finding on a model that did load.
 *
 * All of them, with no elision, for the reason the selector list has none:
 * each one is an edge to fix, and "and 57 more" is how 67 of them went
 * unread in the first place.
 */
function reportModelFindings(
    findings: readonly import('@memoarchitect/tools').ParseError[],
    projectRoot: string,
): void {
    if (findings.length === 0) return;
    const show = (file: string) => (file.startsWith(projectRoot) ? relative(projectRoot, file) : file);
    console.log(chalk.red.bold(
        `\u26d4 ${findings.length} model finding(s). The model loaded, and says something `
        + 'the ontology does not allow:'));
    for (const f of findings) {
        const message = f.message.split(`${projectRoot}/`).join('');
        console.log(chalk.gray(
            `     ${show(f.file)}:${f.line ?? 1}:${f.column ?? 1}: error: ${message} [${f.code}]`));
    }
    console.log('');
}

/**
 * Print every selector that names something no resolved ontology declares.
 *
 * All of them, with no elision: the list is short by construction — a selector
 * is written by hand — and the whole value of the check is that the offending
 * name is spelled out next to where it was written.
 */
function reportSelectorDiagnostics(
    selectorDiagnostics: readonly SelectorVocabularyDiagnostic[],
    projectRoot: string,
): void {
    if (selectorDiagnostics.length === 0) return;
    const show = (file: string) => (file.startsWith(projectRoot) ? relative(projectRoot, file) : file);
    console.log(chalk.red.bold(
        `\u26d4 ${selectorDiagnostics.length} selector(s) name vocabulary no resolved ontology `
        + 'declares. Each one matches nothing, whatever the model contains:'));
    for (const d of selectorDiagnostics) {
        console.log(chalk.gray(
            `     ${show(d.file)}: error: ${d.message}`));
    }
    console.log('');
}

// ─── JUnit XML Generator ─────────────────────────────────────────────────────

function generateJUnit(
    result: ReturnType<typeof validateModel>,
    completeness: ReturnType<typeof computeCompleteness>,
    projectName: string,
    parseErrors: readonly import('@memoarchitect/tools').ParseError[] = [],
    modelFindings: readonly import('@memoarchitect/tools').ParseError[] = [],
): string {
    const escXml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

    const errors = result.violations.filter(v => v.severity === 'error');
    const warnings = result.violations.filter(v => v.severity === 'warning');
    // A file that did not parse is its own failed test. Counted only through
    // the rules, a green suite would report on a model missing the content
    // that file declares.
    const parseErrorFiles = [...filesWithParseErrors(parseErrors)];
    const allTests = result.rulesEvaluated + parseErrorFiles.length + modelFindings.length;
    const failures = errors.length + parseErrorFiles.length + modelFindings.length;
    // A rule that ran on no subject tested nothing. It is reported as skipped
    // so a CI dashboard cannot count it towards the green.
    const skipped = result.rulesVacuous;

    const lines: string[] = [
        '<?xml version="1.0" encoding="UTF-8"?>',
        `<testsuites name="${escXml(projectName)}" tests="${allTests}" failures="${failures}" errors="0" skipped="${skipped}" timestamp="${new Date().toISOString()}">`,
        `  <testsuite name="closure-rules" tests="${allTests}" failures="${failures}" errors="0" skipped="${skipped}">`,
        `    <properties>`,
        `      <property name="completeness" value="${completeness.overall}%" />`,
        `      <property name="elements" value="${completeness.totalElements}" />`,
        `      <property name="warnings" value="${warnings.length}" />`,
        `    </properties>`,
    ];

    for (const [file, count] of parseErrorFiles) {
        const message = `${count} parse error(s); this file's content is missing from the model`;
        lines.push(`    <testcase classname="parse" name="${escXml(file)}">`);
        lines.push(`      <failure message="${escXml(message)}" type="PARSE_ERROR">`);
        for (const e of parseErrors.filter(e => e.file === file)) {
            lines.push(`        ${escXml(`${e.file}:${e.line ?? 1}:${e.column ?? 1}: error: ${e.message}`)}`);
        }
        lines.push(`      </failure>`);
        lines.push(`    </testcase>`);
    }

    for (const f of modelFindings) {
        lines.push(`    <testcase classname="model.${escXml(f.code ?? 'finding')}" name="${escXml(`${f.file}:${f.line ?? 1}`)}">`);
        lines.push(`      <failure message="${escXml(f.message)}" type="${escXml(f.code ?? 'MODEL_FINDING')}" />`);
        lines.push(`    </testcase>`);
    }

    // Each violation becomes a test case
    for (const v of result.violations) {
        const className = `${v.elementKind}.${escXml(v.elementName)}`;
        const testName = `[${v.ruleId}] ${escXml(v.description)}`;

        if (v.severity === 'error') {
            lines.push(`    <testcase classname="${className}" name="${testName}">`);
            lines.push(`      <failure message="${escXml(v.description)}" type="${v.ruleId}">`);
            lines.push(`        ${escXml(v.ruleId)}: ${escXml(v.description)} (element: ${escXml(v.elementName)}, kind: ${escXml(v.elementKind)})`);
            lines.push(`      </failure>`);
            lines.push(`    </testcase>`);
        } else if (v.severity === 'warning') {
            lines.push(`    <testcase classname="${className}" name="${testName}">`);
            lines.push(`      <system-out>WARNING: ${escXml(v.description)}</system-out>`);
            lines.push(`    </testcase>`);
        } else {
            lines.push(`    <testcase classname="${className}" name="${testName}" />`);
        }
    }

    // Passing rules (no violations = passed)
    const passedCount = result.rulesPassed;
    if (passedCount > 0) {
        lines.push(`    <testcase classname="summary" name="${passedCount} rules passed with no violations" />`);
    }

    lines.push(`  </testsuite>`);
    lines.push(`</testsuites>`);

    return lines.join('\n') + '\n';
}

function makeBar(pct: number, width: number = 20): string {
    const filled = Math.round(pct / 100 * width);
    return '█'.repeat(filled) + '░'.repeat(width - filled);
}
