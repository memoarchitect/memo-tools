// ─── Lowering: the one implementation, reached two ways ──────────────────────
//
// "What can MEMO ingest from this revision?" is answered here and nowhere else.
// The in-process transport calls `lowerProject` directly; the process transport
// calls it inside `sysmlc`, over the protocol. That is the whole reason both
// transports can be byte-identical: there is one function, not two that are
// meant to agree.
//
// Note what it takes: a project directory, and nothing else. The compiler loads
// the project's own settings itself, the way a compiler run in that directory
// would. Passing a caller-supplied config in-process and letting the child load
// its own would be the classic way for two transports to drift — same code,
// different inputs — so the input is derived the same way on both sides.
// ─────────────────────────────────────────────────────────────────────────────

import { resolve } from 'node:path';
import { buildMemoModel, type BuilderRegistries } from '../model/builder.js';
import { findConfigFile, loadProjectSettings } from '../model/config-loader.js';
import { loadOntologyRegistries } from '../model/ontology-loader.js';
import { parseFiles } from '../model/parser-utils.js';
import { modelToDTO, type ParseError } from '../model/semantic.js';
import { findSysmlFiles } from '../model/sysml-files.js';
import { loadAndResolveConfig } from '../server/config-resolver.js';
import type { MEMOConfig } from '../model/config.js';
import { SYSMLC_IR_VERSION, type MemoIr } from './protocol.js';

/**
 * The project's effective settings.
 *
 * Settings are optional — a project with none is complete, because a MEMO
 * project declares its identity in SysML, not in YAML.
 */
export function loadProjectConfig(projectDir: string): MEMOConfig {
    const configPath = findConfigFile(projectDir);
    return configPath ? loadAndResolveConfig(configPath) : loadProjectSettings(projectDir);
}

/**
 * The ontology registries the builder resolves kinds against.
 *
 * A project that cannot load them still lowers, with reduced kind resolution —
 * §1.1 again: the compiler reports what is wrong, it does not refuse to work.
 */
export async function loadBuilderRegistries(projectDir: string): Promise<BuilderRegistries | undefined> {
    try {
        const result = await loadOntologyRegistries(projectDir);
        return result.fileCount > 0 ? result.registries : undefined;
    } catch {
        return undefined;
    }
}

export interface LoweringOptions {
    /**
     * Ontology registries the caller has already loaded. See `ProviderContext`.
     */
    registries?: BuilderRegistries;
    /**
     * The exact sources to read, instead of the directory's own discovery.
     *
     * Absolute paths, and never a project's normal input: a project is defined
     * by what is in it. It exists for callers whose subject is a *file set*
     * rather than a project — conformance runs a corpus unit whose Kernel
     * libraries are `.kerml`, which the project walker does not collect, and a
     * run that silently analysed none of them would report a clean pass on
     * files it never opened.
     */
    files?: readonly string[];
}

/**
 * The sources a run reads: the caller's explicit list, or the project's own.
 *
 * Sorted either way, because "both transports are byte-identical" only holds
 * against an input order that does not depend on who built the list.
 */
export function resolveSources(root: string, files?: readonly string[]): string[] {
    return (files ? files.map(file => resolve(root, file)) : findSysmlFiles(root)).slice().sort();
}

/**
 * Lower a project to IR.
 *
 * Everything here is deterministic given the file contents: file discovery is
 * sorted, element identity is content-hashed, and the payload is plain JSON. It
 * has to be — "both transports are byte-identical" is only a meaningful test
 * against a function whose output does not depend on which process ran it.
 */
export async function lowerProject(
    projectDir: string,
    options: LoweringOptions = {},
): Promise<MemoIr> {
    const root = resolve(projectDir);
    const config = loadProjectConfig(root);
    // Loading the ontology closure is the expensive part, and a caller that has
    // already done it — the snapshot builder needs the same registries to
    // validate against — may hand them over rather than pay twice. It is the
    // same value either way: a process transport loads its own, and the two
    // agree because they resolve the same project.
    const registries = options.registries ?? await loadBuilderRegistries(root);
    const { documents, errors } = await parseFiles(resolveSources(root, options.files), `${root}/`);
    const model = buildMemoModel(documents, config, errors, registries);
    return {
        irVersion: SYSMLC_IR_VERSION,
        model: modelToDTO(model),
        parseErrors: errors,
        accepted: errors.length === 0,
    };
}

/**
 * Parse without building — what `check` needs and nothing more.
 *
 * The validator role asks a narrower question than lowering does, and paying
 * for a full model build to answer it would make `memo validate` slower for no
 * reason.
 */
export async function checkProject(
    projectDir: string,
    files?: readonly string[],
): Promise<{ accepted: boolean; parseErrors: ParseError[] }> {
    const root = resolve(projectDir);
    const { errors } = await parseFiles(resolveSources(root, files), `${root}/`);
    return { accepted: errors.length === 0, parseErrors: errors };
}
