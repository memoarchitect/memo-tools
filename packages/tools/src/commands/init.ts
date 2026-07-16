import { basename, resolve } from 'node:path';
import { cpSync, existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import chalk from 'chalk';
import {
    findConfigFile,
    findMemoManifests,
    installContentPackage,
    resolveManifestPath,
    type LoadedMemoManifest,
} from '@memo/tools';
import { createLockFile } from '../lock.js';
import {
    loadArchetypes,
    findArchetype,
    deviceClassArchetypes,
    profileArchetypes,
    type ArchetypeInfo,
} from './archetype-loader.js';
import { runWizard } from './init-wizard.js';

export { type ArchetypeInfo } from './archetype-loader.js';

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
                if (parsed?.type !== 'ontology' && parsed?.type !== 'profile') continue;
                results.push({
                    name,
                    version: String(parsed.version ?? '0.0.0'),
                    type: String(parsed.type),
                    description: String(parsed.description ?? ''),
                    extends: typeof parsed.extends === 'string' ? parsed.extends : undefined,
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
                description = raw.split('\n')[0]?.replace(/^#\s*/, '') ?? '';
            }
            results.push({ id, aliases: [alias], name, description, path });
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
    template?: string;
    ontology?: string;
    archetype?: string;
    listOntologies?: boolean;
    example?: string;
    fromExample?: string;
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
            const config = findConfigFile(projectDir);
            console.error(chalk.red(config
                ? `❌ This directory is already a MEMO project (${basename(config)} exists).`
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
    const exampleQuery = options.example ?? options.fromExample;
    let preparedTarget: ReturnType<typeof ensureTarget> | undefined;
    let loaded: LoadedMemoManifest;
    try {
        if (manifests(fromDir).length === 0 && !options.listOntologies) {
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
    const archetypes = await loadArchetypes(contentFromDir, loaded);

    if (options.listOntologies) {
        listOntologiesCommand(fromDir);
        const examples = discoverExamples(fromDir);
        if (examples.length > 0) {
            console.log(chalk.bold('Available examples:\n'));
            for (const example of examples) console.log(`  ${chalk.cyan(example.id)}`);
            console.log();
        }
        const profiles = profileArchetypes(archetypes);
        if (profiles.length > 0) console.log(chalk.bold(`Available profiles:\n${profiles.map(p => `  ${p.id}`).join('\n')}\n`));
        console.log(chalk.bold('Available device archetypes:\n'));
        for (const archetype of deviceClassArchetypes(archetypes)) console.log(`  ${chalk.cyan(archetype.id)}\n    ${chalk.gray(archetype.description)}`);
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
        console.log(chalk.green(target.inPlace ? '\n✅ Project created in current directory' : `\n✅ Project created at ./${name}`));
        return;
    }

    const target = preparedTarget ?? ensureTarget(name);
    const ontology = options.ontology ?? loaded.manifest.init.defaultExtends;
    let selectedArchetype = options.archetype ? findArchetype(archetypes, options.archetype) : undefined;
    if (options.archetype && !selectedArchetype) {
        console.error(chalk.red(`❌ Unknown archetype "${options.archetype}".`));
        console.log(chalk.gray('Available: ' + archetypes.map(entry => entry.id).join(', ')));
        process.exit(1);
    }
    if (!selectedArchetype && process.stdin.isTTY) {
        try {
            const result = await runWizard(deviceClassArchetypes(archetypes));
            selectedArchetype = findArchetype(archetypes, result.archetypeId);
        } catch { selectedArchetype = findArchetype(archetypes, 'blank'); }
    }
    selectedArchetype ??= findArchetype(archetypes, 'blank');

    console.log(chalk.bold(`\n📦 Creating MEMO project: ${target.projectName}\n`));
    const templateDir = resolveManifestPath(loaded, loaded.manifest.init.template);
    cpSync(templateDir, target.projectDir, { recursive: true });
    if (selectedArchetype?.templateDir) {
        const archetypesPath = resolveManifestPath(loaded, loaded.manifest.init.archetypes);
        const starter = resolve(archetypesPath, '..', 'templates', selectedArchetype.templateDir, 'starter.sysml');
        if (!existsSync(starter)) throw new Error(`Archetype template not found: ${starter}`);
        cpSync(starter, resolve(target.projectDir, 'src', 'catalog', 'starter.sysml'));
    }
    replaceTokens(target.projectDir, { name: target.projectName, rootImport: loaded.manifest.init.rootImport });

    const configPath = resolve(target.projectDir, 'memo.package.yaml');
    const config = parseYaml(readFileSync(configPath, 'utf-8'));
    config.name = target.projectName;
    config.extends = ontology;
    if (selectedArchetype && selectedArchetype.id !== 'blank') config.archetype = selectedArchetype.id;
    writeFileSync(configPath, stringifyYaml(config, { lineWidth: 0 }));

    try {
        const { lock } = createLockFile(configPath);
        console.log(chalk.gray(`  Created memo.lock.yaml (locked to ${lock.ontology} v${lock.version})`));
    } catch (error) {
        console.log(chalk.yellow(`  ⚠ Could not create lock file: ${error instanceof Error ? error.message : error}`));
    }
    console.log(chalk.green(target.inPlace ? '\n✅ Project created in current directory' : `\n✅ Project created at ./${target.projectName}`));
}
