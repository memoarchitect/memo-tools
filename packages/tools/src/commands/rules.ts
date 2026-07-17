// ─── memo rules ──────────────────────────────────────────────────────────────
//
// CLI subcommands for consistency rule management:
//   memo rules list     — list all rules with category and severity
//   memo rules check    — evaluate rules against the current model
//   memo rules explain  — show detailed info for a specific rule
//   memo rules coverage — show coverage rules grouped by standard
// ─────────────────────────────────────────────────────────────────────────────

import { resolve } from 'node:path';
import { readdirSync } from 'node:fs';
import chalk from 'chalk';
import {
    findConfigFile,
    parseFiles,
    buildMemoModel,
    loadOntologyRegistries,
    RuleRegistry,
    collectNativeConstraints,
    evaluateConstraintNode,
} from '@memoarchitect/tools';
// parseFiles still needed by rulesCheckCommand for project SysML files
import type { BuilderRegistries, ParsedDocument } from '@memoarchitect/tools';
import { loadAndResolveConfig } from '../server/config-resolver.js';

// ─── Helpers ─────────────────────────────────────────────────────────────────

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

async function loadContext(projectDir?: string) {
    const cwd = resolve(projectDir || process.cwd());
    const configPath = findConfigFile(cwd);
    if (!configPath) {
        console.error(chalk.red('❌ No memo config found. Run `memo init` first.'));
        process.exit(1);
    }

    const config = loadAndResolveConfig(configPath);

    // Load ontology registries
    let ontologyRegistries: BuilderRegistries | undefined;
    let ruleRegistry: RuleRegistry | undefined;
    let ontologyDocuments: ParsedDocument[] = [];
    try {
        const loadResult = await loadOntologyRegistries(configPath);
        if (loadResult.fileCount > 0) {
            ontologyRegistries = loadResult.registries;
            ontologyDocuments = loadResult.parsedDocuments;

            // Build rule registry from already-parsed ontology documents (discovery/catalog)
            ruleRegistry = new RuleRegistry();
            ruleRegistry.populateFromDocuments(loadResult.parsedDocuments);
        }
    } catch {
        // Ontology loading optional
    }

    return { cwd, configPath, config, ontologyRegistries, ruleRegistry, ontologyDocuments };
}

function severityIcon(severity: string): string {
    switch (severity) {
        case 'error': return chalk.red('✖');
        case 'warning': return chalk.yellow('⚠');
        case 'info': return chalk.blue('ℹ');
        default: return ' ';
    }
}

// ─── memo rules list ─────────────────────────────────────────────────────────

export type RulesFormat = 'text' | 'json';

export async function rulesListCommand(
    projectDir?: string,
    options?: { format?: RulesFormat; category?: string }
): Promise<void> {
    const format = options?.format || 'text';
    const { ruleRegistry } = await loadContext(projectDir);

    // Combine all rules from all sources
    const allRules = ruleRegistry?.entries() ?? [];
    const filteredRules = options?.category
        ? allRules.filter(r => r.category === options.category)
        : allRules;

    if (format === 'json') {
        console.log(JSON.stringify(filteredRules, null, 2));
        return;
    }

    console.log(chalk.bold('\n📏 Consistency Rules\n'));

    if (filteredRules.length === 0) {
        console.log(chalk.gray('  No rules found.'));
        return;
    }

    // Group by category
    const byCategory = new Map<string, typeof filteredRules>();
    for (const rule of filteredRules) {
        const cat = rule.category || 'uncategorized';
        if (!byCategory.has(cat)) byCategory.set(cat, []);
        byCategory.get(cat)!.push(rule);
    }

    for (const [category, rules] of byCategory) {
        console.log(chalk.bold.cyan(`  ${category.toUpperCase()} (${rules.length})`));
        for (const rule of rules) {
            const icon = severityIcon(rule.severity);
            const strength = chalk.gray(`[${rule.strength}]`);
            console.log(`    ${icon} ${chalk.white(rule.id)} ${rule.name} ${strength}`);
            console.log(`      ${chalk.gray(rule.description || rule.rationaleText)}`);
        }
        console.log();
    }

    console.log(chalk.gray(`  Total: ${filteredRules.length} rules`));
}

// ─── memo rules check ────────────────────────────────────────────────────────

