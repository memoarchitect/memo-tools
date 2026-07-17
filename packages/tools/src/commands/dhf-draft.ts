// ─── memo dhf draft CLI Command (M74) ────────────────────────────────────────
//
// `memo dhf draft --target rmp` — Use LLM to fill gap sections in DHF documents.
// Generates boilerplate regulatory text, risk descriptions, verification rationale.
// Human reviews before export.
// ─────────────────────────────────────────────────────────────────────────────

import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { readdirSync } from 'node:fs';
import chalk from 'chalk';
import {
    findConfigFile, parseFiles, buildMemoModel, loadOntologyRegistries,
    validateModel, computeCompleteness, createQueryContext,
    getDocumentType, getAllDocumentIds,
    compileDocument, loadDhfConfig,
    getPlugin,
    resolveLLMConfig, createProvider, draftDocument,
} from '@memoarchitect/tools';
import type { BuilderRegistries, DhfExportFormat, MemoModel, MEMOConfig, DhfConfig } from '@memoarchitect/tools';
import type { ValidationResult, CompletenessReport } from '@memoarchitect/tools';
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

export interface DhfDraftCommandOptions {
    target: string;
    section?: string;
    format?: string;
    output?: string;
}

export async function dhfDraftCommand(options: DhfDraftCommandOptions): Promise<void> {
    // 1. Resolve LLM provider
    const llmConfig = resolveLLMConfig();
    if (!llmConfig) {
        console.error(chalk.red('No LLM API key configured.'));
        console.error(chalk.dim('Set ANTHROPIC_API_KEY or OPENAI_API_KEY environment variable.'));
        process.exit(1);
    }

    const provider = createProvider(llmConfig);

    // 2. Validate target document
    const docType = getDocumentType(options.target);
    if (!docType) {
        console.error(chalk.red(`Unknown document type: ${options.target}`));
        console.error(chalk.gray(`Available: ${getAllDocumentIds().join(', ')}`));
        process.exit(1);
    }

    console.log(chalk.bold(`\nMEMO DHF Draft — ${docType.title}\n`));
    console.log(chalk.dim(`Using ${provider.name}`));

    // 3. Load model
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
    const dhfConfig = loadDhfConfig(cwd);

    // 4. Compile existing document to identify gaps
    const existingDoc = compileDocument({
        model, validation, completeness, config, dhfConfig, documentType: docType,
    });

    console.log(chalk.dim(`Current status: ${existingDoc.status} (${existingDoc.sections.filter(s => s.status === 'empty').length} empty sections)`));

    // 5. Draft
    console.log(chalk.dim('Drafting content...'));
    console.log('');

    const targetSections = options.section ? [options.section] : undefined;

    const result = await draftDocument(ctx, provider, {
        documentType: docType,
        existingDocument: existingDoc,
        targetSections,
    });

    // 6. Report results
    if (result.draftedSections.length === 0) {
        console.log(chalk.yellow('No sections needed drafting — all sections already have content.'));
        console.log('');
        return;
    }

    console.log(chalk.green(`Drafted ${result.draftedSections.length} section(s):`));
    for (const sId of result.draftedSections) {
        const section = result.document.sections.find(s => s.id === sId);
        console.log(chalk.cyan(`  • ${section?.title || sId} (${section?.blocks.length || 0} blocks)`));
    }
    console.log('');
    console.log(chalk.yellow('⚠ Review [REVIEW] and [ASSUMPTION] markers before finalizing.'));

    // 7. Export if requested
    const format = (options.format || 'html') as DhfExportFormat;
    const outputDir = resolve(cwd, options.output || 'dhf-drafts');
    if (!existsSync(outputDir)) mkdirSync(outputDir, { recursive: true });

    const plugin = getPlugin(format);
    if (plugin) {
        const rendered = await plugin.render(result.document);
        const filename = `${options.target}-draft${rendered.extension}`;
        const filepath = resolve(outputDir, filename);
        writeFileSync(filepath, rendered.content);
        console.log(chalk.green(`\nDraft exported to ${filepath}`));
    }

    if (result.usage) {
        console.log(chalk.dim(`\nTokens: ${result.usage.promptTokens} prompt + ${result.usage.completionTokens} completion = ${result.usage.totalTokens} total`));
    }
    console.log('');
}
