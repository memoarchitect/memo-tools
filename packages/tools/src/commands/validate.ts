// ─── memo validate ───────────────────────────────────────────────────────────
//
// Parses all .sysml files, builds the model, evaluates closure rules,
// and prints a completeness report.
// ─────────────────────────────────────────────────────────────────────────────

import { resolve } from 'node:path';
import { writeFileSync } from 'node:fs';
import chalk from 'chalk';
import {
    compileWithConfiguredTool,
    buildMemoModel,
    loadOntologyRegistries,
    loadProjectSettings,
    findProjectRoot,
    resolveEffectiveMethodology,
    resolveEffectiveRules,
    buildEffectiveScope,
    isRulePackageInScope,
    isInScope,
    checkSemanticFields,
    type RuleCandidate,
} from '@memoarchitect/tools';
import type { BuilderRegistries, ParsedDocument } from '@memoarchitect/tools';
import { validateModel, collectNativeConstraints, type ConstraintDiagnostic } from '@memoarchitect/tools';
import { computeCompleteness } from '@memoarchitect/tools';
import { checkLockFile } from '../lock.js';


export type ValidateFormat = 'text' | 'junit' | 'json';

export async function validateCommand(projectDir?: string, options?: { format?: ValidateFormat; output?: string }): Promise<void> {
    const format = options?.format || 'text';
    const cwd = resolve(projectDir || process.cwd());
    console.log(chalk.bold('\n📋 MEMO Validate\n'));

    // 1. Find the project by its native entrypoint, not by a settings file.
    const projectRoot = findProjectRoot(cwd);
    if (!projectRoot) {
        console.error(chalk.red(
            '❌ No model/catalog/project.sysml found. A MEMO project declares its identity and method '
            + 'binding in SysML — run `memo init` to scaffold one.'));
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

    const config = loadProjectSettings(projectRoot);

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

    try {
        const compiler = compileWithConfiguredTool(config, projectRoot);
        if (compiler !== 'internal') console.log(chalk.gray(`Compiler: ${compiler}`));
    } catch (error) {
        console.error(chalk.red(`\n❌ Compilation failed: ${error instanceof Error ? error.message : error}\n`));
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

    // 4. The project's own source is the closure minus the resolved roots.
    const documents = (resolution?.documents ?? []).filter(
        d => !(resolution?.selectedRoots ?? []).some(r => d.filePath.startsWith(r.sysmlDir)),
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

    // A rule's scope is decided by the package that declares it, which is a
    // question every loaded file has an answer to — including files a resolved
    // root supplied without any other file importing them.
    const ruleFileToPackage = resolution?.filePackages ?? new Map<string, string>();
    // A rule is activated when both its declaring package and its subject kind
    // are in scope. A rule whose subject the methodology did not select can
    // only report on content the project never agreed to model, which is how
    // the GPCA prototype used to accumulate cybersecurity violations for a
    // discipline it had excluded.
    const kindRegistry = ontologyRegistries?.kindRegistry;
    const subjectInScope = (appliesTo: string): boolean => {
        if (scope.mode === 'allAvailable') return true;
        // A model-level rule has no single subject kind to place.
        if (!appliesTo || appliesTo === 'Model') return true;
        const kindName = appliesTo.split('[')[0];
        const sourceFile = kindRegistry?.getKind(kindName)?.sourceFile;
        // A methodology's inclusion lists name packages, so a kind is placed by
        // the package that declares it — not by the `layer` string, which is a
        // display grouping in a different namespace.
        const declaringPackage = sourceFile ? ruleFileToPackage.get(sourceFile) : undefined;
        return isRulePackageInScope(scope, declaringPackage);
    };
    const candidates: RuleCandidate[] = nativeConstraints
        .filter(c => isRulePackageInScope(scope, c.sourceFile ? ruleFileToPackage.get(c.sourceFile) : undefined))
        .filter(c => subjectInScope(c.appliesToKind))
        .map(c => ({
            id: c.id,
            typeName: c.typeName ?? c.id,
            severity: c.severity,
            tailoring: c.tailoring ?? 'assurance',
            file: c.sourceFile,
            constraint: c,
        }));
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

    // ─── Output format dispatch ──────────────────────────────────────────────

    if (format === 'junit') {
        const xml = generateJUnit(result, completeness, config.projectName || 'memo');
        if (options?.output) {
            writeFileSync(resolve(cwd, options.output), xml);
            console.log(chalk.green(`JUnit XML written to ${options.output}`));
        } else {
            process.stdout.write(xml);
        }
        if (errors.length > 0) process.exitCode = 1;
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
            },
            rulesNotLoaded: constraintDiagnostics,
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
        if (errors.length > 0) process.exitCode = 1;
        return;
    }

    // ─── Default text output ─────────────────────────────────────────────────

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

    if (errors.length > 0) {
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
