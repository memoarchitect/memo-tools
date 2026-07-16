// ─── memo build ──────────────────────────────────────────────────────────────
//
// Builds a self-contained static HTML site with the model diagram.
//   1. Load config → parse .sysml → build model → validate
//   2. Build the web app via Vite
//   3. Inject model data as window.__MEMO_DATA__ into the HTML
//
// Output: a single-page app that works offline without a dev server.
// ─────────────────────────────────────────────────────────────────────────────

import { resolve, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readdirSync, readFileSync, writeFileSync, mkdirSync, cpSync, createWriteStream, statSync, existsSync } from 'node:fs';
import { createGzip } from 'node:zlib';
import { pipeline } from 'node:stream/promises';
import chalk from 'chalk';
import { findConfigFile, parseFiles, buildMemoModel, modelToDTO, loadOntologyRegistries, deriveModelViews } from '@memo/tools';
import type { BuilderRegistries, DiagramDTO } from '@memo/tools';
import { validateModel } from '@memo/tools';
import { computeCompleteness } from '@memo/tools';
import type { ViewpointDTO, ArchLayerDTO } from '@memo/tools';
import { loadAndResolveConfig } from '../server/config-resolver.js';

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

export async function buildCommand(options: {
    output?: string;
    singleFile?: boolean;
    kpar?: boolean;
}): Promise<void> {
    const cwd = process.cwd();
    const outputDir = resolve(cwd, options.output || 'dist');

    console.log(chalk.bold('\n📦 MEMO Build\n'));

    // 1. Find and load config
    const configPath = findConfigFile(cwd);
    if (!configPath) {
        console.error(chalk.red('❌ No memo config found. Run `memo init` first.'));
        process.exit(1);
    }

    const config = loadAndResolveConfig(configPath);
    console.log(chalk.gray(`  Project: ${config.projectName}`));

    // 2. Parse + build model (ontology registries give kind/layer resolution,
    //    matching `memo dev` and `memo validate`)
    console.log(chalk.gray('  Building model...'));
    let ontologyRegistries: BuilderRegistries | undefined;
    try {
        const loadResult = await loadOntologyRegistries(configPath);
        if (loadResult.fileCount > 0) ontologyRegistries = loadResult.registries;
    } catch {
        // build still works without registries, with reduced kind resolution
    }
    const sysmlFiles = findSysmlFiles(cwd);
    const { documents, errors } = await parseFiles(sysmlFiles, cwd + '/');
    const model = buildMemoModel(documents, config, errors, ontologyRegistries);
    const validation = validateModel(model);
    const completeness = computeCompleteness(model, validation, config);

    const viewpoints: ViewpointDTO[] = config.viewpoints?.map(vp => ({
        id: vp.id,
        label: vp.label,
        visibleKinds: vp.visibleKinds,
        visibleRelationships: vp.visibleRelationships,
        visibleLayers: vp.visibleLayers,
    })) ?? [];

    const architectureLayers: ArchLayerDTO[] | undefined = config.architectureLayers?.map(cl => ({
        id: cl.id,
        label: cl.label,
        color: cl.color,
    }));

    // Per-layer auto diagrams + SysML-modelled views, same as `memo dev`
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
    const derivedViews = deriveModelViews(model, ontologyRegistries?.kindRegistry);
    viewpoints.push(...derivedViews.viewpoints);
    diagrams.push(...derivedViews.diagrams);

    const dto = modelToDTO(model, { viewpoints, architectureLayers, diagrams });

    console.log(chalk.cyan(
        `  ${model.elements.size} elements, ${model.relationships.length} relationships, ` +
        `${validation.violations.length} violations, ${completeness.overall}% complete`
    ));

    // 3. Build embedded data script
    const embeddedData = {
        model: dto,
        validation,
        completeness,
    };
    const dataScript = `<script>window.__MEMO_DATA__=${JSON.stringify(embeddedData)};</script>`;

    // 4. Find pre-built web app or build it
    const webDistPath = resolveWebDist(cwd);
    if (!webDistPath) {
        console.error(chalk.red('❌ Could not find @memo/web dist. Run `pnpm run build` first.'));
        process.exit(1);
    }

    // 5. Copy web dist to output and inject data
    mkdirSync(outputDir, { recursive: true });
    cpSync(webDistPath, outputDir, { recursive: true });

    const indexPath = resolve(outputDir, 'index.html');
    let html = readFileSync(indexPath, 'utf-8');

    // Inject data script before closing </head>
    html = html.replace('</head>', `${dataScript}\n</head>`);

    if (options.singleFile) {
        // Inline all CSS and JS into the HTML for a single file
        html = inlineAssets(html, outputDir);
    }

    writeFileSync(indexPath, html);

    if (options.singleFile) {
        // Remove asset files, keep only index.html
        const assetsDir = resolve(outputDir, 'assets');
        try {
            const { rmSync } = await import('node:fs');
            rmSync(assetsDir, { recursive: true, force: true });
        } catch {
            // ok
        }
    }

    // 6. Copy bundled docs (MkDocs static output) into dist/help/ if available
    const docsDistPath = resolve(cwd, '../../docs/dist');
    const helpDestPath = resolve(outputDir, 'help');
    if (existsSync(resolve(docsDistPath, 'index.html'))) {
        cpSync(docsDistPath, helpDestPath, { recursive: true });
        console.log(chalk.gray(`   Bundled docs → help/`));
    }

    console.log(chalk.green(`\n✅ Built to ${outputDir}`));
    console.log(chalk.gray(`   Open ${resolve(outputDir, 'index.html')} in a browser`));

    // 6. Optional .kpar packaging
    if (options.kpar) {
        const kparPath = await buildKpar(cwd, outputDir, config.projectName || 'memo-project');
        console.log(chalk.green(`\n📦 Packaged as ${kparPath}`));
    }

    console.log('');
}

