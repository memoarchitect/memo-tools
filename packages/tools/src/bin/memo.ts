#!/usr/bin/env node
// ─── MEMO Tools CLI ────────────────────────────────────────────────────────
//
// Compile a project with the selected SysML compiler, validate it, and pack it.
//   memo compile          — is this valid SysML (stage 1)
//   memo validate         — the model against the rules, and completeness
//   memo toolchain check  — the validator over files that are not a project
//   memo pack             — package a project or package (a KPAR, or MEMO's own bundle)
//   memo ship-library     — a package's compiled library, for the package to carry
//
// Creating a project, authoring, packaging, exporting, settings and the rest
// are memo-architect's commands. The old names here fail loudly for one
// release and name where each went.
// ─────────────────────────────────────────────────────────────────────────────

import { Command } from 'commander';
import { validateCommand } from '../commands/validate.js';
import { packCommand } from '../commands/pack.js';
import { sysandPublishCommand } from '../commands/sysand-publish.js';
import { inspectCommand } from '../commands/inspect.js';
import { rulesExplainCommand, rulesListCommand } from '../commands/rules.js';
import { standardsCheckCommand } from '../commands/standards.js';
import { retiredCommand } from '../commands/retired.js';
import {
    configEffectiveCommand,
    toolchainCheckCommand,
    toolchainProbeCommand,
} from '../commands/toolchain.js';
import { applyToolchainCliOptions } from '../toolchain/schema.js';
import { compileCommand } from '../commands/compile.js';
import { shipLibraryCommand } from '../commands/ship-library.js';
import { defaultRegistry } from '../toolchain/default-registry.js';
import chalk from 'chalk';
import { Stage1RejectedError } from '../toolchain/project-model.js';
import { ToolchainNotConfiguredError } from '../toolchain/effective.js';
import { ProjectNamesUserSettingError } from '../toolchain/ownership.js';
import { setCommandLineToolchain } from '../model/config-loader.js';
import { toolchainOverridesFromCliOptions } from '../toolchain/schema.js';

const program = new Command();

/**
 * Add the generated `--toolchain.*` options to a command.
 *
 * Generated from the registry's schema, so a provider that contributes a
 * settings leaf gets its flag without anyone editing this file — which is what
 * makes "adding a provider touches one file" true of the CLI too.
 */
const withToolchainOptions = (command: Command): Command =>
    applyToolchainCliOptions(command, defaultRegistry);

program
    .name('memo')
    .description('MEMO — Model-Based Systems Engineering for Medical Devices')
    .version('0.6.7');

withToolchainOptions(
    program
        .command('ship-library')
        .description("Export a package's library set with the selected compiler, for the package to carry (stage1/)")
        .argument('[dir]', 'Package directory whose manifest offers the library roots', '.')
        .option('--out <dir>', 'Directory to write the shipped files to (default: <dir>/stage1)'),
).action(async (dir: string, opts: Record<string, unknown>) => {
    await shipLibraryCommand(dir, opts);
});

withToolchainOptions(
    program
        .command('compile')
        .description('Check the project is valid SysML with the selected compiler (stage 1); no MEMO rules')
        .argument('[dir]', 'Project directory', '.')
        .option('--force', 'Compile even when the stage 1 output in .memo/stage1 is fresh')
        .option('--out <file>', 'Write the compiled SysML v2 model (API JSON, diagnostics, element index) to this file')
        .option('--inspect <id>', 'Instead of compiling, show a model element or relationship')
        .option('--provenance', 'With --inspect: only the declaration and classifier provenance')
        .option('--probe', 'Instead of compiling, show which provider fills each role, its executable and version')
        .option('--effective', 'Instead of compiling, print the settings that are in effect, after flags and the environment')
        .option('--format <format>', 'With --probe or --effective: text, json, yaml', undefined),
).action(async (dir: string, opts: Record<string, unknown>) => {
    // The read-only reports are flags of compile and validate, not commands of their own.
    if (opts.inspect) return inspectCommand(String(opts.inspect), { provenance: opts.provenance === true, dir });
    if (opts.probe) return toolchainProbeCommand(dir, { ...opts, format: opts.format as any });
    if (opts.effective) return configEffectiveCommand(dir, { ...opts, format: (opts.format as any) ?? 'yaml' });
    await compileCommand(dir, opts);
});

