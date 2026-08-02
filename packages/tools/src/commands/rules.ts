// ─── memo rules ──────────────────────────────────────────────────────────────
//
// CLI subcommands for consistency rule management:
//   memo rules list     — list all rules with category and severity
//   memo rules check    — evaluate rules against the current model
//   memo rules explain  — show detailed info for a specific rule
//   memo rules coverage — show coverage rules grouped by standard
// ─────────────────────────────────────────────────────────────────────────────

import { resolve } from 'node:path';
import chalk from 'chalk';
import {
    findConfigFile,
    findProjectRoot,
    loadProjectSettings,
    parseFiles,
    buildMemoModel,
    loadOntologyRegistries,
    RuleRegistry,
    collectNativeConstraints,
    loadMethodologyDescriptor,
    resolveEffectiveRules,
    ruleCandidatesFromConstraints,
    buildEffectiveScope,
    activeRuleCandidates,
    BUILTIN_RULES,
    evaluateConstraintNode,
    validateArchitecture,
} from '@memoarchitect/tools';
// parseFiles still needed by rulesCheckCommand for project SysML files
import type { BuilderRegistries, ParsedDocument, EffectiveRule, RuleResolutionDiagnostic } from '@memoarchitect/tools';
import { loadAndResolveConfig } from '../server/config-resolver.js';
import { findSysmlFiles } from '../model/sysml-files.js';

// ─── Helpers ─────────────────────────────────────────────────────────────────


