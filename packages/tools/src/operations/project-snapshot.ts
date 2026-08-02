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
import { findProjectRoot, loadProjectSettings } from '@memoarchitect/tools';
import { findSysmlFiles } from '../model/sysml-files.js';


export interface ProjectSnapshot {
    projectRoot: string;
    /** Absolute path of the settings file, when the project has one. */
    configPath?: string;
    config: MEMOConfig;
    model: MemoModelDTO;
    validation: ValidationResult;
    completeness: CompletenessReport;
    compiler: 'internal' | 'syside';
}

/** Build the immutable data payload consumed by exports and Architect. */
export async function buildProjectSnapshot(projectRoot = process.cwd()): Promise<ProjectSnapshot> {
    const cwd = resolve(projectRoot);
    // A project is identified by its native entrypoint. Settings are optional:
    // a project with none is complete, because settings carry no meaning.
    if (!findProjectRoot(cwd)) {
        throw new Error(
            'No model/catalog/project.sysml found. A MEMO project declares its identity and method '
            + 'binding in SysML — run `memo init` to scaffold one.',
        );
    }
    const configPath = findConfigFile(cwd);
    const config = configPath ? loadAndResolveConfig(configPath) : loadProjectSettings(cwd);
    const compiler = compileWithConfiguredTool(config, cwd);
    let ontologyRegistries: BuilderRegistries | undefined;
    try {
        const loadResult = await loadOntologyRegistries(cwd);
        if (loadResult.fileCount > 0) ontologyRegistries = loadResult.registries;
    } catch {
        // Snapshot generation remains available with reduced kind resolution.
    }

    const { documents, errors } = await parseFiles(findSysmlFiles(cwd), `${cwd}/`);
    const semanticModel = buildMemoModel(documents, config, errors, ontologyRegistries);
    const validation = validateModel(semanticModel, [], ontologyRegistries?.kindRegistry);
    const completeness = computeCompleteness(semanticModel, validation);

    // Viewpoints and layers are derived from the model. The `viewpoints:` and
    // `architectureLayers:` settings blocks that used to supply them are gone:
    // a portable view's content cannot depend on a file the model does not carry.
    const viewpoints: ViewpointDTO[] = [];
    const architectureLayers: ArchLayerDTO[] | undefined = undefined;
    // Diagrams are authored model views. Do not fabricate one generic BDD per
    // layer: those views carry no diagram intent and obscure the useful views.
    const diagrams: DiagramDTO[] = [];
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
