import { basename, join, resolve } from 'node:path';
import { cpSync, existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { parse as parseYaml, parseDocument, stringify as stringifyYaml } from 'yaml';
import chalk from 'chalk';
import {
    findConfigFile,
    findMemoManifests,
    installContentPackage,
    resolveManifestPath,
    type LoadedMemoManifest,
} from '@memoarchitect/tools';
import { createLockFile } from '../lock.js';
import { scaffoldAnalysisSamples } from '../analysis-starters.js';
import { loadProjectSettings } from '../model/config-loader.js';
import { loadProjectOntology } from '../toolchain/project-model.js';
import { RECOMMENDED_COMPILER } from '../toolchain/providers/recommended.js';

/**
 * The compiler a new project names: the recommended one (`toolchain/providers/recommended.ts`,
 * the single place to change it). It is the project's
 * choice, written into its own settings file so everyone who clones it runs the
 * same one; a user who wants another overrides it for themselves
 * (Architect's Compiler control) without editing the project. A project that
 * already names a compiler, or both roles, keeps its own.
 */
const NEW_PROJECT_COMPILER = RECOMMENDED_COMPILER;

function namesACompiler(toolchain: Record<string, unknown> | undefined): boolean {
    return Boolean(toolchain && (toolchain.compiler || (toolchain.validator && toolchain.lowering)));
}

export interface AvailableOntology {
    name: string;
    version: string;
    type: string;
    description: string;
    extends?: string;
    path: string;
    isDefault: boolean;
}

function manifests(fromDir: string): LoadedMemoManifest[] {
    return findMemoManifests(fromDir);
}

export function discoverOntologies(fromDir: string): AvailableOntology[] {
    const results: AvailableOntology[] = [];
    for (const loaded of manifests(fromDir)) {
        for (const [name, subpath] of Object.entries(loaded.manifest.packages)) {
            const path = resolve(resolveManifestPath(loaded, subpath), 'memo.package.yaml');
            if (!existsSync(path) || results.some(result => result.name === name)) continue;
            try {
                const parsed = parseYaml(readFileSync(path, 'utf-8'));
                // Every manifest-listed package is offered. The `type:` field
                // that used to gate this was a semantic classifier and is gone;
                // what a package supplies is what its SysML declares.
                results.push({
                    name,
                    version: String(parsed.version ?? '0.0.0'),
                    type: 'package',
                    description: String(parsed.description ?? ''),
                    path,
                    isDefault: name === loaded.manifest.init.defaultExtends,
                });
            } catch { /* skip malformed logical packages */ }
        }
    }
    return results;
}

export function listOntologiesCommand(fromDir = process.cwd()): void {
    const available = discoverOntologies(fromDir);
    if (available.length === 0) {
        console.log(chalk.yellow('No installed MEMO content manifest found.'));
        return;
    }
    console.log(chalk.bold('\nAvailable ontology packages:\n'));
    for (const ontology of available) {
        console.log(`  ${chalk.cyan(ontology.name)}${ontology.isDefault ? chalk.green(' (default)') : ''}`);
        console.log(`    ${chalk.gray(`v${ontology.version} · ${ontology.type}`)}`);
        if (ontology.description) console.log(`    ${chalk.gray(ontology.description)}`);
        console.log();
    }
}

export interface InitOptions {
    ontology?: string;
    list?: boolean;
    install?: boolean;
}

function ensureTarget(name: string | undefined): { projectDir: string; modelName: string; inPlace: boolean } {
    const inPlace = !name || name === '.';
    const projectDir = inPlace ? process.cwd() : resolve(process.cwd(), name!);
    if (inPlace) {
        const entries = readdirSync(projectDir).filter(entry => !entry.startsWith('.'));
        if (entries.length > 0) {
            // A directory is already a MEMO project when it has the native
            // entrypoint, not when it has a YAML file beside it.
            const entrypoint = join(projectDir, 'model', 'methodology', 'project.sysml');
            console.error(chalk.red(existsSync(entrypoint)
                ? '❌ This directory is already a MEMO project (model/methodology/project.sysml exists).'
                : '❌ Current directory is not empty.'));
            process.exit(1);
        }
    } else if (existsSync(projectDir)) {
        console.error(chalk.red(`❌ Directory "${name}" already exists.`));
        process.exit(1);
    }
    return { projectDir, modelName: basename(projectDir), inPlace };
}

function replaceTokens(dir: string, values: Record<string, string>): void {
    for (const entry of readdirSync(dir)) {
        if (entry === '.memo') continue;
        const path = resolve(dir, entry);
        if (statSync(path).isDirectory()) {
            replaceTokens(path, values);
            continue;
        }
        const content = readFileSync(path);
        if (content.includes(0)) continue;
        let text = content.toString('utf-8');
        for (const [key, value] of Object.entries(values)) text = text.replaceAll(`{{${key}}}`, value);
        writeFileSync(path, text);
    }
}

function npmPackageName(modelName: string): string {
    const normalized = modelName.toLowerCase()
        .replace(/[^a-z0-9._-]+/g, '-')
        .replace(/^[._-]+|[._-]+$/g, '');
    return normalized || 'memo-project';
}

function contentVersion(loaded: LoadedMemoManifest): string {
    const packagePath = resolve(loaded.rootDir, 'package.json');
    if (!existsSync(packagePath)) {
        throw new Error(`content package has no package.json: ${loaded.rootDir}`);
    }
    const metadata = JSON.parse(readFileSync(packagePath, 'utf-8')) as { version?: unknown };
    if (typeof metadata.version !== 'string' || metadata.version.length === 0) {
        throw new Error(`content package has no version: ${packagePath}`);
    }
    return metadata.version;
}

function installProjectDependencies(projectDir: string): void {
    execFileSync('npm', ['install', '--ignore-scripts'], {
        cwd: projectDir,
        stdio: 'pipe',
    });
}

function selectManifest(fromDir: string, logicalName?: string): LoadedMemoManifest {
    const available = manifests(fromDir);
    const selected = logicalName
        ? available.find(entry => logicalName in entry.manifest.packages)
        : available[0];
    if (!selected) {
        throw new Error(logicalName
            ? `ontology "${logicalName}" not found in an installed MEMO content manifest`
            : 'no installed MEMO content manifest was found');
    }
    return selected;
}

export async function initCommand(name: string | undefined, options: InitOptions): Promise<void> {
    const fromDir = process.cwd();
    let preparedTarget: ReturnType<typeof ensureTarget> | undefined;
    let loaded: LoadedMemoManifest;
    try {
        if (manifests(fromDir).length === 0 && !options.list) {
            preparedTarget = ensureTarget(name);
            console.log(chalk.gray('  Fetching MEMO content package...'));
            installContentPackage(preparedTarget.projectDir);
            loaded = selectManifest(preparedTarget.projectDir, options.ontology);
        } else {
            loaded = selectManifest(fromDir, options.ontology);
        }
    }
    catch (error) {
        console.error(chalk.red(`❌ ${error instanceof Error ? error.message : error}`));
        console.error(chalk.gray('  Install the content package with npm, or set MEMO_CONTENT_SPEC to an npm package/tarball.'));
        process.exit(1);
    }
    const contentFromDir = preparedTarget?.projectDir ?? fromDir;

    if (options.list) {
        listOntologiesCommand(fromDir);
        return;
    }

    const target = preparedTarget ?? ensureTarget(name);
    const ontology = options.ontology ?? loaded.manifest.init.defaultExtends;
    const templatePath = loaded.manifest.init.template;

    console.log(chalk.bold(`\n📦 Creating MEMO model: ${target.modelName}\n`));
    const templateDir = resolveManifestPath(loaded, templatePath);
    cpSync(templateDir, target.projectDir, { recursive: true });
    scaffoldAnalysisSamples(target.projectDir);
    replaceTokens(target.projectDir, {
        name: target.modelName,
        npmName: npmPackageName(target.modelName),
        ontologyVersion: contentVersion(loaded),
        rootImport: loaded.manifest.init.rootImport,
    });

    // The descriptor records identity only. What the project selects is in
    // model/methodology/project.sysml: native imports and a ModelMethodBinding.
    // `--ontology` chooses which package the entrypoint imports, and the
    // descriptor never repeats that choice.
    const configPath = resolve(target.projectDir, 'memo.package.yaml');
    const descriptor = parseYaml(readFileSync(configPath, 'utf-8')) ?? {};
    descriptor.name = target.modelName;
    for (const semanticField of ['extends', 'type', 'usage', 'methodology', 'ontologies', 'modules']) {
        delete descriptor[semanticField];
    }

    // The `entrypoint` locator is written here rather than inherited from
    // whatever the template's descriptor happened to carry. There is no
    // conventional fallback any more, so a template that omitted the locator
    // would scaffold a directory no MEMO command can resolve — the failure
    // would surface much later, as "no project found" next to a file that is
    // plainly present. A template MAY still choose its own location (a project
    // rooted at `src/project.sysml`); that choice is respected and only the
    // default is filled in.
    const entrypointRel = typeof descriptor.entrypoint === 'string' && descriptor.entrypoint.trim()
        ? descriptor.entrypoint.trim()
        : 'model/methodology/project.sysml';
    descriptor.entrypoint = entrypointRel;
    if (!namesACompiler(descriptor.toolchain)) {
        descriptor.toolchain = { ...(descriptor.toolchain ?? {}), compiler: NEW_PROJECT_COMPILER };
        console.log(chalk.gray(`  Compiler: ${NEW_PROJECT_COMPILER} (in memo.package.yaml; change it in Architect: the Compiler control, or memo-architect config set compiler <id>)`));
    }

    if (!existsSync(resolve(target.projectDir, entrypointRel))) {
        console.error(chalk.red(
            `❌ The project skeleton produced no ${entrypointRel}. `
            + `A MEMO project's identity and method binding are SysML — a template without an `
            + `entrypoint cannot express either.`));
        process.exit(1);
    }

    writeFileSync(configPath, stringifyYaml(descriptor, { lineWidth: 0 }));
    console.log(chalk.gray(`  Native entrypoint: ${entrypointRel} (methodology from ${ontology})`));

    if (options.install !== false) {
        try {
            console.log(chalk.gray('  Installing the project-local MEMO ontology...'));
            installProjectDependencies(target.projectDir);
            console.log(chalk.gray('  Installed @memoarchitect/ontology in node_modules'));
        } catch (error) {
            console.error(chalk.red(`❌ npm install failed: ${error instanceof Error ? error.message : error}`));
            console.error(chalk.gray(`  The project was created at ${target.projectDir}. Run npm install there to finish setup.`));
            process.exit(1);
        }
    }

    try {
        const { resolution } = await loadProjectOntology({
            projectRoot: target.projectDir, config: loadProjectSettings(target.projectDir),
        });
        if (!resolution) throw new Error('the project did not resolve');
        const { lock } = createLockFile(target.projectDir, resolution.selectedRoots.map(root => ({
            ...root, origin: 'ontology', importDepth: 1,
        })));
        console.log(chalk.gray(`  Created memo.lock.yaml (locked to ${lock.ontology} v${lock.version})`));
    } catch (error) {
        console.log(chalk.yellow(`  ⚠ Could not create lock file: ${error instanceof Error ? error.message : error}`));
    }
    console.log(chalk.green(target.inPlace ? '\n✅ Model created in current directory' : `\n✅ Model created at ./${target.modelName}`));
}
