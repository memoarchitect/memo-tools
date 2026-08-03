// ─── The internal MEMO bundle writer ─────────────────────────────────────────
//
// Moved here from `commands/pack.ts` when packaging became a provider role.
// It used to be the `else` branch of `if (packager === 'internal')`; it is now
// what the internal package provider does, which is the same code reached
// through the same interface every other packager is reached through.
// ─────────────────────────────────────────────────────────────────────────────

import { createWriteStream, readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { createGzip } from 'node:zlib';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import { isIgnoredDirectory } from '../../model/sysml-files.js';

function collectProjectFiles(dir: string, root: string): { path: string; content: Buffer }[] {
    const files: { path: string; content: Buffer }[] = [];
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
        // Tool output and vendored dependencies are excluded by the same rule
        // the source walker uses, so a package can never ship (or claim in its
        // manifest) files the rest of the toolchain ignores.
        if (isIgnoredDirectory(entry.name) || entry.name.endsWith('.kpar')) continue;
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

/**
 * Write MEMO's private, gzip-tar project bundle.
 *
 * This deliberately is not called a KPAR.  A KPAR is an interoperable SysML
 * package and must be produced/consumed by a real KPAR provider; this archive
 * is only a convenient offline MEMO snapshot.
 */
export async function writeInternalMemoBundle(
    projectRoot: string,
    outputPath: string,
    projectName: string,
): Promise<void> {
    const files = collectProjectFiles(projectRoot, projectRoot);
    const manifest = {
        format: 'memo-bundle',
        version: '1.0.0',
        name: projectName,
        createdAt: new Date().toISOString(),
        fileCount: files.length,
        files: files.map(file => file.path),
    };
    files.push({ path: 'manifest.json', content: Buffer.from(JSON.stringify(manifest, null, 2)) });
    await pipeline(Readable.from([createTar(files)]), createGzip({ level: 9 }), createWriteStream(outputPath));
}
