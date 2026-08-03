import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { inflateRawSync } from 'node:zlib';

const MAX_ENTRIES = 2_000;
const MAX_EXPANDED = 100 * 1024 * 1024;

interface KparDescriptor { name: string; version: string; sha256: string; files: string[]; }

function safePath(path: string): string {
    if (!path || path.includes('\\') || path.startsWith('/') || /^[A-Za-z]:/.test(path) || path.split('/').includes('..')) {
        throw new Error(`Unsafe KPAR entry path: ${JSON.stringify(path)}`);
    }
    return path;
}

/** Read a ZIP KPAR without trusting paths, symlinks, or unbounded expansion. */
function readZip(path: string): Map<string, Buffer> {
    const data = readFileSync(path);
    const eocd = data.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
    if (eocd < 0 || eocd + 22 > data.length) throw new Error('KPAR is not a ZIP archive.');
    const count = data.readUInt16LE(eocd + 10); const offset = data.readUInt32LE(eocd + 16);
    if (count > MAX_ENTRIES) throw new Error(`KPAR has too many entries (${count}).`);
    const entries = new Map<string, Buffer>(); let cursor = offset; let expanded = 0;
    for (let i = 0; i < count; i++) {
        if (data.readUInt32LE(cursor) !== 0x02014b50) throw new Error('Malformed ZIP central directory.');
        const method = data.readUInt16LE(cursor + 10); const compressed = data.readUInt32LE(cursor + 20); const size = data.readUInt32LE(cursor + 24);
        const nameLength = data.readUInt16LE(cursor + 28); const extraLength = data.readUInt16LE(cursor + 30); const commentLength = data.readUInt16LE(cursor + 32);
        const attributes = data.readUInt32LE(cursor + 38); const localOffset = data.readUInt32LE(cursor + 42);
        const name = safePath(data.subarray(cursor + 46, cursor + 46 + nameLength).toString('utf8'));
        cursor += 46 + nameLength + extraLength + commentLength;
        if (name.endsWith('/')) continue;
        if ((attributes >>> 16 & 0o170000) === 0o120000) throw new Error(`KPAR symlink entry is forbidden: ${name}`);
        if (size > MAX_EXPANDED || (expanded += size) > MAX_EXPANDED) throw new Error('KPAR exceeds the 100 MB expanded-size limit.');
        if (data.readUInt32LE(localOffset) !== 0x04034b50) throw new Error(`Malformed ZIP entry: ${name}`);
        const localName = data.readUInt16LE(localOffset + 26); const localExtra = data.readUInt16LE(localOffset + 28);
        const payload = data.subarray(localOffset + 30 + localName + localExtra, localOffset + 30 + localName + localExtra + compressed);
        const content = method === 0 ? payload : method === 8 ? inflateRawSync(payload) : (() => { throw new Error(`Unsupported ZIP compression method ${method}.`); })();
        if (content.length !== size) throw new Error(`Invalid ZIP size for ${name}.`);
        if (entries.has(name)) throw new Error(`Duplicate KPAR entry: ${name}`);
        entries.set(name, content);
    }
    return entries;
}

export function inspectKpar(path: string): KparDescriptor {
    const entries = readZip(path);
    const manifestBytes = entries.get('.project.json') ?? entries.get('.meta.json');
    if (!manifestBytes) throw new Error('KPAR must contain .project.json or .meta.json.');
    let manifest: Record<string, unknown>;
    try { manifest = JSON.parse(manifestBytes.toString('utf8')); } catch { throw new Error('KPAR manifest is not valid JSON.'); }
    const name = typeof manifest.name === 'string' ? manifest.name : typeof manifest.packageName === 'string' ? manifest.packageName : undefined;
    const version = typeof manifest.version === 'string' ? manifest.version : undefined;
    if (!name || !version) throw new Error('KPAR manifest must declare string name and version.');
    return { name, version, sha256: createHash('sha256').update(readFileSync(path)).digest('hex'), files: [...entries.keys()].sort() };
}

export function importKpar(projectDir: string, archive: string): KparDescriptor {
    const source = resolve(archive); if (!existsSync(source)) throw new Error(`KPAR not found: ${source}`);
    const descriptor = inspectKpar(source);
    const root = join(resolve(projectDir), '.memo', 'libraries', 'kpar');
    const archiveDir = join(root, 'archives'); const cacheDir = join(root, 'cache'); mkdirSync(archiveDir, { recursive: true }); mkdirSync(cacheDir, { recursive: true });
    const identity = `${descriptor.name.replace(/[^A-Za-z0-9._-]/g, '_')}-${descriptor.version}-${descriptor.sha256.slice(0, 12)}`;
    const destination = join(archiveDir, `${identity}.kpar`); const cache = join(cacheDir, identity);
    if (!existsSync(destination)) copyFileSync(source, destination);
    if (!existsSync(cache)) { const temp = `${cache}.tmp-${process.pid}`; mkdirSync(temp); for (const [name, content] of readZip(source)) { const out = join(temp, name); mkdirSync(resolve(out, '..'), { recursive: true }); writeFileSync(out, content); } renameSync(temp, cache); }
    const index = join(root, 'index.json'); const prior = existsSync(index) ? JSON.parse(readFileSync(index, 'utf8')) as KparDescriptor[] : [];
    const conflict = prior.find(item => item.name === descriptor.name && item.version === descriptor.version && item.sha256 !== descriptor.sha256);
    if (conflict) throw new Error(`KPAR ${descriptor.name}@${descriptor.version} conflicts with an installed archive.`);
    if (!prior.some(item => item.sha256 === descriptor.sha256)) { prior.push(descriptor); writeFileSync(index, JSON.stringify(prior, null, 2) + '\n'); }
    return descriptor;
}
