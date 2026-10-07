// ─── memo config set / get / unset ───────────────────────────────────────────
//
// The settings that are the user's own (which compiler, where its tools are on
// this machine) live in the user's settings file, not in the project. These
// commands read and write that file, so nobody edits YAML by hand and nobody
// has to guess which layer a value came from. Which settings are the user's is
// the registry's answer (`scope: 'user'`), not a list here; the logic is
// shared with Architect (`toolchain/user-settings-status.ts`).
// ─────────────────────────────────────────────────────────────────────────────

import chalk from 'chalk';
import type { ToolchainConfig } from '../model/config.js';
import { USER_COMPILER_ENV, userSettingsPath } from '../model/user-settings.js';
import { defaultRegistry } from '../toolchain/default-registry.js';
import type { ProviderRegistry } from '../toolchain/registry.js';
import { applyUserSetting, ConfigSettingError, userLeaf, userSettingReports } from '../toolchain/user-settings-status.js';

export { ConfigSettingError, userSettingReports };

export function configSetCommand(path: string, value: string, registry: ProviderRegistry = defaultRegistry): void {
    const { file } = applyUserSetting(path, value, registry);
    console.log(chalk.green(`Set toolchain.${path} = ${value}`) + chalk.gray(` in ${file}`));
    if (path === 'compiler' && process.env[USER_COMPILER_ENV]?.trim()) {
        console.log(chalk.yellow(`  ${USER_COMPILER_ENV} is set in this shell and beats the file: ${process.env[USER_COMPILER_ENV]}.`));
    }
}

export function configUnsetCommand(path: string, registry: ProviderRegistry = defaultRegistry): void {
    const { changed } = applyUserSetting(path, undefined, registry);
    console.log(changed
        ? chalk.green(`Removed toolchain.${path}`) + chalk.gray(` from ${userSettingsPath()}`)
        : chalk.gray(`toolchain.${path} was not set in ${userSettingsPath()}`));
}

export function configGetCommand(path: string | undefined, registry: ProviderRegistry = defaultRegistry, commandLine: ToolchainConfig = {}): void {
    if (path) userLeaf(path, registry);
    const reports = userSettingReports(registry, commandLine).filter(r => !path || r.path === path);
    console.log(chalk.gray(`  your settings: ${userSettingsPath()}`));
    for (const report of reports) {
        const left = `toolchain.${report.path}`.padEnd(30);
        if (!report.layer) {
            console.log(`  ${left} ${chalk.gray('(not set)')}`);
            continue;
        }
        const others = report.layers.slice(1).map(l => `${l.layer}: ${l.value}`).join('; ');
        console.log(`  ${left} ${report.value}  ${chalk.gray(`(${report.layer}${others ? `; overrides ${others}` : ''})`)}`);
    }
}
