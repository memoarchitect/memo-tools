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
    IncrementalProjectParser, buildMemoModel, modelToDTO,
    loadOntologyRegistries, getPackageMetadata, loadMethodologyDescriptor, resolveNativeProject,
    deriveModelViews, resolveViewKind, collectNativeConstraints, collectApiConstraints,
    handoffFileOf, loadProjectSettings, resolveEffectiveRules, ruleCandidatesFromConstraints,
} from '@memoarchitect/tools';
import { buildSourceGraph, sourceGraphToDTO, viewSourceFiles } from '@memoarchitect/tools';
import { buildSourceGraphFromPackages } from '../model/source-graph.js';
import type {
    BuilderRegistries, RestartRequiredMessage, MethodologyDescriptor, ParsedDocument,
    EffectiveRule, ParseError,
} from '@memoarchitect/tools';
import { validateModel } from '@memoarchitect/tools';
import { computeCompleteness } from '@memoarchitect/tools';
import type {
    ServerMessage, ViewpointDTO, ArchLayerDTO, DiagramDTO, ModelMetadata, OntologyRegistriesDTO,
    EnumDefinitionDTO,
} from '@memoarchitect/tools';
import { createDevServer } from '../server/dev-server.js';
import { createProjectWatcher, createOntologyWatcher } from '../server/file-watcher.js';
import { checkLockFile } from '../lock.js';
import { findSysmlFiles } from '../model/sysml-files.js';
import { enforceRuntimeBudget } from '../server/runtime-budget.js';
import { withToolchainOverrides } from '../toolchain/schema.js';
import { compileResolvedProject, selectedCompilerBuildsModel } from '../toolchain/operations.js';
import { resolveToolchain } from '../toolchain/effective.js';
import { defaultRegistry } from '../toolchain/default-registry.js';
import { computeStandardsReport, readDeclaredRegimes } from '../dhf/standards-report.js';
import { loadStandardsLibrary } from '../dhf/standards-library.js';
import { loadProjectModel, stage1CacheDir, type ProjectModel } from '../toolchain/project-model.js';
import { apiEnumerations, apiProjectSourcePackages, resolutionLoads } from '../stage2/project-from-api.js';
import { outlinesFromDocuments, outlinesFromHandoff } from '../authoring/outline-source.js';
import { outlineIdentityTable } from '../authoring/outline-identity.js';

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

