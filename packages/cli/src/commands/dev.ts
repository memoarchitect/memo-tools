// ─── memo dev ────────────────────────────────────────────────────────────────
//
// Starts the development server:
//   1. bootstrap() — load config + ontology registries once (frozen after)
//   2. Start HTTP server (Vite middleware for web app + WebSocket)
//   3. Project watcher → rebuildProject() (hot reload)
//      Ontology watcher → notifyRestartRequired() (no model mutation)
// ─────────────────────────────────────────────────────────────────────────────

import { resolve } from 'node:path';
import { createRequire } from 'node:module';
import { readdirSync, existsSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execSync } from 'node:child_process';
import chalk from 'chalk';
import { findConfigFile, parseFiles, buildMemoModel, modelToDTO, loadOntologyRegistries, getPackageMetadata, loadMethodologyDescriptor, deriveModelViews, resolveViewKind } from '@memo/core';
import type { BuilderRegistries, RestartRequiredMessage, MethodologyDescriptor } from '@memo/core';
import { validateModel } from '@memo/core';
import { computeCompleteness } from '@memo/core';
import type { ServerMessage, ViewpointDTO, ArchLayerDTO, DiagramDTO, ModelMetadata } from '@memo/core';
import { loadAndResolveConfig } from '../server/config-resolver.js';
import { createDevServer } from '../server/dev-server.js';
import { createProjectWatcher, createOntologyWatcher } from '../server/file-watcher.js';
import { checkLockFile } from '../lock.js';

/** Gather git info for model metadata */
function getGitInfo(cwd: string): Partial<ModelMetadata> {
    const git = (cmd: string) => {
        try { return execSync(cmd, { cwd, encoding: 'utf8', timeout: 3000 }).trim(); }
        catch { return undefined; }
    };
    return {
        gitUser: git('git config user.name') || undefined,
        gitBranch: git('git rev-parse --abbrev-ref HEAD') || undefined,
        gitCommitShort: git('git rev-parse --short HEAD') || undefined,
    };
}

