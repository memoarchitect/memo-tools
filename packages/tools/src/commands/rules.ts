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
    findConfigFile, findProjectRoot, loadProjectSettings, RuleRegistry,
    loadMethodologyDescriptor, BUILTIN_RULES, evaluateConstraintSubjects, validateArchitecture,
} from '@memoarchitect/tools';
import type { EffectiveRule, RuleResolutionDiagnostic } from '@memoarchitect/tools';
import { loadProjectModel, projectConstraints } from '../toolchain/project-model.js';
import { handoffFileOf } from '../stage2/handoff-files.js';
import { clauseLabel, readClauseFacts } from '../validator/rule-clauses.js';
import { inactiveRules, resolveProjectRules, type InactiveRule } from '../model/effective-scope.js';
import { isProjectSource } from '../stage2/project-from-api.js';
import { bulkDecisions, tailoringRecord } from '../validator/rule-tailoring.js';
import { checkNewRule, dryRunRule, insertRule, resolveClauseReference, type NewRuleRequest } from '../server/rule-writer.js';
import { commitSource } from '../server/persistor.js';
import {
    checkRulePolicy, insertRulePolicy, renderRulePolicy, resolveStandardReference, type RulePolicyRequest,
} from '../server/rule-policy-writer.js';
import { rulesSelectedBy } from '../model/methodology-resolver.js';
import { selectedOutlineSource } from '../authoring/outline-source.js';
import { existsSync, readFileSync } from 'node:fs';

const RULE_DOMAINS = ['modelling', 'medicalDevice', 'organisation'];
import { resolutionLoads } from '../stage2/project-from-api.js';

// ─── Helpers ─────────────────────────────────────────────────────────────────