function resolveWebDist(cwd: string): string | undefined {
    const cliDir = dirname(fileURLToPath(import.meta.url));
    const tryPaths = [
        resolve(cwd, '../../packages/web/dist'),
        resolve(cwd, '../web/dist'),
        resolve(cwd, 'node_modules/@memo/web/dist'),
        // Monorepo-relative fallback so projects outside packages/../examples
        // (e.g. the vendor submodule reference model) can still build.
        resolve(cliDir, '../../../web/dist'),
        // memo-architect layout: tools lives in memo-tools/packages/tools,
        // web at the outer workspace root
        resolve(cliDir, '../../../../../packages/web/dist'),
    ];

    for (const p of tryPaths) {
        try {
            const files = readdirSync(p);
            if (files.includes('index.html')) return p;
        } catch {
            // not found
        }
    }
    return undefined;
}

// ─── .kpar Archive ────────────────────────────────────────────────────────
// A .kpar (Knowledge Package Archive) is a tar.gz containing:
//   - memo.package.yaml (or memo.config.yaml)
//   - .project.json (SysAnd manifest)
//   - sysml/ directory (all .sysml files)
//   - memo.rendering.yaml, memo.rules.yaml (if present)
//   - dist/ (static HTML build, if present)
//   - manifest.json (archive metadata)
//
// This is a simple tar+gzip implementation using Node built-ins.
// No external dependencies needed.
// ─────────────────────────────────────────────────────────────────────────

async function buildKpar(cwd: string, distDir: string, projectName: string): Promise<string> {
    console.log(chalk.gray('\n  Packaging .kpar archive...'));

    // Collect files for the archive
    const filesToPack: { path: string; content: Buffer }[] = [];

    // Include config files
    const configFiles = [
        'memo.package.yaml', 'memo.config.yaml', '.project.json',
        'memo.rendering.yaml', 'memo.rules.yaml', 'package.json',
    ];
    for (const f of configFiles) {
        const fullPath = resolve(cwd, f);
        try {
            filesToPack.push({ path: f, content: readFileSync(fullPath) });
        } catch {
            // skip missing
        }
    }

    // Include all .sysml files
    const sysmlFiles = findSysmlFiles(cwd);
    for (const f of sysmlFiles) {
        const relPath = f.startsWith(cwd) ? f.slice(cwd.length + 1) : f;
        filesToPack.push({ path: relPath, content: readFileSync(f) });
    }

    // Include dist/ contents
    try {
        const distFiles = collectDirFiles(distDir, distDir);
        for (const df of distFiles) {
            filesToPack.push({ path: `dist/${df.path}`, content: df.content });
        }
    } catch {
        // no dist
    }

    // Create manifest
    const manifest = {
        format: 'kpar',
        version: '1.0.0',
        name: projectName,
        createdAt: new Date().toISOString(),
        fileCount: filesToPack.length,
        files: filesToPack.map(f => f.path),
    };
    filesToPack.push({ path: 'manifest.json', content: Buffer.from(JSON.stringify(manifest, null, 2)) });

    // Build tar buffer
    const tarBuffer = createTar(filesToPack);

    // Gzip and write
    const kparFileName = `${projectName.replace(/[^a-zA-Z0-9_-]/g, '-')}.kpar`;
    const kparPath = resolve(cwd, kparFileName);
    const { Readable } = await import('node:stream');
    const input = Readable.from([tarBuffer]);
    const gzip = createGzip({ level: 9 });
    const output = createWriteStream(kparPath);
    await pipeline(input, gzip, output);

    const size = statSync(kparPath).size;
    const sizeStr = size > 1024 * 1024
        ? `${(size / 1024 / 1024).toFixed(1)} MB`
        : `${(size / 1024).toFixed(1)} KB`;
    console.log(chalk.gray(`  ${filesToPack.length} files, ${sizeStr}`));

    return kparPath;
}

