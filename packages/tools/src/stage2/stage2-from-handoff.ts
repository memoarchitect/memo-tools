// ─── Stage 2 from a stage 1 handoff ──────────────────────────────────────────
//
// What every compiler's lowering does with its handoff: build MEMO's model,
// with registries the handoff states. Asked to resolve the project too
// (`resolveProject`), the handoff was compiled over every library root a
// locator offers, and project resolution comes from it as well: the import
// closure decides which of that content is the ontology, exactly as MEMO's
// parse decides it, so no SysML is parsed by MEMO.
// ─────────────────────────────────────────────────────────────────────────────

import type { BuilderRegistries } from '../model/complete-model.js';
import type { MEMOConfig } from '../model/config.js';
import type { NativeProjectResolution } from '../model/native-project.js';
import { buildProvenanceTable } from '../model/ontology-loader.js';
import type { MemoModel } from '../model/semantic.js';
import type { ApiModel } from './api-model.js';
import { buildMemoModelFromApi } from './build-from-api.js';
import { handoffFileOf } from './handoff-files.js';
import { resolutionLoads, resolveNativeProjectFromApi } from './project-from-api.js';
import { apiOntologyRegistries, handoffRegistries } from './registries-from-api.js';

export interface Stage2Options {
    config: MEMOConfig;
    projectDir: string;
    /** Project source files relative to the project. */
    projectFiles: ReadonlySet<string>;
    /** Resolve the project from the handoff, which was compiled over every library root. */
    resolveProject?: boolean;
    /** Stamp elements with their provenance when resolving the project (default true). */
    provenance?: boolean;
    /** The registries resolution already loaded, when it did not come from the handoff. */
    registries?: BuilderRegistries;
    filePackages?: ReadonlyMap<string, string>;
}

export interface Stage2Result {
    model: MemoModel;
    registries: BuilderRegistries;
    /** The project's resolution, when the handoff stated it (`resolveProject`). */
    resolution?: NativeProjectResolution;
}

export function stage2FromHandoff(api: ApiModel, options: Stage2Options): Stage2Result {
    if (!options.resolveProject) {
        const registries = handoffRegistries(api, options.registries, options.filePackages);
        return { model: buildMemoModelFromApi(api, options.config, registries, options.projectFiles), registries };
    }
    const resolution = resolveNativeProjectFromApi(options.projectDir, api);
    api.useDependencyFiles(
        [...resolution.closure.values()].filter(pkg => pkg.origin === 'dependency').flatMap(pkg => pkg.files),
        resolution.projectRoot);
    const loads = resolutionLoads(resolution);
    const fileOf = handoffFileOf(api, resolution.filePackages);
    const registries: BuilderRegistries = {
        ...(options.provenance === false ? {} : { provenance: buildProvenanceTable(resolution) }),
        ...apiOntologyRegistries(api, fileOf, namespace => loads(fileOf(namespace)), ['library', 'project']),
    };
    return {
        model: buildMemoModelFromApi(api, options.config, registries, options.projectFiles),
        registries,
        resolution,
    };
}
