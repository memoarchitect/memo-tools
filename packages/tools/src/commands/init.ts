import { basename, join, resolve } from 'node:path';
import { cpSync, existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
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

export interface AvailableOntology {
    name: string;
    version: string;
    type: string;
    description: string;
    extends?: string;
    path: string;
    isDefault: boolean;
}

export interface AvailableExample {
    id: string;
    aliases: string[];
    name: string;
    description: string;
    path: string;
}

export interface AvailableTemplate {
    id: string;
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

export function discoverExamples(fromDir: string): AvailableExample[] {
    const results: AvailableExample[] = [];
    for (const loaded of manifests(fromDir)) {
        for (const [alias, subpath] of Object.entries(loaded.manifest.examples)) {
            const path = resolveManifestPath(loaded, subpath);
            if (!existsSync(path)) continue;
            const id = basename(path);
            if (results.some(result => result.path === path)) continue;
            const configPath = ['memo.package.yaml', 'memo.config.yaml']
                .map(name => resolve(path, name)).find(existsSync);
            let name = id;
            let description = '';
            if (configPath) {
                const raw = readFileSync(configPath, 'utf-8');
                const parsed = parseYaml(raw);
                name = String(parsed?.name ?? parsed?.projectName ?? id);
                description = typeof parsed?.description === 'string'
                    ? parsed.description
                    : (raw.split('\n').find(line => /^#\s+/.test(line))?.replace(/^#\s*/, '') ?? '');
            }
            results.push({ id, aliases: [alias], name, description, path });
        }
    }
    return results;
}

export function discoverTemplates(fromDir: string): AvailableTemplate[] {
    const results: AvailableTemplate[] = [];
    for (const loaded of manifests(fromDir)) {
        for (const [id, subpath] of Object.entries(loaded.manifest.templates)) {
            const path = resolveManifestPath(loaded, subpath);
            if (!existsSync(path) || results.some(result => result.id === id)) continue;
            results.push({ id, path, isDefault: id === loaded.manifest.init.defaultTemplate });
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

export function listTemplatesCommand(fromDir = process.cwd()): void {
    const templates = discoverTemplates(fromDir);
    if (templates.length === 0) {
        console.log(chalk.yellow('No installed project templates found.'));
        return;
    }
    console.log(chalk.bold('\nAvailable templates:\n'));
    for (const template of templates) {
        console.log(`  ${chalk.cyan(template.id)}${template.isDefault ? chalk.green(' (default)') : ''}`);
    }
    console.log(chalk.gray('\nCreate one with: memo init <project> --template <id>\n'));
}

export function listExamplesCommand(fromDir = process.cwd()): void {
    const examples = discoverExamples(fromDir);
    if (examples.length === 0) {
        console.log(chalk.yellow('No installed worked examples found.'));
        return;
    }
    console.log(chalk.bold('\nAvailable examples:\n'));
    for (const example of examples) {
        const aliases = example.aliases.filter(alias => alias !== example.id);
        console.log(`  ${chalk.cyan(example.id)}${aliases.length ? chalk.gray(` (aliases: ${aliases.join(', ')})`) : ''}`);
        if (example.description) console.log(`    ${chalk.gray(example.description)}`);
    }
    console.log(chalk.gray('\nCreate one with: memo init <project> --example <id-or-alias>\n'));
}

export interface InitOptions {
    template?: string;
    ontology?: string;
    list?: boolean;
    example?: string;
    install?: boolean;
}

function matchExample(examples: AvailableExample[], query: string): { example?: AvailableExample; candidates: AvailableExample[] } {
    const exact = examples.find(example => example.id === query || example.aliases.includes(query));
    if (exact) return { example: exact, candidates: [exact] };
    let candidates = examples.filter(example => example.id.startsWith(query)
        || example.aliases.some(alias => alias.startsWith(query)));
    if (candidates.length === 0) candidates = examples.filter(example => example.id.includes(query));
    return { example: candidates.length === 1 ? candidates[0] : undefined, candidates };
}

function ensureTarget(name: string | undefined, exampleId?: string): { projectDir: string; projectName: string; inPlace: boolean } {
    const inPlace = !name || name === '.';
    const projectDir = inPlace ? process.cwd() : resolve(process.cwd(), name!);
    if (inPlace) {
        const entries = readdirSync(projectDir).filter(entry => !entry.startsWith('.'));
        if (entries.length > 0) {
            // A directory is already a MEMO project when it has the native
            // entrypoint, not when it has a YAML file beside it.
            const entrypoint = join(projectDir, 'model', 'catalog', 'project.sysml');
            console.error(chalk.red(existsSync(entrypoint)
                ? '❌ This directory is already a MEMO project (model/catalog/project.sysml exists).'
                : '❌ Current directory is not empty.'));
            if (exampleId) console.log(chalk.gray(`  Run in an empty directory, or pass a name: memo init <name> --example ${exampleId}`));
            process.exit(1);
        }
    } else if (existsSync(projectDir)) {
        console.error(chalk.red(`❌ Directory "${name}" already exists.`));
        process.exit(1);
    }
    return { projectDir, projectName: basename(projectDir), inPlace };
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

function npmPackageName(projectName: string): string {
    const normalized = projectName.toLowerCase()
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
    const exampleQuery = options.example;
    let preparedTarget: ReturnType<typeof ensureTarget> | undefined;
    let loaded: LoadedMemoManifest;
    try {
        if (manifests(fromDir).length === 0 && !options.list) {
            preparedTarget = ensureTarget(name, exampleQuery);
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
        listTemplatesCommand(fromDir);
        listExamplesCommand(fromDir);
        return;
    }

    if (exampleQuery) {
        const { example, candidates } = matchExample(discoverExamples(contentFromDir), exampleQuery);
        if (!example) {
            console.error(chalk.red(candidates.length > 1
                ? `❌ Example "${exampleQuery}" is ambiguous.`
                : `❌ Unknown example "${exampleQuery}".`));
            process.exit(1);
        }
        const target = preparedTarget ?? ensureTarget(name, example.id);
        console.log(chalk.bold(`\n📦 Creating project from example: ${example.id}\n`));
        cpSync(example.path, target.projectDir, { recursive: true });
        scaffoldAnalysisSamples(target.projectDir);
        console.log(chalk.green(target.inPlace ? '\n✅ Project created in current directory' : `\n✅ Project created at ./${name}`));
        return;
    }

    const target = preparedTarget ?? ensureTarget(name);
    const ontology = options.ontology ?? loaded.manifest.init.defaultExtends;
    const templateId = options.template ?? loaded.manifest.init.defaultTemplate;
    const templatePath = loaded.manifest.templates[templateId];
    if (!templatePath) {
        console.error(chalk.red(`❌ Unknown template "${templateId}".`));
        console.log(chalk.gray('Available: ' + Object.keys(loaded.manifest.templates).join(', ')));
        process.exit(1);
    }

    console.log(chalk.bold(`\n📦 Creating MEMO project: ${target.projectName} (template: ${templateId})\n`));
    const templateDir = resolveManifestPath(loaded, templatePath);
    cpSync(templateDir, target.projectDir, { recursive: true });
    scaffoldAnalysisSamples(target.projectDir);
    replaceTokens(target.projectDir, {
        name: target.projectName,
        npmName: npmPackageName(target.projectName),
        ontologyVersion: contentVersion(loaded),
        rootImport: loaded.manifest.init.rootImport,
    });

    // The descriptor records identity only. What the project selects is in
    // model/catalog/project.sysml: native imports and a ProjectMethodBinding.
    // `--ontology` chooses which package the entrypoint imports, and the
    // descriptor never repeats that choice.
    const configPath = resolve(target.projectDir, 'memo.package.yaml');
    const descriptor = parseYaml(readFileSync(configPath, 'utf-8')) ?? {};
    descriptor.name = target.projectName;
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
        : 'model/catalog/project.sysml';
    descriptor.entrypoint = entrypointRel;

    if (!existsSync(resolve(target.projectDir, entrypointRel))) {
        console.error(chalk.red(
            `❌ Template "${templateId}" produced no ${entrypointRel}. `
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
        const { resolveNativeProject } = await import('@memoarchitect/tools');
        const resolution = await resolveNativeProject(target.projectDir);
        const { lock } = createLockFile(target.projectDir, resolution.selectedRoots.map(root => ({
            ...root, origin: 'ontology', importDepth: 1,
        })));
        console.log(chalk.gray(`  Created memo.lock.yaml (locked to ${lock.ontology} v${lock.version})`));
    } catch (error) {
        console.log(chalk.yellow(`  ⚠ Could not create lock file: ${error instanceof Error ? error.message : error}`));
    }
    console.log(chalk.green(target.inPlace ? '\n✅ Project created in current directory' : `\n✅ Project created at ./${target.projectName}`));
}
