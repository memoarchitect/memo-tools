// ─── memo validate ───────────────────────────────────────────────────────────
//
// Parses all .sysml files, builds the model, evaluates closure rules,
// and prints a completeness report.
// ─────────────────────────────────────────────────────────────────────────────

import { resolve } from 'node:path';
import { readdirSync, statSync, writeFileSync } from 'node:fs';
import chalk from 'chalk';
import { findConfigFile, parseFiles, buildMemoModel, loadOntologyRegistries } from '@memo/core';
import type { BuilderRegistries, ParsedDocument } from '@memo/core';
import { validateModel, collectNativeConstraints } from '@memo/core';
import { computeCompleteness } from '@memo/core';
import { loadAndResolveConfig } from '../server/config-resolver.js';
import { checkLockFile } from '../lock.js';

/**
 * Find all .sysml files recursively from a directory.
 */
function findSysmlFiles(dir: string): string[] {
    const files: string[] = [];
    try {
        for (const entry of readdirSync(dir, { withFileTypes: true })) {
            const full = resolve(dir, entry.name);
            if (entry.isDirectory() && entry.name !== 'node_modules' && entry.name !== '.memo') {
                files.push(...findSysmlFiles(full));
            } else if (entry.name.endsWith('.sysml')) {
                files.push(full);
            }
        }
    } catch {
        // Permission errors, etc.
    }
    return files;
}

export type ValidateFormat = 'text' | 'junit' | 'json';

export async function validateCommand(projectDir?: string, options?: { format?: ValidateFormat; output?: string }): Promise<void> {
    const format = options?.format || 'text';
    const cwd = resolve(projectDir || process.cwd());
    console.log(chalk.bold('\n📋 MEMO Validate\n'));

    // 1. Find config
    const configPath = findConfigFile(cwd);
    if (!configPath) {
        console.error(chalk.red('❌ No memo config found. Run `memo init` first.'));
        process.exit(1);
    }
    console.log(chalk.gray(`Config: ${configPath}`));

    // 2. Load and resolve config
    const config = loadAndResolveConfig(configPath);
    console.log(chalk.gray(`Project: ${config.projectName} (${config.projectType})`));

    // 2a. Check ontology lock
    const lockCheck = checkLockFile(configPath);
    if (!lockCheck.ok) {
        console.error(chalk.red(`\n❌ ${lockCheck.message}\n`));
        process.exit(1);
    }
    if (lockCheck.locked) {
        console.log(chalk.gray(`Ontology: locked to ${lockCheck.locked.ontology} v${lockCheck.locked.version}`));
    }
    console.log(chalk.gray(`Kinds: ${Object.keys(config.kinds ?? {}).length} | Relationships: ${(config.relationshipTypes ?? []).length}`));

    // 2b. Load ontology registries (SysML-driven kind/relationship discovery)
    let ontologyRegistries: BuilderRegistries | undefined;
    let ontologyDocuments: ParsedDocument[] = [];
    try {
        const loadResult = await loadOntologyRegistries(configPath);
        if (loadResult.fileCount > 0) {
            ontologyRegistries = loadResult.registries;
            ontologyDocuments = loadResult.parsedDocuments;
            const kr = loadResult.registries.kindRegistry;
            const rr = loadResult.registries.relationshipRegistry;
            console.log(chalk.gray(
                `Ontology: ${kr?.size ?? 0} kinds, ${rr?.size ?? 0} relationships ` +
                `(from ${loadResult.fileCount} SysML files)`
            ));
        }
    } catch (e) {
        console.log(chalk.yellow(`  ⚠ Could not load ontology registries: ${e instanceof Error ? e.message : e}`));
    }

    // 3. Find SysML files
    const sysmlFiles = findSysmlFiles(cwd);
    if (sysmlFiles.length === 0) {
        console.error(chalk.yellow('⚠️  No .sysml files found.'));
        return;
    }
    console.log(chalk.gray(`Files: ${sysmlFiles.length} .sysml files\n`));

    // 4. Parse
    const { documents, errors: parseErrors } = await parseFiles(sysmlFiles, cwd + '/');
    if (parseErrors.length > 0) {
        console.log(chalk.red.bold(`Parse Errors (${parseErrors.length}):`));
        for (const err of parseErrors) {
            const loc = err.line ? `:${err.line}:${err.column || 0}` : '';
            console.log(chalk.red(`  ${err.file}${loc}: ${err.message}`));
        }
        console.log();
    }

    // 5. Build model
    const model = buildMemoModel(documents, config, parseErrors, ontologyRegistries);
    console.log(chalk.cyan(`Model: ${model.elements.size} elements, ${model.relationships.length} relationships\n`));

    // 6. Validate — native ontology constraints (constraint def bodies) + structural checks.
    //    Constraint defs live in the ontology packages (parsed by loadOntologyRegistries),
    //    so collect across both ontology and project documents.
    const nativeConstraints = collectNativeConstraints([...ontologyDocuments, ...documents]);
    if (nativeConstraints.length > 0) {
        console.log(chalk.gray(`Native constraints: ${nativeConstraints.length} (from constraint def bodies)`));
    }
    const result = validateModel(model, nativeConstraints);
    const completeness = computeCompleteness(model, result, config);

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
            },
            violations: result.violations.map(v => ({
                ruleId: v.ruleId,
                severity: v.severity,
                elementId: v.elementId,
                elementKind: v.elementKind,
                elementName: v.elementName,
                description: v.description,
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
