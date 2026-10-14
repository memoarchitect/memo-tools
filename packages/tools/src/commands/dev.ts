// ─── memo-architect dev ────────────────────────────────────────────────────────────────
//
// Starts the development server:
//   1. bootstrap() — load config + ontology registries once (frozen after)
//   2. Start HTTP server (Vite middleware for web app + WebSocket)
//   3. Project watcher → rebuildProject() (hot reload)
//      Ontology watcher → notifyRestartRequired() (no model mutation)
// ─────────────────────────────────────────────────────────────────────────────

import { relative, resolve } from 'node:path';
import { existsSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execSync } from 'node:child_process';
import chalk from 'chalk';
import {
    modelToDTO, apiPackageMetadata, loadMethodologyDescriptor, deriveModelViews, collectApiConstraints,
    loadProjectSettings,
} from '@memoarchitect/tools';
import { sourceGraphToDTO, viewSourceFiles } from '@memoarchitect/tools';
import { buildSourceGraphFromPackages } from '../model/source-graph.js';
import { computeWorkspaceMembership, selectWorkspace, workspaceMembershipToDTO, type WorkspaceScope } from '../model/workspace-membership.js';
import type {
    BuilderRegistries, RestartRequiredMessage, MethodologyDescriptor, OntologyPackageInfo,
    EffectiveRule, ParseError, MemoModel,
} from '@memoarchitect/tools';
import { validateModel } from '@memoarchitect/tools';
import { computeCompleteness } from '@memoarchitect/tools';
import type {
    ServerMessage, ViewpointDTO, ArchLayerDTO, DiagramDTO, ModelMetadata, OntologyRegistriesDTO,
    EnumDefinitionDTO,
} from '@memoarchitect/tools';
import { createDevServer } from '../server/dev-server.js';
import { createProjectWatcher, createOntologyWatcher } from '../server/file-watcher.js';
import { layoutBlindRevision } from '../model/view-layout-block.js';
import { setReadOnlyRoots } from '../server/write-guard.js';
import { readLegacyLayouts } from '../model/view-layout-migration.js';
import { checkLockFile } from '../lock.js';
import { findSysmlFiles } from '../model/sysml-files.js';
import { enforceRuntimeBudget } from '../server/runtime-budget.js';
import { withToolchainOverrides } from '../toolchain/schema.js';
import { format } from 'node:util';
import type { CompileModelResult } from '../toolchain/registry.js';
import { sourceFingerprint } from '../toolchain/source-fingerprint.js';
import { newToken, removeDevServerRecord, writeDevServerRecord } from '../server/dev-validate.js';
import { createVersionServers } from '../server/version-servers.js';
import { compileDeviceDhf } from '../dhf/device-dhf.js';
import { evaluateWorkspaceGuide } from '../methodology/guide-service.js';
import { computeChangeImpact } from '../model/impact.js';
import { runValidation, validationExitCode, type ValidateOptions, type ValidationIO } from './validate.js';
import { compileResolvedProject } from '../toolchain/operations.js';
import { resolveToolchain } from '../toolchain/effective.js';
import { defaultRegistry } from '../toolchain/default-registry.js';
import { computeStandardsReport, readDeclaredRegimes } from '../dhf/standards-report.js';
import { loadStandardsLibrary } from '../dhf/standards-library.js';
import { loadProjectModel, stage1CacheDir, type ProjectModel } from '../toolchain/project-model.js';
import { apiEnumerations, apiProjectSourcePackages, resolutionLoads } from '../stage2/project-from-api.js';
import { outlinesFromHandoff } from '../authoring/outline-source.js';
import { outlineIdentityTable } from '../authoring/outline-identity.js';
import { discoverProjectSources } from '../model/native-project.js';
import { isRulePackageInScope, resolveProjectRules, scopedSubjectIds } from '../model/effective-scope.js';
import { isProjectSource } from '../stage2/project-from-api.js';
import { readClauseFacts, type ClauseFact } from '../validator/rule-clauses.js';
import type { RuleServiceContext } from '../server/rule-service.js';

/** Gather git info for model metadata */
function getGitInfo(cwd: string): Partial<ModelMetadata> {
    const git = (cmd: string) => {
        try {
            return execSync(cmd, {
                cwd,
                encoding: 'utf8',
                timeout: 3000,
                stdio: ['ignore', 'pipe', 'ignore'],
            }).trim();
        }
        catch { return undefined; }
    };
    const porcelain = git('git status --porcelain');
    return {
        gitUser: git('git config user.name') || undefined,
        gitBranch: git('git rev-parse --abbrev-ref HEAD') || undefined,
        gitCommitShort: git('git rev-parse --short HEAD') || undefined,
        gitDirty: porcelain ? true : undefined,
    };
}

/**
 * Strip stale relationship types from user diagrams, warn on any dropped.
 * Diagrams themselves are kept — only their stale relationshipType filter entries are removed.
 */
function validateDiagramsAgainstOntology(diagrams: DiagramDTO[], registries: BuilderRegistries): DiagramDTO[] {
    const rr = registries.relationshipRegistry;
    if (!rr) return diagrams;
    const knownRels = new Set(rr.relTypeNames());
    let droppedRels = 0;
    const result = diagrams.map(d => {
        if (!d.relationshipTypes || d.relationshipTypes.length === 0) return d;
        const filtered = d.relationshipTypes.filter(rt => {
            if (knownRels.has(rt)) return true;
            droppedRels++;
            return false;
        });
        return filtered.length !== d.relationshipTypes.length ? { ...d, relationshipTypes: filtered } : d;
    });
    if (droppedRels > 0) {
        console.warn(`[Validate] Stripped ${droppedRels} stale relationship type filter(s) from user diagrams.`);
    }
    return result;
}

