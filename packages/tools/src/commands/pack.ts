import { createReadStream, createWriteStream, existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { createGzip } from 'node:zlib';
import { pipeline } from 'node:stream/promises';
import chalk from 'chalk';
import { packageWithConfiguredTool } from '../model/toolchain.js';
import { buildProjectSnapshot } from '../operations/project-snapshot.js';

function collectProjectFiles(dir: string, root: string): { path: string; content: Buffer }[] {
    const files: { path: string; content: Buffer }[] = [];
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (entry.name === 'node_modules' || entry.name === '.git' || entry.name === '.memo'
            || entry.name === 'dist' || entry.name === 'output' || entry.name.endsWith('.kpar')) continue;
        const full = resolve(dir, entry.name);
        if (entry.isDirectory()) files.push(...collectProjectFiles(full, root));
        else if (entry.name.endsWith('.sysml') || [
            'memo.package.yaml', 'memo.config.yaml', '.project.json',
            'memo.rendering.yaml', 'memo.rules.yaml', 'memo.viewpoints.yaml', 'package.json',
        ].includes(entry.name)) {
            files.push({ path: full.slice(root.length + 1), content: readFileSync(full) });
        }
    }
    return files;
}

function writeOctal(buffer: Buffer, offset: number, length: number, value: number): void {
    Buffer.from(value.toString(8).padStart(length - 1, '0') + '\0', 'ascii').copy(buffer, offset);
}

function createTar(files: { path: string; content: Buffer }[]): Buffer {
    const blocks: Buffer[] = [];
    for (const file of files) {
        const header = Buffer.alloc(512);
        Buffer.from(file.path, 'utf-8').copy(header, 0, 0, 100);
        writeOctal(header, 100, 8, 0o644);
        writeOctal(header, 108, 8, 0);
        writeOctal(header, 116, 8, 0);
        writeOctal(header, 124, 12, file.content.length);
        writeOctal(header, 136, 12, Math.floor(Date.now() / 1000));
        header[156] = 0x30;
        Buffer.from('ustar\0', 'ascii').copy(header, 257);
        Buffer.from('00', 'ascii').copy(header, 263);
        header.fill(0x20, 148, 156);
        let checksum = 0;
        for (const byte of header) checksum += byte;
        writeOctal(header, 148, 7, checksum);
        header[155] = 0x20;
        blocks.push(header, file.content);
        const remainder = file.content.length % 512;
        if (remainder) blocks.push(Buffer.alloc(512 - remainder));
    }
    blocks.push(Buffer.alloc(1024));
    return Buffer.concat(blocks);
}

async function writeInternalKpar(projectRoot: string, outputPath: string, projectName: string): Promise<void> {
    const files = collectProjectFiles(projectRoot, projectRoot);
    const manifest = {
        format: 'kpar',
        version: '1.0.0',
        name: projectName,
        createdAt: new Date().toISOString(),
        fileCount: files.length,
        files: files.map(file => file.path),
    };
    files.push({ path: 'manifest.json', content: Buffer.from(JSON.stringify(manifest, null, 2)) });
    const { Readable } = await import('node:stream');
    await pipeline(Readable.from([createTar(files)]), createGzip({ level: 9 }), createWriteStream(outputPath));
}

export async function packCommand(options: { output?: string } = {}): Promise<void> {
    const snapshot = await buildProjectSnapshot();
    const projectName = snapshot.config.projectName || 'memo-project';
    const outputPath = resolve(snapshot.projectRoot, options.output
        || `${projectName.replace(/[^a-zA-Z0-9_-]/g, '-')}.kpar`);

    console.log(chalk.bold('\n📦 MEMO Pack\n'));
    console.log(chalk.gray(`  Project: ${projectName}`));
    if (snapshot.compiler !== 'internal') console.log(chalk.gray(`  Compiler: ${snapshot.compiler}`));

    const packager = packageWithConfiguredTool(snapshot.config, snapshot.projectRoot, outputPath);
    if (packager === 'internal') await writeInternalKpar(snapshot.projectRoot, outputPath, projectName);
    else console.log(chalk.gray(`  Packager: ${packager}`));

    if (!existsSync(outputPath)) throw new Error(`Packager did not create ${outputPath}.`);
    const size = statSync(outputPath).size;
    console.log(chalk.green(`  Created ${outputPath} (${(size / 1024).toFixed(1)} KB)\n`));
}