async function loadContext(projectDir?: string) {
    const cwd = resolve(projectDir || process.cwd());

    // The loader resolves a PROJECT ROOT, not a settings file. Passing the
    // config path resolved no documents, so `memo rules list` reported "No
    // rules found" on a project `memo validate` was evaluating 61 rules
    // against. The two commands must agree about what the effective rule set
    // is — that is the whole point of section 10.4.
    const projectRoot = findProjectRoot(cwd);
    if (!projectRoot) {
        console.error(chalk.red(
            '❌ No model/catalog/project.sysml found. A MEMO project declares its identity and method '
            + 'binding in SysML — run `memo init` to scaffold one.'));
        process.exit(1);
    }

    // A package descriptor is an optional LOCATOR, not a requirement. Demanding
    // one made `memo rules list` refuse to run on a project `memo validate`
    // handles fine — GPCA has no `memo.package.yaml` and does not need one,
    // because the entrypoint and the binding decide what the model contains.
    const configPath = findConfigFile(projectRoot);
    const config = loadProjectSettings(projectRoot);

    // Load ontology registries
    let ontologyRegistries: BuilderRegistries | undefined;
    let ruleRegistry: RuleRegistry | undefined;
    let ontologyDocuments: ParsedDocument[] = [];
    let filePackages: ReadonlyMap<string, string> = new Map();
    try {
        const loadResult = await loadOntologyRegistries(projectRoot);
        filePackages = loadResult.resolution?.filePackages ?? new Map<string, string>();
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

    // The EFFECTIVE rule set, resolved exactly as `memo validate` and the dev
    // server resolve it. `ruleRegistry` above is a discovery catalogue of
    // methodology closure rules; it is not the set that governs this project,
    // and reporting it as though it were is what made `rules list` disagree
    // with `validate` about how many rules exist.
    let effectiveRules: EffectiveRule[] = [];
    let ruleDiagnostics: RuleResolutionDiagnostic[] = [];
    try {
        const projectFiles = findSysmlFiles(projectRoot);
        const { documents } = await parseFiles(projectFiles, `${projectRoot}/`);
        const constraints = collectNativeConstraints([...ontologyDocuments, ...documents]);
        const descriptor = await loadMethodologyDescriptor(projectRoot);

        // The same activation `memo validate` applies. Reporting every resolved
        // constraint instead would describe a rule set the project does not
        // have: GPCA's methodology excludes cybersecurity, and listing its
        // rules as effective is the exact claim the scope work exists to stop.
        const scope = descriptor.effective
            ? buildEffectiveScope(descriptor.effective)
            : undefined;
        const kindRegistry = ontologyRegistries?.kindRegistry;
        const candidates = scope
            ? activeRuleCandidates(
                constraints, scope, filePackages,
                kindName => kindRegistry?.getKind(kindName)?.sourceFile)
            : ruleCandidatesFromConstraints(constraints);

        const resolved = resolveEffectiveRules(
            candidates,
            descriptor.effective?.policyChain ?? [],
        );
        effectiveRules = resolved.rules;
        ruleDiagnostics = resolved.diagnostics;
    } catch {
        // Rule resolution is reported, not fatal: a bad policy is a diagnostic
        // about the methodology, not a reason the command cannot run.
    }

    return {
        cwd, configPath, config, ontologyRegistries, ruleRegistry, ontologyDocuments,
        effectiveRules, ruleDiagnostics,
    };
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
    const { effectiveRules, ruleDiagnostics } = await loadContext(projectDir);

    // Section 19 asks that the effective rule SET be auditable: identity,
    // disposition, severity, and policy chain. That is what this reports —
    // governance, not evidence that anything was validated (section 10.4).
    const filteredRules = options?.category
        ? effectiveRules.filter(r => r.tailoring === options.category)
        : effectiveRules;

    if (format === 'json') {
        console.log(JSON.stringify({
            tailorable: filteredRules,
            builtin: options?.category ? [] : BUILTIN_RULES,
            total: filteredRules.length + (options?.category ? 0 : BUILTIN_RULES.length),
            diagnostics: ruleDiagnostics,
        }, null, 2));
        return;
    }

    console.log(chalk.bold('\n📏 Effective rule set\n'));

    if (filteredRules.length === 0) {
        console.log(chalk.gray('  No rules resolved for this project.'));
        for (const diagnostic of ruleDiagnostics) {
            console.log(chalk.yellow(`  [${diagnostic.code}] ${diagnostic.message}`));
        }
        return;
    }

    const byTailoring = new Map<string, typeof filteredRules>();
    for (const rule of filteredRules) {
        const cat = rule.tailoring || 'uncategorized';
        if (!byTailoring.has(cat)) byTailoring.set(cat, []);
        byTailoring.get(cat)!.push(rule);
    }

    for (const [tailoring, rules] of byTailoring) {
        console.log(chalk.bold.cyan(`  ${tailoring.toUpperCase()} (${rules.length})`));
        for (const rule of rules) {
            const icon = severityIcon(rule.effectiveSeverity);
            const disposition = rule.disposition === 'enabled'
                ? '' : chalk.yellow(` [${rule.disposition}]`);
            const overridden = rule.effectiveSeverity !== rule.declaredSeverity
                ? chalk.gray(` (declared ${rule.declaredSeverity})`) : '';
            console.log(`    ${icon} ${chalk.white(rule.sourceRuleId)} ${rule.sourceRuleType}`
                + `${disposition}${overridden}`);
            if (rule.rationaleText) {
                console.log(`      ${chalk.gray(rule.rationaleText)}`);
            }
            if (rule.authority) {
                console.log(`      ${chalk.gray(`authority: ${rule.authority}`)}`);
            }
        }
        console.log();
    }

    // Built-in rules evaluate against the model but are not tailorable: a
    // RulePolicy references a rule by its `constraint def` name and these have
    // none. Listing them here is what makes this command's total reconcile
    // with `memo validate` — the two used to report different numbers because
    // only one of them knew these rules existed.
    if (!options?.category) {
        console.log(chalk.bold.cyan(`  BUILT-IN — not tailorable (${BUILTIN_RULES.length})`));
        for (const rule of BUILTIN_RULES) {
            console.log(`    ${severityIcon(rule.severity)} ${chalk.white(rule.id)} ${rule.name}`);
            console.log(`      ${chalk.gray(rule.description)}`);
        }
        console.log();
    }

    const disabled = filteredRules.filter(r => r.disposition !== 'enabled').length;
    const builtinShown = options?.category ? 0 : BUILTIN_RULES.length;
    console.log(chalk.gray(
        `  Total: ${filteredRules.length + builtinShown} rules`
        + ` (${filteredRules.length} tailorable`
        + (disabled > 0 ? `, ${disabled} tailored` : '')
        + (builtinShown > 0 ? `; ${builtinShown} built-in` : '')
        + ')'));
    console.log(chalk.gray('  Tailorable rules are the set a methodology governs (design section 10).'));
    for (const diagnostic of ruleDiagnostics) {
        console.log(chalk.yellow(`  [${diagnostic.code}] ${diagnostic.message}`));
    }
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
        const ruleViolations = constraint.evaluator === 'architecture'
            ? validateArchitecture(model, constraint.appliesToKind, ontologyRegistries?.kindRegistry)
            : constraint.evaluator && constraint.evaluator !== 'native'
                ? []
                : evaluateConstraintNode(constraint, constraint.ast, model, ontologyRegistries?.kindRegistry);
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
