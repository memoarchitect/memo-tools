// ─── memo-architect lock ────────────────────────────────────────────────────────────────
//
// Regenerates memo.lock.yaml from the packages the project's imports resolve to.
// ─────────────────────────────────────────────────────────────────────────────

import { dirname } from 'node:path';
import chalk from 'chalk';
import { findConfigFile } from '@memoarchitect/tools';
import { createLockFile } from '../lock.js';
import { loadProjectOntology } from '../toolchain/project-model.js';
import { loadProjectSettings } from '../model/config-loader.js';

export async function lockCommand(): Promise<void> {
    const cwd = process.cwd();

    const configPath = findConfigFile(cwd);
    if (!configPath) {
        console.error(chalk.red('❌ No memo config found. Run `memo-architect init` first.'));
        process.exit(1);
    }

    try {
        const projectRoot = dirname(configPath);
        const { resolution } = await loadProjectOntology({ projectRoot, config: loadProjectSettings(projectRoot) });
        if (!resolution) throw new Error('the project did not resolve');
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
