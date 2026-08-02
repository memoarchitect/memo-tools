// ─── memo lock ────────────────────────────────────────────────────────────────
//
// Regenerates memo.lock.yaml from the packages the project's imports resolve to.
// ─────────────────────────────────────────────────────────────────────────────

import { dirname } from 'node:path';
import chalk from 'chalk';
import { findConfigFile } from '@memoarchitect/tools';
import { createLockFile } from '../lock.js';

export async function lockCommand(): Promise<void> {
    const cwd = process.cwd();

    const configPath = findConfigFile(cwd);
    if (!configPath) {
        console.error(chalk.red('❌ No memo config found. Run `memo init` first.'));
        process.exit(1);
    }

    try {
        const { resolveNativeProject } = await import('@memoarchitect/tools');
        const resolution = await resolveNativeProject(dirname(configPath));
        const { lockPath, lock } = createLockFile(dirname(configPath), resolution.selectedRoots.map(root => ({
            ...root, origin: 'ontology', importDepth: 1,
        })));
        console.log(chalk.green(`✅ Lock file written: ${lockPath}`));
        console.log(chalk.gray(`   Ontology: ${lock.ontology} v${lock.version}`));
        console.log(chalk.gray(`   Packages: ${lock.packages.length}`));
        for (const pkg of lock.packages) {
            console.log(chalk.gray(`     - ${pkg.name} v${pkg.version} (${pkg.type})`));
        }
    } catch (e) {
        console.error(chalk.red(`❌ Failed to create lock file: ${e instanceof Error ? e.message : e}`));
        process.exit(1);
    }
}
