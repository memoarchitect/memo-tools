import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { discoverMemoManifests, type LoadedMemoManifest } from './manifest.js';

interface ToolsPackageMetadata {
    memo?: {
        contentPackage?: string;
        /** The patched minimum of each Node line, from the latest Node security release, and where it is announced. */
        nodeSecurity?: { advisory: string; patched: Record<string, string> };
    };
    dependencies?: Record<string, string>;
}

function packageMetadata(): ToolsPackageMetadata {
    let dir = dirname(fileURLToPath(import.meta.url));
    while (true) {
        const candidate = resolve(dir, 'package.json');
        if (existsSync(candidate)) {
            const metadata = JSON.parse(readFileSync(candidate, 'utf-8')) as ToolsPackageMetadata & { name?: string };
            if (metadata.name === '@memoarchitect/tools') return metadata;
        }
        const parent = dirname(dir);
        if (parent === dir) break;
        dir = parent;
    }
    throw new Error('Could not locate the @memoarchitect/tools package manifest.');
}

const versionParts = (version: string): number[] => version.replace(/^v/, '').split('.').map(part => Number.parseInt(part, 10) || 0);
const olderThan = (a: string, b: string): boolean => {
    const [x, y] = [versionParts(a), versionParts(b)];
    for (let i = 0; i < 3; i++) if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) < (y[i] ?? 0);
    return false;
};

/**
 * A warning when this Node is older than the patched release of its line, else nothing. It never stops a
 * command: an unsupported Node is what `engines` refuses, and a missing security patch is the machine's to fix.
 */
export function nodeSecurityWarning(version: string = process.versions.node): string | undefined {
    const security = packageMetadata().memo?.nodeSecurity;
    if (!security) return undefined;
    const line = String(versionParts(version)[0]);
    const patched = security.patched[line];
    if (!patched || !olderThan(version, patched)) return undefined;
    return `Node.js ${version} is missing a security release: update to ${patched} or later, then restart MEMO `
        + `(a running \`memo-architect dev\` too). ${security.advisory}`;
}

export function contentPackageName(): string {
    const name = packageMetadata().memo?.contentPackage;
    if (!name) throw new Error('This @memoarchitect/tools package does not declare its MEMO content package.');
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
    return resolve(projectDir, 'node_modules');
}

export function installedContentManifests(projectDir: string): LoadedMemoManifest[] {
    return discoverMemoManifests([projectDir]);
}

export function installContentPackage(projectDir: string, version?: string): LoadedMemoManifest[] {
    const spec = contentPackageSpec(version);
    execFileSync('npm', ['install', '--save-exact', '--ignore-scripts', spec], {
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
