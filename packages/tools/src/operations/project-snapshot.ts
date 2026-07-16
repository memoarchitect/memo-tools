import { readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { buildMemoModel } from '../model/builder.js';
import { compileWithConfiguredTool } from '../model/toolchain.js';
import { computeCompleteness } from '../completeness/tracker.js';
import { deriveModelViews } from '../model/view-deriver.js';
import { findConfigFile } from '../model/config-loader.js';
import { loadOntologyRegistries } from '../model/ontology-loader.js';
import { parseFiles } from '../model/parser-utils.js';
import { validateModel } from '../validator/rule-engine.js';
import type { BuilderRegistries } from '../model/builder.js';
import type { MEMOConfig } from '../model/config.js';
import { modelToDTO } from '../model/semantic.js';
import type { ArchLayerDTO, DiagramDTO, MemoModelDTO, ViewpointDTO } from '../model/semantic.js';
import type { CompletenessReport, ValidationResult } from '../validator/types.js';
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
        // Ignore unreadable directories.
    }
    return files;
}

export interface ProjectSnapshot {
    projectRoot: string;
    configPath: string;
    config: MEMOConfig;
    model: MemoModelDTO;
    validation: ValidationResult;
    completeness: CompletenessReport;
    compiler: 'internal' | 'syside';
}

/** Build the immutable data payload consumed by exports and Architect. */
export async function buildProjectSnapshot(projectRoot = process.cwd()): Promise<ProjectSnapshot> {
    const cwd = resolve(projectRoot);
    const configPath = findConfigFile(cwd);
    if (!configPath) {
        throw new Error('No memo config found. Run `memo init` first.');
    }

    const config = loadAndResolveConfig(configPath);
    const compiler = compileWithConfiguredTool(config, cwd, configPath);
    let ontologyRegistries: BuilderRegistries | undefined;
    try {
        const loadResult = await loadOntologyRegistries(configPath);
        if (loadResult.fileCount > 0) ontologyRegistries = loadResult.registries;
    } catch {
        // Snapshot generation remains available with reduced kind resolution.
    }

    const { documents, errors } = await parseFiles(findSysmlFiles(cwd), `${cwd}/`);
    const semanticModel = buildMemoModel(documents, config, errors, ontologyRegistries);
    const validation = validateModel(semanticModel);
    const completeness = computeCompleteness(semanticModel, validation, config);

    const viewpoints: ViewpointDTO[] = config.viewpoints?.map(vp => ({
        id: vp.id,
        label: vp.label,
        visibleKinds: vp.visibleKinds,
        visibleRelationships: vp.visibleRelationships,
        visibleLayers: vp.visibleLayers,
    })) ?? [];
    const architectureLayers: ArchLayerDTO[] | undefined = config.architectureLayers?.map(layer => ({
        id: layer.id,
        label: layer.label,
        color: layer.color,
    }));
    const diagrams: DiagramDTO[] = [];
    for (const [layerId, layerElements] of semanticModel.elementsByLayer.entries()) {
        if (layerElements.length === 0) continue;
        const label = layerId.charAt(0).toUpperCase() + layerId.slice(1);
        diagrams.push({
            id: `diag-layer-${layerId}`,
            name: `${label} Layer`,
            diagramType: 'bdd',
            viewKind: 'general',
            viewpointId: '__model',
            auto: true,
            description: `${label} architecture layer — ${layerElements.length} elements`,
            elementIds: layerElements.map(element => element.id),
        });
    }
    const derivedViews = deriveModelViews(semanticModel, ontologyRegistries?.kindRegistry);
    viewpoints.push(...derivedViews.viewpoints);
    diagrams.push(...derivedViews.diagrams);

    return {
        projectRoot: cwd,
        configPath,
        config,
        model: modelToDTO(semanticModel, { viewpoints, architectureLayers, diagrams }),
        validation,
        completeness,
        compiler,
    };
}

/** Serialize data for an inline script without permitting script termination. */
export function serializeForInlineScript(value: unknown): string {
    return JSON.stringify(value)
        .replace(/&/g, '\\u0026')
        .replace(/</g, '\\u003c')
        .replace(/>/g, '\\u003e')
        .replace(/\u2028/g, '\\u2028')
        .replace(/\u2029/g, '\\u2029');
}
