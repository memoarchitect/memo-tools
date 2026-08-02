import { existsSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import chalk from 'chalk';
import { runPackager } from '../toolchain/operations.js';
import { formatDiagnosticText } from '../toolchain/diagnostic.js';
import { withToolchainOverrides } from '../toolchain/schema.js';
import { defaultRegistry } from '../toolchain/default-registry.js';
import { buildProjectSnapshot } from '../operations/project-snapshot.js';

export async function packCommand(
    options: { output?: string } & Record<string, unknown> = {},
): Promise<void> {
    const snapshot = await buildProjectSnapshot();
    const config = withToolchainOverrides(snapshot.config, options, defaultRegistry);
    const projectName = config.projectName || 'memo-project';
    const outputPath = resolve(snapshot.projectRoot, options.output
        || `${projectName.replace(/[^a-zA-Z0-9_-]/g, '-')}.kpar`);

    console.log(chalk.bold('\n📦 MEMO Pack\n'));
    console.log(chalk.gray(`  Project: ${projectName}`));
    console.log(chalk.gray(`  Validator: ${snapshot.validator}`));

    // The packager is resolved and run through the registry like anything else.
    // There is no `if (packager === 'internal')` here any more: MEMO's own KPAR
    // writer is a provider, reached the same way `sysand` is.
    const result = await runPackager({ config, projectDir: snapshot.projectRoot, outputPath });
    console.log(chalk.gray(`  Packager: ${result.provider}`));
    for (const diagnostic of result.diagnostics) {
        console.log(chalk.red(`  ${formatDiagnosticText(diagnostic)}`));
    }
    if (!result.accepted) {
        throw new Error(`${result.provider} failed to package the project.`);
    }

    if (!existsSync(outputPath)) throw new Error(`Packager did not create ${outputPath}.`);
    const size = statSync(outputPath).size;
    console.log(chalk.green(`  Created ${outputPath} (${(size / 1024).toFixed(1)} KB)\n`));
}
