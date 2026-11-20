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
import { loadProjectModel, projectConstraints, type ProjectModel } from '../toolchain/project-model.js';
import type { CompiledConstraint } from '../validator/constraint-eval.js';
import { loadMethodologyDescriptor } from '../model/methodology-loader.js';
import { computeWorkspaceMembership, selectWorkspace } from '../model/workspace-membership.js';
import { narrowModel } from '../model/narrow-model.js';
import { validateProject } from '../toolchain/project-validation.js';
import type { OntologyRegistriesDTO } from '../model/relationship-legality.js';

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
    /** The ontology's definitions, ends included, for checking a proposed relationship. */
    registries?: OntologyRegistriesDTO;
    /** The project as the compiler built it, for the services that need its handoff (the Guide, change impact). */
    model: ProjectModel;
    /** The rule definitions the project resolves. */
    constraints: CompiledConstraint[];
    /** The packages declaring the effective methodology chain, base first. */
    methodologyPackages: string[];
    /** The systems and systems of systems the model declares, each a workspace an agent can work in. */
    systems: { id: string; name: string; scope: 'system' | 'sos' }[];
    /** The workspace the context is scoped to, when one was asked for. */
    workspace?: { id: string; name: string; scope: 'system' | 'sos' };
}

interface CacheEntry {
    /** The whole model's load; a workspace's is derived from it on demand. */
    project: LoadedProject;
    scoped: Map<string, LoadedProject>;
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

/**
 * The project, whole or scoped to one system or system of systems (by id or name), as
 * `memo validate --workspace` scopes it: the element queries list the workspace's members and the
 * rules judge only them, over the whole model.
 */
export async function loadProject(projectRoot: string, system?: string): Promise<LoadedProject> {
    const whole = await loadWholeProject(projectRoot);
    if (!system) return whole;
    const entry = cache.get(projectRoot)!;
    const known = entry.scoped.get(system);
    if (known) return known;

    const registries = whole.model.registries;
    if (!registries?.kindRegistry || !registries.relationshipRegistry) {
        throw new Error('This model was built without ontology registries, so it has no systems to scope to.');
    }
    const selection = selectWorkspace(whole.model.model, computeWorkspaceMembership(whole.model.model, registries), system);
    if (!selection.ok) throw new Error(selection.message);
    const workspace = selection.scope;
    const { validation } = await validateProject(projectRoot, whole.model, { workspace });
    const subjects = new Map([...whole.model.model.elements].filter(([id]) => workspace.subjects.has(id)));
    const completeness = computeCompleteness(narrowModel(whole.model.model, subjects), validation);
    const scoped: LoadedProject = {
        ...whole,
        ctx: createQueryContext(whole.model.model, validation, completeness, whole.config, undefined, workspace),
        workspace: { id: workspace.root, name: workspace.name, scope: workspace.scope },
    };
    entry.scoped.set(system, scoped);
    return scoped;
}

async function loadWholeProject(projectRoot: string): Promise<LoadedProject> {
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

    const definitions: OntologyRegistriesDTO | undefined = registries?.kindRegistry && registries.relationshipRegistry
        ? { kinds: registries.kindRegistry.toDefinitionDTOs(), relationships: registries.relationshipRegistry.toDefinitionDTOs() }
        : undefined;
    let methodologyPackages: string[] = [];
    try {
        const descriptor = await loadMethodologyDescriptor(projectRoot, loaded.resolution, loaded.api);
        methodologyPackages = (descriptor.effective?.chain ?? []).map(m => m.packageQualifiedName).filter((p): p is string => !!p);
    } catch {
        // A model whose methodology does not resolve still answers every question but the Guide's.
    }
    const systems = registries?.kindRegistry && registries.relationshipRegistry
        ? computeWorkspaceMembership(model, registries).workspaces.map(w => ({ id: model.elements.get(w.root)?.shortId ?? w.root, name: model.elements.get(w.root)?.name ?? w.root, scope: w.scope }))
        : [];
    const project: LoadedProject = {
        ctx, config, ontology, registries: definitions, projectRoot, fileCount: files.length,
        model: loaded, constraints: projectConstraints(loaded), methodologyPackages, systems,
    };
    const inputs = new Set<string>([configPath]);
    for (const pkg of loaded.resolution?.closure.values() ?? []) {
        for (const file of pkg.files) inputs.add(isAbsolute(file) ? file : join(projectRoot, file));
    }
    cache.set(projectRoot, { project, scoped: new Map(), inputs: [...inputs], signature: signatureOf([...files, ...settings, ...inputs]) });
    return project;
}