withToolchainOptions(
    program
        .command('pack')
        .description('Package the project or package you are in, with toolchain.packager: a KPAR (sysand) or MEMO\'s own bundle (internal)')
        .option('-o, --output <file>', 'Output file (default: <name>-<version>.kpar for sysand, <name>.memo-bundle otherwise)'),
).action(async (options: Record<string, unknown>) => {
    await packCommand({ ...options, output: options.output as string | undefined });
});

withToolchainOptions(
    program
        .command('publish')
        .description('Dry run of publishing the package or project you are in: stages what `memo pack` stages and reports the artifact; writes and uploads nothing')
        .option('-p, --package <name>', 'Check that this is the package named (by name or directory)'),
).action(async (options: Record<string, unknown>) => {
    await sysandPublishCommand({ ...options, dryRun: true });
});

withToolchainOptions(
    program
        .command('validate')
        .description('Validate the model against closure rules and show completeness')
        .argument('[dir]', 'Project directory', '.')
        .option('--format <format>', 'Output format: text, junit, json', 'text')
        .option('-o, --output <file>', 'Write output to file instead of stdout')
        .option('--no-server', 'Compile here even when `memo dev` is running for the project')
        .option('--rules', 'Instead of validating, list the consistency rules in effect (--format text or json)')
        .option('--rules-domain <domain>', 'With --rules: modelling, medicalDevice, organisation')
        .option('--rules-obligation <obligation>', 'With --rules: required, recommended, bestPractice')
        .option('--rules-category <category>', 'With --rules: invariant, assurance, methodology')
        .option('--explain-rule <id>', 'Instead of validating, show one rule in detail (e.g. CR-MED-001)')
        .option('--standards', 'Instead of validating, report clause coverage: required, claimed, evidenced')
        .option('--standard <designation>', 'With --standards: only this standard (substring of the designation)')
        .option('--regime <regime...>', 'With --standards: scope to these regimes, overriding the project declaration')
        .option('--gaps-only', 'With --standards: only clauses nothing claims'),
).action(async (dir: string, opts: Record<string, unknown>) => {
    // The read-only reports are flags of compile and validate, not commands of their own.
    const reportFormat = opts.format === 'json' ? 'json' : 'text';
    if (opts.format === 'junit' && (opts.rules || opts.explainRule || opts.standards)) {
        console.error(chalk.red('✖ the rule and standards reports are text or json, not junit.'));
        process.exitCode = 1;
        return;
    }
    if (opts.rules) return rulesListCommand(dir, { format: reportFormat, category: opts.rulesCategory as string | undefined, domain: opts.rulesDomain as string | undefined, obligation: opts.rulesObligation as string | undefined });
    if (opts.explainRule) return rulesExplainCommand(String(opts.explainRule), dir, { format: reportFormat });
    if (opts.standards) {
        return standardsCheckCommand({
            standard: opts.standard as string | undefined, regime: opts.regime as string[] | undefined,
            gapsOnly: opts.gapsOnly === true, json: reportFormat === 'json',
        });
    }
    await validateCommand(dir, { ...opts, format: opts.format as any, output: opts.output as string });
});

// ─── memo toolchain ─────────────────────────────────────────────────────────

const toolchainCmd = program
    .command('toolchain')
    .description('Inspect the configured SysML toolchain');


withToolchainOptions(
    toolchainCmd
        .command('check')
        .description('Run the selected validator over these SysML paths, less the listed exceptions')
        .argument('[paths...]', 'Files or directories, relative to the project directory', [])
        .option('-p, --project <dir>', 'Project directory: settings, exceptions and relative paths', '.')
        .option('--exceptions <file>', 'Exceptions register, relative to the project (default validator-exceptions.json)'),
).action(async (paths: string[], opts: Record<string, unknown>) => {
    await toolchainCheckCommand(paths, opts);
});

