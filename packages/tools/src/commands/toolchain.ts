// ─── memo toolchain / memo config ────────────────────────────────────────────
//
// `toolchain probe` answers "which binary am I actually running, and what
// version is it?" without running a build to find out. `config effective`
// answers "what did my settings, my flags and the defaults add up to?".
//
// Both are thin: the resolution lives in `toolchain/operations.ts`, which is
// the same implementation Architect's server protocol calls.
// ─────────────────────────────────────────────────────────────────────────────

import { resolve } from 'node:path';
import chalk from 'chalk';
import { stringify as toYaml } from 'yaml';
import { findConfigFile, loadProjectSettings } from '../model/config-loader.js';
import { defaultRegistry } from '../toolchain/default-registry.js';
import { withToolchainOverrides } from '../toolchain/schema.js';
import { effectiveConfigReport, formatProbeLine, probeToolchain } from '../toolchain/operations.js';
import { PROVIDER_ROLES } from '../toolchain/registry.js';

export type StructuredFormat = 'text' | 'json' | 'yaml';

function loadFor(dir: string | undefined, options: Record<string, unknown>) {
    const projectDir = resolve(dir || process.cwd());
    const settingsFile = findConfigFile(projectDir);
    const config = withToolchainOverrides(
        loadProjectSettings(projectDir), options, defaultRegistry);
    return { projectDir, settingsFile, config };
}

export async function toolchainProbeCommand(
    dir?: string,
    options: { format?: StructuredFormat } & Record<string, unknown> = {},
): Promise<void> {
    const { projectDir, config } = loadFor(dir, options);
    const probe = probeToolchain({ config, projectDir, registry: defaultRegistry });

    if (options.format === 'json') {
        process.stdout.write(JSON.stringify(probe, null, 2) + '\n');
    } else if (options.format === 'yaml') {
        process.stdout.write(toYaml(probe));
    } else {
        console.log(chalk.bold('\n🔧 MEMO Toolchain\n'));
        for (const role of probe.roles) {
            const line = formatProbeLine(role);
            console.log(role.availability.available ? chalk.gray(`  ${line}`) : chalk.red(`  ${line}`));
        }
        console.log();
        for (const note of probe.effective.deprecations) console.log(chalk.yellow(`  ⚠ ${note}`));
        console.log(chalk.dim('  Registered providers:'));
        for (const roleName of PROVIDER_ROLES) {
            console.log(chalk.dim(`    ${roleName.padEnd(10)} ${defaultRegistry.ids(roleName).join(', ')}`));
        }
        console.log();
    }

    // A selected tool that is not there is a failed probe, not a note. Rule 2:
    // never a silent fallback to a different provider.
    if (probe.roles.some(role => !role.availability.available)) process.exitCode = 1;
}

export async function configEffectiveCommand(
    dir?: string,
    options: { format?: StructuredFormat } & Record<string, unknown> = {},
): Promise<void> {
    const { projectDir, settingsFile, config } = loadFor(dir, options);
    const report = effectiveConfigReport({
        config, projectDir, settingsFile, registry: defaultRegistry });

    if (options.format === 'json') {
        process.stdout.write(JSON.stringify(report, null, 2) + '\n');
        return;
    }
    process.stdout.write(toYaml(report));
}
