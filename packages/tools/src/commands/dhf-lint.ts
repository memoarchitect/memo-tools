// ─── memo dhf lint ────────────────────────────────────────────────────────────
//
// Validates the shipped DHF templates against the ontology they query.
// Runs structurally in any checkout; resolves kinds, layers and columns when an
// ontology is reachable from the working directory.
// ─────────────────────────────────────────────────────────────────────────────

import chalk from 'chalk';
import { dirname } from 'node:path';
import { lintTemplates, type LintFinding } from '../dhf/template-lint.js';
import { loadOntologyRegistries } from '../model/ontology-loader.js';
import { findConfigFile } from '../model/config-loader.js';

export interface DhfLintOptions {
    /** Only lint templates whose id starts with this prefix, e.g. "iso-14971". */
    filter?: string;
    /** Skip ontology resolution and run structural checks only. */
    structuralOnly?: boolean;
    /** Emit JSON for CI consumption. */
    json?: boolean;
}

export async function dhfLintCommand(options: DhfLintOptions = {}): Promise<void> {
    const cwd = process.cwd();

    let kindRegistry;
    let relationshipRegistry;
    let knownLayers: Set<string> | undefined;

    if (!options.structuralOnly) {
        // The ontology repo itself resolves as a root, so this works both in a
        // project and in a bare ontology checkout.
        const configPath = findConfigFile(cwd);
        const root = configPath ? dirname(configPath) : cwd;
        try {
            const loaded = await loadOntologyRegistries(root);
            kindRegistry = loaded.registries.kindRegistry ?? undefined;
            relationshipRegistry = loaded.registries.relationshipRegistry ?? undefined;
            if (kindRegistry) {
                knownLayers = new Set(
                    kindRegistry.entries().map(e => e.layer).filter((l): l is string => Boolean(l) && l !== 'unknown'),
                );
            }
        } catch {
            // Fall through to structural-only rather than failing the lint: a
            // template with a broken `where:` is still worth reporting when the
            // ontology cannot be resolved.
            kindRegistry = undefined;
        }
    }

    const report = lintTemplates({ kindRegistry, relationshipRegistry, knownLayers, filter: options.filter });

    if (options.json) {
        console.log(JSON.stringify(report, null, 2));
        process.exitCode = report.findings.some(f => f.severity === 'error') ? 1 : 0;
        return;
    }

    const errors = report.findings.filter(f => f.severity === 'error');
    const warnings = report.findings.filter(f => f.severity === 'warning');

    console.log(chalk.bold('\nMEMO DHF Template Lint\n'));
    console.log(chalk.gray(
        `Templates: ${report.templatesChecked} | Mode: ${report.ontologyAware ? 'ontology-aware' : 'structural only'}\n`,
    ));

    if (report.findings.length === 0) {
        console.log(chalk.green('  ✔ no findings\n'));
        return;
    }

    const byTemplate = new Map<string, LintFinding[]>();
    for (const f of report.findings) {
        if (!byTemplate.has(f.template)) byTemplate.set(f.template, []);
        byTemplate.get(f.template)!.push(f);
    }

    for (const [template, findings] of [...byTemplate.entries()].sort()) {
        console.log(chalk.bold(`  ${template}`));
        for (const f of findings) {
            const tag = f.severity === 'error' ? chalk.red('error  ') : chalk.yellow('warning');
            const where = f.block ? chalk.gray(` (query block ${f.block})`) : '';
            console.log(`    ${tag} ${chalk.gray(f.rule)}${where}`);
            console.log(`            ${f.message}`);
        }
        console.log('');
    }

    const summary = `${errors.length} error(s), ${warnings.length} warning(s)`;
    console.log(errors.length > 0 ? chalk.red(`  ✖ ${summary}\n`) : chalk.yellow(`  ${summary}\n`));

    if (errors.length > 0) process.exitCode = 1;
}
