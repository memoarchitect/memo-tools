// ─── memo import ea / memo import cameo ──────────────────────────────────────
//
// Import from Sparx EA or MagicDraw/Cameo into MEMO.
//
// Commands:
//   memo import ea <file>       — Import from EA JSON export (.json)
//   memo import cameo <file>    — Import from Cameo XMI/XML or JSON (.xml/.json)
// ─────────────────────────────────────────────────────────────────────────────

import { resolve, basename, extname } from 'node:path';
import { readFileSync, writeFileSync } from 'node:fs';
import chalk from 'chalk';
import {
    findConfigFile,
    loadOntologyRegistries,
    importEaJson,
    eaResultToSysml,
    importCameoXml,
    importCameoJson,
    cameoResultToSysml,
} from '@memo/core';
import type { EaJsonExport, CameoJsonExport } from '@memo/core';

/**
 * memo import ea <file> — Import from Sparx EA JSON export.
 *
 * EA projects should be exported as JSON first via EA's scripting API
 * or third-party tools. The JSON format is:
 * {
 *   "elements": [{ id, name, type, stereotype, notes, package, taggedValues }],
 *   "connectors": [{ id, sourceId, targetId, type, stereotype }]
 * }
 */
export async function importEaCommand(
    file: string,
    options: { output?: string; package?: string; dryRun?: boolean },
): Promise<void> {
    const cwd = process.cwd();

    console.log(chalk.bold('\n\u{1F4E5} MEMO Import \u2190 Sparx EA\n'));

    // Read input file
    const filePath = resolve(cwd, file);
    let content: string;
    try {
        content = readFileSync(filePath, 'utf-8');
    } catch {
        console.error(chalk.red(`Cannot read file: ${filePath}`));
        process.exit(1);
    }

    // Parse JSON
    let jsonData: EaJsonExport;
    try {
        jsonData = JSON.parse(content);
    } catch (e) {
        console.error(chalk.red(`Invalid JSON: ${e}`));
        process.exit(1);
    }

    // Load ontology registries if available (for better kind mapping)
    const configPath = findConfigFile(cwd);
    let kindRegistry, relRegistry;
    if (configPath) {
        const loadResult = await loadOntologyRegistries(configPath);
        kindRegistry = loadResult.registries.kindRegistry;
        relRegistry = loadResult.registries.relationshipRegistry;
    }

    // Import
    const result = importEaJson(jsonData, kindRegistry, relRegistry);

    // Report
    console.log(chalk.cyan(`  Elements:      ${result.stats.totalElements} total, ${result.stats.mappedElements} mapped, ${result.stats.unmappedElements} unmapped`));
    console.log(chalk.cyan(`  Relationships: ${result.stats.totalRelationships} total, ${result.stats.mappedRelationships} mapped, ${result.stats.unmappedRelationships} unmapped`));

    for (const warn of result.warnings) {
        console.log(chalk.yellow(`  \u26A0 ${warn}`));
    }
    for (const err of result.errors) {
        console.error(chalk.red(`  \u2716 ${err}`));
    }

    if (result.stats.mappedElements === 0) {
        console.error(chalk.red('\nNo elements could be mapped. Check that stereotypes match MEMO kinds.'));
        process.exit(1);
    }

    // Generate SysML
    const packageName = options.package || basename(file, extname(file)).replace(/[^a-zA-Z0-9_]/g, '_');
    const sysml = eaResultToSysml(result, packageName);

    if (options.dryRun) {
        console.log(chalk.dim('\n── Generated SysML (dry run) ──'));
        console.log(sysml);
        return;
    }

    const outputFile = options.output || `${packageName}.sysml`;
    const outputPath = resolve(cwd, outputFile);
    writeFileSync(outputPath, sysml, 'utf-8');
    console.log(chalk.green(`\n\u2705 Imported ${result.stats.mappedElements} elements, ${result.stats.mappedRelationships} relationships \u2192 ${outputFile}\n`));
}

/**
 * memo import cameo <file> — Import from MagicDraw/Cameo.
 *
 * Accepts:
 * - .xml/.mdxml — XMI export from MagicDraw
 * - .json — JSON intermediate format
 *
 * For .mdzip files, users should first extract the XML:
 *   unzip model.mdzip com.nomagic.magicdraw.uml_model.model -d extracted/
 *   memo import cameo extracted/com.nomagic.magicdraw.uml_model.model
 */
export async function importCameoCommand(
    file: string,
    options: { output?: string; package?: string; dryRun?: boolean },
): Promise<void> {
    const cwd = process.cwd();

    console.log(chalk.bold('\n\u{1F4E5} MEMO Import \u2190 MagicDraw/Cameo\n'));

    const filePath = resolve(cwd, file);
    let content: string;
    try {
        content = readFileSync(filePath, 'utf-8');
    } catch {
        console.error(chalk.red(`Cannot read file: ${filePath}`));
        process.exit(1);
    }

    // Load ontology registries if available
    const configPath = findConfigFile(cwd);
    let kindRegistry, relRegistry;
    if (configPath) {
        const loadResult = await loadOntologyRegistries(configPath);
        kindRegistry = loadResult.registries.kindRegistry;
        relRegistry = loadResult.registries.relationshipRegistry;
    }

    // Determine format and import
    const ext = extname(file).toLowerCase();
    let result;

    if (ext === '.json') {
        let jsonData: CameoJsonExport;
        try {
            jsonData = JSON.parse(content);
        } catch (e) {
            console.error(chalk.red(`Invalid JSON: ${e}`));
            process.exit(1);
        }
        result = importCameoJson(jsonData, kindRegistry, relRegistry);
    } else {
        // Treat as XMI/XML
        result = importCameoXml(content, kindRegistry, relRegistry);
    }

    // Report
    console.log(chalk.cyan(`  Elements:      ${result.stats.totalElements} total, ${result.stats.mappedElements} mapped, ${result.stats.unmappedElements} unmapped`));
    console.log(chalk.cyan(`  Relationships: ${result.stats.totalRelationships} total, ${result.stats.mappedRelationships} mapped, ${result.stats.unmappedRelationships} unmapped`));

    for (const warn of result.warnings) {
        console.log(chalk.yellow(`  \u26A0 ${warn}`));
    }
    for (const err of result.errors) {
        console.error(chalk.red(`  \u2716 ${err}`));
    }

    if (result.stats.mappedElements === 0) {
        console.error(chalk.red('\nNo elements could be mapped. Check that stereotypes match MEMO kinds.'));
        process.exit(1);
    }

    // Generate SysML
    const packageName = options.package || basename(file, extname(file)).replace(/[^a-zA-Z0-9_]/g, '_');
    const sysml = cameoResultToSysml(result, packageName);

    if (options.dryRun) {
        console.log(chalk.dim('\n── Generated SysML (dry run) ──'));
        console.log(sysml);
        return;
    }

    const outputFile = options.output || `${packageName}.sysml`;
    const outputPath = resolve(cwd, outputFile);
    writeFileSync(outputPath, sysml, 'utf-8');
    console.log(chalk.green(`\n\u2705 Imported ${result.stats.mappedElements} elements, ${result.stats.mappedRelationships} relationships \u2192 ${outputFile}\n`));
}
