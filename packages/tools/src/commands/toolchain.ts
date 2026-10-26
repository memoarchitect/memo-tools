// ─── memo toolchain / memo config ────────────────────────────────────────────
//
// `toolchain probe` answers "which binary am I actually running, and what
// version is it?" without running a build to find out. `config effective`
// answers "what did my settings, my flags and the defaults add up to?".
//
// Both are thin: the resolution lives in `toolchain/operations.ts`, which is
// the same implementation Architect's server protocol calls.
// ─────────────────────────────────────────────────────────────────────────────

import { statSync } from 'node:fs';
import { resolve } from 'node:path';
import chalk from 'chalk';
import { stringify as toYaml } from 'yaml';
import { findConfigFile, loadProjectSettings } from '../model/config-loader.js';
import { defaultRegistry } from '../toolchain/default-registry.js';
import { withToolchainOverrides } from '../toolchain/schema.js';
import { effectiveConfigReport, formatProbeLine, probeToolchain, runValidator } from '../toolchain/operations.js';
import {
    applyValidatorExceptions,
    projectRelative,
    readValidatorExceptions,
    VALIDATOR_EXCEPTIONS_FILE,
} from '../toolchain/exceptions.js';
import { findSysmlFiles } from '../model/sysml-files.js';
import { PROVIDER_ROLES } from '../toolchain/registry.js';
import { OPENSYSML_PROVIDER_ID } from '../toolchain/providers/opensysml-names.js';

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

// ─── memo toolchain check ────────────────────────────────────────────────────
//
// Runs the SELECTED validator — `toolchain.validator`, switchable per run with
// `--toolchain.validator=<id>` — over the given paths and nothing else, and
// applies the project's `validator-exceptions.json`. It is the one way scripts
// ask "does this SysML pass the validator": memo's build, its portability
// check and memo-tools' test gate all call it rather than spawning a tool, so
// changing engines is a flag and an exception is honoured by all of them.
//
// Unlike `memo validate` it runs no MEMO rule: the question is the SysML's,
// not the model's. Fails on any error not excepted, on any warning not excepted
// for a provider whose warnings are findings (SysIDE, run with
// `--warnings-as-errors`), on any stale exception for the provider that ran, and
// on a provider that cannot run. OpenSysML's warnings are printed and do not
// fail: its own verdict (`accepted`) is "no errors", and its `name-conflict`
// warning fires on every recursive `expose X::**` over a tree with repeated
// member names, which the sample views need.
// ─────────────────────────────────────────────────────────────────────────────

/** Whether a validator's warnings are findings that fail the check. OpenSysML's are reported, not failing. */
export const warningsFail = (provider: string): boolean => provider !== OPENSYSML_PROVIDER_ID;

export interface ToolchainCheckOptions extends Record<string, unknown> {
    project?: string;
    exceptions?: string;
}

export async function toolchainCheckCommand(paths: string[], options: ToolchainCheckOptions = {}): Promise<void> {
    const { projectDir, config } = loadFor(options.project, options);
    // `files` is honoured by every provider, so the set checked is exactly the
    // set named — a directory is expanded here rather than left to a tool that
    // might walk it differently.
    const files = (paths.length > 0 ? paths : ['.']).flatMap(path => {
        const full = resolve(projectDir, path);
        return statSync(full).isDirectory() ? findSysmlFiles(full) : [full];
    });
    const exceptionsPath = resolve(projectDir, options.exceptions ?? VALIDATOR_EXCEPTIONS_FILE);
    const exceptions = readValidatorExceptions(exceptionsPath);

    let run;
    try {
        run = await runValidator({ config, projectDir, files, registry: defaultRegistry });
    } catch (error) {
        console.error(chalk.red(`✖ ${error instanceof Error ? error.message : error}`));
        process.exitCode = 1;
        return;
    }
    const outcome = applyValidatorExceptions(run.diagnostics, exceptions, run.provider, projectDir);
    const failing = outcome.remaining.filter(d => d.severity === 'error' || (warningsFail(run.provider) && d.severity === 'warning'));
    const tolerated = outcome.remaining.filter(d => d.severity === 'warning' && !warningsFail(run.provider));

    for (const { diagnostic, exception } of outcome.excepted) {
        const at = `${projectRelative(diagnostic.file, projectDir)}:${diagnostic.range?.start.line ?? 0}`;
        console.log(chalk.gray(`  excepted ${at} (${diagnostic.code}) — ${exception.id}`));
    }
    for (const diagnostic of failing) {
        const start = diagnostic.range?.start;
        const at = diagnostic.file
            ? `${projectRelative(diagnostic.file, projectDir)}:${start?.line ?? 0}:${start?.column ?? 0}: `
            : '';
        console.log(`${at}${diagnostic.severity}${diagnostic.code ? ` (${diagnostic.code})` : ''}: ${diagnostic.message}`);
    }
    if (tolerated.length > 0) console.log(chalk.yellow(`  ${tolerated.length} ${run.provider} warning(s) reported; they do not fail this check.`));
    for (const exception of outcome.stale) {
        console.error(chalk.red(
            `✖ stale exception ${exception.id}: ${run.provider} no longer reports ${exception.code} in ${exception.file} — delete it.`));
    }
    const version = run.providerVersion ? ` ${run.providerVersion}` : '';
    if (failing.length > 0 || outcome.stale.length > 0) {
        console.error(chalk.red(
            `✖ ${run.provider}${version}: ${files.length} file(s), ${failing.length} diagnostic(s) not excepted, `
            + `${outcome.stale.length} stale exception(s).`));
        process.exitCode = 1;
        return;
    }
    console.log(chalk.green(
        `✔ ${run.provider}${version}: ${files.length} file(s) clean`
        + (outcome.excepted.length > 0 ? `, ${outcome.excepted.length} excepted` : '') + '.'));
}
