import { existsSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import chalk from 'chalk';
import { runPackager } from '../toolchain/operations.js';
import { formatDiagnosticText } from '../toolchain/diagnostic.js';
import { withToolchainOverrides } from '../toolchain/schema.js';
import { defaultRegistry } from '../toolchain/default-registry.js';
import { loadProjectSettings } from '../model/config-loader.js';
import { resolveToolchain } from '../toolchain/effective.js';
import type { PackageDescriptor } from '../toolchain/registry.js';

export async function packCommand(
    options: { output?: string } & Record<string, unknown> = {},
): Promise<void> {
    // A package (the ontology, an extension) is packed as well as a project, so this does not
    // compile first: what a packager needs of the project it reads for itself.
    const projectRoot = process.cwd();
    const config = withToolchainOverrides(loadProjectSettings(projectRoot), options, defaultRegistry);
    const modelName = config.modelName || 'memo-project';
    // The file is named by what the selected packager makes.
    const packager = defaultRegistry.descriptor('package', resolveToolchain(config, defaultRegistry).packager) as PackageDescriptor;
    const defaultName = packager.defaultOutputName?.({ config, projectDir: projectRoot })
        ?? `${modelName.replace(/[^a-zA-Z0-9_-]/g, '-')}.memo-bundle`;
    const outputPath = resolve(projectRoot, options.output || defaultName);

    console.log(chalk.bold('\n📦 MEMO Pack\n'));
    console.log(chalk.gray(`  Model: ${modelName}`));

    // The packager is resolved and run through the registry like anything else.
    // There is no `if (packager === 'internal')` here any more: MEMO's own KPAR
    // writer is a provider, reached the same way `sysand` is.
    const result = await runPackager({ config, projectDir: projectRoot, outputPath });
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
