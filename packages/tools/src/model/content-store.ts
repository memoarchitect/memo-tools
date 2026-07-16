import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { discoverMemoManifests, type LoadedMemoManifest } from './manifest.js';

interface ToolsPackageMetadata {
    memo?: { contentPackage?: string };
    dependencies?: Record<string, string>;
}

function packageMetadata(): ToolsPackageMetadata {
    let dir = dirname(fileURLToPath(import.meta.url));
    while (true) {
        const candidate = resolve(dir, 'package.json');
        if (existsSync(candidate)) {
            const metadata = JSON.parse(readFileSync(candidate, 'utf-8')) as ToolsPackageMetadata & { name?: string };
            if (metadata.name === '@memo/tools') return metadata;
        }
        const parent = dirname(dir);
        if (parent === dir) break;
        dir = parent;
    }
    throw new Error('Could not locate the @memo/tools package manifest.');
}

export function contentPackageName(): string {
    const name = packageMetadata().memo?.contentPackage;
    if (!name) throw new Error('This @memo/tools package does not declare its MEMO content package.');
    return name;
}

export function contentPackageSpec(version?: string): string {
    if (process.env.MEMO_CONTENT_SPEC) return process.env.MEMO_CONTENT_SPEC;
    const metadata = packageMetadata();
    const name = contentPackageName();
    const declared = metadata.dependencies?.[name];
    const resolvedVersion = version || (declared && !declared.startsWith('workspace:') ? declared : undefined);
    return resolvedVersion ? `${name}@${resolvedVersion}` : name;
}

export function projectContentStore(projectDir: string): string {
    return resolve(projectDir, '.memo', 'content');
}

export function installedContentManifests(projectDir: string): LoadedMemoManifest[] {
    return discoverMemoManifests([projectContentStore(projectDir)]);
}

export function installContentPackage(projectDir: string, version?: string): LoadedMemoManifest[] {
    const store = projectContentStore(projectDir);
    const spec = contentPackageSpec(version);
    execFileSync('npm', ['install', '--prefix', store, '--no-save', '--ignore-scripts', spec], {
        cwd: projectDir,
        stdio: 'pipe',
    });
    const manifests = installedContentManifests(projectDir);
    if (manifests.length === 0) {
        throw new Error(`npm installed ${spec}, but it did not contain memo.manifest.yaml.`);
    }
    return manifests;
}

export function hasProjectContentStore(projectDir: string): boolean {
    return existsSync(projectContentStore(projectDir)) && installedContentManifests(projectDir).length > 0;
}
