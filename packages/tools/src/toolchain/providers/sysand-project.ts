// ─── A MEMO project as a SysAnd interchange project ──────────────────────────
//
// `sysand build` packs a *SysAnd interchange project*: sources, a `.project.json`
// (name, publisher, version, usages) and a `.meta.json` (an index of the symbols
// each file declares, with checksums). A MEMO project has neither: its descriptor
// is `memo.package.yaml`. So packaging stages a copy in a scratch directory,
// writes the first from what the project already says, and leaves the second to
// `sysand include`, which indexes and checksums. The project itself is never
// written to, and the SysML it packs is only what the project or package declares
// as its own: its `sysmlDir` (a package) or its `include` roots (a project), never
// a walk of the directory, so examples, templates, other packages and the libraries
// it imports (which are usages, not content) are not bundled.
// ─────────────────────────────────────────────────────────────────────────────

import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { findConfigFile } from '../../model/config-loader.js';
import type { MEMOConfig } from '../../model/config.js';
import { discoverLibraryRoots, projectEntrypoint } from '../../model/native-project.js';
import { readSourceFacts } from '../../model/project-conversion.js';
import { readManifest, readPackageManifest } from '../../model/package-manifest.js';
import { findSysmlFiles } from '../../model/sysml-files.js';
import { compileResolvedProject } from '../operations.js';
import { stage1CacheDir } from '../project-model.js';

/** What a project says about itself that a SysAnd package carries. */
export interface SysandProjectIdentity {
    name: string;
    publisher: string;
    version: string;
    description?: string;
    license?: string;
}

export interface SysandProjectInfo extends SysandProjectIdentity {
    usage: { resource: string; versionConstraint?: string }[];
}

/** Name, version, publisher, description and licence, from `memo.package.yaml`. */
export function sysandProjectIdentity(projectDir: string, config: MEMOConfig): SysandProjectIdentity {
    const root = resolve(projectDir);
    const settingsFile = findConfigFile(root);
    const manifest = readManifest(settingsFile && dirname(resolve(settingsFile)) === root ? settingsFile : '');
    const text = (value: unknown): string | undefined => (typeof value === 'string' && value.trim() ? value.trim() : undefined);
    return {
        name: config.projectName || manifest.name || 'memo-project',
        // `untitled` is what `sysand init` writes when nobody says.
        publisher: text(manifest.raw.publisher) ?? text(manifest.raw.author) ?? 'untitled',
        version: manifest.version ?? '0.1.0',
        ...(text(manifest.raw.description) ? { description: text(manifest.raw.description) } : {}),
        ...(text(manifest.raw.license) ? { license: text(manifest.raw.license) } : {}),
    };
}

/**
 * The project's `.project.json`: its identity, and a usage for each library
 * package its imports actually reach from outside the project (the compile's
 * `selectedRoots`: the ontology, its profile, the methodology and any extension
 * the project imports, not every package a locator could offer), as
 * `urn:kpar:<package>` with a Cargo-style `^version` constraint, the way
 * `memo-architect ontology export sysand` names them.
 */
export async function sysandProjectInfo(projectDir: string, config: MEMOConfig): Promise<SysandProjectInfo> {
    const root = resolve(projectDir);
    // A package (it declares `sysmlDir`, and has no entrypoint) is not a project, so there is no
    // import closure from an entrypoint: its dependencies are the library roots its own sources import.
    if (!projectEntrypoint(root)) return { ...sysandProjectIdentity(root, config), usage: packageUsages(root) };
    const compiled = await compileResolvedProject({ config, projectDir: root, cacheDir: stage1CacheDir(root) });
    if (!compiled.accepted || !compiled.resolution) {
        const why = compiled.diagnostics.filter(d => d.severity === 'error').map(d => d.message).slice(0, 3).join('; ');
        throw new Error(`The libraries this project uses could not be determined, so it cannot be packaged: ${why || 'the compile resolved no project'}.`);
    }
    const outside = (dir: string) => relative(root, resolve(dir)).startsWith('..');
    const usage = compiled.resolution.selectedRoots
        .filter(library => outside(library.dir))
        .map(library => ({
            resource: `urn:kpar:${library.packageName}`,
            ...(library.packageVersion ? { versionConstraint: `^${library.packageVersion}` } : {}),
        }));
    return { ...sysandProjectIdentity(root, config), usage };
}

/**
 * The packages a package depends on: each library root, other than its own, that declares a
 * package one of its sources imports, as `urn:kpar:<package>` with a `^version` constraint.
 *
 * `memo.package.yaml` cannot say it (a `usage` or `extends` there is rejected since the native
 * flip), so the sources do: an `import` names a package, the library roots the manifest offers
 * say which root declares it. Only the direct dependencies are listed; a dependency lists its own.
 * Packages no root declares (the SysML standard library) are not usages of a MEMO package.
 */