export async function loadContext(projectDir?: string) {
    const cwd = resolve(projectDir || process.cwd());

    // The loader resolves a PROJECT ROOT, not a settings file. Passing the
    // config path resolved no documents, so `memo rules list` reported "No
    // rules found" on a project `memo validate` was evaluating 61 rules
    // against. The two commands must agree about what the effective rule set
    // is — that is the whole point of section 10.4.
    const projectRoot = findProjectRoot(cwd);
    if (!projectRoot) {
        console.error(chalk.red(
            '❌ No MEMO project found. A project is located by the `entrypoint` in its '
            + '`memo.package.yaml`, which names the SysML file declaring its identity '
            + 'and method binding — run `memo init` to scaffold one.'));
        process.exit(1);
    }

    // A package descriptor is an optional LOCATOR, not a requirement. Demanding
    // one made `memo rules list` refuse to run on a project `memo validate`
    // handles fine — GPCA has no `memo.package.yaml` and does not need one,
    // because the entrypoint and the binding decide what the model contains.
    const configPath = findConfigFile(projectRoot);
    const config = loadProjectSettings(projectRoot);

    // The project as every command loads it, from the selected compiler:
    // the model, the registries, the resolution and the rule definitions.
    const project = await loadProjectModel({ projectRoot, config });
    const ontologyRegistries = project.registries;
    const filePackages: ReadonlyMap<string, string> = project.resolution?.filePackages ?? new Map<string, string>();
    const constraints = projectConstraints(project);
    // The rule catalogue: the rule parts the project's closure declares, from
    // the compiler's handoff.
    const ruleRegistry = new RuleRegistry();
    {
        const loads = project.resolution ? resolutionLoads(project.resolution) : () => true;
        const fileOf = handoffFileOf(project.api, project.resolution?.filePackages);
        const catalogue = new RuleRegistry();
        catalogue.populateFromApi(project.api, fileOf);
        for (const entry of catalogue.entries()) if (loads(entry.file)) ruleRegistry.register(entry);
    }

    // The EFFECTIVE rule set, resolved exactly as `memo validate` and the dev
    // server resolve it. `ruleRegistry` above is a discovery catalogue of
    // methodology closure rules; it is not the set that governs this project,
    // and reporting it as though it were is what made `rules list` disagree
    // with `validate` about how many rules exist.
    let effectiveRules: EffectiveRule[] = [];
    let ruleDiagnostics: RuleResolutionDiagnostic[] = [];
    let inactive: InactiveRule[] = [];
    try {
        const descriptor = await loadMethodologyDescriptor(projectRoot, project.resolution, project.api);

        // The same activation `memo validate` and the dev server apply
        // (`resolveProjectRules`). Reporting every resolved constraint instead
        // would describe a rule set the project does not have: GPCA's methodology
        // excludes cybersecurity, and listing its rules as effective is the exact
        // claim the scope work exists to stop. A rule the project wrote in its own
        // files always counts; the rules the methodology leaves out are listed
        // with the reason, so an absent rule is never mistaken for a passing one.
        const kindRegistry = ontologyRegistries?.kindRegistry;
        const kindSourceFile = (kindName: string) => kindRegistry?.getKind(kindName)?.sourceFile;
        const isOwnFile = project.resolution ? isProjectSource(project.resolution) : () => false;
        const { rules: resolved, scope } = resolveProjectRules({
            constraints, effective: descriptor.effective, filePackages, kindSourceFile, isOwnFile,
        });
        effectiveRules = resolved.rules;
        ruleDiagnostics = resolved.diagnostics;
        if (scope) inactive = inactiveRules(constraints, scope, filePackages, kindSourceFile, isOwnFile);
    } catch {
        // Rule resolution is reported, not fatal: a bad policy is a diagnostic
        // about the methodology, not a reason the command cannot run.
    }

    // The clauses the model carries, to name what a rule enforces. Only a
    // compiler that builds the model states them.
    const clauseFacts = project.api ? readClauseFacts(project.api) : [];

    return {
        cwd, projectRoot, configPath, config, ontologyRegistries, ruleRegistry, constraints, model: project.model,
        effectiveRules, ruleDiagnostics, inactive, clauseFacts,
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
    options?: { format?: RulesFormat; category?: string; domain?: string }
): Promise<void> {
    const format = options?.format || 'text';
    const { effectiveRules, ruleDiagnostics, inactive, clauseFacts } = await loadContext(projectDir);

    if (options?.domain && !RULE_DOMAINS.includes(options.domain)) {
        console.error(chalk.red(`❌ --domain expects one of ${RULE_DOMAINS.join(', ')}, got "${options.domain}".`));
        process.exit(1);
    }

    // Section 19 asks that the effective rule SET be auditable: identity,
    // disposition, severity, and policy chain. That is what this reports —
    // governance, not evidence that anything was validated (section 10.4).
    const filteredRules = effectiveRules
        .filter(r => !options?.category || r.tailoring === options.category)
        .filter(r => !options?.domain || r.domain === options.domain);
    // A domain filter narrows to MEMO's tailorable rules: the built-in ones state no domain.
    const narrowed = Boolean(options?.category || options?.domain);

    if (format === 'json') {
        console.log(JSON.stringify({
            tailorable: filteredRules.map(rule => ({
                ...rule,
                clauses: (rule.enforces ?? []).map(clause => ({ qualifiedName: clause, label: clauseLabel(clauseFacts, clause) })),
            })),
            builtin: narrowed ? [] : BUILTIN_RULES,
            total: filteredRules.length + (narrowed ? 0 : BUILTIN_RULES.length),
            diagnostics: ruleDiagnostics,
            inactive,
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
            const domain = rule.domain === 'medicalDevice'
                ? chalk.magenta(' [medical device]') : rule.domain === 'organisation' ? chalk.blue(' [organisation]') : '';
            console.log(`    ${icon} ${chalk.white(rule.sourceRuleId)} ${rule.sourceRuleType}`
                + `${domain}${disposition}${overridden}`);
            if (rule.rationaleText) {
                console.log(`      ${chalk.gray(rule.rationaleText)}`);
            }
            for (const clause of rule.enforces ?? []) {
                console.log(`      ${chalk.gray(`enforces ${clauseLabel(clauseFacts, clause)}`)}`);
            }
            if (rule.domain === 'medicalDevice' && (rule.enforces ?? []).length === 0) {
                console.log(`      ${chalk.yellow('traces to no clause yet')}`);
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
    if (!narrowed) {
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
    // A rule that does not run for this project says so, with the reason: a rule
    // that is silently absent reads as one that passed.
    if (!narrowed && inactive.length > 0) {
        console.log(chalk.bold.cyan(`\n  NOT RUNNING IN THIS PROJECT (${inactive.length})`));
        for (const rule of inactive) {
            console.log(chalk.gray(`    ${rule.id} ${rule.typeName ?? ''} — ${rule.detail}`));
        }
    }
}

// ─── memo rules check ────────────────────────────────────────────────────────

export async function rulesCheckCommand(
    projectDir?: string,
    options?: { format?: RulesFormat }
): Promise<void> {
    const format = options?.format || 'text';
    const { ontologyRegistries, model, constraints } = await loadContext(projectDir);

    // Evaluate the rule definitions across the ontology and the project.
    let rulesPassed = 0;
    let rulesVacuous = 0;
    const violations = [];
    for (const constraint of constraints) {
        if (constraint.evaluator && constraint.evaluator !== 'native') {
            const ruleViolations = constraint.evaluator === 'architecture'
                ? validateArchitecture(model, constraint.appliesToKind, ontologyRegistries?.kindRegistry)
                : [];
            if (ruleViolations.length === 0) rulesPassed++;
            violations.push(...ruleViolations);
            continue;
        }
        const { violations: ruleViolations, subjectCount } = evaluateConstraintSubjects(
            constraint, constraint.ast, model, ontologyRegistries?.kindRegistry);
        if (subjectCount === 0) rulesVacuous++;
        else if (ruleViolations.length === 0) rulesPassed++;
        violations.push(...ruleViolations);
    }
    const result = {
        rulesEvaluated: constraints.length,
        rulesPassed,
        rulesVacuous,
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
    console.log(chalk.gray(`  No subject:      ${result.rulesVacuous}`));
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
    const { ruleRegistry, constraints } = await loadContext(projectDir);

    // Look up in registry first (catalog metadata), then in native constraint defs.
    const registryEntry = ruleRegistry?.getRule(ruleId);
    const constraint = constraints.find(c => c.id === ruleId);

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
    const { ruleRegistry, model } = await loadContext(projectDir);

    const coverageRules = ruleRegistry?.byCategory('coverage') ?? [];

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

// ─── memo rules tailoring ────────────────────────────────────────────────────
//
// The record of every rule this project's policies switched off, downgraded or
// replaced, with who decided and why. A user may tailor any rule; what the
// project owes is this record, and it belongs in the DHF.

export async function rulesTailoringCommand(
    projectDir?: string,
    options?: { format?: 'text' | 'json' | 'markdown' },
): Promise<void> {
    const { effectiveRules, ruleDiagnostics } = await loadContext(projectDir);
    const entries = tailoringRecord(effectiveRules);
    const decisions = bulkDecisions(entries);
    const describe = (d: { selection: { standard?: string; category?: string } }) =>
        d.selection.standard ? `every rule of the standard ${d.selection.standard}` : `every rule on the layer ${d.selection.category}`;
    // A policy whose target is not in the project's rule set changes nothing,
    // but the decision it states is still the project's record.
    const inert = ruleDiagnostics.filter(d => d.code === 'missing-target');
    const format = options?.format ?? 'text';

    if (format === 'json') {
        console.log(JSON.stringify({ tailored: entries, total: entries.length, decisions, inertPolicies: inert }, null, 2));
        return;
    }

    if (format === 'markdown') {
        console.log('# Rule tailoring record\n');
        if (entries.length === 0) console.log('No rule has been switched off, downgraded or replaced.');
        if (decisions.length > 0) {
            console.log('## Decisions that reached several rules\n');
            for (const d of decisions) {
                console.log(`### ${d.policy}: ${describe(d)}\n`);
                console.log(`- ${d.disposition ?? 'enabled'}${d.severityOverride ? `, severity ${d.severityOverride}` : ''} (${d.level}, ${d.source}): ${d.rationaleText ?? '*no rationale*'}`);
                console.log(`- Authority: ${d.authority ?? '*none*'}; approval: ${d.approvalReference ?? '*none*'}`);
                console.log(`- Reached ${d.ruleIds.length} rule(s): ${d.ruleIds.join(', ')}\n`);
            }
            console.log('## Rules\n');
        }
        for (const entry of entries) {
            console.log(`## ${entry.ruleId} ${entry.ruleType}${entry.domain === 'medicalDevice' ? ' (medical device)' : ''}\n`);
            console.log(`- Disposition: ${entry.disposition}${entry.activeRuleId ? ` → ${entry.activeRuleId}` : ''}`);
            console.log(`- Severity: ${entry.declaredSeverity} → ${entry.effectiveSeverity}`);
            for (const change of entry.changes) {
                console.log(`- ${change.policy} (${change.level}, ${change.source}): ${change.rationaleText ?? '*no rationale*'}`);
                console.log(`  - Authority: ${change.authority ?? '*none*'}; approval: ${change.approvalReference ?? '*none*'}`
                    + `${change.approvedBy ? `; approved by ${change.approvedBy}` : ''}${change.approvedOn ? ` on ${change.approvedOn}` : ''}`);
            }
            if (entry.gaps.length > 0) console.log(`- **Record incomplete:** ${entry.gaps.join(', ')}`);
            console.log();
        }
        if (inert.length > 0) {
            console.log('## Policies that target a rule outside the project\'s rule set\n');
            for (const d of inert) console.log(`- ${d.policy}: ${d.message}`);
        }
        return;
    }

    console.log(chalk.bold('\n📝 Rule tailoring record\n'));
    if (entries.length === 0) {
        console.log(chalk.gray('  No rule has been switched off, downgraded or replaced.\n'));
    }
    for (const d of decisions) {
        console.log(`  ${chalk.bold(d.policy)} — ${chalk.yellow(`${d.disposition ?? 'enabled'}${d.severityOverride ? ` at ${d.severityOverride}` : ''} ${describe(d)}`)}`);
        console.log(chalk.gray(`    ${d.rationaleText ?? 'no rationale'}`));
        console.log(chalk.gray(`    authority: ${d.authority ?? 'none'}; approval: ${d.approvalReference ?? 'none'}`));
        console.log(chalk.gray(`    reached ${d.ruleIds.length} rule(s): ${d.ruleIds.join(', ')}`));
    }
    if (decisions.length > 0) console.log();
    for (const entry of entries) {
        const medical = entry.domain === 'medicalDevice' ? chalk.magenta(' [medical device]') : '';
        const state = entry.disposition === 'enabled'
            ? `severity ${entry.declaredSeverity} → ${entry.effectiveSeverity}`
            : entry.disposition === 'replaced' ? `replaced by ${entry.activeRuleId}` : 'disabled';
        console.log(`  ${chalk.white(entry.ruleId)} ${entry.ruleType}${medical} — ${chalk.yellow(state)}`);
        for (const change of entry.changes) {
            console.log(chalk.gray(`    ${change.policy} (${change.level}): ${change.rationaleText ?? 'no rationale'}`));
            console.log(chalk.gray(`    authority: ${change.authority ?? 'none'}; approval: ${change.approvalReference ?? 'none'}`
                + `${change.approvedBy ? `; approved by ${change.approvedBy}` : ''}${change.approvedOn ? ` on ${change.approvedOn}` : ''}`));
        }
        if (entry.gaps.length > 0) console.log(chalk.yellow(`    record incomplete: ${entry.gaps.join(', ')}`));
    }
    if (entries.length > 0) console.log(chalk.gray(`\n  ${entries.length} rule(s) tailored.\n`));
    if (inert.length > 0) {
        console.log(chalk.bold('  Policies that target a rule outside this project\'s rule set (they change nothing)\n'));
        for (const d of inert) console.log(chalk.gray(`    ${d.policy}: ${d.message}`));
        console.log();
    }
}


// ─── memo rules new ──────────────────────────────────────────────────────────
//
// Write a rule of the project's own. It is checked, its effect on the model as
// it stands is shown, and it is written through the same compile-before-commit
// path every authoring write takes, so a rule the compiler rejects never
// reaches the file. `--dry-run` stops after the preview.

export interface RulesNewOptions {
    id?: string;
    type?: string;
    appliesTo?: string;
    predicate?: string;
    severity?: string;
    rationale?: string;
    enforces?: string[];
    file?: string;
    tailoring?: string;
    dryRun?: boolean;
}

export async function rulesNewCommand(projectDir: string | undefined, options: RulesNewOptions): Promise<void> {
    const missing = (['id', 'type', 'appliesTo', 'predicate', 'rationale', 'file'] as const).filter(key => !options[key]);
    if (missing.length > 0) {
        console.error(chalk.red(`❌ Missing: ${missing.map(m => `--${m.replace(/[A-Z]/g, c => `-${c.toLowerCase()}`)}`).join(', ')}`));
        process.exit(1);
    }
    const { projectRoot, config, constraints, model, ontologyRegistries, clauseFacts } = await loadContext(projectDir);

    const enforces: string[] = [];
    for (const text of options.enforces ?? []) {
        const clause = resolveClauseReference(clauseFacts, text);
        if (!clause) {
            console.error(chalk.red(`❌ "${text}" names no single clause. Use the qualified name, or "<standard> §<number>" such as "62304 §5.2".`));
            process.exit(1);
        }
        enforces.push(clause.qualifiedName);
    }
    const request: NewRuleRequest = {
        id: options.id!, typeName: options.type!, appliesTo: options.appliesTo!,
        predicateExpression: options.predicate!, severity: (options.severity ?? 'warning') as NewRuleRequest['severity'],
        rationaleText: options.rationale!, file: options.file!,
        ...(options.tailoring ? { tailoring: options.tailoring as NewRuleRequest['tailoring'] } : {}),
        ...(enforces.length > 0 ? { enforces } : {}),
    };

    const kindRegistry = ontologyRegistries?.kindRegistry;
    const refusal = checkNewRule(request, {
        existingIds: new Set(constraints.map(c => c.id)),
        existingTypeNames: new Set(constraints.map(c => c.typeName).filter((n): n is string => Boolean(n))),
        kindNames: kindRegistry ? new Set(kindRegistry.kindNames()) : undefined,
        clauses: clauseFacts,
    });
    if (refusal) {
        console.error(chalk.red(`❌ [${refusal.code}] ${refusal.message}`));
        process.exit(1);
    }

    if (model) {
        const result = dryRunRule(request, model, kindRegistry);
        console.log(chalk.bold(`\nDry run: ${request.id} would flag ${result.flagged.length} of ${result.subjects} ${request.appliesTo}`));
        for (const element of result.flagged.slice(0, 20)) {
            console.log(`  ${chalk.yellow('⚠')} ${element.elementKind} ${element.elementName || element.elementId}`);
        }
        if (result.flagged.length > 20) console.log(chalk.gray(`  … and ${result.flagged.length - 20} more`));
        console.log();
    }
    if (options.dryRun) return;

    const relativePath = request.file.replaceAll('\\', '/');
    const filePath = resolve(projectRoot, relativePath);
    if (!existsSync(filePath)) {
        // A methodology runs the rules of the packages it includes, so a rule in a
        // package nothing includes is written and never runs. Put it in one the project has.
        console.error(chalk.red(
            `❌ ${relativePath} does not exist. Write the rule into a file of a package the project already includes; `
            + 'a methodology only runs the rules of the packages it includes.'));
        process.exit(1);
    }
    const updated = insertRule(readFileSync(filePath, 'utf8'), request);
    if (updated === undefined) {
        console.error(chalk.red(`❌ ${relativePath} declares no package to put the rule in; nothing was written.`));
        process.exit(1);
    }
    const committed = await commitSource(filePath, relativePath, updated, selectedOutlineSource(projectRoot, config));
    if (!committed.success) {
        console.error(chalk.red(`❌ ${committed.error}`));
        process.exit(1);
    }
    console.log(chalk.green(`✅ Wrote ${request.id} (${request.typeName}) to ${relativePath}`));
}


// ─── memo rules tailor ───────────────────────────────────────────────────────
//
// Switch off, or change the severity of, a rule, every rule that enforces a
// clause of a standard, or every rule on a layer: one `RulePolicy`, so one
// decision with one rationale and one approval in the tailoring record. It goes
// through the checks and the writer Architect uses, and through the
// compile-before-commit write, so a policy the compiler rejects never reaches
// the file. `--dry-run` shows the rules the policy reaches and stops.

export interface RulesTailorOptions {
    rule?: string;
    standard?: string;
    category?: string;
    disable?: boolean;
    severity?: string;
    replaceWith?: string;
    rationale?: string;
    authority?: string;
    approval?: string;
    file?: string;
    dryRun?: boolean;
}

export async function rulesTailorCommand(projectDir: string | undefined, options: RulesTailorOptions): Promise<void> {
    const fail = (message: string): never => { console.error(chalk.red(`❌ ${message}`)); process.exit(1); };
    const given = [options.rule, options.standard, options.category].filter(Boolean);
    if (given.length !== 1) fail('Name exactly one of --rule, --standard and --category.');
    if (!options.disable && !options.severity && !options.replaceWith) {
        fail('State the decision: --disable, --severity <error|warning|info>, or --replace-with <rule> (one rule only).');
    }
    if (options.severity && !['error', 'warning', 'info'].includes(options.severity)) fail('--severity expects error, warning or info.');
    if (!options.dryRun && !options.file) fail('Missing --file: the project binding or methodology source to write the policy into.');

    const { projectRoot, config, effectiveRules, clauseFacts } = await loadContext(projectDir);

    const request: RulePolicyRequest = {
        disposition: options.replaceWith ? 'replaced' : options.disable ? 'disabled' : 'enabled',
        rationaleText: options.rationale ?? '',
        ...(options.severity ? { severityOverride: options.severity as 'error' | 'warning' | 'info' } : {}),
        ...(options.replaceWith ? { replacementRuleType: options.replaceWith } : {}),
        ...(options.authority ? { authority: options.authority } : {}),
        ...(options.approval ? { approvalReference: options.approval } : {}),
    };
    if (options.rule) {
        // A rule is named by its `constraint def` or by its id.
        const target = effectiveRules.find(r => r.sourceRuleType === options.rule || r.sourceRuleId === options.rule);
        request.targetRuleType = target?.sourceRuleType ?? options.rule;
    } else if (options.standard) {
        if (clauseFacts.length === 0) {
            fail('A standard is selected by the clauses its rules enforce, which only a compiler that builds the model can read. '
                + 'Select the compiler (--toolchain.compiler, or the compiler setting), or name rules one at a time.');
        }
        const standard = resolveStandardReference(clauseFacts, options.standard);
        if (!standard) fail(`"${options.standard}" names no single standard of the model. Use its designation, such as "ISO 14971", or its qualified name.`);
        request.targetStandard = standard;
    } else {
        request.targetCategory = options.category;
    }

    const refusal = checkRulePolicy(request, effectiveRules);
    if (refusal) fail(`[${refusal.code}] ${refusal.message}`);

    const reached = request.targetRuleType
        ? effectiveRules.filter(r => r.sourceRuleType === request.targetRuleType)
        : rulesSelectedBy(effectiveRules, request);
    const left = reached.filter(r => r.tailoring === 'invariant' && request.disposition !== 'enabled');
    const changed = reached.filter(r => !left.includes(r));
    console.log(chalk.bold(`\n${request.disposition === 'disabled' ? 'Disables' : request.disposition === 'replaced' ? 'Replaces' : 'Changes the severity of'} ${changed.length} rule(s):`));
    for (const r of changed) {
        const medical = r.domain === 'medicalDevice' ? chalk.magenta(' [medical device]') : '';
        console.log(`  ${r.sourceRuleId} ${r.sourceRuleType}${medical}`);
    }
    if (left.length > 0) {
        console.log(chalk.yellow(`  ${left.length} invariant rule(s) in the selection keep running: ${left.map(r => r.sourceRuleId).join(', ')}`));
    }
    if (changed.some(r => r.domain === 'medicalDevice') && request.disposition !== 'enabled'
        && !(request.authority && request.approvalReference)) {
        console.log(chalk.yellow('  A medical-device rule\'s record also needs --authority and --approval; the tailoring record will report it incomplete.'));
    }
    console.log();
    if (options.dryRun) return;

    const relativePath = options.file!.replaceAll('\\', '/');
    const filePath = resolve(projectRoot, relativePath);
    if (!existsSync(filePath)) fail(`${relativePath} does not exist.`);
    const updated = insertRulePolicy(readFileSync(filePath, 'utf8'), renderRulePolicy(request));
    if (updated === undefined) fail(`${relativePath} declares no ProjectMethodBinding or MethodologyDefinition to attach the policy to; nothing was written.`);
    const committed = await commitSource(filePath, relativePath, updated!, selectedOutlineSource(projectRoot, config));
    if (!committed.success) fail(committed.error ?? 'The compiler rejected the policy; nothing was written.');
    console.log(chalk.green(`✅ Wrote the policy to ${relativePath}`));
}
