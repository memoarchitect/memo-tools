// ─── memo ontology ──────────────────────────────────────────────────────────
//
// Commands:
//   memo ontology show        — Show resolved ontology in the terminal
//   memo ontology export owl  — Export ontology as OWL/RDF (Turtle)
//   memo ontology export xml  — Export ontology as OWL/RDF (XML)
//   memo ontology export sysand — Export ontology dependency stack as a SysAnd project
// ─────────────────────────────────────────────────────────────────────────────

import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { basename, dirname, extname, join, relative, resolve } from 'node:path';
import chalk from 'chalk';
import type { MEMOConfig } from '@memoarchitect/tools';
import { findConfigFile, loadOntologyRegistries, exportToOwlTurtle, exportToOwlXml } from '@memoarchitect/tools';
import { loadAndResolveConfig, loadConfigChain, type ConfigChainEntry } from '../server/config-resolver.js';

// ─── memo ontology add-kind ──────────────────────────────────────────────────

export function ontologyAddKindCommand(name: string, options: { layer: string; output?: string }): void { // sync — no async needed
    const cwd = process.cwd();

    // Validate kind name: must be a valid PascalCase identifier
    if (!/^[A-Z][A-Za-z0-9]*$/.test(name)) {
        console.error(chalk.red(`❌ Kind name "${name}" must be a PascalCase identifier (e.g. MyKind).`));
        process.exit(1);
    }

    // Validate layer: only word chars and slashes
    const layer = options.layer.trim();
    if (!/^[A-Za-z][A-Za-z0-9_/]*$/.test(layer)) {
        console.error(chalk.red(`❌ Layer "${layer}" must be alphanumeric (e.g. requirements or architecture/requirements).`));
        process.exit(1);
    }

    // Derive package namespace segment from layer path (last segment)
    const layerSegments = layer.split('/');
    const packageSegment = layerSegments[layerSegments.length - 1];

    // Derive outer namespace from config if available, else 'local'
    let namespace = 'local';
    const configPath = findConfigFile(cwd);
    if (configPath) {
        try {
            const cfg = loadAndResolveConfig(configPath);
            if (cfg?.ontologyMetadata?.id) namespace = cfg.ontologyMetadata.id.replace(/^@[^/]+\//, '').replace(/[^A-Za-z0-9_]/g, '_');
            else if (cfg?.projectName) namespace = (cfg.projectName as string).replace(/[^A-Za-z0-9_]/g, '_');
        } catch {
            // ignore — fall back to 'local'
        }
    }

    // Build output path
    const outputDir = options.output
        ? resolve(cwd, options.output)
        : resolve(cwd, 'ontology', layer);
    const fileName = `${name}.sysml`;
    const outputPath = join(outputDir, fileName);

    if (existsSync(outputPath)) {
        console.error(chalk.yellow(`⚠  ${outputPath} already exists. Delete it first to regenerate.`));
        process.exit(1);
    }

    mkdirSync(outputDir, { recursive: true });

    // Build package nesting from layer path segments
    const openPkgs = layerSegments.map((seg, i) => `${'    '.repeat(i + 1)}package ${seg} {`).join('\n');
    const closePkgs = layerSegments.map((_, i) => `${'    '.repeat(layerSegments.length - i)}}`)  .join('\n');
    const indent = '    '.repeat(layerSegments.length + 1);

    const content = [
        `package ${namespace} {`,
        openPkgs,
        `${indent}private import memo::core::common::*;`,
        `${indent}private import memo::core::enumerations::*;`,
        '',
        `${indent}part def ${name} specializes TraceableElement {`,
        `${indent}    attribute doc : String;`,
        `${indent}}`,
        closePkgs,
        '}',
        '',
    ].join('\n');

    writeFileSync(outputPath, content, 'utf-8');

    console.log(chalk.bold(`\n◎ MEMO Ontology — add-kind\n`));
    console.log(chalk.cyan(`  Kind:  `) + name);
    console.log(chalk.cyan(`  Layer: `) + layer);
    console.log(chalk.green(`\n✅ Written to ${relative(cwd, outputPath)}\n`));
}

export async function ontologyShowCommand(): Promise<void> {
    const cwd = process.cwd();

    console.log(chalk.bold('\n\u25C9 MEMO Ontology\n'));

    const configPath = findConfigFile(cwd);
    if (!configPath) {
        console.error(chalk.red('\u274C No memo config found.'));
        process.exit(1);
    }

    const config = loadAndResolveConfig(configPath);

    // Show metadata
    if (config.ontologyMetadata) {
        console.log(chalk.cyan('  ID:      ') + config.ontologyMetadata.id);
        console.log(chalk.cyan('  Version: ') + config.ontologyMetadata.version);
        console.log(chalk.cyan('  Desc:    ') + config.ontologyMetadata.description);
    }
    console.log(chalk.cyan('  Extends: ') + (config.extends || 'none'));
    console.log('');

    // Layers
    const layers = config.architectureLayers || [];
    console.log(chalk.bold(`  Layers (${layers.length}):`));
    for (const l of layers) {
        console.log(`    ${chalk.hex(l.color)('\u25CF')} ${l.label} (${l.id})`);
    }
    console.log('');

    // Load registries for kinds and relationships
    const loadResult = await loadOntologyRegistries(configPath);
    const kindRegistry = loadResult.registries.kindRegistry;
    const relationshipRegistry = loadResult.registries.relationshipRegistry;

    // Kinds by layer (from registry)
    if (kindRegistry) {
        const kindEntries = kindRegistry.entries();
        console.log(chalk.bold(`  Kinds (${kindEntries.length}):`));
        const byLayer = new Map<string, string[]>();
        for (const entry of kindEntries) {
            const layer = entry.layer || 'unknown';
            if (!byLayer.has(layer)) byLayer.set(layer, []);
            byLayer.get(layer)!.push(entry.name);
        }
        for (const l of layers) {
            const kinds = byLayer.get(l.id) || [];
            if (kinds.length > 0) {
                console.log(`    ${chalk.hex(l.color)(l.label)}: ${kinds.join(', ')}`);
            }
        }
        // Show any kinds not in a known layer
        for (const [layer, kinds] of byLayer) {
            if (!layers.find(l => l.id === layer)) {
                console.log(`    ${layer}: ${kinds.join(', ')}`);
            }
        }
    } else {
        // Fallback to config kinds (legacy)
        const kindEntries = Object.entries(config.kinds ?? {});
        console.log(chalk.bold(`  Kinds (${kindEntries.length}):`));
        const byLayer = new Map<string, string[]>();
        for (const [name, def] of kindEntries) {
            const layer = def.layer || 'unknown';
            if (!byLayer.has(layer)) byLayer.set(layer, []);
            byLayer.get(layer)!.push(name);
        }
        for (const l of layers) {
            const kinds = byLayer.get(l.id) || [];
            if (kinds.length > 0) {
                console.log(`    ${chalk.hex(l.color)(l.label)}: ${kinds.join(', ')}`);
            }
        }
    }
    console.log('');

    // Relationships (from registry)
    if (relationshipRegistry) {
        const relEntries = relationshipRegistry.entries();
        console.log(chalk.bold(`  Relationships (${relEntries.length}):`));
        console.log(`    ${relEntries.map(r => r.name).join(', ')}`);
    } else {
        const relTypes = config.relationshipTypes ?? [];
        console.log(chalk.bold(`  Relationships (${relTypes.length}):`));
        console.log(`    ${relTypes.map(r => r.name).join(', ')}`);
    }
    console.log('');

    // Viewpoints
    const viewpoints = config.viewpoints || [];
    console.log(chalk.bold(`  Viewpoints (${viewpoints.length}):`));
    for (const vp of viewpoints) {
        console.log(`    ${vp.label} (${vp.visibleKinds.length} kinds, ${vp.visibleRelationships.length} rels)`);
    }
    console.log('');
}

export async function ontologyExportOwlCommand(options: {
    output?: string;
    format?: string;
    namespace?: string;
}): Promise<void> {
    const cwd = process.cwd();
    const format = options.format || 'turtle';

    console.log(chalk.bold(`\n\u{1F4E4} MEMO Ontology Export \u2192 OWL/${format.toUpperCase()}\n`));

    const configPath = findConfigFile(cwd);
    if (!configPath) {
        console.error(chalk.red('\u274C No memo config found.'));
        process.exit(1);
    }

    const config = loadAndResolveConfig(configPath);
    const ns = options.namespace || 'https://sysand.dev/ontology/memo#';

    let content: string;
    let ext: string;

    if (format === 'xml' || format === 'rdfxml') {
        content = exportToOwlXml(config as any, ns);
        ext = '.owl';
    } else {
        content = exportToOwlTurtle(config as any, ns);
        ext = '.ttl';
    }

    const outputPath = resolve(cwd, options.output || `ontology${ext}`);
    writeFileSync(outputPath, content);

    const kindCount = Object.keys(config.kinds ?? {}).length;
    const relCount = (config.relationshipTypes ?? []).length;
    console.log(chalk.cyan(`  ${kindCount} kinds, ${relCount} relationships`));
    console.log(chalk.green(`\n\u2705 Exported to ${outputPath}\n`));
}

export async function ontologyExportSysandCommand(options: {
    output?: string;
}): Promise<void> {
    const cwd = process.cwd();

    console.log(chalk.bold('\n\u{1F4E6} MEMO Ontology Export \u2192 SysAnd Project\n'));

    const configPath = findConfigFile(cwd);
    if (!configPath) {
        console.error(chalk.red('\u274C No memo config found.'));
        process.exit(1);
    }

    const configChain = loadConfigChain(configPath);
    const currentEntry = configChain[configChain.length - 1];
    const exportEntries = configChain.filter((entry, index) => {
        return index < configChain.length - 1 ||
            !!entry.config.ontologyMetadata ||
            entry.config.projectType === 'ontology' ||
            entry.config.projectType === 'profile';
    });

    if (exportEntries.length === 0) {
        console.error(chalk.red('\u274C No ontology/profile packages found in the current config chain.'));
        process.exit(1);
    }

    const bundleName = sanitizeName(
        currentEntry.config.ontologyMetadata?.id ||
        currentEntry.config.projectName ||
        'memo-ontology'
    );
    const outputDir = resolve(cwd, options.output || `${bundleName}_Project`);
    const packagesDir = resolve(outputDir, 'packages');

    mkdirSync(packagesDir, { recursive: true });

    const exportedPackages = exportEntries.map(entry => exportConfigPackage(entry, packagesDir));

    mkdirSync(resolve(outputDir, 'docs'), { recursive: true });
    writeFileSync(resolve(outputDir, '.project.json'), JSON.stringify(renderProjectJson(currentEntry.config, exportedPackages), null, 2));
    writeFileSync(resolve(outputDir, '.meta.json'), JSON.stringify(renderMetaJson(exportedPackages, outputDir), null, 2));
    writeFileSync(resolve(outputDir, '.gitignore'), ['sysand_env/', 'output/'].join('\n') + '\n');
    writeFileSync(resolve(outputDir, 'README.md'), renderReadme(currentEntry.config, exportedPackages));
    writeFileSync(resolve(outputDir, 'sysand-lock.toml'), renderSysandLock(currentEntry.config, exportedPackages));
    const structureTree = buildTree(outputDir, outputDir);
    writeFileSync(resolve(outputDir, 'docs', 'model-structure.json'), JSON.stringify(structureTree, null, 2));
    writeFileSync(resolve(outputDir, 'docs', 'model-structure.md'), renderTreeMarkdown(structureTree));

    console.log(chalk.cyan(`  ${exportedPackages.length} packages exported`));
    for (const pkg of exportedPackages) {
        console.log(chalk.gray(`  - ${pkg.id || pkg.name} -> ${pkg.path}`));
    }
    console.log(chalk.green(`\n\u2705 Exported to ${outputDir}\n`));
}

interface ExportedPackage {
    id: string;
    name: string;
    version: string;
    projectType: string;
    path: string;
    extends?: string | string[];
    files: string[];
    sources: ExportedSource[];
}

interface ExportedSource {
    path: string;
    symbols: string[];
}

interface TreeNode {
    name: string;
    path: string;
    type: 'file' | 'directory';
    children?: TreeNode[];
}

function exportConfigPackage(entry: ConfigChainEntry, packagesDir: string): ExportedPackage {
    const sourceDir = dirname(entry.configPath);
    const name = sanitizeName(entry.config.ontologyMetadata?.id || basename(sourceDir));
    const targetDir = resolve(packagesDir, name);
    mkdirSync(targetDir, { recursive: true });

    const copied: string[] = [];
    const sources: ExportedSource[] = [];

    // Copy the primary config file
    cpSync(entry.configPath, resolve(targetDir, basename(entry.configPath)));
    copied.push(basename(entry.configPath));

    // Copy companion config files (new format: rendering, rules, viewpoints)
    for (const companion of ['memo.rendering.yaml', 'memo.rules.yaml', 'memo.viewpoints.yaml']) {
        const companionPath = resolve(sourceDir, companion);
        if (existsSync(companionPath)) {
            cpSync(companionPath, resolve(targetDir, companion));
            copied.push(companion);
        }
    }

    // Copy per-package .project.json if it exists
    const projectJsonPath = resolve(sourceDir, '.project.json');
    if (existsSync(projectJsonPath)) {
        cpSync(projectJsonPath, resolve(targetDir, '.project.json'));
        copied.push('.project.json');
    }

    for (const folderName of ['sysml', 'templates']) {
        const sourcePath = resolve(sourceDir, folderName);
        if (existsSync(sourcePath)) {
            cpSync(sourcePath, resolve(targetDir, folderName), { recursive: true });
            copied.push(`${folderName}/`);
            if (folderName === 'sysml') {
                sources.push(...collectSysmlSources(resolve(targetDir, folderName), dirname(packagesDir)));
            }
        }
    }

    return {
        id: entry.config.ontologyMetadata?.id || entry.config.projectName,
        name,
        version: entry.config.ontologyMetadata?.version || '0.0.0',
        projectType: entry.config.projectType,
        path: relative(dirname(packagesDir), targetDir),
        extends: entry.config.extends,
        files: copied,
        sources,
    };
}

function renderReadme(currentConfig: MEMOConfig, packages: ExportedPackage[]): string {
    const title = currentConfig.ontologyMetadata?.id || currentConfig.projectName;
    const lines = [
        `# ${title}`,
        '',
        'Generated by `memo ontology export sysand`.',
        '',
        'The export root is laid out as a SysAnd interchange project with `.project.json` and `.meta.json`.',
        '',
        '## Exported Packages',
        '',
    ];

    for (const pkg of packages) {
        lines.push(`- \`${pkg.id}\` (${pkg.version}) -> \`${pkg.path}\``);
    }

    lines.push('', '## Generated Structure', '', '- `.project.json` — SysAnd interchange project descriptor', '- `.meta.json` — SysAnd source index and checksums for exported `.sysml` files', '- `packages/` — exported ontology/profile packages', '- `docs/model-structure.md` — human-readable tree', '- `docs/model-structure.json` — machine-readable tree', '- `sysand-lock.toml` — generated package manifest for the bundled stack', '');
    return lines.join('\n');
}

function renderProjectJson(
    currentConfig: MEMOConfig,
    packages: ExportedPackage[],
): Record<string, unknown> {
    // Derive usage from package types
    const usageSet = new Set<string>();
    for (const pkg of packages) {
        if (pkg.projectType === 'ontology') {
            usageSet.add('kinds');
            usageSet.add('relationships');
        } else if (pkg.projectType === 'profile') {
            usageSet.add('rules');
            usageSet.add('viewpoints');
            usageSet.add('templates');
        }
    }

    return {
        name: currentConfig.projectName,
        publisher: currentConfig.ontologyMetadata?.author || 'untitled',
        version: currentConfig.ontologyMetadata?.version || packages[packages.length - 1]?.version || '0.0.1',
        usage: Array.from(usageSet).sort(),
    };
}

function renderMetaJson(packages: ExportedPackage[], outputDir: string): Record<string, unknown> {
    const index: Record<string, string> = {};
    const checksum: Record<string, { value: string; algorithm: string }> = {};

    for (const pkg of packages) {
        for (const source of pkg.sources) {
            // Compute SHA-256 checksum from the exported file
            const filePath = resolve(outputDir, source.path);
            let hash = '';
            try {
                const content = readFileSync(filePath);
                hash = createHash('sha256').update(content).digest('hex');
            } catch {
                // File read failed — leave hash empty
            }

            checksum[source.path] = {
                value: hash,
                algorithm: 'SHA-256',
            };
            for (const symbol of source.symbols) {
                index[symbol] = source.path;
            }
        }
    }

    return {
        index,
        created: new Date().toISOString(),
        checksum,
    };
}

function renderSysandLock(currentConfig: MEMOConfig, packages: ExportedPackage[]): string {
    const lines = [
        'version = 1',
        `root_project = ${tomlString(currentConfig.projectName)}`,
        `generated_by = ${tomlString('memo ontology export sysand')}`,
        '',
    ];

    for (const pkg of packages) {
        lines.push('[[package]]');
        lines.push(`id = ${tomlString(pkg.id)}`);
        lines.push(`name = ${tomlString(pkg.name)}`);
        lines.push(`version = ${tomlString(pkg.version)}`);
        lines.push(`project_type = ${tomlString(pkg.projectType)}`);
        lines.push(`path = ${tomlString(pkg.path)}`);
        if (pkg.extends) {
            const extendsStr = Array.isArray(pkg.extends) ? pkg.extends.join(', ') : pkg.extends;
            lines.push(`extends = ${tomlString(extendsStr)}`);
        }
        if (pkg.files.length > 0) {
            lines.push(`files = [${pkg.files.map(file => tomlString(file)).join(', ')}]`);
        }
        lines.push('');
    }

    return lines.join('\n');
}

function buildTree(dir: string, rootDir: string): TreeNode {
    const entries = readdirSync(dir, { withFileTypes: true })
        .filter(entry => entry.name !== '.DS_Store')
        .sort((a, b) => {
            if (a.isDirectory() !== b.isDirectory()) return a.isDirectory() ? -1 : 1;
            return a.name.localeCompare(b.name);
        });

    const node: TreeNode = {
        name: basename(dir),
        path: relative(rootDir, dir) || '.',
        type: 'directory',
        children: [],
    };

    for (const entry of entries) {
        const fullPath = resolve(dir, entry.name);
        if (entry.isDirectory()) {
            node.children!.push(buildTree(fullPath, rootDir));
        } else {
            node.children!.push({
                name: entry.name,
                path: relative(rootDir, fullPath),
                type: 'file',
            });
        }
    }

    return node;
}

function collectSysmlSources(dir: string, rootDir: string): ExportedSource[] {
    const sources: ExportedSource[] = [];
    const entries = readdirSync(dir, { withFileTypes: true })
        .filter(entry => entry.name !== '.DS_Store')
        .sort((a, b) => a.name.localeCompare(b.name));

    for (const entry of entries) {
        const fullPath = resolve(dir, entry.name);
        if (entry.isDirectory()) {
            sources.push(...collectSysmlSources(fullPath, rootDir));
            continue;
        }
        if (extname(entry.name) !== '.sysml') {
            continue;
        }

        sources.push({
            path: relative(rootDir, fullPath),
            symbols: parseDeclaredPackages(fullPath),
        });
    }

    return sources;
}

function parseDeclaredPackages(filePath: string): string[] {
    const content = readFileSync(filePath, 'utf-8');
    const matches = content.matchAll(/^\s*(?:library\s+)?package\s+([A-Za-z_][A-Za-z0-9_]*)\b/gm);
    return Array.from(new Set(Array.from(matches, match => match[1])));
}


function renderTreeMarkdown(tree: TreeNode): string {
    const lines = ['# Model Structure', '', '```text'];
    lines.push(tree.name);
    renderTreeLines(tree.children || [], '', lines);
    lines.push('```', '');
    return lines.join('\n');
}

function renderTreeLines(children: TreeNode[], prefix: string, lines: string[]): void {
    children.forEach((child, index) => {
        const isLast = index === children.length - 1;
        const branch = isLast ? '└── ' : '├── ';
        lines.push(`${prefix}${branch}${child.name}`);
        if (child.type === 'directory' && child.children) {
            renderTreeLines(child.children, `${prefix}${isLast ? '    ' : '│   '}`, lines);
        }
    });
}

function sanitizeName(value: string): string {
    return value
        .replace(/^@/, '')
        .replace(/[\\/]/g, '-')
        .replace(/[^A-Za-z0-9._-]+/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '');
}

function tomlString(value: string): string {
    return JSON.stringify(value);
}
