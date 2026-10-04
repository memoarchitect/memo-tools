// ─── A project's model, from whichever compiler is selected ─────────────────
//
// Every command that needs a MEMO model asks here, so `toolchain.compiler`
// means the same thing to all of them. A compiler that builds the model
// (an external compiler) compiles every library root a locator offers and states
// the project's resolution, registries and rules in its handoff, so MEMO
// parses nothing. MEMO's own compiler resolves the project, loads the ontology
// and builds the model from its parse, as it always has.
// ─────────────────────────────────────────────────────────────────────────────

import { join, relative } from 'node:path';
import type { BuilderRegistries } from '../model/builder.js';
import { buildMemoModel } from '../model/builder.js';
import type { MEMOConfig } from '../model/config.js';
import { findProjectRoot, type NativeProjectResolution } from '../model/native-project.js';
import { loadOntologyRegistries } from '../model/ontology-loader.js';
import type { ParsedDocument } from '../model/parser-utils.js';
import { parseFiles } from '../model/parser-utils.js';
import type { MemoModel, ParseError } from '../model/semantic.js';
import { findSysmlFiles } from '../model/sysml-files.js';
import type { ApiModel } from '../stage2/api-model.js';
import { resolutionLoads } from '../stage2/project-from-api.js';
import { collectNativeConstraints, type ConstraintDiagnostic } from '../validator/constraint-loader.js';
import type { CompiledConstraint } from '../validator/constraint-eval.js';
import { collectApiConstraints } from '../validator/constraint-loader-api.js';
import { defaultRegistry } from './default-registry.js';
import type { Diagnostic } from './diagnostic.js';
import { resolveToolchain } from './effective.js';
import { compileResolvedProject, selectedCompilerBuildsModel } from './operations.js';
import type { ProviderRegistry } from './registry.js';

export interface ProjectModel {
    model: MemoModel;
    /** The kinds, relationship types and provenance the model was built with. */
    registries?: BuilderRegistries;
    resolution?: NativeProjectResolution;
    /** The selected compiler (`toolchain.compiler`). */
    compiler: string;
    /** Whether the selected compiler built the model from its handoff. */
    fromHandoff: boolean;
    /** The compiler's version, when it built the model. */
    providerVersion?: string;
    /** Stage 1's diagnostics, when it built the model. */
    diagnostics: Diagnostic[];
    /** MEMO's parse errors, when it built the model. */
    parseErrors: ParseError[];
    /** Messages from resolving the project and loading its ontology. */
    loadWarnings: string[];
    /** The project files MEMO parsed, when it built the model. */
    documents: ParsedDocument[];
    /** The ontology files MEMO parsed, when it built the model. */
    ontologyDocuments: ParsedDocument[];
    /** The handoff the model was built from, library included. */
    api?: ApiModel;
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
    if (selectedCompilerBuildsModel(config, registry)) {
        const stage1 = await compileResolvedProject({
            config,
            projectDir: projectRoot,
            projectFiles: options.files ? new Set(options.files.map(file => relative(projectRoot, file))) : undefined,
            cacheDir: options.cache === false ? undefined : stage1CacheDir(projectRoot),
            registry,
        });
        if (!stage1) throw new Error(`${compiler} builds the model but compiled nothing`);
        if (!stage1.accepted || !stage1.model) throw new Stage1RejectedError(compiler, stage1.diagnostics);
        return {
            model: stage1.model,
            registries: stage1.registries,
            resolution: stage1.resolution,
            compiler,
            fromHandoff: true,
            providerVersion: stage1.providerVersion,
            diagnostics: stage1.diagnostics,
            parseErrors: [],
            loadWarnings: (stage1.resolution?.diagnostics ?? []).map(d => `${d.code}: ${d.message}`),
            documents: [],
            ontologyDocuments: [],
            api: stage1.api,
            cached: stage1.cached,
        };
    }

    const loaded = await loadOntologyRegistries(projectRoot);
    const registries: BuilderRegistries | undefined = loaded.fileCount > 0
        ? { ...loaded.registries, provenance: loaded.provenance }
        : undefined;
    // The project's own source is everything resolution parsed under no
    // library root, selected or unused, as `memo validate` takes it.
    const resolution = loaded.resolution;
    const roots = [...(resolution?.selectedRoots ?? []), ...(resolution?.unusedRoots ?? [])];
    const isProjectFile = (file: string) => !roots.some(root => file.startsWith(root.sysmlDir));
    // A directory with no entrypoint has no resolution to take its source from;
    // its source is every `.sysml` file under it, as MEMO's lowering reads one.
    const { documents, errors } = options.files || !resolution?.entrypoint
        ? await parseFiles([...(options.files ?? findSysmlFiles(projectRoot))], `${projectRoot}/`)
        : {
            documents: resolution.documents.filter(d => isProjectFile(d.filePath)),
            errors: resolution.parseErrors.filter(e => isProjectFile(e.file)),
        };
    return {
        model: buildMemoModel(documents, config, errors, registries),
        registries,
        resolution: loaded.resolution,
        compiler,
        fromHandoff: false,
        diagnostics: [],
        parseErrors: errors,
        loadWarnings: loaded.errors,
        documents,
        ontologyDocuments: loaded.fileCount > 0 ? loaded.parsedDocuments : [],
    };
}

/**
 * The rule definitions a loaded project declares: from the handoff when the
 * compiler built the model, else from MEMO's parse of the ontology and the
 * project. Restricted to what resolution loads, as `memo validate` restricts it.
 */
export function projectConstraints(
    project: ProjectModel,
    diagnostics: ConstraintDiagnostic[] = [],
    isProjectFile: (file: string) => boolean = () => false,
): CompiledConstraint[] {
    if (project.api) {
        const loaded = project.resolution ? resolutionLoads(project.resolution) : () => true;
        return collectApiConstraints(project.api, diagnostics, project.resolution?.filePackages,
            file => loaded(file) || isProjectFile(file));
    }
    return collectNativeConstraints([...project.ontologyDocuments, ...project.documents], diagnostics);
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
 * resolution itself — for a command that needs no model. From the selected
 * compiler's handoff when it builds the model; else from MEMO's parse of the
 * resolved library files, which is also how a directory with no entrypoint
 * (a bare ontology checkout) resolves.
 */
export async function loadProjectOntology(options: LoadProjectModelOptions): Promise<ProjectOntology> {
    const registry = options.registry ?? defaultRegistry;
    if (selectedCompilerBuildsModel(options.config, registry) && findProjectRoot(options.projectRoot)) {
        const project = await loadProjectModel(options);
        return {
            registries: project.registries ?? {},
            resolution: project.resolution,
            fileCount: project.resolution ? resolutionFileCount(project.resolution) : 0,
            loadWarnings: project.loadWarnings,
        };
    }
    const loaded = await loadOntologyRegistries(options.projectRoot);
    return {
        registries: { ...loaded.registries, provenance: loaded.provenance },
        resolution: loaded.resolution,
        fileCount: loaded.fileCount,
        loadWarnings: loaded.errors,
    };
}

function resolutionFileCount(resolution: NativeProjectResolution): number {
    const files = new Set<string>();
    for (const pkg of resolution.closure.values()) for (const file of pkg.files) files.add(file);
    return files.size;
}
