// ─── memo ask CLI Command (M72) ──────────────────────────────────────────────
//
// `memo ask "<question>"` — Query the model using LLM.
// Examples:
//   memo ask "What hazards have no risk controls?"
//   memo ask "Show trace from REQ-001 to verification"
//   memo ask "Which layers are least complete?"
// ─────────────────────────────────────────────────────────────────────────────

import { readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import chalk from 'chalk';
import {
    findConfigFile, parseFiles, buildMemoModel, loadOntologyRegistries,
    validateModel, computeCompleteness, createQueryContext,
    resolveLLMConfig, createProvider, askModel,
} from '@memoarchitect/tools';
import type { BuilderRegistries } from '@memoarchitect/tools';
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

export interface AskCommandOptions {
    layer?: string;
    kind?: string;
}

export async function askCommand(question: string, options: AskCommandOptions): Promise<void> {
    // 1. Resolve LLM provider
    const llmConfig = resolveLLMConfig();
    if (!llmConfig) {
        console.error(chalk.red('No LLM API key configured.'));
        console.error(chalk.dim('Set ANTHROPIC_API_KEY or OPENAI_API_KEY environment variable.'));
        console.error(chalk.dim('Optionally set MEMO_LLM_MODEL to override the default model.'));
        process.exit(1);
    }

    const provider = createProvider(llmConfig);
    console.log(chalk.dim(`Using ${provider.name}`));

    // 2. Load model
    const cwd = process.cwd();
    const configPath = findConfigFile(cwd);
    if (!configPath) {
        console.error(chalk.red('No memo config found. Run `memo init` first.'));
        process.exit(1);
    }

    console.log(chalk.dim('Loading model...'));
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
    const ctx = createQueryContext(model, validation, completeness, config);

    // 3. Build context options from CLI flags
    const contextOptions: any = {};
    if (options.layer) contextOptions.filterLayers = [options.layer];
    if (options.kind) contextOptions.filterKinds = [options.kind];

    // 4. Ask
    console.log(chalk.dim('Querying model...'));
    console.log('');

    const result = await askModel(question, ctx, provider, contextOptions);

    console.log(result.answer);

    if (result.usage) {
        console.log('');
        console.log(chalk.dim(`Tokens: ${result.usage.promptTokens} prompt + ${result.usage.completionTokens} completion = ${result.usage.totalTokens} total`));
    }
}