function findSysmlFiles(dir: string): string[] {
    const files: string[] = [];
    try {
        for (const entry of readdirSync(dir, { withFileTypes: true })) {
            const full = resolve(dir, entry.name);
            if (entry.isDirectory() && entry.name !== 'node_modules' && entry.name !== '.memo') {
                files.push(...findSysmlFiles(full));
            } else if (entry.name.endsWith('.sysml')) {
                files.push(full);
            }
        }
    } catch {
        // skip
    }
    return files;
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

export async function devCommand(options: { port?: number; open?: boolean }): Promise<void> {
    const cwd = process.cwd();
    const port = options.port || 3000;
    const host = '127.0.0.1';

    console.log(chalk.bold('\n🚀 MEMO Dev Server\n'));

    // ── bootstrap: runs once ───────────────────────────────────────────────────
    const configPath = findConfigFile(cwd);
    if (!configPath) {
        console.error(chalk.red('❌ No memo config found (memo.package.yaml or memo.config.yaml). Run `memo init` first.'));
        process.exit(1);
    }

    const config = loadAndResolveConfig(configPath);
    const gitInfo = getGitInfo(cwd);
    let buildCount = 0;
    console.log(chalk.gray(`Project: ${config.projectName}`));

    const lockCheck = checkLockFile(configPath);
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
    let ontologyHash = '';

    try {
        const loadResult = await loadOntologyRegistries(configPath);
        if (loadResult.fileCount > 0) {
            ontologyRegistries = loadResult.registries;
            ontologyRoots = loadResult.ontologyDirs;
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
        methodologyDescriptor = await loadMethodologyDescriptor(configPath, cwd);
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
    const methodologyConfigPath: string = configPath;
    async function rebuildProject(): Promise<{ messages: ServerMessage[] }> {
        buildCount++;
        try {
            methodologyDescriptor = await loadMethodologyDescriptor(methodologyConfigPath, cwd);
        } catch {
            // keep last good descriptor on transient parse failure
        }
        const sysmlFiles = findSysmlFiles(cwd);
        const { documents, errors } = await parseFiles(sysmlFiles, cwd + '/');
        const model = buildMemoModel(documents, config, errors, ontologyRegistries);
        const validation = validateModel(model);
        const completeness = computeCompleteness(model, validation, config);

        console.log(chalk.cyan(
            `  ${model.elements.size} elements, ${model.relationships.length} relationships, ` +
            `${validation.violations.length} violations, ${completeness.overall}% complete`
        ));

        const viewpoints: ViewpointDTO[] = config.viewpoints?.map(vp => ({
            id: vp.id,
            label: vp.label,
            visibleKinds: vp.visibleKinds,
            visibleRelationships: vp.visibleRelationships,
            visibleLayers: vp.visibleLayers,
            supportedDiagramTypes: vp.supportedDiagramTypes,
        })) ?? [];

        // Views modelled in SysML (DiagramView/DocumentView usages) surface as
        // viewpoint-grouped auto diagrams alongside config-defined viewpoints.
        const derivedViews = deriveModelViews(model, ontologyRegistries?.kindRegistry);
        viewpoints.push(...derivedViews.viewpoints);

        const diagrams: DiagramDTO[] = [];
        for (const [layerId, layerElements] of model.elementsByLayer.entries()) {
            if (layerElements.length === 0) continue;
            const label = layerId.charAt(0).toUpperCase() + layerId.slice(1);
            diagrams.push({
                id: `diag-layer-${layerId}`,
                name: `${label} Layer`,
                diagramType: 'bdd',
                viewKind: 'general',
                viewpointId: '__model',
                auto: true,
                description: `${label} architecture layer — ${layerElements.length} elements`,
                elementIds: layerElements.map(e => e.id),
            });
        }
        diagrams.push(...derivedViews.diagrams);
        if (config.viewpoints) {
            for (const vp of config.viewpoints) {
                if (vp.diagrams) {
                    for (const d of vp.diagrams) {
                        diagrams.push({
                            id: d.id,
                            name: d.name,
                            diagramType: d.diagramType,
                            viewKind: resolveViewKind(undefined, d.diagramType),
                            viewpointId: d.viewpointId,
                            auto: d.auto,
                            description: d.description,
                            properties: d.properties,
                            elementIds: d.elementIds,
                            relationshipTypes: d.relationshipTypes,
                        });
                    }
                }
            }
        }

        const architectureLayers: ArchLayerDTO[] | undefined = config.architectureLayers?.map(cl => ({
            id: cl.id,
            label: cl.label,
            color: cl.color,
        }));

        const baseVersion = config.ontologyMetadata?.version || '0.1.0';
        const metadata: ModelMetadata = {
            projectName: config.projectName,
            version: `${baseVersion}-dev.${buildCount}`,
            ...gitInfo,
        };

        const userDiagramsPath = resolve(cwd, '.memo', 'user-diagrams.json');
        if (existsSync(userDiagramsPath)) {
            try {
                const rawUserDiagrams = JSON.parse(readFileSync(userDiagramsPath, 'utf8')) as DiagramDTO[];
                const validUserDiagrams = ontologyRegistries
                    ? validateDiagramsAgainstOntology(rawUserDiagrams, ontologyRegistries)
                    : rawUserDiagrams;
                diagrams.push(...validUserDiagrams);
            } catch {
                // ignore corrupt file
            }
        }

        const dto = modelToDTO(model, { viewpoints, architectureLayers, diagrams });
        dto.metadata = metadata;
        (dto as any).ontologyHash = ontologyHash;

        const ontologyPackages = getPackageMetadata(cwd);

        return {
            messages: [
                { type: 'model:update', payload: dto },
                { type: 'validation:update', payload: validation },
                { type: 'completeness:update', payload: completeness },
                { type: 'ontology:packages', payload: { packages: ontologyPackages, ontologyHash } as any },
                { type: 'methodology:update', payload: methodologyDescriptor },
            ],
        };
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

    // Start dev server
    const server = await createDevServer({
        port,
        projectRoot: cwd,
        webPackagePath: resolveWebPackage(cwd),
        initialMessages: initial.messages,
        ontologyRegistries,
    });

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
            instruction: 'Stop dev server (Ctrl+C) and run `memo dev` again to apply ontology changes.',
        };
        process.stderr.write(
            chalk.yellow(`\n  ⚠ Ontology changed (${changedFile}) — restart required. Changes ignored until restart.\n\n`)
        );
        server.broadcast([msg]);
    }

    // Project watcher — hot reload
    const projectWatcher = createProjectWatcher(cwd, async () => {
        console.log(chalk.gray(`  [${new Date().toLocaleTimeString()}] Rebuilding...`));
        const result = await rebuildProject();
        server.broadcast(result.messages);
    });

    // Ontology watcher — restart notification only, no registry reload
    const ontologyWatcher = createOntologyWatcher(
        cwd,
        ontologyRoots,
        (changedFile) => notifyRestartRequired('ontology-source-changed', changedFile)
    );

    // Open browser
    if (options.open !== false) {
        const openModule = await import('open');
        openModule.default(`http://${host}:${port}`);
    }

    process.on('SIGINT', () => {
        console.log(chalk.gray('\n  Shutting down...'));
        projectWatcher.close();
        ontologyWatcher.close();
        server.close();
        process.exit(0);
    });
}

function resolveWebPackage(cwd: string): string {
    // Explicit override wins — standalone installs point this at the folder
    // containing the @memo/web package (source checkout or prebuilt dist/)
    const explicit = process.env.MEMO_WEB_ROOT;
    if (explicit) {
        const root = resolve(cwd, explicit);
        if (existsSync(root)) return root;
        console.warn(chalk.yellow(`  ⚠ MEMO_WEB_ROOT points to a missing path: ${root}`));
    }

    const tryPaths = [
        // Standalone: @memo/web installed as a package next to the model
        resolve(cwd, 'node_modules/@memo/web'),
        // Monorepo layouts (memo-tools checkout, memo-architect root)
        resolve(cwd, '../../packages/web'),
        // memo-architect layout: example lives in the nested content submodule
        // (memo-tools/memo/src/examples/<x>), web at repo root
        resolve(cwd, '../../../../../packages/web'),
        resolve(cwd, '../web'),
    ];

    // Global/linked install: @memo/web resolvable from the CLI's own tree
    try {
        const require = createRequire(import.meta.url);
        tryPaths.push(resolve(require.resolve('@memo/web/package.json'), '..'));
    } catch {
        // @memo/web is not a dependency of the CLI install — fine
    }

    for (const p of tryPaths) {
        try {
            readdirSync(p);
            return p;
        } catch {
            // not found
        }
    }

    return resolve(cwd, '../../packages/web');
}