/** Stable hash of ontology registries — stamped on every broadcast for stale-server detection */
function computeOntologyHash(registries: BuilderRegistries): string {
    const kr = registries.kindRegistry;
    const rr = registries.relationshipRegistry;
    const kindKeys = kr ? kr.kindNames().sort().join(',') : '';
    const relKeys = rr ? rr.relTypeNames().sort().join(',') : '';
    return createHash('sha256').update(`${kindKeys}|${relKeys}`).digest('hex').slice(0, 16);
}

export async function devCommand(options: {
    port?: number; open?: boolean; clientRoot: string;
    /** Stop 10 seconds after the last browser disconnects, unless one reconnects. */
    exitWhenIdle?: boolean;
    /** Client-owned rewrite of the HTML shell (see DevServerOptions). */
    transformClientHtml?: (html: string) => string;
    /** Exit with code 75 after a reusable-source change so an outer supervisor can relaunch. */
    supervisedRuntime?: boolean;
    /**
     * Parsed `--toolchain.*` options, exactly as commander produced them.
     *
     * The server takes the same overrides the CLI does, so a session started
     * with `--toolchain.validator=<provider>` draws from the same selection
     * `memo validate --toolchain.validator=<provider>` reports on. A capability
     * that exists only in one of them is a defect.
     */
    toolchainOptions?: Record<string, unknown>;
    /**
     * Serve this directory read-only (a pinned release or ref): the server refuses every message
     * that is not a read, runs no project or ontology watcher, and leaves no dev-server record.
     * The port may be 0; the bound one is reported to the parent over IPC, if there is one.
     */
    readOnly?: boolean;
    /** What a read-only server says about itself to each client. */
    pinned?: import('../protocol/messages.js').PinnedInfo;
    /** Where the person's role and workspace are read from, when not from this directory. */
    preferencesRoot?: string;
    /**
     * How a pinned view is started: the entry that runs `dev` and the flags that make the child look
     * the same (toolchain, experimental). Absent, the version selector offers no pinned view.
     */
    versionChild?: { entry: string; args: string[] };
}): Promise<void> {
    const bootstrapStartedAt = performance.now();
    const cwd = process.cwd();
    const port = options.readOnly ? (options.port ?? 0) : (options.port || 3000);
    const host = '127.0.0.1';

    console.log(chalk.bold('\n🚀 MEMO Dev Server\n'));

    // ── bootstrap: runs once ───────────────────────────────────────────────────
    // The native entrypoint defines the project. Tool settings are optional.
    const config = withToolchainOverrides(
        loadProjectSettings(cwd), options.toolchainOptions ?? {}, defaultRegistry);
    const toolchain = resolveToolchain(config, defaultRegistry);
    const gitInfo = getGitInfo(cwd);
    let buildCount = 0;
    console.log(chalk.gray(`Model: ${config.modelName}`));
    console.log(chalk.gray(
        `Toolchain: ${toolchain.selections.map(s => `${s.role === 'package' ? 'packager' : s.role}=${s.provider}`).join(' ')}`));
    for (const note of toolchain.deprecations) console.log(chalk.yellow(`  ⚠ ${note}`));

    // The compiler resolves the project from what it compiled, so MEMO parses
    // neither the ontology nor the closure; a stage 1 that reports an error
    // stops here, as it stops `memo validate`.
    let compiled: ProjectModel;
    try {
        compiled = await loadProjectModel({ projectRoot: cwd, config });
    } catch (error) {
        console.error(chalk.red(`\n❌ ${error instanceof Error ? error.message : error}\n`));
        process.exit(1);
    }
    console.log(chalk.gray(`Stage 1: ${toolchain.lowering} ${compiled.providerVersion ?? ''}${compiled.cached ? ' (reused .memo/stage1)' : ''}`));
    const nativeResolution = compiled.resolution ?? (() => {
        console.error(chalk.red(`\n❌ ${toolchain.lowering} resolved no project: no entrypoint was compiled.\n`));
        return process.exit(1);
    })();
    for (const d of nativeResolution.diagnostics) {
        console.log(chalk.yellow(`  ⚠ ${d.code}: ${d.message}`));
    }
    const lockCheck = checkLockFile(cwd, nativeResolution.selectedRoots.map(root => ({
        ...root, origin: 'ontology', importDepth: 1,
    })));
    if (!lockCheck.ok) {
        console.error(chalk.red(`\n❌ ${lockCheck.message}\n`));
        process.exit(1);
    }
    if (lockCheck.locked) {
        console.log(chalk.gray(`Ontology: locked to ${lockCheck.locked.ontology} v${lockCheck.locked.version}`));
    }

    // Load + freeze ontology registries — no mid-session mutation
    let ontologyRegistries: BuilderRegistries | undefined;
    let ontologyRoots: string[] = [];
    let provenance: import('@memoarchitect/tools').ProvenanceTable | undefined;
    let ontologyHash = '';

    if (compiled.registries) {
        ontologyRegistries = compiled.registries;
        ontologyRoots = [...new Set(nativeResolution.selectedRoots.map(root => root.sysmlDir))];
        provenance = compiled.registries.provenance;
        if (ontologyRegistries.kindRegistry) Object.freeze(ontologyRegistries.kindRegistry);
        if (ontologyRegistries.relationshipRegistry) Object.freeze(ontologyRegistries.relationshipRegistry);
        ontologyHash = computeOntologyHash(ontologyRegistries);
        console.log(chalk.gray(
            `Ontology: ${ontologyRegistries.kindRegistry?.size ?? 0} kinds, `
            + `${ontologyRegistries.relationshipRegistry?.size ?? 0} relationships (from ${toolchain.lowering}'s handoff)`));
    } else {
        console.log(chalk.yellow(`  ⚠ ${toolchain.lowering}'s handoff stated no ontology registries`));
    }

    // Phase B — methodology descriptor (data-only; no UI consumer yet)
    let methodologyDescriptor: MethodologyDescriptor = { folders: [], errors: [] };
    try {
        methodologyDescriptor = await loadMethodologyDescriptor(cwd, nativeResolution, compiled.api);
        const folderCount = methodologyDescriptor.folders.length;
        const totalParts = methodologyDescriptor.folders.reduce(
            (s, f) => s + Object.values(f.parts).reduce((a, p) => a + p.length, 0), 0,
        );
        const totalDefs = methodologyDescriptor.folders.reduce((s, f) => s + f.partDefs.length, 0);
        const namespaces = new Set<string>();
        const totalFiles = methodologyDescriptor.folders.reduce((s, f) => s + f.sourceFiles.length, 0);
        for (const f of methodologyDescriptor.folders) {
            for (const ns of f.namespaces) namespaces.add(ns);
        }
        if (folderCount > 0) {
            console.log(chalk.gray(
                `Methodology: ${folderCount} folder(s), ${totalFiles} file(s), ${namespaces.size} namespace(s), ` +
                `${totalDefs} part defs, ${totalParts} part instances ` +
                `(${methodologyDescriptor.folders.map(f => f.name).join(', ')})`
            ));
        }
        for (const err of methodologyDescriptor.errors) {
            console.log(chalk.yellow(`  ⚠ methodology: ${err}`));
        }
    } catch (e) {
        console.log(chalk.yellow(`  ⚠ Could not load methodology descriptor: ${e instanceof Error ? e.message : e}`));
    }
    // ── end bootstrap ──────────────────────────────────────────────────────────

    // ── rebuildProject: hot path — no ontology reload ─────────────────────────
    /** Revision of the newest rebuild that parsed — what a client is still showing. */
    let lastGoodRevision = 0;
    /**
     * What the last accepted stage 1 built: a rejected edit leaves the model,
     * its identities, rules and registries where the last valid revision put
     * them. There is no second opinion to fall back on.
     */
    /** The project as last built, for previewing and writing a user's rule. */
    let ruleContext: RuleServiceContext | undefined;
    let latestClauses: ClauseFact[] = [];
    let lastPackages: OntologyPackageInfo[] = [];
    let lastAccepted: {
        model: MemoModel; irIdentities: Record<string, string>;
        constraints: ReturnType<typeof collectApiConstraints>; registries?: BuilderRegistries;
        sourceGraph: ReturnType<typeof buildSourceGraphFromPackages>; enumerations: EnumDefinitionDTO[];
        /** The handoff the model was built from, which the Guide reads the method's steps from. */
        api?: import('../stage2/api-model.js').ApiModel;
    } | undefined;
    // The newest compile, with the fingerprint of the sources it read (taken
    // before it ran): what `memo validate` is answered from while the
    // fingerprint still matches the files on disk.
    let latestCompile: { fingerprint: string; stage1: CompileModelResult } | undefined;
    /** The layout-blind revision of every source file as of the last rebuild. */
    let lastSourceHashes: Record<string, string> = {};
    async function rebuildProject(changedFiles?: readonly string[]): Promise<{
        messages: ServerMessage[]; revision: number; coherent: boolean; firstErrorFile?: string;
        errors: readonly ParseError[];
    }> {
        const rebuildStartedAt = performance.now();
        buildCount++;
        const sysmlFiles = findSysmlFiles(cwd);
        let errors: ParseError[] = [];
        // `toolchain.compiler` decides where the model comes from. A stage 1
        // that reports errors makes this build incoherent, so a client keeps
        // showing the last good one.
        // The same resolved compile every command runs, reusing `.memo/stage1/`.
        const fingerprint = sourceFingerprint(cwd);
        const stage1 = await compileResolvedProject({ config, projectDir: cwd, cacheDir: stage1CacheDir(cwd) });
        latestCompile = { fingerprint, stage1 };
        // The methodology follows the project's imports, which an edit can
        // change: from the compiled resolution.
        try {
            if (stage1.api) methodologyDescriptor = await loadMethodologyDescriptor(cwd, stage1.resolution, stage1.api);
        } catch {
            // keep last good descriptor on transient parse failure
        }
        if (!stage1.accepted || !stage1.model) {
            errors = [...errors, ...stage1.diagnostics.filter(d => d.severity === 'error').map(d => ({
                file: d.file ?? '', line: d.range?.start.line, message: d.message, code: d.code,
            }))];
        }
        const accepted = stage1.accepted && stage1.model && stage1.api;
        const kept = !accepted ? lastAccepted : undefined;
        // A rejected first build has nothing to keep: the dev server starts only
        // from a valid project, so `lastAccepted` is set by the bootstrap compile.
        if (!accepted && !kept) throw new Error('No accepted build to show');
        const model = accepted ? stage1.model! : kept!.model;
        // Identities for the authoring write-back: each element's declaration in
        // its file's outline (plans/memo-write-back-from-handoff.md), read from
        // the handoff stage 1 built the model from.
        const irIdentities = kept?.irIdentities ?? outlineIdentityTable(
            outlinesFromHandoff(resolve(cwd), stage1.api!),
            model.elements.values(),
            resolve(cwd),
        );
        // An accepted stage 1 carries the ontology it resolved, rules included,
        // so they are read from its handoff rather than from MEMO's own parse.
        // The rules resolution loads, and the project's own: a rule the project
        // wrote in a file nothing imports still runs, as in `memo validate`.
        const resolutionOf = stage1.resolution ?? nativeResolution;
        const ruleFileLoaded = resolutionOf
            ? (file: string) => resolutionLoads(resolutionOf)(file) || isProjectSource(resolutionOf)(file)
            : undefined;
        // No write may land in a package the model depends on: it is shown, linked to, and changed elsewhere.
        setReadOnlyRoots([...(resolutionOf?.closure.values() ?? [])]
            .filter(pkg => pkg.origin === 'dependency' && pkg.root)
            .flatMap(pkg => [pkg.root!.dir, pkg.root!.sysmlDir]));
        const nativeConstraints = accepted
            ? collectApiConstraints(stage1.api!, undefined, stage1.resolution?.filePackages, ruleFileLoaded)
            : kept!.constraints;
        // An accepted stage 1 states the ontology with the project's own kinds.
        const stage2Registries: BuilderRegistries | undefined = accepted && stage1.registries
            ? stage1.registries
            : kept?.registries;
        // The effective rule set, activated and tailored as `memo validate` and
        // `memo validate --rules` do it (`resolveProjectRules`), so Architect reports
        // the rule set they do. Rule resolution must never take the rebuild down:
        // a bad policy is a diagnostic about the methodology, not a reason the
        // model cannot be shown.
        let validation: ReturnType<typeof validateModel>;
        // Which workspace holds each element; also validated per workspace below, so a client shows a
        // workspace's problems from the same computation `memo validate --workspace` runs.
        const membership = stage2Registries?.kindRegistry && stage2Registries.relationshipRegistry
            ? computeWorkspaceMembership(model, stage2Registries)
            : undefined;
        const validateWorkspaces = (run: (workspace?: WorkspaceScope) => ReturnType<typeof validateModel>) => {
            if (!membership || membership.missingSystem) return;
            const byWorkspace: Record<string, ReturnType<typeof validateModel>> = {};
            for (const workspace of membership.workspaces) {
                const selection = selectWorkspace(model, membership, workspace.root);
                if (selection.ok) byWorkspace[workspace.root] = run(selection.scope);
            }
            validation.byWorkspace = byWorkspace;
        };
        const effectiveRuleSet = (() => {
            try {
                const kindRegistry = stage2Registries?.kindRegistry;
                const filePackages = resolutionOf?.filePackages ?? new Map<string, string>();
                const { rules: resolved, scope } = resolveProjectRules({
                    constraints: nativeConstraints,
                    effective: methodologyDescriptor.effective,
                    filePackages,
                    kindSourceFile: kind => kindRegistry?.getKind(kind)?.sourceFile,
                    isOwnFile: resolutionOf ? isProjectSource(resolutionOf) : undefined,
                });
                // Scope decides which elements rules RUN ON, not the model they navigate.
                const inScopeIds = scope && scope.mode !== 'allAvailable'
                    ? scopedSubjectIds(model, kind => {
                        const sourceFile = kindRegistry?.getKind(kind)?.sourceFile;
                        const declaringPackage = sourceFile ? filePackages.get(sourceFile) : undefined;
                        return !declaringPackage || isRulePackageInScope(scope, declaringPackage);
                    })
                    : undefined;
                const runRules = (workspace?: WorkspaceScope) => validateModel(
                    model, resolved.activeConstraints, kindRegistry, resolved.rules,
                    inScopeIds && (element => inScopeIds.has(element.id)), workspace, membership);
                validation = runRules();
                validateWorkspaces(runRules);
                return { rules: resolved.rules, diagnostics: resolved.diagnostics };
            } catch (error) {
                const runNative = (workspace?: WorkspaceScope) =>
                    validateModel(model, nativeConstraints, stage2Registries?.kindRegistry, undefined, undefined, workspace, membership);
                validation = runNative();
                validateWorkspaces(runNative);
                return {
                    rules: [] as EffectiveRule[],
                    diagnostics: [{
                        code: 'resolution-failed' as const,
                        message: error instanceof Error ? error.message : String(error),
                    }],
                };
            }
        })();
        // The clauses the model carries, to name and choose what a rule enforces.
        // Only an accepted stage 1 states them; a rejected edit keeps the last.
        if (accepted) latestClauses = readClauseFacts(stage1.api!);
        const projectSourceFiles = discoverProjectSources(cwd).projectFiles;
        (effectiveRuleSet as Record<string, unknown>).clauses = latestClauses;
        (effectiveRuleSet as Record<string, unknown>).projectFiles = projectSourceFiles
            .map(file => relative(cwd, file).replaceAll('\\', '/')).sort();
        ruleContext = {
            projectRoot: cwd, config, model, kindRegistry: stage2Registries?.kindRegistry,
            constraints: nativeConstraints, clauses: latestClauses, projectFiles: new Set(projectSourceFiles.map(file => resolve(file))),
        };
        const completeness = computeCompleteness(model, validation);

        console.log(chalk.cyan(
            `  ${model.elements.size} elements, ${model.relationships.length} relationships, ` +
            `${validation.violations.length} violations, ${completeness.overall}% complete`
        ));

        // Viewpoints are native `viewpoint def` packages. The `viewpoints:`
        // settings block that used to supply them is gone: a portable view's
        // content cannot depend on a file the model does not carry.
        const viewpoints: ViewpointDTO[] = [];

        // Views modelled in SysML (DiagramView/DocumentView usages) surface as
        // viewpoint-grouped auto diagrams.
        const derivedViews = deriveModelViews(model, stage2Registries?.kindRegistry);
        viewpoints.push(...derivedViews.viewpoints);

        const diagrams: DiagramDTO[] = [];
        diagrams.push(...derivedViews.diagrams);

        // Layer presentation comes from the ontology's own `LayerRendering`
        // usages, published with the package metadata.
        const architectureLayers: ArchLayerDTO[] | undefined = undefined;

        const baseVersion = nativeResolution.selectedRoots[0]?.packageVersion || '0.1.0';
        const metadata: ModelMetadata = {
            modelName: config.modelName,
            projectName: config.modelName,   // deprecated alias, deleted in 0.15.0
            version: `${baseVersion}-dev.${buildCount}`,
            ...gitInfo,
        };

        const userDiagramsPath = resolve(cwd, '.memo', 'user-diagrams.json');
        if (existsSync(userDiagramsPath)) {
            try {
                const rawUserDiagrams = JSON.parse(readFileSync(userDiagramsPath, 'utf8')) as DiagramDTO[];
                const validUserDiagrams = stage2Registries
                    ? validateDiagramsAgainstOntology(rawUserDiagrams, stage2Registries)
                    : rawUserDiagrams;
                diagrams.push(...validUserDiagrams);
            } catch {
                // ignore corrupt file
            }
        }

        // Ship the ontology registries with the model so the client resolves
        // relationship legality from the ontology, not a hardcoded table.
        const registriesDTO: OntologyRegistriesDTO | undefined = stage2Registries
            ? {
                relationships: stage2Registries.relationshipRegistry?.toDefinitionDTOs() ?? [],
                kinds: stage2Registries.kindRegistry?.toDefinitionDTOs() ?? [],
            }
            : undefined;

        // Which files can change what each view renders. Computed once per
        // rebuild so every client can answer "does this change affect me?"
        // locally, without a round trip per changed file.
        // From the handoff stage 1 built the model from.
        const sourceGraph = accepted
            ? (() => {
                const { packages, files } = apiProjectSourcePackages(stage1.api!, resolve(cwd));
                return buildSourceGraphFromPackages(packages, files);
            })()
            : kept!.sourceGraph;
        const enumerations = accepted ? apiEnumerations(stage1.api!) : kept!.enumerations;
        if (accepted) {
            lastAccepted = { model, irIdentities, constraints: nativeConstraints, registries: stage2Registries, sourceGraph, enumerations, api: stage1.api };
        }
        for (const diagram of diagrams) {
            diagram.sourceFiles = viewSourceFiles(diagram, model.elements, sourceGraph);
        }

        lastSourceHashes = Object.fromEntries(sysmlFiles.map(file => [
            relative(cwd, file).replaceAll('\\', '/'),
            layoutBlindRevision(readFileSync(file, 'utf8')),
        ]));
        const dto = modelToDTO(model, {
            viewpoints, architectureLayers, diagrams, registries: registriesDTO,
            revision: buildCount,
            sourceGraph: sourceGraphToDTO(sourceGraph),
            irIdentities,
            sourceHashes: lastSourceHashes,
            enumerations,
            workspaceMembership: membership ? workspaceMembershipToDTO(membership, model) : undefined,
        });
        // Compute the clause coverage report and attach it to the model DTO
        // so the Architect can badge document cards with gap counts without a
        // second request. Same computation as `memo validate --standards`.
        try {
            const library = loadStandardsLibrary(cwd);
            const kindRegistry = stage2Registries?.kindRegistry;
            const declared = readDeclaredRegimes(model, kindRegistry);
            dto.standardsReport = computeStandardsReport({
                library,
                model,
                kindRegistry,
                regimes: declared.regimes,
                regimeSource: declared.regimes.length > 0 ? 'project' : 'none',
            });
        } catch {
            // Standards library not found or failed to load — not a build error.
            // The Architect falls back to showing no gap badges.
        }
        dto.metadata = metadata;
        (dto as any).ontologyHash = ontologyHash;

        // The packages of the last accepted build: a rejected edit keeps them.
        if (accepted) {
            lastPackages = apiPackageMetadata(
                stage1.api!, cwd, new Set(nativeResolution.selectedRoots.map(root => root.dir)), resolutionOf?.filePackages);
        }
        const ontologyPackages = lastPackages;

        if (errors.length === 0) lastGoodRevision = buildCount;
        const result: {
            messages: ServerMessage[]; revision: number; coherent: boolean; firstErrorFile?: string;
            errors: readonly ParseError[];
        } = {
            revision: buildCount,
            coherent: errors.length === 0,
            firstErrorFile: errors[0]?.file,
            errors,
            messages: [
                { type: 'model:update', payload: dto },
                { type: 'validation:update', payload: validation },
                { type: 'completeness:update', payload: completeness },
                { type: 'ontology:packages', payload: { packages: ontologyPackages, ontologyHash } as any },
                { type: 'methodology:update', payload: methodologyDescriptor },
                // The effective rule set is governance data (section 10.4):
                // which rules are active, at what severity, under whose
                // authority. The rule-policy editor reads it to know what may
                // be tailored — an invariant is not offered as an option
                // rather than being refused after the fact.
                { type: 'rules:update', payload: effectiveRuleSet },
            ],
        };
        if (changedFiles !== undefined) {
            const budget = enforceRuntimeBudget('incrementalProjectRebuild', performance.now() - rebuildStartedAt);
            console.log(chalk.gray(`  Incremental rebuild: ${budget.elapsedMs.toFixed(0)}ms / ${budget.budgetMs}ms`));
        }
        return result;
    }

    const sysmlCount = findSysmlFiles(cwd).length;
    if (sysmlCount === 0) {
        console.log(chalk.yellow('  ⚠ No .sysml files found in this directory.'));
        console.log(chalk.gray('  Create model files in a model/ subdirectory, or run:'));
        console.log(chalk.gray('    memo-architect init <project-name>'));
        console.log(chalk.gray('    memo-architect import template elements\n'));
    }
    console.log(chalk.gray('  Building model...'));
    const initial = await rebuildProject();
    // Layouts moved into their views; a sidecar left behind is no longer read.
    try {
        const leftover = readLegacyLayouts(cwd);
        if (leftover.length > 0) {
            console.log(chalk.yellow(
                `  ⚠ ${leftover.length} diagram layout(s) in .viewlayout files are no longer read. `
                + 'Run `memo-architect migrate-layout` to move them into their views.'));
        }
    } catch { /* a warning, never a reason not to serve */ }

    let shuttingDown = false;
    let idleShutdownTimer: ReturnType<typeof setTimeout> | undefined;
    let projectWatcher: ReturnType<typeof createProjectWatcher> | undefined;
    let ontologyWatcher: ReturnType<typeof createOntologyWatcher> | undefined;

    const shutdown = (reason: string) => {
        if (shuttingDown) return;
        shuttingDown = true;
        if (idleShutdownTimer) clearTimeout(idleShutdownTimer);
        console.log(chalk.gray(`\n  ${reason}`));
        if (layoutSettleTimer) clearTimeout(layoutSettleTimer);
        projectWatcher?.close();
        ontologyWatcher?.close();
        versions?.close();
        removeDevServerRecord(cwd);
        server.close();
        process.exit(0);
    };

    // Compiles run one at a time, whether a save or a `memo validate` asked.
    let compileChain: Promise<unknown> = Promise.resolve();
    const serialized = <T>(run: () => Promise<T>): Promise<T> => {
        const next = compileChain.then(run, run);
        compileChain = next.then(() => undefined, () => undefined);
        return next;
    };
    // `memo validate`, answered from the model held here (server/dev-validate.ts).
    // The settings are read once, at startup: changed since, this process is
    // not the one to validate them, and the caller validates on its own.
    const settingsAtStart = JSON.stringify(loadProjectSettings(cwd));
    const validateToken = newToken();
    const validateHere = (validateOptions: ValidateOptions) => serialized(async () => {
        if (JSON.stringify(loadProjectSettings(cwd)) !== settingsAtStart) {
            throw new Error('the project settings changed since memo dev started');
        }
        if (latestCompile?.fingerprint !== sourceFingerprint(cwd)) await rebuildAndPublish([]);
        const held = latestCompile;
        if (!held) throw new Error('memo dev holds no compile');
        let stdout = '';
        let stderr = '';
        const io: ValidationIO = {
            out: (...args) => { stdout += format(...args) + '\n'; },
            err: (...args) => { stderr += format(...args) + '\n'; },
            write: text => { stdout += text; },
        };
        const exitCode = await validationExitCode(() => runValidation(cwd, validateOptions, io, async () => held.stage1));
        return { exitCode, stdout, stderr };
    });

    // Start dev server
    const versions = options.versionChild && !options.readOnly
        ? createVersionServers({
            projectRoot: cwd, entry: options.versionChild.entry, args: options.versionChild.args,
            workingModel: () => lastAccepted?.model, workingUrl: () => `http://${host}:${workingPort}`,
            toolchain: config.toolchain,
        })
        : undefined;
    let workingPort = port;
    const devices = options.readOnly ? undefined : {
        generate: (device: string) => {
            if (!lastAccepted) throw new Error('the working model is not built yet');
            return compileDeviceDhf({
                projectRoot: cwd, working: { model: lastAccepted.model, registries: lastAccepted.registries },
                device, outputDir: resolve(cwd, 'dhf-output'), config: { toolchain: config.toolchain },
            });
        },
    };
    // Where the model stands against its method, for one workspace. Read-only: it writes nothing.
    const guide = {
        evaluate: (workspace?: string) => {
            if (!lastAccepted?.api || !lastAccepted.registries) throw new Error('the working model is not built yet');
            const packages = (methodologyDescriptor.effective?.chain ?? []).map(m => m.packageQualifiedName).filter((p): p is string => !!p);
            return evaluateWorkspaceGuide({
                api: lastAccepted.api, model: lastAccepted.model, registries: lastAccepted.registries,
                constraints: lastAccepted.constraints, packages, workspace,
            });
        },
    };
    // What the working tree's change reaches, measured from the commit it branched from (T11).
    const impact = options.readOnly ? undefined : {
        compute: (target?: string) => {
            if (!lastAccepted?.api || !lastAccepted.registries) throw new Error('the working model is not built yet');
            const packages = (methodologyDescriptor.effective?.chain ?? []).map(m => m.packageQualifiedName).filter((p): p is string => !!p);
            return computeChangeImpact({
                projectRoot: cwd, target,
                head: { model: lastAccepted.model, registries: lastAccepted.registries, api: lastAccepted.api, constraints: lastAccepted.constraints, packages },
                build: { config: { toolchain: config.toolchain } },
            });
        },
    };
    const server = await createDevServer({
        impact,
        guide,
        devices,
        versions,
        readOnly: options.readOnly,
        pinned: options.pinned,
        preferencesRoot: options.preferencesRoot,
        validate: validateHere,
        validateToken,
        port,
        projectRoot: cwd,
        webPackagePath: options.clientRoot,
        initialMessages: initial.messages,
        ruleContext: () => ruleContext,
        ontologyRegistries,
        ontologyRoots,
        packageMetadata: () => lastPackages,
        relationshipFiles: config.relationshipFiles,
        canonicalRelationshipFile: config.canonicalRelationshipFile,
        transformClientHtml: options.transformClientHtml,
        onClientCountChanged: (count) => {
            if (!options.exitWhenIdle) return;
            if (count > 0) {
                if (idleShutdownTimer) clearTimeout(idleShutdownTimer);
                idleShutdownTimer = undefined;
                return;
            }
            if (!idleShutdownTimer) {
                console.log(chalk.gray('  No browser clients remain; shutting down in 10 seconds unless one reconnects.'));
                idleShutdownTimer = setTimeout(() => {
                    idleShutdownTimer = undefined;
                    shutdown('No browser clients reconnected; shutting down.');
                }, 10_000);
            }
        },
    });

    // Say where `memo validate` can find this model. Not when this run names a
    // toolchain of its own: a plain `memo validate` would then be answered by
    // another compiler than the settings select.
    const ownToolchain = Object.values(options.toolchainOptions ?? {}).some(value => value !== undefined);
    if (!ownToolchain && !options.readOnly) {
        writeDevServerRecord({ pid: process.pid, url: `http://${host}:${port}`, token: validateToken, projectRoot: cwd });
        process.once('exit', () => removeDevServerRecord(cwd));
    }

    if (!initial.coherent) {
        // Starting on a project that does not parse is allowed — the user
        // opened Architect precisely to see and fix it. There is no last good
        // model yet, so what ships is whatever parsed, flagged as partial.
        server.setSourceCoherence({
            coherent: false,
            files: [...new Set(initial.errors.map(error => error.file))],
            diagnostics: initial.errors.map(error => ({
                file: error.file, message: error.message, line: error.line, column: error.column,
            })),
            lastGoodRevision,
        });
    }

    const restartStartedAt = Number(process.env.MEMO_RUNTIME_RESTART_STARTED_AT);
    const budgetPath = Number.isFinite(restartStartedAt) && restartStartedAt > 0
        ? 'supervisedRestart' : 'coldBootstrap';
    const elapsed = budgetPath === 'supervisedRestart'
        ? Date.now() - restartStartedAt
        : performance.now() - bootstrapStartedAt;
    const runtimeBudget = enforceRuntimeBudget(budgetPath, elapsed);
    console.log(chalk.gray(`  ${budgetPath}: ${runtimeBudget.elapsedMs.toFixed(0)}ms / ${runtimeBudget.budgetMs}ms`));

    const boundPort = options.readOnly ? server.port : port;
    workingPort = boundPort;
    console.log(chalk.green(`\n  ➜ http://${host}:${boundPort}\n`));
    // A pinned server is a child of the server that opened it: it tells that parent where it is, and
    // goes when the parent does.
    if (options.readOnly && process.send) {
        process.send({ type: 'memo:read-only-ready', url: `http://${host}:${boundPort}` });
        process.once('disconnect', () => process.exit(0));
    }

    // ── notifyRestartRequired: ontology watcher callback ───────────────────────
    // Declared after server so it can reference server directly.
    function notifyRestartRequired(
        reason: RestartRequiredMessage['reason'],
        changedFile: string
    ): void {
        const msg: RestartRequiredMessage = {
            type: 'app:restart-required',
            reason,
            changedFile,
            instruction: reason === 'dependency-closure-uncomputable'
                ? 'Fix the source diagnostic, then Relaunch Memo Architect. Model mutations are locked until a coherent workspace can be rebuilt.'
                : reason === 'transaction-independence-uncomputable'
                    ? 'Repeated external writes overlapped a server transaction. Model mutations are locked while Memo Architect relaunches from disk.'
                : options.supervisedRuntime
                    ? 'The model runtime is rebuilding from disk; Architect will reconnect automatically.'
                    : 'Stop Architect (Ctrl+C) and start it again to apply reusable semantic changes.',
        };
        server.lockMutations(msg);
        process.stderr.write(
            chalk.yellow(`\n  ⚠ Ontology changed (${changedFile}) — restart required. Changes ignored until restart.\n\n`)
        );
        if (options.supervisedRuntime) {
            // Give the WebSocket publication a chance to flush, then release
            // the port and all watchers before asking the supervisor to start
            // a fresh frozen semantic environment.
            setTimeout(() => {
                projectWatcher?.close();
                ontologyWatcher?.close();
                server.close();
                process.exit(75);
            }, 50);
        }
    }

    // Project watcher — hot reload. Not in a read-only server: the directory is a pinned commit and
    // does not change under it.
    //
    // The rebuild is broadcast together with the list of files that caused it,
    // so open editors and views can tell whether the change was theirs instead
    // of refreshing on every unrelated save.
    // A burst of saves may arrive during a semantic rebuild. Rebuilds own a
    // complete AST/model snapshot, so serialize and coalesce them to avoid
    // concurrent heap spikes while preserving coherent publications.
    let rebuildInFlight = false;
    const pendingRebuildFiles = new Set<string>();
    const rebuildAndPublish = async (changedFiles: string[]) => {
        const transactions = server.consumeWriteTransactions(changedFiles);
        if (transactions.escalationFile) {
            notifyRestartRequired('transaction-independence-uncomputable', transactions.escalationFile);
            return;
        }
        const summary = changedFiles.length === 1
            ? changedFiles[0]
            : `${changedFiles.length} files`;
        console.log(chalk.gray(`  [${new Date().toLocaleTimeString()}] Rebuilding (${summary})...`));
        const result = await rebuildProject(changedFiles);
        if (!result.coherent) {
            // Saving a file that does not parse is an ordinary working state.
            // Withhold the degraded model so every client keeps the last good
            // scene, publish the diagnostics against it, and wait: the next
            // clean save clears this by itself. Escalating to restart-required
            // here made a typo cost a relaunch.
            server.setSourceCoherence({
                coherent: false,
                files: [...new Set(result.errors.map(error => error.file))],
                diagnostics: result.errors.map(error => ({
                    file: error.file, message: error.message, line: error.line, column: error.column,
                })),
                lastGoodRevision,
            });
            console.log(chalk.yellow(
                `  ⚠ ${result.firstErrorFile ?? 'project source'} does not compile — showing the last good model`
                + ` (revision ${lastGoodRevision}). Mutations are held until it does.`
            ));
            return;
        }
        server.setSourceCoherence({ coherent: true, files: [], diagnostics: [], lastGoodRevision });
        server.broadcast(result.messages, changedFiles);
        server.notify([{
            type: 'source:changed',
            payload: {
                files: changedFiles, revision: result.revision, at: Date.now(),
                serverTransactions: transactions.matched,
            },
        }]);
    };
    // A layout is saved at the end of a drag, into the view that declares it. Such a
    // write changes no model fact, so it does not rebuild at once: the clients that
    // did not make it are given the new layout, and one rebuild follows when the
    // saves stop. That rebuild is not for the model's sake but for the source
    // ranges the compile recorded, which a block of statements shifts for every
    // declaration after it in the file.
    const LAYOUT_SETTLE_MS = 2500;
    let layoutSettleTimer: ReturnType<typeof setTimeout> | undefined;
    const settlingLayoutFiles = new Set<string>();
    const runRebuilds = async (files: readonly string[]) => {
        for (const file of files) pendingRebuildFiles.add(file);
        if (rebuildInFlight) return;
        rebuildInFlight = true;
        try {
            while (pendingRebuildFiles.size > 0) {
                const nextFiles = [...pendingRebuildFiles].sort();
                pendingRebuildFiles.clear();
                await serialized(() => rebuildAndPublish(nextFiles));
            }
        } finally {
            rebuildInFlight = false;
        }
    };
    if (!options.readOnly) projectWatcher = createProjectWatcher(cwd, async (changedFiles) => {
        const layoutOnly = changedFiles.filter(file => {
            const known = lastSourceHashes[file.replaceAll('\\', '/')];
            const path = resolve(cwd, file);
            return known !== undefined && existsSync(path) && layoutBlindRevision(readFileSync(path, 'utf8')) === known;
        });
        const rest = changedFiles.filter(file => !layoutOnly.includes(file));
        if (layoutOnly.length > 0) {
            const mine = server.consumeWriteTransactions(layoutOnly).matched;
            const outside = layoutOnly.filter(file => !(file.replaceAll('\\', '/') in mine));
            if (outside.length > 0) server.refreshLayouts(outside);
            // Whatever else changed in the same burst rebuilds anyway, and that
            // rebuild covers these files; otherwise settle first.
            if (rest.length === 0) {
                for (const file of layoutOnly) settlingLayoutFiles.add(file);
                if (layoutSettleTimer) clearTimeout(layoutSettleTimer);
                layoutSettleTimer = setTimeout(() => {
                    const files = [...settlingLayoutFiles];
                    settlingLayoutFiles.clear();
                    void runRebuilds(files);
                }, LAYOUT_SETTLE_MS);
                return;
            }
        }
        await runRebuilds(rest.length > 0 ? changedFiles : []);
    }, 300, false, { ontologyRoots, provenance });

    // Ontology watcher — restart notification only, no registry reload
    if (!options.readOnly) ontologyWatcher = createOntologyWatcher(
        cwd,
        ontologyRoots,
        (changedFile) => notifyRestartRequired('ontology-source-changed', changedFile),
        300,
        provenance,
    );

    // Open browser
    if (options.open !== false) {
        const openModule = await import('open');
        openModule.default(`http://${host}:${port}`);
    }

    for (const signal of ['SIGINT', 'SIGTERM'] as const) {
        process.once(signal, () => shutdown('Shutting down...'));
    }
}
