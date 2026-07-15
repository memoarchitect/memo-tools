// ─── memo export ─────────────────────────────────────────────────────────────
//
// Export model data in various formats:
//   - json  → full MemoModelDTO as JSON
//   - png   → diagram screenshots (future)
// ─────────────────────────────────────────────────────────────────────────────

import { resolve } from 'node:path';
import { readdirSync, writeFileSync, mkdirSync } from 'node:fs';
import chalk from 'chalk';
import { findConfigFile, parseFiles, buildMemoModel, modelToDTO } from '@memo/core';
import { validateModel } from '@memo/core';
import { computeCompleteness } from '@memo/core';
import type { ViewpointDTO, ArchLayerDTO } from '@memo/core';
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

function buildFullModel(cwd: string, config: any) {
    // Shared model building used by all export formats
    const sysmlFiles = findSysmlFiles(cwd);

    const viewpoints: ViewpointDTO[] | undefined = config.viewpoints?.map((vp: any) => ({
        id: vp.id,
        label: vp.label,
        visibleKinds: vp.visibleKinds,
        visibleRelationships: vp.visibleRelationships,
        visibleLayers: vp.visibleLayers,
    }));

    const architectureLayers: ArchLayerDTO[] | undefined = config.architectureLayers?.map((cl: any) => ({
        id: cl.id,
        label: cl.label,
        color: cl.color,
    }));

    return { sysmlFiles, viewpoints, architectureLayers };
}

// ─── memo export json ────────────────────────────────────────────────────────

export async function exportJsonCommand(options: {
    output?: string;
    pretty?: boolean;
}): Promise<void> {
    const cwd = process.cwd();

    console.log(chalk.bold('\n📤 MEMO Export → JSON\n'));

    const configPath = findConfigFile(cwd);
    if (!configPath) {
        console.error(chalk.red('❌ No memo config found.'));
        process.exit(1);
    }

    const config = loadAndResolveConfig(configPath);
    const { sysmlFiles, viewpoints, architectureLayers } = buildFullModel(cwd, config);

    const { documents, errors } = await parseFiles(sysmlFiles, cwd + '/');
    const model = buildMemoModel(documents, config, errors);
    const validation = validateModel(model);
    const completeness = computeCompleteness(model, validation, config);
    const dto = modelToDTO(model, { viewpoints, architectureLayers });

    const output = {
        projectName: config.projectName,
        projectType: config.projectType,
        exportedAt: new Date().toISOString(),
        model: dto,
        validation,
        completeness,
    };

    const outputPath = resolve(cwd, options.output || 'memo-model.json');
    const indent = options.pretty !== false ? 2 : undefined;
    writeFileSync(outputPath, JSON.stringify(output, null, indent));

    console.log(chalk.cyan(
        `  ${model.elements.size} elements, ${model.relationships.length} relationships`
    ));
    console.log(chalk.green(`\n✅ Exported to ${outputPath}\n`));
}

// ─── memo export dot ─────────────────────────────────────────────────────────

export async function exportDotCommand(options: {
    output?: string;
    viewpoint?: string;
}): Promise<void> {
    const cwd = process.cwd();

    console.log(chalk.bold('\n📤 MEMO Export → Graphviz DOT\n'));

    const configPath = findConfigFile(cwd);
    if (!configPath) {
        console.error(chalk.red('❌ No memo config found.'));
        process.exit(1);
    }

    const config = loadAndResolveConfig(configPath);
    const { sysmlFiles, viewpoints, architectureLayers } = buildFullModel(cwd, config);

    const { documents, errors } = await parseFiles(sysmlFiles, cwd + '/');
    const model = buildMemoModel(documents, config, errors);
    const dto = modelToDTO(model, { viewpoints, architectureLayers });

    // Filter by viewpoint if specified
    let elements = Object.values(dto.elements);
    let relationships = dto.relationships;

    if (options.viewpoint && viewpoints) {
        const vp = viewpoints.find(v => v.id === options.viewpoint);
        if (vp) {
            const kinds = new Set(vp.visibleKinds);
            const layers = new Set(vp.visibleLayers);
            elements = elements.filter(el => kinds.has(el.kind) || layers.has(el.layer));
            const visibleIds = new Set(elements.map(e => e.id));
            relationships = relationships.filter(
                r => visibleIds.has(r.sourceId) && visibleIds.has(r.targetId)
            );
        }
    }

    // Layer colors for DOT
    const layerColors: Record<string, string> = {};
    for (const cl of architectureLayers ?? []) {
        layerColors[cl.id] = cl.color;
    }

    // Generate DOT
    const lines: string[] = [
        'digraph MEMO {',
        '    rankdir=LR;',
        '    node [shape=box, style="rounded,filled", fontname="Helvetica", fontsize=10];',
        '    edge [fontname="Helvetica", fontsize=8];',
        '',
    ];

    for (const el of elements) {
        const color = layerColors[el.layer] || '#666666';
        const escapedName = el.name.replace(/"/g, '\\"');
        lines.push(`    "${el.id}" [label="${escapedName}\\n(${el.kind})", fillcolor="${color}22", color="${color}"];`);
    }

    lines.push('');

    for (const rel of relationships) {
        lines.push(`    "${rel.sourceId}" -> "${rel.targetId}" [label="${rel.type}"];`);
    }

    lines.push('}');

    const dot = lines.join('\n');
    const outputPath = resolve(cwd, options.output || 'memo-model.dot');
    writeFileSync(outputPath, dot);

    console.log(chalk.cyan(
        `  ${elements.length} elements, ${relationships.length} relationships`
    ));
    console.log(chalk.green(`\n✅ Exported to ${outputPath}`));
    console.log(chalk.gray(`   Render with: dot -Tpng ${outputPath} -o diagram.png\n`));
}