retiredCommand(toolchainCmd, 'probe', 'memo compile --probe');

// ─── Retired: conformance ───────────────────────────────────────────────────
retiredCommand(program, 'conformance', {
    reason: 'it graded MEMO\'s own SysML compiler against the OMG corpus, and that compiler is gone. '
        + 'The selected compiler is the authority on validity: `memo compile`.',
});

// ─── Retired: check, round-trip ──────────────────────────────────────────────
// Heuristic guesses at what external SysML tools accept, from before the
// selected compiler was the authority on validity; `memo compile` asks it.
retiredCommand(program, 'check', 'memo compile');
retiredCommand(program, 'round-trip', 'memo compile');


// ─── Moved to memo-architect ───────────────────────────────────────────────
// One way of doing a thing: these are `memo-architect <command>` now. The old
// names stay for one release, hidden, and fail naming the replacement.
retiredCommand(program, 'inspect', 'memo compile --inspect <id>');
retiredCommand(program, 'element', 'memo-architect element');
retiredCommand(program, 'init', 'memo-architect init');
retiredCommand(program, 'convert', 'memo-architect convert');
retiredCommand(program, 'package', 'memo-architect import kpar [--inspect] <archive>');
retiredCommand(program, 'config', 'memo compile --effective (what is in effect); memo-architect config (to change it)');
retiredCommand(program, 'export', 'memo-architect export');
retiredCommand(program, 'create-package', 'memo-architect new package');
retiredCommand(program, 'install', 'memo-architect install');
retiredCommand(program, 'lock', 'memo-architect lock');
retiredCommand(program, 'ontology', 'memo-architect ontology');
retiredCommand(program, 'import', 'memo-architect import');
retiredCommand(program, 'ask', 'memo-architect ask');
retiredCommand(program, 'mcp', 'memo-architect mcp');
retiredCommand(program, 'generate', 'memo-architect generate');
retiredCommand(program, 'req', 'memo-architect new requirement --pattern <pattern>');
retiredCommand(program, 'plugin', 'memo-architect plugin');
retiredCommand(program, 'dhf', 'memo-architect dhf');
retiredCommand(program, 'standards', 'memo validate --standards');
retiredCommand(program, 'sysand', 'memo publish');
retiredCommand(program, 'rules', 'memo validate --rules, --explain-rule <id> (to change them: memo-architect new rule, rules tailor|tailoring)');
retiredCommand(program, 'examples', 'memo-architect init --list');
retiredCommand(program, 'templates', 'memo-architect init --list');

// Every command takes the `--toolchain.*` flags, and the running command's
// flags apply to whatever settings it loads (model/config-loader.ts).
const allCommands = (command: Command): Command[] => [command, ...command.commands.flatMap(allCommands)];
for (const command of allCommands(program)) {
    if (command.commands.length > 0 || command === program) continue;
    if (!command.options.some(option => option.attributeName() === 'toolchain.compiler')) withToolchainOptions(command);
}
program.hook('preAction', (_program, action) => {
    setCommandLineToolchain(toolchainOverridesFromCliOptions(action.opts(), defaultRegistry));
});

// A stage 1 that rejects the source is a verdict on the model, not a crash:
// every command that loads one reports its diagnostics and fails, as
// `memo validate` does. Anything else is still a crash, with its stack.
program.parseAsync().catch((error: unknown) => {
    // So is a project whose settings name no compiler: MEMO chooses none.
    if (error instanceof Stage1RejectedError || error instanceof ToolchainNotConfiguredError || error instanceof ProjectNamesUserSettingError) {
        console.error(chalk.red(`\n❌ ${error.message}\n`));
        process.exit(1);
    }
    throw error;
});