function collectDirFiles(dir: string, baseDir: string): { path: string; content: Buffer }[] {
    const results: { path: string; content: Buffer }[] = [];
    try {
        for (const entry of readdirSync(dir, { withFileTypes: true })) {
            const full = resolve(dir, entry.name);
            if (entry.isDirectory()) {
                results.push(...collectDirFiles(full, baseDir));
            } else {
                const relPath = full.slice(baseDir.length + 1);
                results.push({ path: relPath, content: readFileSync(full) });
            }
        }
    } catch {
        // skip
    }
    return results;
}

/** Minimal POSIX tar implementation — no external deps */
function createTar(files: { path: string; content: Buffer }[]): Buffer {
    const blocks: Buffer[] = [];
    for (const file of files) {
        // 512-byte header
        const header = Buffer.alloc(512);
        // Name (first 100 bytes)
        const nameBytes = Buffer.from(file.path, 'utf-8');
        nameBytes.copy(header, 0, 0, Math.min(nameBytes.length, 100));
        // Mode
        writeOctal(header, 100, 8, 0o644);
        // UID/GID
        writeOctal(header, 108, 8, 0);
        writeOctal(header, 116, 8, 0);
        // Size
        writeOctal(header, 124, 12, file.content.length);
        // Mtime
        writeOctal(header, 136, 12, Math.floor(Date.now() / 1000));
        // Type flag (0 = regular file)
        header[156] = 0x30; // '0'
        // Magic
        Buffer.from('ustar\0', 'ascii').copy(header, 257);
        // Version
        Buffer.from('00', 'ascii').copy(header, 263);
        // Checksum
        header.fill(0x20, 148, 156); // spaces for checksum calculation
        let checksum = 0;
        for (let i = 0; i < 512; i++) checksum += header[i];
        writeOctal(header, 148, 7, checksum);
        header[155] = 0x20; // space

        blocks.push(header);

        // File content (padded to 512-byte boundary)
        blocks.push(file.content);
        const remainder = file.content.length % 512;
        if (remainder > 0) {
            blocks.push(Buffer.alloc(512 - remainder));
        }
    }
    // Two 512-byte zero blocks to mark end
    blocks.push(Buffer.alloc(1024));
    return Buffer.concat(blocks);
}

function writeOctal(buf: Buffer, offset: number, length: number, value: number): void {
    const str = value.toString(8).padStart(length - 1, '0');
    Buffer.from(str + '\0', 'ascii').copy(buf, offset);
}

function inlineAssets(html: string, baseDir: string): string {
    // Inline CSS
    html = html.replace(
        /<link[^>]+rel="stylesheet"[^>]+href="([^"]+)"[^>]*\/?>/g,
        (_match, href: string) => {
            try {
                const cssPath = resolve(baseDir, href.replace(/^\//, ''));
                const css = readFileSync(cssPath, 'utf-8');
                return `<style>${css}</style>`;
            } catch {
                return _match; // keep original if file not found
            }
        }
    );

    // Inline JS
    html = html.replace(
        /<script[^>]+src="([^"]+)"[^>]*><\/script>/g,
        (_match, src: string) => {
            try {
                const jsPath = resolve(baseDir, src.replace(/^\//, ''));
                const js = readFileSync(jsPath, 'utf-8');
                return `<script type="module">${js}</script>`;
            } catch {
                return _match;
            }
        }
    );

    return html;
}
