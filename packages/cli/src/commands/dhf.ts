// ─── DHF CLI Commands ────────────────────────────────────────────────────────
//
// Full DHF workbench CLI: export, status, snapshot, redline, diff, review-packet.
// Replaces the M58 stub with Phase 13 implementation.
// ─────────────────────────────────────────────────────────────────────────────

import { resolve } from 'node:path';
import { readdirSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import chalk from 'chalk';
import {
    findConfigFile, parseFiles, buildMemoModel, loadOntologyRegistries,
    validateModel, computeCompleteness,
    DHF_DOCUMENT_TYPES, getDocumentType, getDocumentsByGroup, getAllDocumentIds,
    compileDocument, loadDhfConfig, isDocumentEnabled,
    getPlugin, getAvailableFormats,
    createSnapshot, saveSnapshot, loadSnapshots, loadLatestSnapshot,
    diffSnapshots, generateRedlineDocument,
    createQueryContext,
    loadDhfConfigV2, isDhfConfigV2, resolveManifestDocuments,
    compileMarkdownDocument, compileMarkdownContent, markdownToDhfDocument,
} from '@memo/core';
import { readFileSync } from 'node:fs';
import { loadDhfDocs, loadDhfSettings } from '../server/dhf-doc-store.js';
import type { BuilderRegistries, DhfExportFormat, DhfDocument, MemoModel, MEMOConfig, DhfConfig } from '@memo/core';
import type { ValidationResult, CompletenessReport } from '@memo/core';
import { loadAndResolveConfig } from '../server/config-resolver.js';

// ─── Shared: find SysML files ────────────────────────────────────────────────

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

// ─── Shared: load model ──────────────────────────────────────────────────────

interface LoadedModel {
    model: MemoModel;
    config: MEMOConfig;
    validation: ValidationResult;
    completeness: CompletenessReport;
    dhfConfig: DhfConfig | undefined;
    queryCtx: ReturnType<typeof createQueryContext>;
}

async function loadModel(): Promise<LoadedModel> {
    const cwd = process.cwd();
    const configPath = findConfigFile(cwd);
    if (!configPath) {
        console.error(chalk.red('No memo config found.'));
        process.exit(1);
    }

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
    const dhfConfig = loadDhfConfig(cwd);
    const queryCtx = createQueryContext(model, validation, completeness, config);

    return { model, config, validation, completeness, dhfConfig, queryCtx };
}

// ─── Resolve target documents ────────────────────────────────────────────────

function resolveTargets(target?: string, group?: string, dhfConfig?: DhfConfig): string[] {
    if (target) {
        // Single document target
        const doc = getDocumentType(target);
        if (!doc) {
            console.error(chalk.red(`Unknown document type: ${target}`));
            console.error(chalk.gray(`Available: ${getAllDocumentIds().join(', ')}`));
            process.exit(1);
        }
        return [target];
    }

    if (group) {
        return getDocumentsByGroup(group).map(d => d.id);
    }

    // All enabled documents
    return getAllDocumentIds().filter(id => isDocumentEnabled(id, dhfConfig));
}

// ─── memo export dhf ─────────────────────────────────────────────────────────

export async function exportDhfCommand(options: {
    output?: string;
    target?: string;
    format?: string;
    group?: string;
}): Promise<void> {
    const cwd = process.cwd();
    console.log(chalk.bold('\nMEMO DHF Export\n'));

    const { model, config, validation, completeness, dhfConfig, queryCtx } = await loadModel();

    // ── V2: markdown-first pipeline (manifest docs + workbench documents) ────
    const dhfConfigV2 = loadDhfConfigV2(cwd);
    const hasV2Manifest = !!(dhfConfigV2 && isDhfConfigV2(dhfConfigV2) && dhfConfigV2.manifest);
    // Workbench documents created in the web app, persisted under dhf/documents/
    const workbenchDocs = loadDhfDocs(cwd).filter(d =>
        !options.target || d.id === options.target || d.templateId === options.target);

    if (hasV2Manifest || workbenchDocs.length > 0) {
        const cfgV2 = hasV2Manifest ? dhfConfigV2! : ({} as ReturnType<typeof loadDhfConfigV2> & object);
        const format = (options.format || dhfConfigV2?.export?.format || 'md') as string;
        const plugin = format === 'md' ? null : getPlugin(format as DhfExportFormat);
        if (format !== 'md' && !plugin) {
            console.error(chalk.red(`Unknown format: ${format}. Available: md, ${getAvailableFormats().join(', ')}`));
            process.exit(1);
        }

        const outputDir = resolve(cwd, options.output || dhfConfigV2?.export?.output_dir || 'dhf-output');
        if (!existsSync(outputDir)) mkdirSync(outputDir, { recursive: true });

        // Project metadata: web workbench settings fill {{project.*}} when
        // memo.dhf.yaml has no project block
        const webSettings = loadDhfSettings(cwd);
        const extraMeta: Record<string, unknown> = webSettings ? {
            company: webSettings.company,
            product: webSettings.product,
            device_type: webSettings.deviceType,
            version: webSettings.version,
            phase: webSettings.phase,
        } : {};

        let exported = 0;
        const emit = async (markdown: string, id: string, title: string, group: string, warningCount: number) => {
            const groupDir = resolve(outputDir, group);
            if (!existsSync(groupDir)) mkdirSync(groupDir, { recursive: true });
            let filename: string;
            if (plugin) {
                const ir = markdownToDhfDocument(markdown, {
                    documentId: id,
                    title,
                    project: typeof extraMeta.product === 'string' ? extraMeta.product : undefined,
                    organization: typeof extraMeta.company === 'string' ? extraMeta.company : undefined,
                    version: typeof extraMeta.version === 'string' ? extraMeta.version : undefined,
                });
                const rendered = await plugin.render(ir);
                filename = `${id}${rendered.extension}`;
                writeFileSync(resolve(groupDir, filename), rendered.content);
            } else {
                filename = `${id}.md`;
                writeFileSync(resolve(groupDir, filename), markdown, 'utf-8');
            }
            exported++;
            const warnSuffix = warningCount > 0 ? chalk.yellow(` (${warningCount} warnings)`) : '';
            console.log(chalk.cyan(`  ${title} → ${group}/${filename}${warnSuffix}`));
        };

        const manifestDocs = hasV2Manifest ? resolveManifestDocuments(dhfConfigV2!, options.group) : [];
        const manifestTargets = options.target
            ? manifestDocs.filter(d => d.id === options.target || d.template === options.target)
            : manifestDocs;

        console.log(chalk.gray(`Format: ${format} | Documents: ${manifestTargets.length + workbenchDocs.length} (V2 markdown pipeline)\n`));

        for (const doc of manifestTargets) {
            const result = await compileMarkdownDocument({
                templateId: doc.template,
                ctx: queryCtx,
                config: cfgV2 as any,
                extraMeta,
            });
            await emit(result.markdown, doc.id, result.title, doc.group, result.warnings.length);
        }

        for (const doc of workbenchDocs) {
            const { markdown, warnings } = await compileMarkdownContent({
                content: doc.content,
                ctx: queryCtx,
                config: cfgV2 as any,
                extraMeta,
            });
            await emit(markdown, doc.id, doc.title, 'documents', warnings.length);
        }

        console.log(chalk.green(`\nExported ${exported} documents to ${outputDir}\n`));
        return;
    }

    // ── V1: Document IR pipeline (backward compat) ───────────────────────────
    const format = (options.format || dhfConfig?.defaultFormat || 'html') as DhfExportFormat;
    const targets = resolveTargets(options.target, options.group, dhfConfig);

    const plugin = getPlugin(format);
    if (!plugin) {
        console.error(chalk.red(`Unknown format: ${format}. Available: ${getAvailableFormats().join(', ')}`));
        process.exit(1);
    }

    console.log(chalk.gray(`Format: ${format} | Documents: ${targets.length}`));

    const outputDir = resolve(cwd, options.output || 'dhf-output');
    if (!existsSync(outputDir)) mkdirSync(outputDir, { recursive: true });

    let exported = 0;
    for (const targetId of targets) {
        const docType = getDocumentType(targetId)!;
        const doc = compileDocument({ model, validation, completeness, config, dhfConfig, documentType: docType });
        const result = await plugin.render(doc);

        const filename = `${targetId}${result.extension}`;
        const filepath = resolve(outputDir, filename);
        writeFileSync(filepath, result.content);
        exported++;

        const statusIcon = doc.status === 'complete' ? chalk.green('OK') : doc.status === 'partial' ? chalk.yellow('PARTIAL') : chalk.red('EMPTY');
        console.log(chalk.cyan(`  ${docType.title} → ${filename} [${statusIcon}]`));
    }

    console.log(chalk.green(`\nExported ${exported} documents to ${outputDir}\n`));
}

// ─── memo dhf status ─────────────────────────────────────────────────────────

export async function dhfStatusCommand(options: {
    verbose?: boolean;
    target?: string;
}): Promise<void> {
    console.log(chalk.bold('\nMEMO DHF Status\n'));

    const { model, config, validation, completeness, dhfConfig } = await loadModel();
    const targets = resolveTargets(options.target, undefined, dhfConfig);

    const elements = Array.from(model.elements.values());
    const errors = validation.violations.filter(v => v.severity === 'error').length;
    const warnings = validation.violations.filter(v => v.severity === 'warning').length;

    console.log(chalk.gray(`Project: ${config.projectName || 'MEMO Project'}`));
    console.log(chalk.gray(`Elements: ${elements.length} | Relationships: ${model.relationships.length} | Completeness: ${completeness.overall}%`));
    console.log(chalk.gray(`Errors: ${errors} | Warnings: ${warnings}\n`));

    // Column headers
    console.log(chalk.bold('  Document                                      Status     Elements  Gaps'));
    console.log(chalk.gray('  ' + '─'.repeat(74)));

    for (const targetId of targets) {
        const docType = getDocumentType(targetId)!;
        const doc = compileDocument({ model, validation, completeness, config, dhfConfig, documentType: docType });

        const title = docType.title.padEnd(44);
        const statusStr = doc.status === 'complete'
            ? chalk.green('COMPLETE')
            : doc.status === 'partial' ? chalk.yellow('PARTIAL ')
            : chalk.red('EMPTY   ');
        const elCount = String(doc.totalElements).padStart(6);
        const gapCount = String(doc.totalGaps).padStart(6);

        console.log(`  ${title} ${statusStr} ${elCount} ${gapCount}`);

        if (options.verbose) {
            for (const section of doc.sections) {
                const secStatus = section.status === 'complete'
                    ? chalk.green('OK')
                    : section.status === 'partial' ? chalk.yellow('!!')
                    : chalk.red('--');
                console.log(chalk.gray(`    ${secStatus} ${section.title} (${section.elementCount || 0} elements, ${section.gapCount || 0} gaps)`));
            }
        }
    }

    console.log('');
}

// ─── memo dhf snapshot ───────────────────────────────────────────────────────

export async function dhfSnapshotCommand(options: {
    target?: string;
    label?: string;
}): Promise<void> {
    const cwd = process.cwd();
    console.log(chalk.bold('\nMEMO DHF Snapshot\n'));

    const { model, config, validation, completeness, dhfConfig } = await loadModel();
    const targets = resolveTargets(options.target, undefined, dhfConfig);

    for (const targetId of targets) {
        const docType = getDocumentType(targetId)!;
        const doc = compileDocument({ model, validation, completeness, config, dhfConfig, documentType: docType });
        const snapshot = createSnapshot(doc, options.label);
        const filepath = saveSnapshot(cwd, snapshot);
        console.log(chalk.cyan(`  ${docType.title} → ${snapshot.id}`));
    }

    console.log(chalk.green(`\nSnapshots saved to .memo/dhf-snapshots/\n`));
}

// ─── memo dhf diff ───────────────────────────────────────────────────────────

export async function dhfDiffCommand(options: {
    target: string;
}): Promise<void> {
    const cwd = process.cwd();
    console.log(chalk.bold('\nMEMO DHF Diff\n'));

    const { model, config, validation, completeness, dhfConfig } = await loadModel();
    const docType = getDocumentType(options.target);
    if (!docType) {
        console.error(chalk.red(`Unknown document type: ${options.target}`));
        process.exit(1);
    }

    const baseline = loadLatestSnapshot(cwd, options.target);
    if (!baseline) {
        console.error(chalk.yellow(`No previous snapshot found for ${options.target}. Run 'memo dhf snapshot' first.`));
        process.exit(1);
    }

    const doc = compileDocument({ model, validation, completeness, config, dhfConfig, documentType: docType });
    const current = createSnapshot(doc);
    const diff = diffSnapshots(baseline, current);

    console.log(chalk.gray(`Baseline: ${baseline.label || baseline.id} (${new Date(baseline.timestamp).toLocaleDateString()})`));
    console.log(chalk.gray(`Current:  ${current.id} (${new Date(current.timestamp).toLocaleDateString()})\n`));

    console.log(`  Element delta: ${diff.elementDelta >= 0 ? chalk.green(`+${diff.elementDelta}`) : chalk.red(String(diff.elementDelta))}`);
    console.log(`  Gap delta:     ${diff.gapDelta <= 0 ? chalk.green(String(diff.gapDelta)) : chalk.red(`+${diff.gapDelta}`)}`);
    console.log(`  Status:        ${diff.statusChange}\n`);

    const changed = diff.changedSections.filter(s => s.changeType !== 'unchanged');
    if (changed.length > 0) {
        console.log(chalk.bold('  Changed sections:'));
        for (const s of changed) {
            const icon = s.changeType === 'added' ? chalk.green('+')
                : s.changeType === 'removed' ? chalk.red('-')
                : chalk.yellow('~');
            console.log(`    ${icon} ${s.title} (${s.changeType})`);
        }
    } else {
        console.log(chalk.green('  No changes detected.'));
    }
    console.log('');
}

// ─── memo dhf redline ────────────────────────────────────────────────────────

export async function dhfRedlineCommand(options: {
    target: string;
    format?: string;
    output?: string;
}): Promise<void> {
    const cwd = process.cwd();
    console.log(chalk.bold('\nMEMO DHF Redline\n'));

    const { model, config, validation, completeness, dhfConfig } = await loadModel();
    const docType = getDocumentType(options.target);
    if (!docType) {
        console.error(chalk.red(`Unknown document type: ${options.target}`));
        process.exit(1);
    }

    const baseline = loadLatestSnapshot(cwd, options.target);
    if (!baseline) {
        console.error(chalk.yellow(`No previous snapshot found for ${options.target}. Run 'memo dhf snapshot' first.`));
        process.exit(1);
    }

    const doc = compileDocument({ model, validation, completeness, config, dhfConfig, documentType: docType });
    const current = createSnapshot(doc);
    const diff = diffSnapshots(baseline, current);
    const redlineDoc = generateRedlineDocument(diff);

    const format = (options.format || 'html') as DhfExportFormat;
    const plugin = getPlugin(format);
    if (!plugin) {
        console.error(chalk.red(`Unknown format: ${format}`));
        process.exit(1);
    }

    const result = await plugin.render(redlineDoc);
    const outputPath = resolve(cwd, options.output || `${options.target}-redline${result.extension}`);
    writeFileSync(outputPath, result.content);

    console.log(chalk.green(`Redline document written to ${outputPath}\n`));
}

// ─── memo dhf review-packet ──────────────────────────────────────────────────

export async function dhfReviewPacketCommand(options: {
    format?: string;
    output?: string;
}): Promise<void> {
    const cwd = process.cwd();
    console.log(chalk.bold('\nMEMO DHF Review Packet\n'));

    const { model, config, validation, completeness, dhfConfig } = await loadModel();
    const format = (options.format || 'html') as DhfExportFormat;
    const targets = resolveTargets(undefined, undefined, dhfConfig);

    const plugin = getPlugin(format);
    if (!plugin) {
        console.error(chalk.red(`Unknown format: ${format}`));
        process.exit(1);
    }

    const outputDir = resolve(cwd, options.output || 'dhf-review-packet');
    if (!existsSync(outputDir)) mkdirSync(outputDir, { recursive: true });

    let exported = 0;
    for (const targetId of targets) {
        const docType = getDocumentType(targetId)!;
        const doc = compileDocument({ model, validation, completeness, config, dhfConfig, documentType: docType });
        const result = await plugin.render(doc);

        const filename = `${targetId}${result.extension}`;
        writeFileSync(resolve(outputDir, filename), result.content);
        exported++;
    }

    // Also generate snapshots for the review packet
    for (const targetId of targets) {
        const docType = getDocumentType(targetId)!;
        const doc = compileDocument({ model, validation, completeness, config, dhfConfig, documentType: docType });
        const snapshot = createSnapshot(doc, 'review-packet');
        saveSnapshot(cwd, snapshot);
    }

    console.log(chalk.green(`Review packet: ${exported} documents exported to ${outputDir}`));
    console.log(chalk.gray(`Snapshots saved to .memo/dhf-snapshots/\n`));
}
