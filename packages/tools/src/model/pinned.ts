// ─── Pinned builds: the model as it was at a commit ──────────────────────────
//
// `buildAt` is the one primitive: it resolves a ref to a commit, keeps a cached git worktree of
// that commit under `<project>/.memo/pinned/<sha>`, and builds the model there with the ordinary
// loader. A release is a record that names a commit (`modelCommit`), and an unreleased ref (the
// latest tag, the latest commit of the main line) is the same call, so the Version selector has
// one path.
//
// A system of systems version is assembled from several commits: everything outside
// `<include>/systems/` comes from the version's own commit, and each `systems/<s>` from the commit
// of the release record of that system (plan section 9: measured, the assembly costs what a
// working build of the same content costs). It relies on the layout the plan fixes: a system
// folder is self-contained and imports only `shared/`. `crossSystemReferences` checks that on the
// assembled model, because a system that reached into another system's folder would build from
// the wrong commit without any error.
//
// What a pinned build uses from today, not from the commit: the compiler and the ontology the
// locator resolves. The worktree sits under the project, so the locator reaches the project's
// installed ontology, not the one at that commit. `PinnedBuild` names both so a reader can see.
// ─────────────────────────────────────────────────────────────────────────────

import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { appendFileSync, cpSync, existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { basename, join, relative, resolve, sep } from 'node:path';
import { promisify } from 'node:util';
import type { MEMOConfig } from './config.js';
import { loadProjectSettings } from './config-loader.js';
import { readManifest } from './package-manifest.js';
import type { MemoModel } from './semantic.js';
import { computeWorkspaceMembership } from './workspace-membership.js';
import type { BuilderRegistries } from './complete-model.js';
import { loadProjectModel, Stage1RejectedError, type ProjectModel } from '../toolchain/project-model.js';
import type { Diagnostic } from '../toolchain/diagnostic.js';

const git = promisify(execFile);

/** The folder of the layout a family uses for its systems, under each include root. */
export const SYSTEMS_DIR = 'systems';

async function run(cwd: string, args: string[]): Promise<string> {
    const { stdout } = await git('git', ['-C', cwd, ...args], { maxBuffer: 64 * 1024 * 1024 });
    return stdout.trim();
}

/** A project's repository: its top level and where the project sits in it. */
export async function findRepository(projectRoot: string): Promise<{ top: string; subpath: string }> {
    const root = realpathSync(resolve(projectRoot));
    const top = realpathSync(await run(root, ['rev-parse', '--show-toplevel']));
    return { top, subpath: relative(top, root) };
}

/**
 * Keep the caches out of the user's `git status` and out of a `git add -A`, which would take a
 * worktree for an embedded repository. The repository's own `info/exclude` is used: it is local,
 * untracked and per clone, so no tracked file (a `.gitignore`) is edited.
 */
async function excludeCaches(top: string, root: string, subpath: string): Promise<void> {
    const exclude = resolve(top, await run(top, ['rev-parse', '--git-path', 'info/exclude']));
    const base = subpath === '' ? '' : `${subpath.split(sep).join('/')}/`;
    const lines = [`/${base}.memo/pinned/`, `/${base}.memo/assembled/`];
    const present = existsSync(exclude) ? readFileSync(exclude, 'utf8').split('\n') : [];
    const missing = lines.filter(line => !present.includes(line));
    if (missing.length === 0) return;
    mkdirSync(join(exclude, '..'), { recursive: true });
    appendFileSync(exclude, `${present.length > 0 && present[present.length - 1] !== '' ? '\n' : ''}${missing.join('\n')}\n`);
}

/** A commit checked out in a cached worktree. */
export interface Pin {
    /** What the caller asked for: a ref, or a commit. */
    ref: string;
    /** The full commit hash. */
    sha: string;
    /** The worktree: a checkout of the whole repository. */
    dir: string;
    /** The project inside the worktree. */
    projectDir: string;
    /** True when the worktree already existed and was reused. */
    reused: boolean;
    /** Milliseconds spent resolving and checking out. */
    ms: number;
}

/** The commit a ref names. Throws when it names none. */
export async function resolveCommit(projectRoot: string, ref: string): Promise<string> {
    try {
        return await run(projectRoot, ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`]);
    } catch {
        throw new Error(`"${ref}" is not a commit or a ref of this repository`);
    }
}

/** Whether `ancestor` is `descendant` or reachable from it. */
export async function isAncestor(projectRoot: string, ancestor: string, descendant: string): Promise<boolean> {
    try {
        await git('git', ['-C', projectRoot, 'merge-base', '--is-ancestor', ancestor, descendant]);
        return true;
    } catch (error) {
        if ((error as { code?: number }).code === 1) return false;
        throw error;
    }
}

async function clean(dir: string, sha: string): Promise<boolean> {
    try {
        if ((await run(dir, ['rev-parse', 'HEAD'])) !== sha) return false;
        return (await run(dir, ['status', '--porcelain', '--untracked-files=no'])) === '';
    } catch {
        return false;
    }
}

/**
 * The worktree of a commit, created once and reused while it is at that commit and unmodified.
 * Nothing is ever written into the project's own checkout: the worktree is the only addition.
 */
export async function pinWorktree(projectRoot: string, ref: string): Promise<Pin> {
    const started = Date.now();
    const root = realpathSync(resolve(projectRoot));
    const { top, subpath } = await findRepository(root);
    const sha = await resolveCommit(root, ref);
    const dir = join(root, '.memo', 'pinned', sha.slice(0, 12));
    let reused = false;
    if (existsSync(dir)) {
        if (await clean(dir, sha)) reused = true;
        else {
            // Moved or modified: it is a cache, never authored content, so it is rebuilt.
            await run(top, ['worktree', 'remove', '--force', dir]).catch(() => rmSync(dir, { recursive: true, force: true }));
            await run(top, ['worktree', 'prune']);
        }
    }
    if (!reused) {
        await excludeCaches(top, root, subpath);
        mkdirSync(join(root, '.memo', 'pinned'), { recursive: true });
        await run(top, ['worktree', 'add', '--detach', '--force', dir, sha]);
    }
    return { ref, sha, dir, projectDir: join(dir, subpath), reused, ms: Date.now() - started };
}

/** What a pinned build used, and cost. */
export interface PinnedBuild {
    project: ProjectModel;
    /** The commits the model was built from. */
    pins: { name: string; pin: Pin }[];
    /** The directory the model was built in. */
    projectDir: string;
    compiler: string;
    compilerVersion?: string;
    /** The ontology packages the build resolved (today's installed ones; see the header). */
    timings: { checkoutMs: number; assembleMs: number; compileMs: number };
}

export interface BuildOptions {
    /** Settings laid over the pinned tree's own (the compiler is the caller's choice). */
    config?: Partial<MEMOConfig>;
}

function settings(projectDir: string, override: Partial<MEMOConfig> | undefined): MEMOConfig {
    const loaded = loadProjectSettings(projectDir);
    return { ...loaded, ...override, toolchain: { ...loaded.toolchain, ...override?.toolchain } } as MEMOConfig;
}

/** The model at one commit or ref: a release's `modelCommit`, a tag, a branch. */
export async function buildAt(projectRoot: string, ref: string, options: BuildOptions = {}): Promise<PinnedBuild> {
    const pin = await pinWorktree(projectRoot, ref);
    const started = Date.now();
    const project = await loadProjectModel({ projectRoot: pin.projectDir, config: settings(pin.projectDir, options.config) });
    return result(project, [{ name: 'model', pin }], pin.projectDir, pin.ms, 0, Date.now() - started);
}

function result(project: ProjectModel, pins: PinnedBuild['pins'], projectDir: string, checkoutMs: number, assembleMs: number, compileMs: number): PinnedBuild {
    return { project, pins, projectDir, compiler: project.compiler, compilerVersion: project.providerVersion, timings: { checkoutMs, assembleMs, compileMs } };
}

// ─── Release records to commits ──────────────────────────────────────────────

export interface ReleasePin {
    /** The system folder name under `systems/`. */
    system: string;
    /** `<include root>/systems/<system>`, project-relative, with forward slashes. */
    path: string;
    commit: string;
    /** The release record that names the commit, and the item it releases. */
    record: string;
    item: string;
}

export interface ReleasePins {
    record: string;
    commit: string;
    systems: ReleasePin[];
    /** Contained records that pin nothing of their own: their item is not under `systems/`. */
    notPinned: { record: string; item: string; file: string }[];
}

const attr = (model: MemoModel, id: string, key: string): string | undefined => {
    const value = model.elements.get(id)?.attributes?.[key];
    return value === undefined || value === '' ? undefined : value;
};

const systemFolder = (file: string): { path: string; system: string } | undefined => {
    const match = /^(.*?\/?)systems\/([^/]+)\//.exec(file.split(sep).join('/'));
    return match ? { path: `${match[1]}${SYSTEMS_DIR}/${match[2]}`, system: match[2] } : undefined;
};

/**
 * The commits an SoS version is assembled from, read from the working model: the record's own
 * `modelCommit`, and for each record it `contains` the commit and the system folder of the item
 * that record is a release of. A record that releases an item outside `systems/` is listed in
 * `notPinned`, never guessed at.
 */
export function releasePins(model: MemoModel, recordId: string): ReleasePins {
    const record = model.elements.get(recordId);
    if (!record) throw new Error(`no element ${recordId}`);
    const commit = attr(model, recordId, 'modelCommit');
    if (!commit) throw new Error(`${record.shortName ?? recordId} has no modelCommit`);
    const linked = (type: string, from: string) => [...model.relationships.values()].filter(r => r.type === type && r.sourceId === from).map(r => r.targetId);
    const systems: ReleasePin[] = [];
    const notPinned: ReleasePins['notPinned'] = [];
    for (const contained of linked('contains', recordId)) {
        const items = linked('releaseOf', contained);
        const name = model.elements.get(contained)?.shortName ?? contained;
        if (items.length !== 1) throw new Error(`${name} must be a release of exactly one item (#ReleaseOf); it has ${items.length}`);
        const item = model.elements.get(items[0])!;
        const folder = systemFolder(item.file);
        const containedCommit = attr(model, contained, 'modelCommit');
        if (!folder) { notPinned.push({ record: name, item: item.shortName ?? item.id, file: item.file }); continue; }
        if (!containedCommit) throw new Error(`${name} has no modelCommit`);
        if (systems.some(s => s.path === folder.path)) throw new Error(`two contained records release items of ${folder.path}; an SoS version pins one release per system`);
        systems.push({ system: folder.system, path: folder.path, commit: containedCommit, record: name, item: item.shortName ?? item.id });
    }
    return { record: record.shortName ?? recordId, commit, systems, notPinned };
}

/** A `Contains` edge whose contained record is not at or before its container's commit. */
export interface OrderingViolation {
    container: string;
    contained: string;
    containerCommit: string;
    containedCommit: string;
}

/**
 * Every `Contains` edge below a record, at every level: a container's commit must be at or after
 * the commit of what it contains (plan section 9, decision 2). The identity registry and `shared/`
 * come from the container's commit, so an element added later would be minted on the fly.
 */
export async function orderingViolations(projectRoot: string, model: MemoModel, recordId: string): Promise<OrderingViolation[]> {
    const violations: OrderingViolation[] = [];
    const seen = new Set<string>();
    const visit = async (id: string): Promise<void> => {
        if (seen.has(id)) return;
        seen.add(id);
        const containerCommit = attr(model, id, 'modelCommit');
        for (const r of model.relationships.values()) {
            if (r.type !== 'contains' || r.sourceId !== id) continue;
            const containedCommit = attr(model, r.targetId, 'modelCommit');
            if (containerCommit && containedCommit && !(await isAncestor(projectRoot, containedCommit, containerCommit))) {
                violations.push({
                    container: model.elements.get(id)?.shortName ?? id, contained: model.elements.get(r.targetId)?.shortName ?? r.targetId,
                    containerCommit, containedCommit,
                });
            }
            await visit(r.targetId);
        }
    };
    await visit(recordId);
    return violations;
}

// ─── Assembling an SoS version ───────────────────────────────────────────────

export interface Assembly {
    dir: string;
    key: string;
    sos: Pin;
    systems: { pin: ReleasePin; worktree: Pin }[];
    reused: boolean;
}

const assemblyKey = (sos: string, systems: ReleasePin[]) => createHash('sha256')
    .update([sos, ...systems.map(s => `${s.path}@${s.commit}`).sort()].join('\n')).digest('hex').slice(0, 12);

function includeRoots(projectDir: string): string[] {
    const manifest = readManifest(join(projectDir, 'memo.package.yaml'));
    return (manifest.include ?? ['model']).map(root => root.replace(/\/+$/, ''));
}

/**
 * The project of an SoS version: the SoS commit's project directory without `.memo` and without
 * `<include>/systems/`, then each system folder laid from its own commit. The directory is keyed by
 * the commits, which do not change, so a second call reuses it. Refused when a system folder exists
 * at the SoS commit and is not pinned, or a pinned one does not exist at its commit.
 */
export async function assemble(projectRoot: string, sosCommit: string, pins: ReleasePin[]): Promise<Assembly> {
    const root = realpathSync(resolve(projectRoot));
    const sos = await pinWorktree(root, sosCommit);
    const key = assemblyKey(sos.sha, pins);
    const dir = join(root, '.memo', 'assembled', key);
    const marker = join(dir, '.assembled');
    const worktrees = [] as Assembly['systems'];
    for (const pin of pins) worktrees.push({ pin, worktree: await pinWorktree(root, pin.commit) });

    const roots = includeRoots(sos.projectDir);
    const present = roots.flatMap(r => {
        const systems = join(sos.projectDir, r, SYSTEMS_DIR);
        return existsSync(systems) ? readdirSync(systems).filter(n => statSync(join(systems, n)).isDirectory()).map(n => `${r}/${SYSTEMS_DIR}/${n}`) : [];
    });
    const unpinned = present.filter(p => !pins.some(pin => pin.path === p));
    if (unpinned.length > 0) throw new Error(`the SoS commit ${sos.sha.slice(0, 7)} holds system folders no contained release pins: ${unpinned.join(', ')}`);

    if (existsSync(marker)) return { dir, key, sos, systems: worktrees, reused: true };
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(dir, { recursive: true });
    const systemsRoots = roots.map(r => join(sos.projectDir, r, SYSTEMS_DIR));
    cpSync(sos.projectDir, dir, {
        recursive: true,
        filter: source => basename(source) !== '.memo' && basename(source) !== '.git' && !systemsRoots.includes(source),
    });
    for (const { pin, worktree } of worktrees) {
        const from = join(worktree.projectDir, pin.path);
        if (!existsSync(from)) throw new Error(`${pin.path} does not exist at ${pin.commit.slice(0, 7)}, the commit of ${pin.record}`);
        cpSync(from, join(dir, pin.path), { recursive: true });
    }
    writeFileSync(marker, JSON.stringify({ sos: sos.sha, systems: pins.map(p => `${p.path}@${p.commit}`) }, null, 2));
    return { dir, key, sos, systems: worktrees, reused: false };
}

/** Where a path in an assembled build came from: the system and commit, or the SoS commit. */
export function originOf(assembly: Assembly, file: string): string {
    const normal = file.split(sep).join('/');
    const marker = `/assembled/${assembly.key}/`;
    const inside = normal.includes(marker) ? normal.slice(normal.indexOf(marker) + marker.length) : normal;
    for (const { pin } of assembly.systems) {
        if (inside.startsWith(`${pin.path}/`)) return `${pin.path}@${pin.commit.slice(0, 7)}/${inside.slice(pin.path.length + 1)}`;
    }
    return `@${assembly.sos.sha.slice(0, 7)}/${inside}`;
}

/** Stage 1 rejected an assembled build: the same diagnostics, each path mapped back to its commit. */
export class PinnedBuildError extends Error {
    constructor(readonly assembly: Assembly, readonly diagnostics: Diagnostic[], readonly cause: Stage1RejectedError) {
        const errors = diagnostics.filter(d => d.severity === 'error');
        super(`The assembled build (${assembly.key}) was rejected by ${cause.compiler}, ${errors.length} error(s):\n`
            + errors.map(d => `  ${d.file}:${d.range?.start.line ?? '?'}:${d.range?.start.column ?? '?'} ${d.code ?? ''} ${d.message}`).join('\n'));
    }
}

// ─── The guard on the layout ─────────────────────────────────────────────────

export interface CrossSystemReference {
    from: string;
    to: string;
    fromSystem: string;
    toSystem: string;
    how: string;
}

/**
 * Elements of one system folder that type by, or link to, an element declared in another's.
 * Such a build is wrong without being an error: the second system's elements come from the other
 * system's commit. Typing is read from the workspace closure; every relationship is read as is.
 */
export function crossSystemReferences(model: MemoModel, registries: BuilderRegistries): CrossSystemReference[] {
    const folder = (id: string) => {
        const file = model.elements.get(id)?.file;
        return file ? systemFolder(file)?.path : undefined;
    };
    const name = (id: string) => model.elements.get(id)?.shortName ?? id;
    const found: CrossSystemReference[] = [];
    const check = (a: string, b: string, how: string) => {
        const fromSystem = folder(a);
        const toSystem = folder(b);
        if (fromSystem && toSystem && fromSystem !== toSystem) found.push({ from: name(a), to: name(b), fromSystem, toSystem, how });
    };
    for (const r of model.relationships.values()) check(r.sourceId, r.targetId, r.type);
    const membership = computeWorkspaceMembership(model, registries);
    for (const [usage, definition] of membership.definitionOf) check(usage, definition, 'typing');
    return found;
}

// ─── An SoS version, built ───────────────────────────────────────────────────

export interface ReleaseBuild extends PinnedBuild {
    assembly: Assembly;
    /** What the record named: the SoS commit and each system's. */
    releasePins: ReleasePins;
}

/**
 * The model of an SoS version: the release record's pins read from `working` (the model of the
 * checkout the record lives in), ordering checked at every level, assembled, built, and checked for
 * references across system folders. Diagnostics of a rejected build name the system and commit.
 */
export async function buildRelease(projectRoot: string, working: ProjectModel, recordId: string, options: BuildOptions = {}): Promise<ReleaseBuild> {
    const pins = releasePins(working.model, recordId);
    if (pins.systems.length === 0) {
        const first = pins.notPinned[0];
        throw new Error(`${pins.record} contains no release of an item under ${SYSTEMS_DIR}/<system>/`
            + (first ? `; ${first.record} is a release of ${first.item}, declared in ${first.file}` : ''));
    }
    const ordering = await orderingViolations(projectRoot, working.model, recordId);
    if (ordering.length > 0) {
        throw new Error('a release must be at or after what it contains:\n' + ordering.map(v =>
            `  ${v.container} (${v.containerCommit.slice(0, 7)}) contains ${v.contained} (${v.containedCommit.slice(0, 7)}), which is not an ancestor`).join('\n'));
    }
    const started = Date.now();
    const assembly = await assemble(projectRoot, pins.commit, pins.systems);
    const assembleMs = Date.now() - started;
    const compileStarted = Date.now();
    let project: ProjectModel;
    try {
        project = await loadProjectModel({ projectRoot: assembly.dir, config: settings(assembly.dir, options.config) });
    } catch (error) {
        if (!(error instanceof Stage1RejectedError)) throw error;
        const mapped = error.diagnostics.map(d => d.file ? { ...d, file: originOf(assembly, d.file) } : d);
        throw new PinnedBuildError(assembly, mapped, error);
    }
    const crossings = crossSystemReferences(project.model, project.registries ?? {});
    if (crossings.length > 0) {
        throw new Error('a system folder must be self-contained; these references would build from the wrong commit:\n'
            + crossings.map(c => `  ${c.from} (${c.fromSystem}) -> ${c.to} (${c.toSystem}) by ${c.how}`).join('\n'));
    }
    const build = result(project, [{ name: 'sos', pin: assembly.sos }, ...assembly.systems.map(s => ({ name: s.pin.system, pin: s.worktree }))],
        assembly.dir, assembly.sos.ms + assembly.systems.reduce((sum, s) => sum + s.worktree.ms, 0), assembleMs, Date.now() - compileStarted);
    return { ...build, assembly, releasePins: pins };
}

/** The unmodified read of a file at a commit, for tests that check a worktree stayed clean. */
export async function worktreeIsClean(pin: Pin): Promise<boolean> {
    return clean(pin.dir, pin.sha);
}
