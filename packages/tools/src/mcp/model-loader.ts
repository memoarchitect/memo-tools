// ─── MCP Model Loader ────────────────────────────────────────────────────────
//
// Loads a MEMO project into a QueryContext for the MCP server.
//
// The server is long-lived and an IDE agent may call it long after the files
// changed on disk, so the model is cached with an mtime check rather than read
// once at startup — a stale answer to "what hazards exist?" is worse than the
// cost of a reload.
// ─────────────────────────────────────────────────────────────────────────────

import { statSync } from 'node:fs';
import { resolve } from 'node:path';
import { findSysmlFiles } from '../model/sysml-files.js';
// Imported from their defining modules rather than the package index: this
// module is reached from server/persistor, which imports the package by name.
import { findConfigFile } from '../model/config-loader.js';
import { parseFiles } from '../model/parser-utils.js';
import { buildMemoModel, type BuilderRegistries } from '../model/builder.js';
import { loadOntologyRegistries } from '../model/ontology-loader.js';
import { validateModel } from '../validator/rule-engine.js';
import { computeCompleteness } from '../completeness/tracker.js';
import { createQueryContext } from '../dhf/query-engine.js';
import type { QueryContext } from '../dhf/query-engine.js';
import type { MEMOConfig } from '../model/config.js';
import { loadAndResolveConfig } from '../server/config-resolver.js';

// Source discovery is the shared walker's job. This module kept its own copy
// with a shorter skip list, which meant the MCP server saw files every other
// entry point had already learned to ignore — a virtualenv's bundled standard
// library among them. Re-exported because `mcp/index.ts` publishes it.
export { findSysmlFiles };

export interface LoadedProject {
    ctx: QueryContext;
    config: MEMOConfig;
    projectRoot: string;
    fileCount: number;
}

interface CacheEntry {
    project: LoadedProject;
    /** Newest mtime across all .sysml files at load time. */
    signature: string;
}

const cache = new Map<string, CacheEntry>();

/** Cheap staleness check: file count plus the newest mtime. */
function signatureOf(files: string[]): string {
    let newest = 0;
    for (const f of files) {
        try {
            const t = statSync(f).mtimeMs;
            if (t > newest) newest = t;
        } catch {
            // A file that vanished mid-scan changes the count, which is enough.
        }
    }
    return `${files.length}:${newest}`;
}

export async function loadProject(projectRoot: string): Promise<LoadedProject> {
    const files = findSysmlFiles(projectRoot);
    const signature = signatureOf(files);

    const cached = cache.get(projectRoot);
    if (cached && cached.signature === signature) return cached.project;

    const configPath = findConfigFile(projectRoot);
    if (!configPath) {
        throw new Error(`No MEMO project found at ${projectRoot}. Run \`memo init\` there first.`);
    }

    const config = await loadAndResolveConfig(configPath);

    let ontologyRegistries: BuilderRegistries | undefined;
    try {
        const loadResult = await loadOntologyRegistries(configPath);
        if (loadResult.fileCount > 0) ontologyRegistries = loadResult.registries;
    } catch {
        // A project without a resolvable ontology still has a parseable model.
    }

    const { documents, errors: parseErrors } = await parseFiles(files, `${projectRoot}/`);
    const model = buildMemoModel(documents, config, parseErrors, ontologyRegistries);
    const validation = validateModel(model);
    const completeness = computeCompleteness(model, validation, config);
    const ctx = createQueryContext(model, validation, completeness, config);

    const project: LoadedProject = { ctx, config, projectRoot, fileCount: files.length };
    cache.set(projectRoot, { project, signature });
    return project;
}
