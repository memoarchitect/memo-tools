// ─── memo validate ───────────────────────────────────────────────────────────
//
// Parses all .sysml files, builds the model, evaluates closure rules,
// and prints a completeness report.
// ─────────────────────────────────────────────────────────────────────────────

import { resolve } from 'node:path';
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
    checkSemanticFields,
    type RuleCandidate,
} from '@memoarchitect/tools';
import type { BuilderRegistries, ParsedDocument } from '@memoarchitect/tools';
import { validateModel, collectNativeConstraints, type ConstraintDiagnostic } from '@memoarchitect/tools';
import { computeCompleteness } from '@memoarchitect/tools';
import { checkLockFile } from '../lock.js';
import { runValidator } from '../toolchain/operations.js';
import { resolveToolchain } from '../toolchain/effective.js';
import { defaultRegistry } from '../toolchain/default-registry.js';
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
    //    everything about what is loaded.
    let ontologyRegistries: BuilderRegistries | undefined;
    let ontologyDocuments: ParsedDocument[] = [];
    const loadResult = await loadOntologyRegistries(projectRoot);
    const resolution = loadResult.resolution;
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

    if (resolution?.binding) {
        console.log(chalk.gray(
            `Binding: ${resolution.binding.projectName ?? resolution.binding.usageName} → `
            + `${resolution.binding.selectedMethodologyName ?? '(none)'}`));
    }

    // The validator's verdict is diagnostics, not an exception. A tool that
    // rejects the source has done its job and its complaints belong in the
    // report; only a tool that could not be run at all aborts the command,
    // because selecting a missing tool must never downgrade to another provider.
    let sysmlDiagnostics: Diagnostic[] = [];
    try {
        const run = await runValidator({ config, projectDir: projectRoot, registry: defaultRegistry });
        sysmlDiagnostics = run.diagnostics;
        console.log(chalk.gray(
            `Validator: ${run.provider}${run.providerVersion ? ` ${run.providerVersion}` : ''}`));
    } catch (error) {
        console.error(chalk.red(`\n❌ ${error instanceof Error ? error.message : error}\n`));
        process.exit(1);
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
    const documents = (resolution?.documents ?? []).filter(
        d => !resolvedRoots.some(r => d.filePath.startsWith(r.sysmlDir)),
    );
    const parseErrors: import('@memoarchitect/tools').ParseError[] = [];
    if (documents.length === 0) {
        console.error(chalk.yellow('⚠️  No project .sysml files found.'));
        return;
    }
    console.log(chalk.gray(`Files: ${documents.length} project .sysml files\n`));

    // 5. Build model
    const model = buildMemoModel(documents, config, parseErrors, ontologyRegistries);
    console.log(chalk.cyan(`Model: ${model.elements.size} elements, ${model.relationships.length} relationships\n`));

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
    const constraintDiagnostics: ConstraintDiagnostic[] = [];
    const nativeConstraints = collectNativeConstraints(
        [...ontologyDocuments, ...documents], constraintDiagnostics);
    if (nativeConstraints.length > 0) {
        console.log(chalk.gray(`Native constraints: ${nativeConstraints.length} (from constraint def bodies)`));
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
    const subjectModel = scope.mode === 'allAvailable' ? model : narrowToScope(model);
    const result = validateModel(
        subjectModel, effectiveRules.activeConstraints, ontologyRegistries?.kindRegistry, effectiveRules.rules);
    // Completeness reports on what the methodology selected, which is the
    // scoped model — not on content the project deliberately excluded.
    const completeness = computeCompleteness(subjectModel, result);

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
        return {
            ...full,
            elements: kept,
            elementsByKind: byKind,
            elementsByLayer: byLayer,
            relationships: full.relationships.filter(r => kept.has(r.sourceId) && kept.has(r.targetId)),
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
        const xml = generateJUnit(result, completeness, config.projectName || 'memo');
        if (options?.output) {
            writeFileSync(resolve(cwd, options.output), xml);
            console.log(chalk.green(`JUnit XML written to ${options.output}`));
        } else {
            process.stdout.write(xml);
        }
        if (errors.length > 0 || sysmlErrors > 0) process.exitCode = 1;
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
                violations: result.violations.length,
                errors: errors.length,
                warnings: warnings.length,
                infos: infos.length,
                completeness: completeness.overall,
                rulesNotLoaded: constraintDiagnostics.length,
                sysmlErrors,
            },
            rulesNotLoaded: constraintDiagnostics,
            toolchain: {
                validator: effectiveToolchain.validator,
                lowering: effectiveToolchain.lowering,
                packager: effectiveToolchain.packager,
            },
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
        if (errors.length > 0 || sysmlErrors > 0) process.exitCode = 1;
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
    console.log(chalk.gray(`Rules: ${result.rulesEvaluated} evaluated, ${result.rulesPassed} passed, ${result.violations.length} violations\n`));

    if (errors.length > 0 || sysmlErrors > 0) {
        process.exitCode = 1;
    }
}

// ─── JUnit XML Generator ─────────────────────────────────────────────────────

function generateJUnit(
    result: ReturnType<typeof validateModel>,
    completeness: ReturnType<typeof computeCompleteness>,
    projectName: string,
): string {
    const escXml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

    const errors = result.violations.filter(v => v.severity === 'error');
    const warnings = result.violations.filter(v => v.severity === 'warning');
    const allTests = result.rulesEvaluated;
    const failures = errors.length;
    const skipped = 0;

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
