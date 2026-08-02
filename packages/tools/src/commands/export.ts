// ─── memo export ─────────────────────────────────────────────────────────────
//
// Export model data in various formats:
//   - json  → full MemoModelDTO as JSON
//   - png   → diagram screenshots (future)
// ─────────────────────────────────────────────────────────────────────────────

import { resolve } from 'node:path';
import { writeFileSync, mkdirSync } from 'node:fs';
import chalk from 'chalk';
import {
    findConfigFile, findProjectRoot, loadProjectSettings, loadOntologyRegistries,
    deriveModelViews, parseFiles, buildMemoModel, modelToDTO,
} from '@memoarchitect/tools';
import type { BuilderRegistries } from '@memoarchitect/tools';
import { validateModel } from '@memoarchitect/tools';
import { computeCompleteness } from '@memoarchitect/tools';
import type { ViewpointDTO, ArchLayerDTO } from '@memoarchitect/tools';
import { loadAndResolveConfig } from '../server/config-resolver.js';
import { findSysmlFiles } from '../model/sysml-files.js';


/**
 * Resolve a project for export.
 *
 * A project is found by its native entrypoint. Viewpoints and layers used to
 * come out of the settings file; viewpoints are derived from the model's own
 * view usages now, and layers from the ontology, so an export carries what the
 * model says rather than what a sidecar said about it.
 */
async function resolveForExport(cwd: string) {
    const projectRoot = findProjectRoot(cwd);
    if (!projectRoot) {
        console.error(chalk.red(
            '❌ No model/catalog/project.sysml found. Run `memo init` to scaffold one.'));
        process.exit(1);
    }
    const config = loadProjectSettings(projectRoot);
    let registries: BuilderRegistries | undefined;
    try {
        const loaded = await loadOntologyRegistries(projectRoot);
        if (loaded.fileCount > 0) registries = loaded.registries;
    } catch {
        // Export still works with reduced kind resolution.
    }
    const sysmlFiles = findSysmlFiles(projectRoot);
    const { documents, errors } = await parseFiles(sysmlFiles, projectRoot + '/');
    const model = buildMemoModel(documents, config, errors, registries);
    const derived = deriveModelViews(model, registries?.kindRegistry);
    const viewpoints: ViewpointDTO[] | undefined = derived.viewpoints;
    const architectureLayers: ArchLayerDTO[] | undefined = undefined;
    return { projectRoot, config, model, viewpoints, architectureLayers };
}

// ─── memo export json ────────────────────────────────────────────────────────

export async function exportJsonCommand(options: {
    output?: string;
    pretty?: boolean;
}): Promise<void> {
    const cwd = process.cwd();

    console.log(chalk.bold('\n📤 MEMO Export → JSON\n'));

    const { config, model, viewpoints, architectureLayers } = await resolveForExport(cwd);
    const validation = validateModel(model);
    const completeness = computeCompleteness(model, validation);
    const dto = modelToDTO(model, { viewpoints, architectureLayers });

    const output = {
        projectName: config.projectName,
        projectType: undefined as string | undefined,
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

    const { model, viewpoints, architectureLayers } = await resolveForExport(cwd);
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

    // Layer colours for DOT. They come from the ontology's LayerRendering
    // usages when the export carries them; otherwise every node is neutral.
    const layerColors: Record<string, string> = {};
    for (const cl of (architectureLayers ?? []) as ArchLayerDTO[]) {
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
