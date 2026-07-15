// ─── memo import ─────────────────────────────────────────────────────────────
//
// Import elements and relationships from CSV files into the project.
// Generates .sysml files from the CSV data, validated against the ontology.
//
// Commands:
//   memo import csv <file>           — Import elements CSV
//   memo import csv-rel <file>       — Import relationships CSV
//   memo import template elements    — Generate element CSV template
//   memo import template relations   — Generate relationship CSV template
// ─────────────────────────────────────────────────────────────────────────────

import { resolve, basename } from 'node:path';
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import chalk from 'chalk';
import {
    findConfigFile,
    parseFiles,
    buildMemoModel,
    parseElementsCsv,
    parseRelationshipsCsv,
    generateFile,
    generateElementTemplate,
    generateRelationshipTemplate,
    computeImportDiff,
    formatDiffSummary,
} from '@memo/core';
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
    } catch {
        // skip
    }
    return files;
}

/**
 * Import elements from a CSV file. Generates a .sysml file.
 */
export async function importCsvCommand(
    csvFile: string,
    options: { output?: string; package?: string; dryRun?: boolean }
): Promise<void> {
    const cwd = process.cwd();

    // Load config
    const configPath = findConfigFile(cwd);
    if (!configPath) {
        console.error(chalk.red('No memo config found. Run `memo init` first.'));
        process.exit(1);
    }
    const config = await loadAndResolveConfig(configPath);

    // Read CSV
    const csvPath = resolve(cwd, csvFile);
    let csvText: string;
    try {
        csvText = readFileSync(csvPath, 'utf-8');
    } catch {
        console.error(chalk.red(`Cannot read file: ${csvPath}`));
        process.exit(1);
    }

    console.log(chalk.blue(`Parsing elements CSV: ${csvFile}`));

    const result = parseElementsCsv(csvText, config);

    // Report warnings
    for (const warn of result.warnings) {
        console.log(chalk.yellow(`  Warning: ${warn}`));
    }

    // Report errors
    if (result.errors.length > 0) {
        console.error(chalk.red(`\n${result.errors.length} error(s):`));
        for (const err of result.errors) {
            console.error(chalk.red(`  ${err}`));
        }
        if (result.items.length === 0) {
            process.exit(1);
        }
        console.log(chalk.yellow(`\nContinuing with ${result.items.length} valid element(s)...`));
    }

    const packageName = options.package || basename(csvFile, '.csv').replace(/[^a-zA-Z0-9_]/g, '_');
    const sysml = generateFile(result.items, [], packageName);

    if (options.dryRun) {
        console.log(chalk.dim('\n── Generated SysML (dry run) ──'));
        console.log(sysml);
        return;
    }

    const outputFile = options.output || `${packageName}.sysml`;
    const outputPath = resolve(cwd, outputFile);
    writeFileSync(outputPath, sysml, 'utf-8');
    console.log(chalk.green(`\nImported ${result.items.length} element(s) → ${outputFile}`));
}

/**
 * Import relationships from a CSV file. Appends to existing or generates new .sysml.
 */
export async function importRelCsvCommand(
    csvFile: string,
    options: { output?: string; package?: string; dryRun?: boolean }
): Promise<void> {
    const cwd = process.cwd();

    const configPath = findConfigFile(cwd);
    if (!configPath) {
        console.error(chalk.red('No memo config found. Run `memo init` first.'));
        process.exit(1);
    }
    const config = await loadAndResolveConfig(configPath);

    // Build current model to validate element references
    const sysmlFiles = findSysmlFiles(cwd);
    let knownIds: Set<string> | undefined;
    if (sysmlFiles.length > 0) {
        const parsed = await parseFiles(sysmlFiles);
        const model = buildMemoModel(parsed.documents, config);
        knownIds = new Set(model.elements.keys());
    }

    const csvPath = resolve(cwd, csvFile);
    let csvText: string;
    try {
        csvText = readFileSync(csvPath, 'utf-8');
    } catch {
        console.error(chalk.red(`Cannot read file: ${csvPath}`));
        process.exit(1);
    }

    console.log(chalk.blue(`Parsing relationships CSV: ${csvFile}`));

    const result = parseRelationshipsCsv(csvText, config, knownIds);

    for (const warn of result.warnings) {
        console.log(chalk.yellow(`  Warning: ${warn}`));
    }

    if (result.errors.length > 0) {
        console.error(chalk.red(`\n${result.errors.length} error(s):`));
        for (const err of result.errors) {
            console.error(chalk.red(`  ${err}`));
        }
        if (result.items.length === 0) {
            process.exit(1);
        }
        console.log(chalk.yellow(`\nContinuing with ${result.items.length} valid relationship(s)...`));
    }

    const packageName = options.package || basename(csvFile, '.csv').replace(/[^a-zA-Z0-9_]/g, '_');
    const sysml = generateFile([], result.items, packageName);

    if (options.dryRun) {
        console.log(chalk.dim('\n── Generated SysML (dry run) ──'));
        console.log(sysml);
        return;
    }

    const outputFile = options.output || `${packageName}_relationships.sysml`;
    const outputPath = resolve(cwd, outputFile);
    writeFileSync(outputPath, sysml, 'utf-8');
    console.log(chalk.green(`\nImported ${result.items.length} relationship(s) → ${outputFile}`));
}