export async function rulesCheckCommand(
    projectDir?: string,
    options?: { format?: RulesFormat }
): Promise<void> {
    const format = options?.format || 'text';
    const { cwd, config, ontologyRegistries, ontologyDocuments } = await loadContext(projectDir);

    // Parse project SysML files
    const sysmlFiles = findSysmlFiles(cwd);
    if (sysmlFiles.length === 0) {
        console.error(chalk.red('❌ No .sysml files found.'));
        process.exit(1);
    }

    const parseResult = await parseFiles(sysmlFiles);
    const model = buildMemoModel(parseResult.documents, config, parseResult.errors, ontologyRegistries);

    // Evaluate native `constraint def` bodies (KerML expressions) across ontology + project docs.
    const constraints = collectNativeConstraints([...ontologyDocuments, ...parseResult.documents]);
    let rulesPassed = 0;
    const violations = [];
    for (const constraint of constraints) {
        const ruleViolations = evaluateConstraintNode(constraint, constraint.ast, model);
        if (ruleViolations.length === 0) rulesPassed++;
        violations.push(...ruleViolations);
    }
    const result = {
        rulesEvaluated: constraints.length,
        rulesPassed,
        violations,
        timestamp: Date.now(),
    };

    if (format === 'json') {
        console.log(JSON.stringify(result, null, 2));
        return;
    }

    console.log(chalk.bold('\n📋 Rule Check Results\n'));
    console.log(chalk.gray(`  Rules evaluated: ${result.rulesEvaluated}`));
    console.log(chalk.gray(`  Rules passed:    ${result.rulesPassed}`));
    console.log(chalk.gray(`  Violations:      ${result.violations.length}`));
    console.log();

    if (result.violations.length === 0) {
        console.log(chalk.green('  ✅ All rules passed!'));
        return;
    }

    // Group violations by rule
    const byRule = new Map<string, typeof result.violations>();
    for (const v of result.violations) {
        if (!byRule.has(v.ruleId)) byRule.set(v.ruleId, []);
        byRule.get(v.ruleId)!.push(v);
    }

    for (const [ruleId, violations] of byRule) {
        const first = violations[0];
        const icon = severityIcon(first.severity);
        console.log(`  ${icon} ${chalk.white(ruleId)}: ${first.description} (${violations.length} violations)`);
        for (const v of violations.slice(0, 5)) {
            console.log(`    ${chalk.gray('→')} ${v.elementKind}/${v.elementName} ${chalk.gray(`(${v.elementId})`)}`);
        }
        if (violations.length > 5) {
            console.log(chalk.gray(`    ... and ${violations.length - 5} more`));
        }
    }
}

// ─── memo rules explain ──────────────────────────────────────────────────────

export async function rulesExplainCommand(
    ruleId: string,
    projectDir?: string,
    options?: { format?: RulesFormat }
): Promise<void> {
    const format = options?.format || 'text';
    const { ruleRegistry, ontologyDocuments } = await loadContext(projectDir);

    // Look up in registry first (catalog metadata), then in native constraint defs.
    const registryEntry = ruleRegistry?.getRule(ruleId);
    const constraint = collectNativeConstraints(ontologyDocuments).find(c => c.id === ruleId);

    if (!registryEntry && !constraint) {
        console.error(chalk.red(`❌ Rule "${ruleId}" not found.`));
        process.exit(1);
    }

    if (format === 'json') {
        const payload = registryEntry ?? (constraint && { id: constraint.id, description: constraint.description, appliesTo: constraint.appliesToKind, severity: constraint.severity });
        console.log(JSON.stringify(payload, null, 2));
        return;
    }

    console.log(chalk.bold(`\n📏 Rule: ${ruleId}\n`));

    if (registryEntry) {
        console.log(`  ${chalk.cyan('Name:')}         ${registryEntry.name}`);
        console.log(`  ${chalk.cyan('Description:')}  ${registryEntry.description}`);
        console.log(`  ${chalk.cyan('Applies to:')}   ${registryEntry.appliesTo}`);
        console.log(`  ${chalk.cyan('Predicate:')}    ${registryEntry.predicate}`);
        console.log(`  ${chalk.cyan('Strength:')}     ${registryEntry.strength}`);
        console.log(`  ${chalk.cyan('Severity:')}     ${registryEntry.severity}`);
        console.log(`  ${chalk.cyan('Category:')}     ${registryEntry.category}`);
        console.log(`  ${chalk.cyan('Rationale:')}    ${registryEntry.rationaleText}`);
        console.log(`  ${chalk.cyan('Source:')}       ${registryEntry.file}`);

        // Show type-specific attributes
        const attrs = registryEntry.attributes;
        if (attrs['relationshipType']) {
            console.log(`  ${chalk.cyan('Relationship:')} ${attrs['relationshipType']}`);
            console.log(`  ${chalk.cyan('Min count:')}    ${attrs['minCount'] ?? '-'}`);
            console.log(`  ${chalk.cyan('Max count:')}    ${attrs['maxCount'] || 'unlimited'}`);
            console.log(`  ${chalk.cyan('Direction:')}    ${attrs['direction'] ?? 'any'}`);
            if (attrs['relatedKinds']) {
                console.log(`  ${chalk.cyan('Related:')}      ${attrs['relatedKinds']}`);
            }
        }
        if (attrs['targetAttribute']) {
            console.log(`  ${chalk.cyan('Attribute:')}    ${attrs['targetAttribute']}`);
        }
        if (attrs['standard']) {
            console.log(`  ${chalk.cyan('Standard:')}     ${attrs['standard']}`);
            console.log(`  ${chalk.cyan('Clause:')}       ${attrs['clause'] ?? '-'}`);
        }
        if (attrs['conditionAttribute']) {
            console.log(`  ${chalk.cyan('Condition:')}    ${attrs['conditionAttribute']} ${attrs['conditionOperator']} ${attrs['conditionValues']}`);
        }
    } else if (constraint) {
        console.log(`  ${chalk.cyan('Description:')}  ${constraint.description}`);
        console.log(`  ${chalk.cyan('Applies to:')}   ${constraint.appliesToKind}`);
        console.log(`  ${chalk.cyan('Severity:')}     ${constraint.severity}`);
        console.log(`  ${chalk.cyan('Source:')}       native constraint def`);
    }
}

