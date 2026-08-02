import { resolve } from 'node:path';
import { buildMemoModel } from '../model/builder.js';
import { computeCompleteness } from '../completeness/tracker.js';
import { deriveModelViews } from '../model/view-deriver.js';
import { findConfigFile } from '../model/config-loader.js';
import { loadOntologyRegistries } from '../model/ontology-loader.js';
import { validateModel } from '../validator/rule-engine.js';
import type { BuilderRegistries } from '../model/builder.js';
import type { MEMOConfig } from '../model/config.js';
import { modelToDTO } from '../model/semantic.js';
import type { ArchLayerDTO, DiagramDTO, MemoModelDTO, ViewpointDTO } from '../model/semantic.js';
import type { CompletenessReport, ValidationResult } from '../validator/types.js';
import { loadAndResolveConfig } from '../server/config-resolver.js';
import { findProjectRoot, loadProjectSettings } from '@memoarchitect/tools';
import { defaultRegistry } from '../toolchain/default-registry.js';
import { resolveToolchain } from '../toolchain/effective.js';
import { mergeDiagnostics, runLowering, runValidator } from '../toolchain/operations.js';
import type { Diagnostic } from '../toolchain/diagnostic.js';
import type { ProviderRegistry } from '../toolchain/registry.js';


export interface ProjectSnapshot {
    projectRoot: string;
    /** Absolute path of the settings file, when the project has one. */
    configPath?: string;
    config: MEMOConfig;
    model: MemoModelDTO;
    validation: ValidationResult;
    completeness: CompletenessReport;
    /** Provider that answered "is this valid SysML?". */
    validator: string;
    /** Provider that answered "what can MEMO ingest?". */
    lowering: string;
    /**
     * @deprecated Reads as the validator. Kept so callers written against the
     * single-provider shape keep working while they move to `validator`.
     */
    compiler: string;
    /** Normalized diagnostics from both roles, each in its own domain. */
    diagnostics: Diagnostic[];
    /**
     * True when the model shown is the last one that built, not this revision.
     *
     * §1.1: while the current revision is broken the diagram keeps the last
     * good scene rather than blanking. A caller that draws needs to know which
     * it is holding.
     */
    stale: boolean;
}

/**
 * Last model that built, per project root.
 *
 * The point of keeping it is the §1.1 rule: a broken revision leaves the last
 * good picture on screen plus current diagnostics. It never blanks and never
 * shows a half-built model. Process-scoped, which is the scope of the server
 * that draws from it.
 */
const lastGoodModel = new Map<string, MemoModelDTO>();

/** Drop the retained model for a project — a fresh start really is fresh. */
export function forgetLastGoodModel(projectRoot?: string): void {
    if (projectRoot) lastGoodModel.delete(resolve(projectRoot));
    else lastGoodModel.clear();
}

/** Build the immutable data payload consumed by exports and Architect. */
export async function buildProjectSnapshot(
    projectRoot = process.cwd(),
    options: { registry?: ProviderRegistry } = {},
): Promise<ProjectSnapshot> {
    const cwd = resolve(projectRoot);
    const registry = options.registry ?? defaultRegistry;
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
    const effective = resolveToolchain(config, registry);

    // The validator answers "is this valid SysML?" and nothing else. Its
    // failures are `sysml` errors; a failure to *run* it is still an exception,
    // because a selected tool that is not there must never downgrade in silence.
    const validatorRun = await runValidator({ config, projectDir: cwd, registry });

    let ontologyRegistries: BuilderRegistries | undefined;
    try {
        const loadResult = await loadOntologyRegistries(cwd);
        if (loadResult.fileCount > 0) ontologyRegistries = loadResult.registries;
    } catch {
        // Snapshot generation remains available with reduced kind resolution.
    }

    // Lowering answers "what can MEMO ingest from this revision?". Its failures
    // are `memo-ingest` by construction — MEMO reporting the limits of its own
    // reading, not a verdict on the source. The rule this implements verbatim:
    //
    //   an internal-parser failure on source the validator accepted is a
    //   `memo-ingest` diagnostic, never a SysML error.
    //
    // `mergeDiagnostics` then collapses the duplicate when one provider filled
    // both roles, so a defect is reported once, in the domain with the most
    // authority.
    const loweringRun = await runLowering({ config, projectDir: cwd, registry });
    const { documents, parseErrors } = loweringRun;
    const diagnostics = mergeDiagnostics(validatorRun.diagnostics, loweringRun.diagnostics);

    const semanticModel = buildMemoModel(documents, config, parseErrors, ontologyRegistries);
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

    const model = modelToDTO(semanticModel, { viewpoints, architectureLayers, diagrams });

    // "Built" means lowering produced a model without ingest failures. A
    // revision that lowered cleanly becomes the new last good picture; one that
    // did not keeps the previous picture on screen next to its diagnostics.
    const lowered = loweringRun.accepted;
    if (lowered) lastGoodModel.set(cwd, model);
    const retained = lowered ? undefined : lastGoodModel.get(cwd);

    return {
        projectRoot: cwd,
        configPath,
        config,
        model: retained ?? model,
        validation,
        completeness,
        validator: effective.validator,
        lowering: effective.lowering,
        compiler: effective.validator,
        diagnostics,
        stale: retained !== undefined,
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