export function packageUsages(packageDir: string): SysandProjectInfo['usage'] {
    const root = resolve(packageDir);
    const { base, files } = declaredSources(root);
    const own = new Set(files.map(file => resolve(base, file)));
    const imported = new Set<string>();
    for (const file of own) for (const name of readSourceFacts(readFileSync(file, 'utf-8')).imports) imported.add(name);

    const declaredBy = new Map<string, ReturnType<typeof discoverLibraryRoots>[number]>();
    for (const library of discoverLibraryRoots(root)) {
        if (resolve(library.dir) === root || resolve(library.sysmlDir) === resolve(base)) continue;
        for (const file of findSysmlFiles(library.sysmlDir)) {
            if (own.has(resolve(file))) continue;
            for (const name of readSourceFacts(readFileSync(file, 'utf-8')).topLevelPackages) {
                if (imported.has(name) && !declaredBy.has(name)) declaredBy.set(name, library);
            }
        }
    }
    const usages = new Map<string, SysandProjectInfo['usage'][number]>();
    for (const library of declaredBy.values()) {
        usages.set(library.packageName, {
            resource: `urn:kpar:${library.packageName}`,
            ...(library.packageVersion ? { versionConstraint: `^${library.packageVersion}` } : {}),
        });
    }
    return [...usages.values()].sort((a, b) => a.resource.localeCompare(b.resource));
}

export interface StagedSysandProject {
    /** The scratch directory: the caller removes it. */
    dir: string;
    /** The SysML files staged, relative to `dir`. */
    files: string[];
    info: SysandProjectInfo;
}

/**
 * The SysML a project or package declares as its own, and the directory its paths are relative to.
 *
 * A package says where its sources are (`sysmlDir`, which may sit outside the package's own
 * directory, as the ontology's `../src` does); a project says which roots it contains (`include`)
 * and where it starts (`entrypoint`). Anything else in the directory (examples, templates, other
 * packages, installed libraries) is not this package's.
 */
export function declaredSources(projectDir: string): { base: string; files: string[] } {
    const root = resolve(projectDir);
    const manifest = readPackageManifest(root).manifest;
    if (manifest.sysmlDir) {
        const base = resolve(root, manifest.sysmlDir);
        return { base, files: findSysmlFiles(base).map(file => relative(base, file)).sort() };
    }
    const roots = (manifest.include ?? []).filter(path => !path.toLowerCase().endsWith('.kpar'));
    const entrypoint = projectEntrypoint(root);
    if (entrypoint && !roots.some(path => resolve(root, entrypoint).startsWith(resolve(root, path)))) roots.push(entrypoint);
    const files = new Set<string>();
    for (const path of roots) {
        const target = resolve(root, path);
        if (!existsSync(target)) continue;
        if (statSync(target).isDirectory()) findSysmlFiles(target).forEach(file => files.add(relative(root, file)));
        else if (target.endsWith('.sysml')) files.add(relative(root, target));
    }
    if (files.size === 0) {
        throw new Error(
            `${root} declares no SysML of its own to package. A package says where its sources are with sysmlDir, `
            + 'and a project with include and entrypoint, in memo.package.yaml; run this inside one.');
    }
    return { base: root, files: [...files].filter(file => !file.startsWith('..')).sort() };
}

/** Copy the SysML the project or package declares into a scratch interchange project, with `.project.json` and an empty `.meta.json`. */
export async function stageSysandProject(projectDir: string, config: MEMOConfig): Promise<StagedSysandProject> {
    const root = resolve(projectDir);
    const info = await sysandProjectInfo(root, config);
    const { base, files } = declaredSources(root);
    const dir = mkdtempSync(join(tmpdir(), 'memo-sysand-'));
    for (const file of files) {
        const target = join(dir, file);
        mkdirSync(dirname(target), { recursive: true });
        copyFileSync(join(base, file), target);
    }
    writeFileSync(join(dir, '.project.json'), `${JSON.stringify(info, null, 2)}\n`);
    writeFileSync(join(dir, '.meta.json'), `${JSON.stringify({ index: {}, created: new Date().toISOString() }, null, 2)}\n`);
    return { dir, files, info };
}

/** The file name a package gets: `<name>-<version>.kpar`, as `sysand build` names its own. */
export function sysandPackageFileName(info: Pick<SysandProjectIdentity, 'name' | 'version'>): string {
    return `${info.name.replace(/[^a-zA-Z0-9_.-]/g, '-')}-${info.version}.kpar`;
}
