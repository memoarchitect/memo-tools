// ─── memo install ────────────────────────────────────────────────────────────
//
// Installs an ontology package into the current project.
// Three install modes:
//   memo install <git-url>       — Clone into memo_packages/ from git
//   memo install <npm-package>   — Install via npm into node_modules/
//   memo install <local-path>    — Symlink into memo_packages/
//
// Adds the package to memo.package.yaml under `dependencies`.
// Resolution order (handled by config-resolver):
//   1. memo/packages/<name>/  (git submodule)
//   2. packages/<name>/                      (workspace)
//   3. memo_packages/<name>/                 (local installs)
//   4. node_modules/<name>/                  (npm installs)
// ─────────────────────────────────────────────────────────────────────────────

import { resolve, basename, join } from 'node:path';
import { existsSync, readFileSync, writeFileSync, symlinkSync, lstatSync, mkdirSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import chalk from 'chalk';
import {
    contentPackageName,
    findConfigFile,
    findMemoManifests,
    installContentPackage,
} from '@memoarchitect/tools';
import { readLockFile } from '../lock.js';

/** Detect which install mode to use based on the source string */
export type InstallMode = 'git' | 'npm' | 'local';

export function detectInstallMode(source: string): InstallMode {
    // Git URLs: ssh, https with .git, or explicit git+ prefix
    if (
        source.startsWith('git@') ||
        source.startsWith('git+') ||
        source.startsWith('git://') ||
        (source.startsWith('https://') && source.endsWith('.git')) ||
        (source.startsWith('http://') && source.endsWith('.git'))
    ) {
        return 'git';
    }

    // Local paths: starts with /, ./, or ../
    if (source.startsWith('/') || source.startsWith('./') || source.startsWith('../')) {
        return 'local';
    }

    // Also local if the path exists on disk
    if (existsSync(resolve(source))) {
        return 'local';
    }

    // Default: npm package
    return 'npm';
}

/** Read package name from a memo.package.yaml in a directory */
function readPackageName(dir: string): string | undefined {
    const pkgPath = join(dir, 'memo.package.yaml');
    if (!existsSync(pkgPath)) return undefined;
    try {
        const raw = readFileSync(pkgPath, 'utf-8');
        const parsed = parseYaml(raw);
        return parsed?.name;
    } catch {
        return undefined;
    }
}

/** Read package version from a memo.package.yaml in a directory */
function readPackageVersion(dir: string): string | undefined {
    const pkgPath = join(dir, 'memo.package.yaml');
    if (!existsSync(pkgPath)) return undefined;
    try {
        const raw = readFileSync(pkgPath, 'utf-8');
        const parsed = parseYaml(raw);
        return parsed?.version;
    } catch {
        return undefined;
    }
}

/** Add a dependency to memo.package.yaml */
function addDependency(configPath: string, packageName: string, version: string): void {
    const raw = readFileSync(configPath, 'utf-8');
    const parsed = parseYaml(raw);

    if (!parsed.dependencies) {
        parsed.dependencies = {};
    }
    parsed.dependencies[packageName] = version;

    // Re-serialize preserving comments by doing a targeted append if possible
    // For simplicity, use yaml stringify
    writeFileSync(configPath, stringifyYaml(parsed, { lineWidth: 0 }));
}

export interface InstallOptions {
    mode?: InstallMode;
}

export async function installCommand(
    source: string | undefined,
    options: InstallOptions
): Promise<void> {
    const projectDir = process.cwd();

    // Find project config
    const configPath = findConfigFile(projectDir);
    if (!configPath) {
        console.error(chalk.red('❌ No memo.package.yaml or memo.config.yaml found in this directory.'));
        console.error(chalk.gray('  Run `memo init <name>` to create a new project first.'));
        process.exit(1);
    }

    if (!source) {
        const lock = readLockFile(projectDir);
        if (!lock) {
            console.error(chalk.red('❌ No memo.lock.yaml found. Run `memo lock` after resolving the configured ontology.'));
            process.exit(1);
        }
        const physicalPackage = contentPackageName();
        if (findMemoManifests(projectDir).some(manifest => manifest.manifest.packages[lock.ontology])) {
            console.log(chalk.green(`✅ ${physicalPackage} v${lock.version} is already resolvable.`));
            return;
        }
        console.log(chalk.bold(`\n📦 Installing locked MEMO content v${lock.version}...\n`));
        try {
            const installed = installContentPackage(projectDir, lock.version);
            if (!installed.some(manifest => manifest.manifest.packages[lock.ontology])) {
                throw new Error(`installed content does not provide logical package "${lock.ontology}"`);
            }
        } catch (error) {
            console.error(chalk.red(`❌ npm install failed: ${error instanceof Error ? error.message : error}`));
            process.exit(1);
        }
        console.log(chalk.green(`\n✅ Installed ${physicalPackage} v${lock.version}`));
        console.log(chalk.gray(`  Location: ${join(projectDir, '.memo', 'content')}\n`));
        return;
    }

    const mode = options.mode ?? detectInstallMode(source);

    console.log(chalk.bold(`\n📦 Installing package (${mode})...\n`));

    let packageName: string | undefined;
    let packageVersion: string | undefined;
    let installedDir: string;

    switch (mode) {
        case 'git':
            ({ packageName, packageVersion, installedDir } = await installFromGit(source, projectDir));
            break;
        case 'local':
            ({ packageName, packageVersion, installedDir } = await installFromLocal(source, projectDir));
            break;
        case 'npm':
            ({ packageName, packageVersion, installedDir } = await installFromNpm(source, projectDir));
            break;
    }

    if (!packageName) {
        console.error(chalk.red('❌ Could not determine package name from installed source.'));
        process.exit(1);
    }

    // Add dependency to memo.package.yaml (only for new-format files)
    const configFilename = configPath.split('/').pop() ?? '';
    if (configFilename.startsWith('memo.package.')) {
        addDependency(configPath, packageName, packageVersion ?? '*');
        console.log(chalk.gray(`  Added ${packageName}@${packageVersion ?? '*'} to memo.package.yaml dependencies`));
    }

    console.log(chalk.green(`\n✅ Installed ${packageName}${packageVersion ? ` v${packageVersion}` : ''}`));
    console.log(chalk.gray(`  Location: ${installedDir}\n`));
}

interface InstallResult {
    packageName: string | undefined;
    packageVersion: string | undefined;
    installedDir: string;
}

/**
 * Install from a git URL by cloning into memo_packages/.
 */
async function installFromGit(source: string, projectDir: string): Promise<InstallResult> {
    const memoPackagesDir = join(projectDir, 'memo_packages');
    mkdirSync(memoPackagesDir, { recursive: true });

    // Derive a directory name from the git URL
    const repoName = basename(source, '.git').replace(/^git\+/, '');
    const targetDir = join(memoPackagesDir, repoName);

    if (existsSync(targetDir)) {
        console.log(chalk.yellow(`  Directory memo_packages/${repoName} already exists, pulling latest...`));
        try {
            execSync('git pull', { cwd: targetDir, stdio: 'pipe' });
        } catch (e) {
            console.error(chalk.red(`  Failed to pull: ${e instanceof Error ? e.message : e}`));
        }
    } else {
        console.log(chalk.gray(`  Cloning into memo_packages/${repoName}...`));
        try {
            execSync(`git clone ${source} ${targetDir}`, { stdio: 'pipe' });
        } catch (e) {
            console.error(chalk.red(`❌ Failed to clone: ${e instanceof Error ? e.message : e}`));
            process.exit(1);
        }
    }

    const packageName = readPackageName(targetDir);
    const packageVersion = readPackageVersion(targetDir);

    return { packageName, packageVersion, installedDir: targetDir };
}

/**
 * Install from a local path by creating a symlink in memo_packages/.
 */
async function installFromLocal(source: string, projectDir: string): Promise<InstallResult> {
    const sourcePath = resolve(projectDir, source);

    if (!existsSync(sourcePath)) {
        console.error(chalk.red(`❌ Local path does not exist: ${sourcePath}`));
        process.exit(1);
    }

    const packageName = readPackageName(sourcePath);
    const packageVersion = readPackageVersion(sourcePath);
    const dirName = packageName?.replace(/^@[^/]+\//, '') ?? basename(sourcePath);

    const memoPackagesDir = join(projectDir, 'memo_packages');
    mkdirSync(memoPackagesDir, { recursive: true });

    const linkPath = join(memoPackagesDir, dirName);

    if (existsSync(linkPath)) {
        // Check if it's already a symlink to the same target
        try {
            if (lstatSync(linkPath).isSymbolicLink()) {
                console.log(chalk.yellow(`  Symlink memo_packages/${dirName} already exists, replacing...`));
                const { unlinkSync } = await import('node:fs');
                unlinkSync(linkPath);
            } else {
                console.error(chalk.red(`❌ memo_packages/${dirName} already exists and is not a symlink.`));
                process.exit(1);
            }
        } catch {
            console.error(chalk.red(`❌ memo_packages/${dirName} already exists.`));
            process.exit(1);
        }
    }

    console.log(chalk.gray(`  Symlinking memo_packages/${dirName} → ${sourcePath}`));
    symlinkSync(sourcePath, linkPath, 'dir');

    return { packageName, packageVersion, installedDir: linkPath };
}

/**
 * Install from npm into node_modules/.
 */
async function installFromNpm(source: string, projectDir: string): Promise<InstallResult> {
    console.log(chalk.gray(`  Running: npm install ${source}`));

    try {
        execSync(`npm install ${source}`, {
            cwd: projectDir,
            stdio: 'pipe',
        });
    } catch (e) {
        console.error(chalk.red(`❌ npm install failed: ${e instanceof Error ? e.message : e}`));
        process.exit(1);
    }

    // Try to find the installed package in node_modules
    const shortName = source.replace(/@[^/]+$/, ''); // strip version suffix like @1.0.0
    const nmDir = join(projectDir, 'node_modules', shortName);

    const packageName = existsSync(nmDir) ? readPackageName(nmDir) ?? shortName : shortName;
    const packageVersion = existsSync(nmDir) ? readPackageVersion(nmDir) : undefined;

    return { packageName, packageVersion, installedDir: nmDir };
}
