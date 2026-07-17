// ─── memo import sysand ──────────────────────────────────────────────────────
//
// Import a SysAnd project directory into MEMO.
// Reads .project.json + SysML files, populates registries.
// ─────────────────────────────────────────────────────────────────────────────

import { resolve } from 'node:path';
import { existsSync } from 'node:fs';
import chalk from 'chalk';
import {
    importSysandProject,
    loadOntologyRegistries,
    findConfigFile,
    verifySysandRoundTrip,
} from '@memoarchitect/tools';

/**
 * memo import sysand <project-dir> — Import a SysAnd project.
 *
 * Reads .project.json + SysML files from a SysAnd project directory.
 * Populates KindRegistry and RelationshipRegistry.
 * Optionally verifies round-trip against the current ontology.
 */
export async function importSysandCommand(
    projectDir: string,
    options: { verify?: boolean },
): Promise<void> {
    const cwd = process.cwd();

    console.log(chalk.bold('\n\u{1F4E5} MEMO Import \u2190 SysAnd Project\n'));

    const dirPath = resolve(cwd, projectDir);
    if (!existsSync(dirPath)) {
        console.error(chalk.red(`Directory not found: ${dirPath}`));
        process.exit(1);
    }

    // Import
    const result = await importSysandProject(dirPath);

    // Report
    if (result.projectJson.name) {
        console.log(chalk.cyan(`  Project: ${result.projectJson.name} v${result.projectJson.version || '?'}`));
    }
    console.log(chalk.cyan(`  Packages:      ${result.stats.packages}`));
    console.log(chalk.cyan(`  SysML files:   ${result.stats.sysmlFiles}`));
    console.log(chalk.cyan(`  Kinds:         ${result.stats.kinds}`));
    console.log(chalk.cyan(`  Relationships: ${result.stats.relationships}`));

    for (const warn of result.warnings) {
        console.log(chalk.yellow(`  \u26A0 ${warn}`));
    }
    for (const err of result.errors) {
        console.error(chalk.red(`  \u2716 ${err}`));
    }

    if (result.stats.sysmlFiles === 0) {
        console.error(chalk.red('\nNo .sysml files found in the SysAnd project.'));
        process.exit(1);
    }

    // Round-trip verification
    if (options.verify) {
        console.log(chalk.dim('\n── Round-trip verification ──'));

        const configPath = findConfigFile(cwd);
        if (!configPath) {
            console.log(chalk.yellow('  No MEMO config found — skipping round-trip verification.'));
        } else {
            const original = await loadOntologyRegistries(configPath);
            const diff = verifySysandRoundTrip(
                original.registries.kindRegistry!,
                original.registries.relationshipRegistry!,
                result.kindRegistry,
                result.relationshipRegistry,
            );

            if (diff.isClean) {
                console.log(chalk.green('  \u2705 Round-trip clean: all kinds and relationships match.'));
            } else {
                if (diff.missingKinds.length > 0) {
                    console.log(chalk.red(`  Missing kinds (in original, not in import): ${diff.missingKinds.join(', ')}`));
                }
                if (diff.extraKinds.length > 0) {
                    console.log(chalk.yellow(`  Extra kinds (in import, not in original): ${diff.extraKinds.join(', ')}`));
                }
                if (diff.missingRels.length > 0) {
                    console.log(chalk.red(`  Missing relationships: ${diff.missingRels.join(', ')}`));
                }
                if (diff.extraRels.length > 0) {
                    console.log(chalk.yellow(`  Extra relationships: ${diff.extraRels.join(', ')}`));
                }
            }
        }
    }

    // Summary
    console.log(chalk.green(`\n\u2705 Imported SysAnd project: ${result.stats.kinds} kinds, ${result.stats.relationships} relationships from ${result.stats.sysmlFiles} files\n`));

    // Show kind list
    if (result.kindRegistry.size > 0) {
        const kindNames = result.kindRegistry.kindNames();
        if (kindNames.length <= 20) {
            console.log(chalk.dim(`  Kinds: ${kindNames.join(', ')}`));
        } else {
            console.log(chalk.dim(`  Kinds: ${kindNames.slice(0, 20).join(', ')} ... and ${kindNames.length - 20} more`));
        }
    }
}