// ─── memo rules coverage ────────────────────────────────────────────────────

export async function rulesCoverageCommand(
    projectDir?: string,
    options?: { format?: RulesFormat }
): Promise<void> {
    const format = options?.format || 'text';
    const { cwd, config, ontologyRegistries, ruleRegistry } = await loadContext(projectDir);

    const coverageRules = ruleRegistry?.byCategory('coverage') ?? [];

    // Parse project model to evaluate coverage
    const sysmlFiles = findSysmlFiles(cwd);
    let model: ReturnType<typeof buildMemoModel> | undefined;
    if (sysmlFiles.length > 0) {
        const parseResult = await parseFiles(sysmlFiles);
        model = buildMemoModel(parseResult.documents, config, parseResult.errors, ontologyRegistries);
    }

    // Evaluate each coverage rule against model
    type CoverageResult = { rule: (typeof coverageRules)[0]; passed: boolean; count: number };
    const results: CoverageResult[] = coverageRules.map(rule => {
        const target = rule.attributes['coverageTarget'] || rule.appliesTo;
        const count = model ? [...model.elements.values()].filter((e: any) => e.kind === target).length : 0;
        return { rule, passed: count > 0, count };
    });

    if (format === 'json') {
        const grouped: Record<string, { id: string; name: string; passed: boolean; count: number }[]> = {};
        for (const r of results) {
            const std = r.rule.attributes['standard'] || 'unspecified';
            if (!grouped[std]) grouped[std] = [];
            grouped[std].push({ id: r.rule.id, name: r.rule.name, passed: r.passed, count: r.count });
        }
        const totalPassed = results.filter(r => r.passed).length;
        const pct = results.length > 0 ? Math.round((totalPassed / results.length) * 100) : 0;
        console.log(JSON.stringify({ total: results.length, passed: totalPassed, percentage: pct, byStandard: grouped }, null, 2));
        return;
    }

    console.log(chalk.bold('\n📊 Coverage Rules by Standard\n'));

    if (coverageRules.length === 0) {
        console.log(chalk.gray('  No coverage rules found.'));
        return;
    }

    // Group by standard
    const byStandard = new Map<string, CoverageResult[]>();
    for (const r of results) {
        const std = r.rule.attributes['standard'] || 'unspecified';
        if (!byStandard.has(std)) byStandard.set(std, []);
        byStandard.get(std)!.push(r);
    }

    for (const [standard, stdResults] of byStandard) {
        const stdPassed = stdResults.filter(r => r.passed).length;
        const stdPct = Math.round((stdPassed / stdResults.length) * 100);
        const pctColor = stdPct >= 90 ? chalk.green : stdPct >= 50 ? chalk.yellow : chalk.red;
        console.log(chalk.bold.cyan(`  ${standard}`) + chalk.gray(` (${stdResults.length} rules)`) + ` ${pctColor(`${stdPct}%`)}`);
        for (const r of stdResults) {
            const clause = r.rule.attributes['clause'] ? chalk.gray(`[${r.rule.attributes['clause']}]`) : '';
            const icon = r.passed ? chalk.green('✔') : severityIcon(r.rule.severity);
            const countLabel = r.passed ? chalk.green(`${r.count} found`) : chalk.red('0 found');
            console.log(`    ${icon} ${chalk.white(r.rule.id)} ${r.rule.name} ${clause} — ${countLabel}`);
        }
        console.log();
    }

    const totalPassed = results.filter(r => r.passed).length;
    const totalPct = results.length > 0 ? Math.round((totalPassed / results.length) * 100) : 0;
    const totalColor = totalPct >= 90 ? chalk.green : totalPct >= 50 ? chalk.yellow : chalk.red;
    console.log(chalk.gray(`  Total: ${totalPassed}/${results.length} coverage rules satisfied`) + ` ${totalColor(`(${totalPct}%)`)}`);
}
