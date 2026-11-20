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
import { isAbsolute, join } from 'node:path';
import { findSysmlFiles } from '../model/sysml-files.js';
// Imported from their defining modules rather than the package index: this
// module is reached from server/persistor, which imports the package by name.
import { findConfigFile } from '../model/config-loader.js';
import { computeCompleteness } from '../completeness/tracker.js';
import { createQueryContext } from '../dhf/query-engine.js';
import type { QueryContext } from '../dhf/query-engine.js';
import type { MEMOConfig } from '../model/config.js';
import { loadAndResolveConfig } from '../server/config-resolver.js';
import { EMPTY_ONTOLOGY_VIEW, ontologyViewFrom, type OntologyView } from '../model/kind-registry.js';
import { loadProjectModel } from '../toolchain/project-model.js';
import { validateProject } from '../toolchain/project-validation.js';

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
    /** Kinds and relationships from the resolved ontology. */
    ontology: OntologyView;
}

interface CacheEntry {
    project: LoadedProject;
    /** What the model was built from, beyond the project's own sources: settings and the ontology closure. */
    inputs: string[];
    signature: string;
}

const cache = new Map<string, CacheEntry>();

/** Settings read next to the sources; a missing one simply contributes nothing. */
const PROJECT_SETTINGS_FILES = ['memo.package.yaml', 'memo.identity.yaml'];

/**
 * Cheap staleness check: file count plus the newest mtime. Over the project's sources, its settings
 * files and every ontology or library file the last build resolved, so editing `memo.config`, the
 * identity file or a linked ontology is seen as a change, not only editing a `.sysml` file.
 */
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
    const settings = PROJECT_SETTINGS_FILES.map(name => join(projectRoot, name));

    const cached = cache.get(projectRoot);
    if (cached && cached.signature === signatureOf([...files, ...settings, ...cached.inputs])) return cached.project;

    const configPath = findConfigFile(projectRoot);
    if (!configPath) {
        throw new Error(`No MEMO project found at ${projectRoot}. Run \`memo-architect init\` there first.`);
    }

    const config = loadAndResolveConfig(configPath);

    const loaded = await loadProjectModel({ projectRoot, config });
    const { model, registries } = loaded;
    const ontology = registries?.kindRegistry && registries.relationshipRegistry
        ? ontologyViewFrom(registries.kindRegistry, registries.relationshipRegistry)
        : EMPTY_ONTOLOGY_VIEW;
    // The effective rule set, as `memo validate` and Architect run it: an agent checking its work
    // must see the findings the engineer sees, not a reduced set.
    const { validation } = await validateProject(projectRoot, loaded);
    const completeness = computeCompleteness(model, validation);
    const ctx = createQueryContext(model, validation, completeness, config);

    const project: LoadedProject = { ctx, config, ontology, projectRoot, fileCount: files.length };
    const inputs = new Set<string>([configPath]);
    for (const pkg of loaded.resolution?.closure.values() ?? []) {
        for (const file of pkg.files) inputs.add(isAbsolute(file) ? file : join(projectRoot, file));
    }
    cache.set(projectRoot, { project, inputs: [...inputs], signature: signatureOf([...files, ...settings, ...inputs]) });
    return project;
}
