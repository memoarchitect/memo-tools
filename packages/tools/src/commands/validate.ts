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
    loadProjectSettings,
    findProjectRoot,
    resolveEffectiveMethodology,
    buildEffectiveScope,
    resolveProjectRules,
    isRulePackageInScope,
    scopedSubjectIds,
    checkSemanticFields,
} from '@memoarchitect/tools';
import type { BuilderRegistries, MemoModel, ParseError } from '@memoarchitect/tools';
import { ELEMENT_NAME_COLLISION, AMBIGUOUS_ELEMENT_REFERENCE, toElementIndex } from '@memoarchitect/tools';
import {
    validateModel, collectApiConstraints, type ConstraintDiagnostic,
} from '@memoarchitect/tools';
import { checkSelectorVocabulary, type SelectorVocabularyDiagnostic } from '@memoarchitect/tools';
import { computeCompleteness } from '@memoarchitect/tools';
import { checkLockFile } from '../lock.js';
import { runValidator } from '../toolchain/operations.js';
import { resolveToolchain } from '../toolchain/effective.js';
import { defaultRegistry } from '../toolchain/default-registry.js';
import { compileResolvedProject, compileServesValidator } from '../toolchain/operations.js';
import type { CompileModelResult } from '../toolchain/registry.js';
import { discoverProjectSources, type NativeProjectResolution } from '../model/native-project.js';
import { resolutionLoads } from '../stage2/project-from-api.js';
import { stage1CacheDir } from '../toolchain/project-model.js';
import { withToolchainOverrides } from '../toolchain/schema.js';
import { countBySeverity, formatDiagnosticsText, type Diagnostic } from '../toolchain/diagnostic.js';
import { servable, validateWithDevServer } from './validate-client.js';


export type ValidateFormat = 'text' | 'junit' | 'json';

export type ValidateOptions = { format?: ValidateFormat; output?: string } & Record<string, unknown>;

/**
 * Where a validation run writes: progress and the text report (`out`), what
 * must stay off a machine-readable stdout (`err`), and a report written whole
 * (`write`). The CLI passes the console; `memo dev` captures it to answer a
 * `memo validate` that asked it (see validate-client.ts).
 */
export interface ValidationIO {
    out(...args: unknown[]): void;
    err(...args: unknown[]): void;
    write(text: string): void;
}

/** Stage 1 for a validation run: compiled here, or the model `memo dev` holds. */
export type ValidationCompile = typeof compileResolvedProject;

/** A run that stops early with this exit code; thrown, never left to escape. */
export class ValidationExit extends Error {
    constructor(readonly code: number) {
        super(`validation stopped with exit code ${code}`);
    }
}

/** The console, as the CLI writes. */
export const consoleIO: ValidationIO = {
    out: (...args) => console.log(...args),
    err: (...args) => console.error(...args),
    write: text => { process.stdout.write(text); },
};

/** Runs a validation, stopping early with its code instead of throwing. */
export async function validationExitCode(run: () => Promise<number>): Promise<number> {
    try {
        return await run();
    } catch (error) {
        if (error instanceof ValidationExit) return error.code;
        throw error;
    }
}

export async function validateCommand(
    projectDir?: string,
    options?: ValidateOptions,
): Promise<void> {
    // A running `memo dev` holds the compiled model already: ask it first.
    const cwd = resolve(projectDir || process.cwd());
    const projectRoot = servable(options) ? findProjectRoot(cwd) : undefined;
    const served = projectRoot ? await validateWithDevServer(projectRoot, process.cwd(), options) : undefined;
    if (served) {
        process.stderr.write(chalk.gray(`(answered by the dev server running for this project, from the model it holds; --no-server to compile here)\n`));
        process.stderr.write(served.stderr);
        process.stdout.write(served.stdout);
        if (served.exitCode !== 0) process.exitCode = served.exitCode;
        return;
    }
    const code = await validationExitCode(() => runValidation(projectDir, options, consoleIO));
    if (code !== 0) process.exitCode = code;
}

