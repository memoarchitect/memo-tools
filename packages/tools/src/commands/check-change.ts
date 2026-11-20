// ─── memo-architect check-change ─────────────────────────────────────────────
//
// The change in a working tree or branch, judged for CI: what it reaches (the same change impact
// Architect and AI tools read), the interface contracts it breaks, and the rule findings it adds
// against the commit it branched from. The exit code fails the build on what `--fail-on` names:
// breaking contracts and new errors by default.
// ─────────────────────────────────────────────────────────────────────────────

import { resolve } from 'node:path';
import chalk from 'chalk';
import { findProjectRoot, loadProjectSettings } from '../index.js';
import { loadProjectModel, projectConstraints } from '../toolchain/project-model.js';
import { validateProject } from '../toolchain/project-validation.js';
import { loadMethodologyDescriptor } from '../model/methodology-loader.js';
import { computeChangeImpact, type ImpactReport } from '../model/impact.js';
import type { Violation } from '../validator/types.js';

export const FAIL_ON = ['breaking', 'errors', 'warnings', 'release'] as const;
export type FailOn = typeof FAIL_ON[number];

export interface ChangeCheck {
    impact: ImpactReport;
    /** Findings the change adds: in the working model and not in the base, by rule and element. */
    newFindings: Pick<Violation, 'severity' | 'ruleId' | 'elementId' | 'description'>[];
    /** Findings the change clears. */
    cleared: number;
    failures: string[];
}

const key = (v: Pick<Violation, 'ruleId' | 'elementId'>) => `${v.ruleId}\u0000${v.elementId}`;

/** What fails the check, from the report and the `--fail-on` list. */
export function changeFailures(check: Omit<ChangeCheck, 'failures'>, failOn: readonly FailOn[]): string[] {
    const failures: string[] = [];
    const breaking = check.impact.contract.summary.breaking ?? 0;
    const errors = check.newFindings.filter(f => f.severity === 'error').length;
    const warnings = check.newFindings.filter(f => f.severity === 'warning').length;
    const releases = check.impact.releases.filter(r => r.needsNewRelease).length;
    if (failOn.includes('breaking') && breaking > 0) failures.push(`${breaking} breaking interface change${breaking === 1 ? '' : 's'}`);
    if (failOn.includes('errors') && errors > 0) failures.push(`${errors} new error${errors === 1 ? '' : 's'}`);
    if (failOn.includes('warnings') && warnings > 0) failures.push(`${warnings} new warning${warnings === 1 ? '' : 's'}`);
    if (failOn.includes('release') && releases > 0) failures.push(`${releases} release${releases === 1 ? '' : 's'} needing a new release`);
    return failures;
}

export async function runChangeCheck(projectRoot: string, base: string, failOn: readonly FailOn[]): Promise<ChangeCheck> {
    const config = loadProjectSettings(projectRoot);
    const head = await loadProjectModel({ projectRoot, config });
    if (!head.registries?.kindRegistry || !head.registries.relationshipRegistry) {
        throw new Error('The model was built without the ontology registries, so its change cannot be judged.');
    }
    const descriptor = await loadMethodologyDescriptor(projectRoot, head.resolution, head.api);
    const packages = (descriptor.effective?.chain ?? []).map(m => m.packageQualifiedName).filter((p): p is string => !!p);
    const headFindings = (await validateProject(projectRoot, head)).validation.violations;
    let baseFindings: Violation[] = [];
    const impact = await computeChangeImpact({
        projectRoot, target: base,
        head: { model: head.model, registries: head.registries, api: head.api, constraints: projectConstraints(head), packages },
        build: { config: { toolchain: config.toolchain } },
        withBase: async (baseProject, projectDir) => { baseFindings = (await validateProject(projectDir, baseProject)).validation.violations; },
    });
    const before = new Set(baseFindings.map(key));
    const after = new Set(headFindings.map(key));
    const newFindings = headFindings.filter(v => v.severity !== 'info' && !before.has(key(v)))
        .map(({ severity, ruleId, elementId, description }) => ({ severity, ruleId, elementId, description }));
    const cleared = baseFindings.filter(v => v.severity !== 'info' && !after.has(key(v))).length;
    const partial = { impact, newFindings, cleared };
    return { ...partial, failures: changeFailures(partial, failOn) };
}

export async function checkChangeCommand(options: { base?: string; failOn?: string; json?: boolean; project?: string }): Promise<void> {
    const projectRoot = findProjectRoot(resolve(options.project ?? process.cwd()));
    if (!projectRoot) {
        console.error(chalk.red('No MEMO project found here.'));
        process.exit(2);
    }
    const failOn = (options.failOn ?? 'breaking,errors').split(',').map(s => s.trim()).filter(Boolean);
    const unknown = failOn.filter(f => !(FAIL_ON as readonly string[]).includes(f));
    if (unknown.length) {
        console.error(chalk.red(`--fail-on takes ${FAIL_ON.join(', ')}; not ${unknown.join(', ')}.`));
        process.exit(2);
    }
    const check = await runChangeCheck(projectRoot, options.base ?? 'main', failOn as FailOn[]);
    if (options.json) {
        console.log(JSON.stringify(check, null, 2));
    } else {
        const { impact } = check;
        const c = impact.changed;
        console.log(chalk.bold(`Change from ${impact.base.ref} (${impact.base.commit.slice(0, 8)})`));
        console.log(`  Elements: ${c.added} added, ${c.removed} removed, ${c.changed} changed; links: ${c.addedLinks} added, ${c.removedLinks} removed, ${c.changedLinks} changed`);
        const reached = Object.entries(impact.reached).map(([layer, items]) => `${layer} ${items.length}`).join(', ');
        if (reached) console.log(`  Reaches: ${reached}`);
        if (impact.systems.length) console.log(`  Systems: ${impact.systems.map(s => s.name).join(', ')}`);
        for (const change of impact.contract.changes.filter(ch => ch.verdict === 'breaking')) {
            console.log(chalk.red(`  Breaking: ${change.subject.name}: ${change.reason}`));
        }
        for (const release of impact.releases.filter(r => r.needsNewRelease)) console.log(chalk.yellow(`  Needs a new release: ${release.name}`));
        for (const step of impact.reopened) console.log(`  Reopens: ${step.label} (${step.workspace})`);
        for (const finding of check.newFindings) {
            const paint = finding.severity === 'error' ? chalk.red : chalk.yellow;
            console.log(paint(`  New ${finding.severity}: [${finding.ruleId}] ${finding.elementId}: ${finding.description}`));
        }
        if (check.cleared) console.log(chalk.green(`  Clears ${check.cleared} finding${check.cleared === 1 ? '' : 's'}`));
        for (const limit of impact.limits) console.log(chalk.gray(`  ${limit}`));
        console.log(check.failures.length ? chalk.red(`\nFails: ${check.failures.join('; ')}.`) : chalk.green('\nPasses.'));
    }
    process.exit(check.failures.length ? 1 : 0);
}