/**
 * Generate template CSV files based on the current ontology config.
 */
export async function importTemplateCommand(
    templateType: string,
    options: { output?: string }
): Promise<void> {
    const cwd = process.cwd();

    const configPath = findConfigFile(cwd);
    if (!configPath) {
        console.error(chalk.red('No memo config found. Run `memo init` first.'));
        process.exit(1);
    }
    const config = await loadAndResolveConfig(configPath);

    let csv: string;
    let defaultFile: string;

    if (templateType === 'elements') {
        csv = generateElementTemplate(config);
        defaultFile = 'elements-template.csv';
        console.log(chalk.blue(`Generating element template with ${Object.keys(config.kinds ?? {}).length} kinds`));
    } else if (templateType === 'relationships' || templateType === 'relations') {
        csv = generateRelationshipTemplate(config);
        defaultFile = 'relationships-template.csv';
        console.log(chalk.blue(`Generating relationship template with ${(config.relationshipTypes ?? []).length} types`));
    } else {
        console.error(chalk.red(`Unknown template type: '${templateType}'. Use 'elements' or 'relationships'.`));
        process.exit(1);
    }

    const outputFile = options.output || defaultFile;
    const outputPath = resolve(cwd, outputFile);
    writeFileSync(outputPath, csv, 'utf-8');
    console.log(chalk.green(`Template written → ${outputFile}`));
}

/**
 * Show a diff of what a CSV import would change without modifying the model.
 * Useful for reviewing updates before committing.
 */
export async function importDiffCommand(
    csvFile: string,
    options: { detectRemovals?: boolean }
): Promise<void> {
    const cwd = process.cwd();

    const configPath = findConfigFile(cwd);
    if (!configPath) {
        console.error(chalk.red('No memo config found. Run `memo init` first.'));
        process.exit(1);
    }
    const config = await loadAndResolveConfig(configPath);

    const csvPath = resolve(cwd, csvFile);
    let csvText: string;
    try {
        csvText = readFileSync(csvPath, 'utf-8');
    } catch {
        console.error(chalk.red(`Cannot read file: ${csvPath}`));
        process.exit(1);
    }

    console.log(chalk.blue(`Parsing elements CSV: ${csvFile}`));
    const parseResult = parseElementsCsv(csvText, config);

    for (const warn of parseResult.warnings) {
        console.log(chalk.yellow(`  Warning: ${warn}`));
    }
    if (parseResult.errors.length > 0) {
        for (const err of parseResult.errors) {
            console.error(chalk.red(`  Error: ${err}`));
        }
        if (parseResult.items.length === 0) {
            process.exit(1);
        }
    }

    // Build current model for comparison
    const sysmlFiles = findSysmlFiles(cwd);
    let model: any = { elements: new Map(), relationships: [] };
    if (sysmlFiles.length > 0) {
        const parsed = await parseFiles(sysmlFiles);
        model = buildMemoModel(parsed.documents, config);
    }

    const diff = computeImportDiff(model, parseResult.items, options.detectRemovals ?? false);

    console.log(chalk.bold(`\nImport diff: ${formatDiffSummary(diff)}`));
    console.log(chalk.dim(`  Incoming: ${diff.incomingCount} row(s)   Current model: ${diff.currentCount} element(s)\n`));

    if (diff.added.length > 0) {
        console.log(chalk.green(`  + ${diff.added.length} new element(s):`));
        for (const el of diff.added) {
            console.log(chalk.green(`      ${el.id}  [${el.kind}]  "${el.name}"`));
        }
        console.log('');
    }

    if (diff.modified.length > 0) {
        console.log(chalk.yellow(`  ~ ${diff.modified.length} modified element(s):`));
        for (const { current, incoming, changes } of diff.modified) {
            console.log(chalk.yellow(`      ${current.id}  [${current.kind}]  "${current.name}"`));
            for (const ch of changes) {
                console.log(chalk.dim(`          ${ch.field}: "${ch.currentValue}" → "${ch.incomingValue}"`));
            }
        }
        console.log('');
    }

    if (diff.unchanged.length > 0) {
        console.log(chalk.dim(`  = ${diff.unchanged.length} unchanged element(s)`));
        console.log('');
    }

    if (diff.removed.length > 0) {
        console.log(chalk.red(`  - ${diff.removed.length} element(s) in model but missing from CSV:`));
        for (const id of diff.removed) {
            const el = model.elements.get(id);
            console.log(chalk.red(`      ${id}  [${el?.kind ?? '?'}]  "${el?.name ?? '?'}"`));
        }
        console.log('');
    }

    if (diff.added.length === 0 && diff.modified.length === 0 && diff.removed.length === 0) {
        console.log(chalk.dim('  No changes — CSV matches current model state.\n'));
    }
}