export async function runValidation(
    projectDir: string | undefined,
    options: ValidateOptions | undefined,
    io: ValidationIO,
    compile: ValidationCompile = compileResolvedProject,
): Promise<number> {
    let exitCode = 0;
    const format = options?.format || 'text';
    // A report written to stdout (json or junit without -o) is the whole of
    // stdout, so a script can parse it; the progress goes to stderr.
    const say: (...args: unknown[]) => void = format !== 'text' && !options?.output ? io.err : io.out;
    const cwd = resolve(projectDir || process.cwd());
    say(chalk.bold('\n📋 MEMO Validate\n'));

    // 1. Find the project by its native entrypoint, not by a settings file.
    const projectRoot = findProjectRoot(cwd);
    if (!projectRoot) {
        io.err(chalk.red(
            '❌ No MEMO project found. A project is located by the `entrypoint` in its '
            + '`memo.package.yaml`, which names the SysML file declaring its identity '
            + 'and method binding — run `memo-architect init` to scaffold one.'));
        throw new ValidationExit(1);
    }
    say(chalk.gray(`Project root: ${projectRoot}`));

    // 2. Reject semantic configuration before anything reads it.
    const rejections = checkSemanticFields(projectRoot);
    if (rejections.length > 0) {
        io.err(chalk.red(`\n❌ Semantic configuration found in application settings (${rejections.length}):\n`));
        for (const r of rejections) {
            io.err(chalk.red(`  ${r.file}`));
            io.err(chalk.gray(`    ${r.message}\n`));
        }
        throw new ValidationExit(1);
    }

    const config = withToolchainOverrides(
        loadProjectSettings(projectRoot), options ?? {}, defaultRegistry);
    const effectiveToolchain = resolveToolchain(config, defaultRegistry);
    for (const note of effectiveToolchain.deprecations) say(chalk.yellow(`  ⚠ ${note}`));

    // 3. Resolve the project: imports and the method binding decide everything
    //    about what is loaded. The compiler resolves it from what it compiled —
    //    every library root a locator offers, the import closure deciding which
    //    is the ontology — so MEMO parses nothing.
    const compiler = effectiveToolchain.lowering;
    const validatorFromStage1 = compileServesValidator(config, defaultRegistry);
    let sysmlDiagnostics: Diagnostic[] = [];
    let ontologyRegistries: BuilderRegistries | undefined;
    let resolution: NativeProjectResolution | undefined;
    let stage1: CompileModelResult;
    const projectSourceCount = discoverProjectSources(projectRoot).projectFiles.length;
    {
        try {
            // Reuses a fresh `memo compile`.
            stage1 = await compile({ config, projectDir: projectRoot, cacheDir: stage1CacheDir(projectRoot) });
        } catch (error) {
            io.err(chalk.red(`\n❌ ${error instanceof Error ? error.message : error}\n`));
            throw new ValidationExit(1);
        }
        say(chalk.gray(`Stage 1: ${compiler} ${stage1.providerVersion ?? ''} — ${stage1.accepted ? 'clean' : 'errors'}${stage1.cached ? ' (reused .memo/stage1)' : ''}`));
        if (validatorFromStage1) {
            sysmlDiagnostics = stage1.diagnostics;
            say(chalk.gray(`Validator: ${compiler} ${stage1.providerVersion ?? ''} (stage 1's check)`));
        }
        // A stage 1 that reports an error stops here: stage 2 and the rules
        // never run on a model that is not valid SysML.
        if (!stage1.accepted || !stage1.model) {
            const errors = stage1.diagnostics.filter(d => d.severity === 'error');
            io.err(chalk.red(`\n❌ Stage 1 (${compiler}) reported ${errors.length} error(s); stage 2 and the rules did not run.\n`));
            for (const d of errors) io.err(chalk.red(`  ${d.file}:${d.range?.start.line ?? '?'}:${d.range?.start.column ?? '?'} ${d.code ?? ''} ${d.message}`));
            throw new ValidationExit(1);
        }
        resolution = stage1.resolution;
        ontologyRegistries = stage1.registries;
        const kr = ontologyRegistries?.kindRegistry;
        const rr = ontologyRegistries?.relationshipRegistry;
        say(chalk.gray(
            `Resolved: ${kr?.size ?? 0} kinds, ${rr?.size ?? 0} relationships `
            + `(from ${compiler}'s handoff, ${resolution?.closure.size ?? 0} packages)`));
        for (const d of resolution?.diagnostics ?? []) say(chalk.yellow(`  ⚠ ${d.code}: ${d.message}`));
    }

    if (resolution?.binding) {
        say(chalk.gray(
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
            say(chalk.gray(
                `Validator: ${run.provider}${run.providerVersion ? ` ${run.providerVersion}` : ''}`));
        } catch (error) {
            io.err(chalk.red(`\n❌ ${error instanceof Error ? error.message : error}\n`));
            throw new ValidationExit(1);
        }
    }

    const lockCheck = checkLockFile(projectRoot, (resolution?.selectedRoots ?? []).map(root => ({
        ...root,
        origin: 'ontology',
        importDepth: 1,
    })));
    if (!lockCheck.ok) {
        io.err(chalk.red(`\n❌ ${lockCheck.message}\n`));
        throw new ValidationExit(1);
    }
    if (lockCheck.locked) {
        say(chalk.gray(`Ontology: locked to ${lockCheck.locked.ontology} v${lockCheck.locked.version}`));
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
    // Stage 1 was clean, so nothing the project declares failed to parse.
    const parseErrors: ParseError[] = [];
    const projectFileCount = projectSourceCount;
    if (projectFileCount === 0) {
        io.err(chalk.yellow('⚠️  No project .sysml files found.'));
        return exitCode;
    }
    say(chalk.gray(`Files: ${projectFileCount} project .sysml files\n`));

    // 5. The model stage 1 built from its handoff.
    const model: MemoModel = stage1.model!;
    say(chalk.cyan(`Model: ${model.elements.size} elements, ${model.relationships.length} relationships\n`));

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
    reportParseErrors(diagnostics, projectRoot, say);
    reportModelFindings(modelFindings, projectRoot, say);

    // A selector naming a kind, relationship or attribute the ontology never
    // declared matches nothing — in this model and in every other one, which is
    // why it survives review: an empty view looks exactly like an empty model.
    // Reported here, next to the parse errors, because both mean the report
    // below describes something other than what the source says.
    const selectorDiagnostics = checkSelectorVocabulary(model, {
        kindRegistry: ontologyRegistries?.kindRegistry,
        relationshipRegistry: ontologyRegistries?.relationshipRegistry,
    });
    reportSelectorDiagnostics(selectorDiagnostics, projectRoot, say);

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
    //    The compiler's handoff carries the ontology, so its rules are read from
    //    that handoff.
    const constraintDiagnostics: ConstraintDiagnostic[] = [];
    const stage1Api = stage1.api!;
    // The rules resolution loads: the ontology's and the project's own.
    const loaded = resolution ? resolutionLoads(resolution) : () => true;
    const ruleFileLoaded = (file: string) => loaded(file) || isProjectFile(file);
    const nativeConstraints = collectApiConstraints(stage1Api, constraintDiagnostics, resolution?.filePackages, ruleFileLoaded);
    if (nativeConstraints.length > 0) {
        say(chalk.gray(`Native constraints: ${nativeConstraints.length} (from ${compiler}'s handoff)`));
    }
    // A rule that failed to load is a check that is not running. Report it
    // prominently: silence here reads as "all rules passed".
    if (constraintDiagnostics.length > 0) {
        say(chalk.red(
            `\n⚠  ${constraintDiagnostics.length} rule(s) could not be loaded and are NOT being evaluated:`));
        for (const d of constraintDiagnostics) {
            say(chalk.red(`   ${d.ruleId} (${d.file})`));
            say(chalk.gray(`     ${d.message}`));
        }
        say('');
    }
    // 6a. Effective methodology and the deterministic effective rule set.
    const effectiveMethodology = resolveEffectiveMethodology(
        resolution?.binding,
        resolution?.methodologies ?? new Map(),
        resolution?.publicImports ?? new Map(),
    );
    const scope = buildEffectiveScope(effectiveMethodology);
    // A methodology diagnostic is not advisory either. A module, layer or base
    // the methodology names and the project cannot resolve selects nothing, so
    // the rule set that ran is not the one the methodology describes, and a
    // narrower rule set reads exactly like a cleaner model. It fails the run
    // the way a rule-resolution diagnostic does.
    if (effectiveMethodology.diagnostics.length > 0) {
        say(chalk.red.bold(`\nMethodology resolution (${effectiveMethodology.diagnostics.length}):`));
        for (const d of effectiveMethodology.diagnostics) {
            say(chalk.red(`  ${d.code}: ${d.message}`));
        }
        say();
        exitCode = 1;
    }

    // Rule activation is shared with `memo validate --rules` so the two commands
    // cannot report different rule sets for one project.
    const ruleFileToPackage = resolution?.filePackages ?? new Map<string, string>();
    const kindRegistry = ontologyRegistries?.kindRegistry;
    const { rules: effectiveRules } = resolveProjectRules({
        constraints: nativeConstraints,
        effective: effectiveMethodology,
        filePackages: ruleFileToPackage,
        kindSourceFile: kindName => kindRegistry?.getKind(kindName)?.sourceFile,
        isOwnFile: isProjectFile,
    });

    // A rule-resolution diagnostic is not advisory. A policy that targets a
    // rule that is not there, or tries to disable an invariant, means the
    // effective rule set is not the one the methodology describes.
    if (effectiveRules.diagnostics.length > 0) {
        say(chalk.red.bold(`\nRule resolution (${effectiveRules.diagnostics.length}):`));
        for (const d of effectiveRules.diagnostics) {
            say(chalk.red(`  ${d.code}${d.ruleId ? ` [${d.ruleId}]` : ''}: ${d.message}`));
        }
        say();
        exitCode = 1;
    }

    const disabled = effectiveRules.rules.filter(r => r.disposition !== 'enabled');
    if (disabled.length > 0) {
        say(chalk.gray(`Tailored rules (${disabled.length}):`));
        for (const r of disabled) {
            const chain = r.policyChain.map(p => `${p.level}:${p.source}`).join(' → ');
            say(chalk.gray(`  ${r.sourceRuleId} ${r.disposition} by ${chain}`));
            if (r.rationaleText) say(chalk.gray(`    ${r.rationaleText}`));
        }
        say();
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
        // the layer selection governs instead. XL-002 then reported 89 requirements
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
            io.out(chalk.green(`JUnit XML written to ${options.output}`));
        } else {
            io.write(xml);
        }
        if (failed()) exitCode = 1;
        return exitCode;
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
            io.out(chalk.green(`JSON report written to ${options.output}`));
        } else {
            io.write(jsonStr + '\n');
        }
        if (failed()) exitCode = 1;
        return exitCode;
    }

    // ─── Default text output ─────────────────────────────────────────────────

    // GNU one-liners, so an editor or CI annotator that already understands
    // `file:line:col: severity:` picks them up without knowing anything about
    // MEMO. The trailing `[domain/provider]` is additive.
    if (sysmlDiagnostics.length > 0) {
        const counts = countBySeverity(sysmlDiagnostics);
        io.out(chalk.red.bold(
            `SysML diagnostics (${counts.error} error, ${counts.warning} warning, ${counts.info} info):`));
        io.out(formatDiagnosticsText(sysmlDiagnostics));
        io.out();
    }

    if (errors.length > 0) {
        io.out(chalk.red.bold(`Errors (${errors.length}):`));
        for (const v of errors) {
            io.out(chalk.red(`  ✖ [${v.ruleId}] ${v.elementKind}/${v.elementName}: ${v.description}`));
        }
        io.out();
    }

    if (warnings.length > 0) {
        io.out(chalk.yellow.bold(`Warnings (${warnings.length}):`));
        for (const v of warnings) {
            io.out(chalk.yellow(`  ⚠ [${v.ruleId}] ${v.elementKind}/${v.elementName}: ${v.description}`));
        }
        io.out();
    }

    if (infos.length > 0) {
        io.out(chalk.blue.bold(`Info (${infos.length}):`));
        for (const v of infos) {
            io.out(chalk.blue(`  ℹ [${v.ruleId}] ${v.elementKind}/${v.elementName}: ${v.description}`));
        }
        io.out();
    }

    io.out(chalk.bold('Completeness by Layer:'));
    for (const layer of completeness.layers) {
        if (layer.totalElements === 0) continue;
        const pct = layer.percentage;
        const color = pct >= 80 ? chalk.green : pct >= 50 ? chalk.yellow : chalk.red;
        const bar = makeBar(pct);
        io.out(`  ${layer.layerLabel.padEnd(22)} ${color(bar)} ${color(`${pct}%`)} (${layer.completeElements}/${layer.totalElements})`);
    }

    io.out();
    const overallColor = completeness.overall >= 80 ? chalk.green : completeness.overall >= 50 ? chalk.yellow : chalk.red;
    io.out(chalk.bold(`Overall: ${overallColor(completeness.overall + '%')} (${completeness.completeElements}/${completeness.totalElements} elements complete)`));
    io.out(chalk.gray(`Rules: ${result.rulesEvaluated} evaluated, ${result.rulesPassed} passed, `
        + `${result.rulesVacuous} ran on no subject, ${result.violations.length} violations`));
    const parseErrorFiles = filesWithParseErrors(diagnostics).size;
    io.out((diagnostics.length > 0 ? chalk.red : chalk.gray)(
        `Parse errors: ${diagnostics.length}`
        + (diagnostics.length > 0
            ? ` in ${parseErrorFiles} file(s) \u2014 this report describes an incomplete model`
            : '')));
    io.out((modelFindings.length > 0 ? chalk.red : chalk.gray)(
        `Model findings: ${modelFindings.length}`));
    io.out();

    if (failed()) {
        exitCode = 1;
    }
    return exitCode;

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
    say: (...args: unknown[]) => void,
): void {
    if (parseErrors.length === 0) return;
    const show = (file: string) => (file.startsWith(projectRoot) ? relative(projectRoot, file) : file);
    const byFile = filesWithParseErrors(parseErrors);
    say(chalk.red.bold(
        `\u26d4 ${parseErrors.length} parse error(s) in ${byFile.size} file(s). `
        + 'Whatever those files declare past the error is missing from the model, '
        + 'so every count below is a count of less than the project:'));
    for (const [file, count] of byFile) {
        say(chalk.red(`   ${show(file)} (${count})`));
    }
    // GNU one-liners, the same prefix the SysML diagnostics use, so an editor
    // or CI annotator picks them up without knowing anything about MEMO.
    for (const e of parseErrors.slice(0, PARSE_ERRORS_LISTED)) {
        // A message may name a second location of its own — the other half of
        // a short-name collision does — so the same relativization is applied
        // inside it. An absolute path from a build machine is noise in a report
        // read next to relative ones.
        const message = e.message.split(`${projectRoot}/`).join('');
        say(chalk.gray(`     ${show(e.file)}:${e.line ?? 1}:${e.column ?? 1}: error: ${message}`));
    }
    if (parseErrors.length > PARSE_ERRORS_LISTED) {
        say(chalk.gray(`     \u2026 and ${parseErrors.length - PARSE_ERRORS_LISTED} more`));
    }
    say('');
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
    say: (...args: unknown[]) => void,
): void {
    if (findings.length === 0) return;
    const show = (file: string) => (file.startsWith(projectRoot) ? relative(projectRoot, file) : file);
    say(chalk.red.bold(
        `\u26d4 ${findings.length} model finding(s). The model loaded, and says something `
        + 'the ontology does not allow:'));
    for (const f of findings) {
        const message = f.message.split(`${projectRoot}/`).join('');
        say(chalk.gray(
            `     ${show(f.file)}:${f.line ?? 1}:${f.column ?? 1}: error: ${message} [${f.code}]`));
    }
    say('');
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
    say: (...args: unknown[]) => void,
): void {
    if (selectorDiagnostics.length === 0) return;
    const show = (file: string) => (file.startsWith(projectRoot) ? relative(projectRoot, file) : file);
    say(chalk.red.bold(
        `\u26d4 ${selectorDiagnostics.length} selector(s) name vocabulary no resolved ontology `
        + 'declares. Each one matches nothing, whatever the model contains:'));
    for (const d of selectorDiagnostics) {
        say(chalk.gray(
            `     ${show(d.file)}: error: ${d.message}`));
    }
    say('');
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
