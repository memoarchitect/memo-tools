// ─── memo plugin CLI Commands (M78) ──────────────────────────────────────────
//
// Plugin management commands:
//   memo plugin list              — List registered plugins
//   memo plugin create <name>     — Scaffold a new plugin
//   memo plugin run <id>          — Run a generator or analysis plugin
// ─────────────────────────────────────────────────────────────────────────────

import { resolve, join } from 'node:path';
import { readdirSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import chalk from 'chalk';
import {
    findConfigFile, parseFiles, buildMemoModel, loadOntologyRegistries,
    validateModel, computeCompleteness, createQueryContext,
    PluginRegistry, loadPlugins, loadPluginConfig, scaffoldPlugin,
} from '@memo/tools';
import type { BuilderRegistries, PluginType, PluginContext, MemoPlugin } from '@memo/tools';
import { loadAndResolveConfig } from '../server/config-resolver.js';

function findSysmlFiles(dir: string): string[] {
    const files: string[] = [];
    try {
        for (const entry of readdirSync(dir, { withFileTypes: true })) {
            const full = resolve(dir, entry.name);
            if (entry.isDirectory() && entry.name !== 'node_modules' && entry.name !== '.memo') {
                files.push(...findSysmlFiles(full));
            } else if (entry.name.endsWith('.sysml')) {
                files.push(full);
            }
        }
    } catch { /* skip */ }
    return files;
}

// ─── memo plugin list ───────────────────────────────────────────────────────

export async function pluginListCommand(): Promise<void> {
    const cwd = process.cwd();
    console.log(chalk.bold('\nMEMO Plugins\n'));

    // Load plugin config
    const entries = loadPluginConfig(cwd);
    if (entries.length === 0) {
        console.log(chalk.gray('No plugins configured.'));
        console.log(chalk.gray('Add plugins in memo.plugins.yaml:'));
        console.log(chalk.dim(`
  - module: "./plugins/my-exporter.js"
    options:
      format: pdf
`));
        return;
    }

    // Load plugins
    const registry = new PluginRegistry();
    const result = await loadPlugins(entries, cwd, registry);

    // Display loaded plugins
    if (result.loaded.length > 0) {
        console.log(chalk.bold('  Loaded:'));
        const typeOrder: PluginType[] = ['export', 'analysis', 'validation', 'generator'];
        for (const type of typeOrder) {
            const plugins = registry.list(type);
            if (plugins.length === 0) continue;
            console.log(chalk.cyan(`\n  ${type.toUpperCase()}`));
            for (const p of plugins) {
                const desc = p.description ? chalk.gray(` — ${p.description}`) : '';
                console.log(`    ${p.name} ${chalk.dim(`v${p.version}`)} [${p.id}]${desc}`);
            }
        }
    }

    // Display errors
    if (result.errors.length > 0) {
        console.log(chalk.red(`\n  Errors (${result.errors.length}):`));
        for (const err of result.errors) {
            console.log(chalk.red(`    ${err.module}: ${err.error}`));
        }
    }

    console.log('');
}

// ─── memo plugin create ─────────────────────────────────────────────────────

export async function pluginCreateCommand(
    name: string,
    options: { type?: string; description?: string; output?: string },
): Promise<void> {
    const type = (options.type || 'export') as PluginType;
    const validTypes: PluginType[] = ['export', 'analysis', 'validation', 'generator'];
    if (!validTypes.includes(type)) {
        console.error(chalk.red(`Invalid plugin type: ${type}. Must be one of: ${validTypes.join(', ')}`));
        process.exit(1);
    }

    const cwd = process.cwd();
    const outputDir = resolve(cwd, options.output || `plugins/${name}`);

    console.log(chalk.bold(`\nScaffolding MEMO ${type} plugin: ${name}\n`));

    const files = scaffoldPlugin({
        name,
        type,
        description: options.description,
    });

    // Write files
    for (const file of files) {
        const filepath = join(outputDir, file.path);
        const dir = resolve(filepath, '..');
        if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
        writeFileSync(filepath, file.content);
        console.log(chalk.cyan(`  ${file.path}`));
    }

    console.log(chalk.green(`\n✓ Plugin scaffolded at ${outputDir}`));
    console.log(chalk.gray(`\nNext steps:`));
    console.log(chalk.gray(`  1. cd ${outputDir}`));
    console.log(chalk.gray(`  2. Edit src/index.ts to implement your ${type} logic`));
    console.log(chalk.gray(`  3. Add to memo.plugins.yaml:`));
    console.log(chalk.dim(`     - module: "./${outputDir.replace(cwd + '/', '')}"`));
    console.log('');
}

// ─── memo plugin run ────────────────────────────────────────────────────────

export async function pluginRunCommand(
    pluginId: string,
    options: { json?: boolean },
): Promise<void> {
    const cwd = process.cwd();

    // 1. Load model
    const configPath = findConfigFile(cwd);
    if (!configPath) {
        console.error(chalk.red('No memo config found. Run `memo init` first.'));
        process.exit(1);
    }

    console.log(chalk.dim('Loading model and plugins...'));
    const config = loadAndResolveConfig(configPath);
    let ontologyRegistries: BuilderRegistries | undefined;
    try {
        const loadResult = await loadOntologyRegistries(configPath);
        if (loadResult.fileCount > 0) ontologyRegistries = loadResult.registries;
    } catch { /* skip */ }

    const sysmlFiles = findSysmlFiles(cwd);
    const { documents, errors: parseErrors } = await parseFiles(sysmlFiles, cwd + '/');
    const model = buildMemoModel(documents, config, parseErrors, ontologyRegistries);
    const validation = validateModel(model);
    const completeness = computeCompleteness(model, validation, config);
    const query = createQueryContext(model, validation, completeness, config);

    const ctx: PluginContext = {
        model, config, validation, completeness, query, projectDir: cwd,
    };

    // 2. Load plugins
    const entries = loadPluginConfig(cwd);
    const registry = new PluginRegistry();
    const loadResult = await loadPlugins(entries, cwd, registry);

    if (loadResult.errors.length > 0) {
        for (const err of loadResult.errors) {
            console.error(chalk.yellow(`Warning: ${err.module}: ${err.error}`));
        }
    }

    // 3. Find and run the plugin
    const plugin = registry.get(pluginId);
    if (!plugin) {
        console.error(chalk.red(`Plugin not found: ${pluginId}`));
        console.error(chalk.gray(`Loaded plugins: ${registry.list().map(p => p.id).join(', ') || '(none)'}`));
        process.exit(1);
    }

    console.log(chalk.dim(`Running ${plugin.type} plugin: ${plugin.name} v${plugin.version}`));
    console.log('');

    switch (plugin.type) {
        case 'analysis': {
            const result = await registry.runAnalysis(pluginId, ctx);
            if (options.json) {
                console.log(JSON.stringify(result, null, 2));
            } else {
                console.log(chalk.bold(result.title));
                if (result.summary) console.log(result.summary);
                else console.log(JSON.stringify(result.data, null, 2));
            }
            break;
        }
        case 'validation': {
            const violations = await registry.runValidation(pluginId, ctx);
            if (options.json) {
                console.log(JSON.stringify(violations, null, 2));
            } else {
                if (violations.length === 0) {
                    console.log(chalk.green('No violations found.'));
                } else {
                    for (const v of violations) {
                        const icon = v.severity === 'error' ? chalk.red('✗') : v.severity === 'warning' ? chalk.yellow('!') : chalk.blue('i');
                        console.log(`  ${icon} [${v.ruleId}] ${v.elementName} (${v.elementKind}): ${v.description}`);
                    }
                    console.log(`\n${violations.length} violation(s) found.`);
                }
            }
            break;
        }
        case 'generator': {
            await registry.runGenerator(pluginId, ctx);
            console.log(chalk.green('Generator completed.'));
            break;
        }
        default:
            console.error(chalk.red(`Plugin type "${plugin.type}" is not runnable via CLI. Use 'memo export dhf' for export plugins.`));
            process.exit(1);
    }

    console.log('');
}
