import { resolve } from 'node:path';
import { readdirSync, writeFileSync } from 'node:fs';
import chalk from 'chalk';
import { findConfigFile, parseFiles, buildMemoModel, loadOntologyRegistries } from '@memo/tools';
import type { BuilderRegistries, MemoModel } from '@memo/tools';
import { loadAndResolveConfig } from '../server/config-resolver.js';

interface RoundTripDiff {
    category: 'element_lost' | 'element_gained' | 'relationship_lost' | 'relationship_gained' | 'attribute_changed';
    id: string;
    detail: string;
}

interface RoundTripReport {
    tool: string;
    timestamp: string;
    projectName: string;
    sourceElements: number;
    sourceRelationships: number;
    diffs: RoundTripDiff[];
    summary: {
        elementsLost: number;
        elementsGained: number;
        relationshipsLost: number;
        relationshipsGained: number;
        attributesChanged: number;
        conformant: boolean;
    };
}

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

function computeRoundTripDiffs(source: MemoModel): RoundTripDiff[] {
    const diffs: RoundTripDiff[] = [];

    for (const [id, el] of source.elements) {
        if (!el.kind || el.kind === 'Unknown') {
            diffs.push({
                category: 'element_lost',
                id,
                detail: `Element "${el.name}" (construct: ${el.construct}) has no resolvable kind — external tools may discard it`,
            });
        }

        if (el.construct === 'port' && el.portSpec) {
            if (!el.portSpec.direction) {
                diffs.push({
                    category: 'attribute_changed',
                    id,
                    detail: `Port "${el.name}" has no direction — round-trip may default to "inout"`,
                });
            }
        }

        const attrCount = Object.keys(el.attributes).length;
        if (attrCount > 10) {
            diffs.push({
                category: 'attribute_changed',
                id,
                detail: `Element "${el.name}" has ${attrCount} attributes — tool may reorder or normalize`,
            });
        }
    }

    for (const rel of source.relationships) {
        if (!source.elements.has(rel.sourceId) || !source.elements.has(rel.targetId)) {
            diffs.push({
                category: 'relationship_lost',
                id: rel.id,
                detail: `Relationship "${rel.type}" references unresolved endpoint (${rel.sourceId} → ${rel.targetId})`,
            });
        }
    }

    return diffs;
}

export async function roundTripCommand(
    projectDir?: string,
    options?: { tool?: string; format?: 'text' | 'json'; output?: string }
): Promise<void> {
    const format = options?.format || 'text';
    const tool = options?.tool || 'syson';
    const cwd = resolve(projectDir || process.cwd());

    const isJson = format === 'json';
    const log = isJson ? () => {} : console.log.bind(console);

    log(chalk.bold(`\n🔄 MEMO Round-Trip Conformance — ${tool}\n`));

    const configPath = findConfigFile(cwd);
    if (!configPath) {
        console.error(chalk.red('❌ No memo config found. Run `memo init` first.'));
        process.exit(1);
    }

    const config = loadAndResolveConfig(configPath);
    log(chalk.gray(`Project: ${config.projectName}`));

    let ontologyRegistries: BuilderRegistries | undefined;
    try {
        const loadResult = await loadOntologyRegistries(configPath);
        if (loadResult.fileCount > 0) {
            ontologyRegistries = loadResult.registries;
        }
    } catch {
        // proceed without
    }

    const sysmlFiles = findSysmlFiles(cwd);
    if (sysmlFiles.length === 0) {
        console.error(chalk.yellow('⚠️  No .sysml files found.'));
        return;
    }
    log(chalk.gray(`Files: ${sysmlFiles.length} .sysml files`));

    const { documents, errors: parseErrors } = await parseFiles(sysmlFiles, cwd + '/');
    const model = buildMemoModel(documents, config, parseErrors, ontologyRegistries);
    log(chalk.gray(`Model: ${model.elements.size} elements, ${model.relationships.length} relationships\n`));

    if (parseErrors.length > 0) {
        log(chalk.yellow(`⚠ ${parseErrors.length} parse error(s) — round-trip fidelity reduced\n`));
    }

    const diffs = computeRoundTripDiffs(model);

    const elementsLost = diffs.filter(d => d.category === 'element_lost').length;
    const elementsGained = diffs.filter(d => d.category === 'element_gained').length;
    const relationshipsLost = diffs.filter(d => d.category === 'relationship_lost').length;
    const relationshipsGained = diffs.filter(d => d.category === 'relationship_gained').length;
    const attributesChanged = diffs.filter(d => d.category === 'attribute_changed').length;

    const report: RoundTripReport = {
        tool,
        timestamp: new Date().toISOString(),
        projectName: config.projectName || 'unknown',
        sourceElements: model.elements.size,
        sourceRelationships: model.relationships.length,
        diffs,
        summary: {
            elementsLost,
            elementsGained,
            relationshipsLost,
            relationshipsGained,
            attributesChanged,
            conformant: elementsLost === 0 && relationshipsLost === 0,
        },
    };

    if (format === 'json') {
        const jsonStr = JSON.stringify(report, null, 2);
        if (options?.output) {
            writeFileSync(resolve(cwd, options.output), jsonStr);
            console.log(chalk.green(`Report written to ${options.output}`));
        } else {
            process.stdout.write(jsonStr + '\n');
        }
        if (!report.summary.conformant) process.exitCode = 1;
        return;
    }

    if (diffs.length === 0) {
        console.log(chalk.green.bold('✔ No expected round-trip diffs — fully conformant\n'));
        return;
    }

    const categories: Array<{ label: string; key: RoundTripDiff['category']; color: typeof chalk }> = [
        { label: 'Elements at risk of loss', key: 'element_lost', color: chalk.red },
        { label: 'Relationships at risk', key: 'relationship_lost', color: chalk.red },
        { label: 'Attribute normalization', key: 'attribute_changed', color: chalk.yellow },
        { label: 'Elements gained', key: 'element_gained', color: chalk.blue },
        { label: 'Relationships gained', key: 'relationship_gained', color: chalk.blue },
    ];

    for (const cat of categories) {
        const items = diffs.filter(d => d.category === cat.key);
        if (items.length === 0) continue;
        console.log(cat.color.bold(`${cat.label} (${items.length}):`));
        for (const d of items) {
            console.log(cat.color(`  • [${d.id}] ${d.detail}`));
        }
        console.log();
    }

    const status = report.summary.conformant
        ? chalk.green.bold('✔ Conformant')
        : chalk.yellow.bold('⚠ Expected diffs');
    console.log(`${status} — ${diffs.length} diff(s) predicted for ${tool} round-trip\n`);

    if (!report.summary.conformant) process.exitCode = 1;
}