/** Presentation enums are model facts, so ship their literal sets to the canvas. */
function collectEnumerations(documents: readonly ParsedDocument[]): EnumDefinitionDTO[] {
    const found = new Map<string, EnumDefinitionDTO>();
    const visit = (member: any): void => {
        if (member?.$type === 'EnumDefinition' && member.name) {
            found.set(member.name, { name: member.name, literals: (member.literals ?? []).map((literal: any) => literal.name).filter(Boolean) });
        }
        for (const child of member?.members ?? []) visit(child);
    };
    for (const document of documents) for (const member of document.document.parseResult.value.members) visit(member);
    return [...found.values()];
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
     * with `--toolchain.validator=syside` draws from the same selection
     * `memo validate --toolchain.validator=syside` reports on. A capability
     * that exists only in one of them is a defect.
     */
    toolchainOptions?: Record<string, unknown>;
}): Promise<void> {
    const bootstrapStartedAt = performance.now();
    const cwd = process.cwd();
    const port = options.port || 3000;
    const host = '127.0.0.1';

    console.log(chalk.bold('\n🚀 MEMO Dev Server\n'));

    // ── bootstrap: runs once ───────────────────────────────────────────────────
    // The native entrypoint defines the project. Tool settings are optional.
    const config = withToolchainOverrides(
        loadProjectSettings(cwd), options.toolchainOptions ?? {}, defaultRegistry);
    const toolchain = resolveToolchain(config, defaultRegistry);
    const gitInfo = getGitInfo(cwd);
    let buildCount = 0;
    console.log(chalk.gray(`Project: ${config.projectName}`));
    console.log(chalk.gray(
        `Toolchain: validator=${toolchain.validator} lowering=${toolchain.lowering} `
        + `packager=${toolchain.packager}`));
    for (const note of toolchain.deprecations) console.log(chalk.yellow(`  ⚠ ${note}`));

    // A compiler that builds the model resolves the project from what it
    // compiled, so MEMO parses neither the ontology nor the closure; a stage 1
    // that reports an error stops here, as it stops `memo validate`.
    const external = selectedCompilerBuildsModel(config, defaultRegistry);
    let compiled: ProjectModel | undefined;
    if (external) {
        try {
            compiled = await loadProjectModel({ projectRoot: cwd, config });
        } catch (error) {
            console.error(chalk.red(`\n❌ ${error instanceof Error ? error.message : error}\n`));
            process.exit(1);
        }
        console.log(chalk.gray(`Stage 1: ${toolchain.lowering} ${compiled.providerVersion ?? ''}${compiled.cached ? ' (reused .memo/stage1)' : ''}`));
    }
    const nativeResolution = compiled?.resolution ?? await resolveNativeProject(cwd);
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
    let ontologyDocuments: ParsedDocument[] = [];
    let ontologyHash = '';

    if (compiled?.registries) {
        ontologyRegistries = compiled.registries;
        ontologyRoots = [...new Set(nativeResolution.selectedRoots.map(root => root.sysmlDir))];
        provenance = compiled.registries.provenance;
        if (ontologyRegistries.kindRegistry) Object.freeze(ontologyRegistries.kindRegistry);
        if (ontologyRegistries.relationshipRegistry) Object.freeze(ontologyRegistries.relationshipRegistry);
        ontologyHash = computeOntologyHash(ontologyRegistries);
        console.log(chalk.gray(
            `Ontology: ${ontologyRegistries.kindRegistry?.size ?? 0} kinds, `
            + `${ontologyRegistries.relationshipRegistry?.size ?? 0} relationships (from ${toolchain.lowering}'s handoff)`));
    } else try {
        const loadResult = await loadOntologyRegistries(cwd);
        if (loadResult.fileCount > 0) {
            ontologyRegistries = { ...loadResult.registries, provenance: loadResult.provenance };
            // Include the resolved KPAR cache roots as restart-scoped library
            // content. They must never be picked up by the project hot watcher.
            ontologyRoots = [...new Set([
                ...loadResult.ontologyDirs,
                ...nativeResolution.selectedRoots.map(root => root.sysmlDir),
            ])];
            provenance = loadResult.provenance;
            ontologyDocuments = loadResult.parsedDocuments;
            if (ontologyRegistries.kindRegistry) Object.freeze(ontologyRegistries.kindRegistry);
            if (ontologyRegistries.relationshipRegistry) Object.freeze(ontologyRegistries.relationshipRegistry);
            ontologyHash = computeOntologyHash(ontologyRegistries);

            const kr = loadResult.registries.kindRegistry;
            const rr = loadResult.registries.relationshipRegistry;
            console.log(chalk.gray(
                `Ontology: ${kr?.size ?? 0} kinds, ${rr?.size ?? 0} relationships ` +
                `(from ${loadResult.fileCount} SysML files)`
            ));
        }
    } catch (e) {
        console.log(chalk.yellow(`  ⚠ Could not load ontology registries: ${e instanceof Error ? e.message : e}`));
    }

    // Phase B — methodology descriptor (data-only; no UI consumer yet)
    let methodologyDescriptor: MethodologyDescriptor = { folders: [], errors: [] };
    try {
        methodologyDescriptor = await loadMethodologyDescriptor(cwd, nativeResolution, compiled?.api);
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
    const projectParser = new IncrementalProjectParser(cwd);
    /** Revision of the newest rebuild that parsed — what a client is still showing. */
    let lastGoodRevision = 0;
    async function rebuildProject(changedFiles?: readonly string[]): Promise<{
        messages: ServerMessage[]; revision: number; coherent: boolean; firstErrorFile?: string;
        errors: readonly ParseError[];
    }> {
        const rebuildStartedAt = performance.now();
        buildCount++;
        const sysmlFiles = findSysmlFiles(cwd);
        const parsed = await projectParser.parse(sysmlFiles, changedFiles);
        const documents = parsed.documents;
        let errors: ParseError[] = [...parsed.errors];
        const projectRegistries: BuilderRegistries | undefined = ontologyRegistries
            ? {
                ...ontologyRegistries,
                kindRegistry: ontologyRegistries.kindRegistry?.withProjectExtensions(documents),
            }
            : undefined;
        // `toolchain.compiler` decides where the model comes from. A stage 1
        // that reports errors makes this build incoherent, so a client keeps
        // showing the last good one; MEMO's own parse still backs the display.
        // The same resolved compile every command runs, reusing `.memo/stage1/`.
        const stage1 = await compileResolvedProject({ config, projectDir: cwd, cacheDir: stage1CacheDir(cwd) });
        // The methodology follows the project's imports, which an edit can
        // change: from the compiled resolution when there is one, else by
        // resolving again.
        try {
            methodologyDescriptor = await loadMethodologyDescriptor(cwd, stage1?.resolution, stage1?.resolution ? stage1.api : undefined);
        } catch {
            // keep last good descriptor on transient parse failure
        }
        if (stage1 && (!stage1.accepted || !stage1.model)) {
            errors = [...errors, ...stage1.diagnostics.filter(d => d.severity === 'error').map(d => ({
                file: d.file ?? '', line: d.range?.start.line, message: d.message, code: d.code,
            }))];
        }
        const model = stage1?.accepted && stage1.model
            ? stage1.model
            : buildMemoModel(documents, config, errors, projectRegistries);
        // Identities for the authoring write-back: each element's declaration in
        // its file's outline (plans/memo-write-back-from-handoff.md), read from
        // the handoff when stage 1 built the model, else from the documents
        // this rebuild already parsed.
        const irIdentities = outlineIdentityTable(
            stage1?.accepted && stage1.model && stage1.api
                ? outlinesFromHandoff(resolve(cwd), stage1.api)
                : outlinesFromDocuments(resolve(cwd), documents),
            model.elements.values(),
            resolve(cwd),
        );
        // An accepted stage 1 carries the ontology it resolved, rules included,
        // so they are read from its handoff rather than from MEMO's own parse.
        const accepted = stage1?.accepted && stage1.model && stage1.api;
        const nativeConstraints = accepted
            ? collectApiConstraints(stage1.api!, undefined, stage1.resolution?.filePackages,
                stage1.resolution ? resolutionLoads(stage1.resolution) : undefined)
            : collectNativeConstraints([...ontologyDocuments, ...documents]);
        // An accepted stage 1 states the ontology with the project's own kinds,
        // as MEMO's parse of the same closure does.
        const stage2Registries: BuilderRegistries | undefined = accepted && stage1.registries
            ? stage1.registries
            : projectRegistries;
        const validation = validateModel(model, nativeConstraints, stage2Registries?.kindRegistry);
        const effectiveRuleSet = (() => {
            try {
                const resolved = resolveEffectiveRules(
                    ruleCandidatesFromConstraints(nativeConstraints),
                    methodologyDescriptor.effective?.policyChain ?? [],
                );
                return { rules: resolved.rules, diagnostics: resolved.diagnostics };
            } catch (error) {
                // Rule resolution must never take the rebuild down: a bad
                // policy is a diagnostic about the methodology, not a reason
                // the model cannot be shown.
                return {
                    rules: [] as EffectiveRule[],
                    diagnostics: [{
                        code: 'resolution-failed' as const,
                        message: error instanceof Error ? error.message : String(error),
                    }],
                };
            }
        })();
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
            projectName: config.projectName,
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
        // From the handoff when stage 1 built the model, else from MEMO's parse.
        const sourceGraph = accepted
            ? (() => {
                const { packages, files } = apiProjectSourcePackages(stage1.api!, resolve(cwd));
                return buildSourceGraphFromPackages(packages, files);
            })()
            : buildSourceGraph(documents);
        for (const diagram of diagrams) {
            diagram.sourceFiles = viewSourceFiles(diagram, model.elements, sourceGraph);
        }

        const dto = modelToDTO(model, {
            viewpoints, architectureLayers, diagrams, registries: registriesDTO,
            revision: buildCount,
            sourceGraph: sourceGraphToDTO(sourceGraph),
            irIdentities,
            sourceHashes: Object.fromEntries(sysmlFiles.map(file => [
                relative(cwd, file).replaceAll('\\', '/'),
                createHash('sha256').update(readFileSync(file)).digest('hex').slice(0, 16),
            ])),
            enumerations: accepted ? apiEnumerations(stage1.api!) : collectEnumerations(documents),
        });
        // Compute the clause coverage report and attach it to the model DTO
        // so the Architect can badge document cards with gap counts without a
        // second request. Same computation as `memo standards check`.
        try {
            const library = loadStandardsLibrary(cwd);
            const kindRegistry = stage2Registries?.kindRegistry;
            const declared = readDeclaredRegimes(model);
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

        const ontologyPackages = getPackageMetadata(cwd);

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
        console.log(chalk.gray('    memo init <project-name>'));
        console.log(chalk.gray('    memo import template elements\n'));
    }
    console.log(chalk.gray('  Building model...'));
    const initial = await rebuildProject();

    let shuttingDown = false;
    let idleShutdownTimer: ReturnType<typeof setTimeout> | undefined;
    let projectWatcher: ReturnType<typeof createProjectWatcher> | undefined;
    let ontologyWatcher: ReturnType<typeof createOntologyWatcher> | undefined;

    const shutdown = (reason: string) => {
        if (shuttingDown) return;
        shuttingDown = true;
        if (idleShutdownTimer) clearTimeout(idleShutdownTimer);
        console.log(chalk.gray(`\n  ${reason}`));
        projectWatcher?.close();
        ontologyWatcher?.close();
        server.close();
        process.exit(0);
    };

    // Start dev server
    const server = await createDevServer({
        port,
        projectRoot: cwd,
        webPackagePath: options.clientRoot,
        initialMessages: initial.messages,
        ontologyRegistries,
        ontologyRoots,
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

    console.log(chalk.green(`\n  ➜ http://${host}:${port}\n`));

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

    // Project watcher — hot reload.
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
                `  ⚠ ${result.firstErrorFile ?? 'project source'} does not parse — showing the last good model`
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
    projectWatcher = createProjectWatcher(cwd, async (changedFiles) => {
        for (const file of changedFiles) pendingRebuildFiles.add(file);
        if (rebuildInFlight) return;
        rebuildInFlight = true;
        try {
            while (pendingRebuildFiles.size > 0) {
                const nextFiles = [...pendingRebuildFiles].sort();
                pendingRebuildFiles.clear();
                await rebuildAndPublish(nextFiles);
            }
        } finally {
            rebuildInFlight = false;
        }
    }, 300, false, { ontologyRoots, provenance });

    // Ontology watcher — restart notification only, no registry reload
    ontologyWatcher = createOntologyWatcher(
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
