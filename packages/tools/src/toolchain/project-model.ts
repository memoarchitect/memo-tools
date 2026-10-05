// ─── A project's model, from the selected compiler ───────────────────────────
//
// Every command that needs a MEMO model asks here, so `toolchain.compiler`
// means the same thing to all of them. The compiler compiles every library root
// a locator offers and states the project's resolution, registries and rules in
// its handoff, so MEMO parses nothing: it reads the handoff.
// ─────────────────────────────────────────────────────────────────────────────

import { join, relative } from 'node:path';
import type { BuilderRegistries } from '../model/complete-model.js';
import type { MEMOConfig } from '../model/config.js';
import type { NativeProjectResolution } from '../model/native-project.js';
import type { MemoModel } from '../model/semantic.js';
import type { ApiModel } from '../stage2/api-model.js';
import { isProjectSource, resolutionLoads } from '../stage2/project-from-api.js';
import type { ConstraintDiagnostic } from '../validator/constraint-loader.js';
import type { CompiledConstraint } from '../validator/constraint-eval.js';
import { collectApiConstraints } from '../validator/constraint-loader-api.js';
import { defaultRegistry } from './default-registry.js';
import type { Diagnostic } from './diagnostic.js';
import { resolveToolchain } from './effective.js';
import { compileResolvedProject } from './operations.js';
import type { ProviderRegistry } from './registry.js';

export interface ProjectModel {
    model: MemoModel;
    /** The kinds, relationship types and provenance the model was built with. */
    registries?: BuilderRegistries;
    resolution?: NativeProjectResolution;
    /** The selected compiler (`toolchain.compiler`). */
    compiler: string;
    /** The compiler's version. */
    providerVersion?: string;
    /** Stage 1's diagnostics. */
    diagnostics: Diagnostic[];
    /** Messages from resolving the project and loading its ontology. */
    loadWarnings: string[];
    /** The handoff the model was built from, library included. */
    api: ApiModel;
    /** Whether stage 1 was reused from the project's `.memo/stage1`. */
    cached?: boolean;
}

/** Stage 1 reported an error: no model, since it is not valid SysML. */
export class Stage1RejectedError extends Error {
    constructor(readonly compiler: string, readonly diagnostics: Diagnostic[]) {
        const errors = diagnostics.filter(d => d.severity === 'error');
        super(`Stage 1 (${compiler}) reported ${errors.length} error(s):\n`
            + errors.map(d => `  ${d.file}:${d.range?.start.line ?? '?'}:${d.range?.start.column ?? '?'} ${d.code ?? ''} ${d.message}`).join('\n'));
    }
}

/** Where compilers keep stage 1 output between runs: tool state, never authored content. */
export function stage1CacheDir(projectRoot: string): string {
    return join(projectRoot, '.memo', 'stage1');
}

export interface LoadProjectModelOptions {
    projectRoot: string;
    config: MEMOConfig;
    /**
     * The project files the model is built from, absolute. Defaults to the
     * project's own sources: every file under no library root.
     */
    files?: readonly string[];
    /** Reuse and refresh `.memo/stage1`. Default true. */
    cache?: boolean;
    registry?: ProviderRegistry;
}

/**
 * The project's model from the selected compiler.
 *
 * Throws {@link Stage1RejectedError} when stage 1 reports an error: a command
 * never works on a model that is not valid SysML.
 */
export async function loadProjectModel(options: LoadProjectModelOptions): Promise<ProjectModel> {
    const { projectRoot, config } = options;
    const registry = options.registry ?? defaultRegistry;
    const compiler = resolveToolchain(config, registry).lowering;
    const stage1 = await compileResolvedProject({
        config,
        projectDir: projectRoot,
        projectFiles: options.files ? new Set(options.files.map(file => relative(projectRoot, file))) : undefined,
        cacheDir: options.cache === false ? undefined : stage1CacheDir(projectRoot),
        registry,
    });
    if (!stage1.accepted || !stage1.model || !stage1.api) throw new Stage1RejectedError(compiler, stage1.diagnostics);
    return {
        model: stage1.model,
        registries: stage1.registries,
        resolution: stage1.resolution,
        compiler,
        providerVersion: stage1.providerVersion,
        diagnostics: stage1.diagnostics,
        loadWarnings: (stage1.resolution?.diagnostics ?? []).map(d => `${d.code}: ${d.message}`),
        api: stage1.api,
        cached: stage1.cached,
    };
}

/**
 * The rule definitions a loaded project declares, from the handoff, restricted
 * to what resolution loads, as `memo validate` restricts it.
 */
export function projectConstraints(
    project: ProjectModel,
    diagnostics: ConstraintDiagnostic[] = [],
    /** Files that are the project's own; by default, every file under no library root. */
    isProjectFile: (file: string) => boolean = project.resolution ? isProjectSource(project.resolution) : () => false,
): CompiledConstraint[] {
    const loaded = project.resolution ? resolutionLoads(project.resolution) : () => true;
    return collectApiConstraints(project.api, diagnostics, project.resolution?.filePackages,
        file => loaded(file) || isProjectFile(file));
}

export interface ProjectOntology {
    registries: BuilderRegistries;
    resolution?: NativeProjectResolution;
    /** Ontology files resolution loaded; 0 when nothing resolved. */
    fileCount: number;
    loadWarnings: string[];
}

/**
 * The ontology a project resolves — its kinds, relationship types and the
 * resolution itself — for a command that needs no model, from the selected
 * compiler's handoff.
 */
export async function loadProjectOntology(options: LoadProjectModelOptions): Promise<ProjectOntology> {
    const project = await loadProjectModel(options);
    return {
        registries: project.registries ?? {},
        resolution: project.resolution,
        fileCount: project.resolution ? resolutionFileCount(project.resolution) : 0,
        loadWarnings: project.loadWarnings,
    };
}

function resolutionFileCount(resolution: NativeProjectResolution): number {
    const files = new Set<string>();
    for (const pkg of resolution.closure.values()) for (const file of pkg.files) files.add(file);
    return files.size;
}
