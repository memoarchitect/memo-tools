// ─── memo generate CLI Command (M73) ─────────────────────────────────────────
//
// `memo generate "<description>"` — Generate SysML from natural language.
// Examples:
//   memo generate "Add a pressure sensor component with USB interface"
//   memo generate "Create a hazard for medication overdose with severity S4"
//   memo generate "Add user need for real-time monitoring"
// ─────────────────────────────────────────────────────────────────────────────

import { writeFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import chalk from 'chalk';
import {
    findConfigFile, loadOntologyRegistries,
    resolveLLMConfig, createProvider, generateSysml,
} from '@memoarchitect/tools';
import type { BuilderRegistries } from '@memoarchitect/tools';
import { loadAndResolveConfig } from '../server/config-resolver.js';

export interface GenerateCommandOptions {
    output?: string;
    dryRun?: boolean;
}

export async function generateCommand(description: string, options: GenerateCommandOptions): Promise<void> {
    // 1. Resolve LLM provider
    const llmConfig = resolveLLMConfig();
    if (!llmConfig) {
        console.error(chalk.red('No LLM API key configured.'));
        console.error(chalk.dim('Set ANTHROPIC_API_KEY or OPENAI_API_KEY environment variable.'));
        process.exit(1);
    }

    const provider = createProvider(llmConfig);
    console.log(chalk.dim(`Using ${provider.name}`));

    // 2. Load config (for ontology context)
    const cwd = process.cwd();
    const configPath = findConfigFile(cwd);
    if (!configPath) {
        console.error(chalk.red('No memo config found. Run `memo init` first.'));
        process.exit(1);
    }

    const config = loadAndResolveConfig(configPath);

    // Enrich config with ontology registries if available
    try {
        const loadResult = await loadOntologyRegistries(configPath);
        if (loadResult.registries.kindRegistry && !config.kinds) {
            config.kinds = {};
        }
        if (loadResult.registries.kindRegistry) {
            // Add registry kinds to config for context serialization
            const kr = loadResult.registries.kindRegistry;
            for (const entry of (kr as any)._kinds?.values() || []) {
                if (!config.kinds![entry.name]) {
                    config.kinds![entry.name] = {
                        label: entry.label,
                        layer: entry.layer,
                        sysmlConstruct: entry.sysmlConstruct,
                    };
                }
            }
        }
    } catch { /* skip */ }

    // 3. Generate
    console.log(chalk.dim('Generating SysML...'));
    console.log('');

    const result = await generateSysml(description, config, provider);

    // 4. Output
    if (options.dryRun || !options.output) {
        // Preview mode
        console.log(chalk.cyan('Generated SysML:'));
        console.log('');
        console.log(result.sysml);
        console.log('');
        console.log(chalk.green(`Explanation: ${result.explanation}`));
        if (result.suggestedFile) {
            console.log(chalk.dim(`Suggested file: ${result.suggestedFile}`));
        }
    }

    if (options.output && !options.dryRun) {
        const outPath = resolve(cwd, options.output);
        writeFileSync(outPath, result.sysml + '\n', 'utf-8');
        console.log(chalk.green(`✓ Written to ${options.output}`));
        console.log(chalk.dim(result.explanation));
    }

    if (result.usage) {
        console.log('');
        console.log(chalk.dim(`Tokens: ${result.usage.promptTokens} prompt + ${result.usage.completionTokens} completion = ${result.usage.totalTokens} total`));
    }
}
