import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { buildAt } from '../model/pinned.js';
import { READ_ONLY_MESSAGES, isReadOnlyMessage } from '../server/mutation-domain.js';
import { compilerConfigured, examplesPresent } from './helpers/compile-source.js';
import { createFamilyRepo, type FamilyRepo } from './helpers/pinned-repo.js';

// A pinned view is a read-only server in the pinned directory (plan A14: no write path reachable).
// The server answers an allowlist of messages and refuses the rest by name, whatever they would have
// written, and leaves the directory as it found it.

const OPERATIONS = pathToFileURL(join(__dirname, '../../lib/operations/index.js')).href;
const SERVER_SOURCE = readFileSync(join(__dirname, '../server/dev-server.ts'), 'utf8');

/** Every message type the server has a handler for, read from the handler chain itself. */
const HANDLED = [...new Set([...SERVER_SOURCE.matchAll(/msg\.type === '([^']+)'/g)].map(m => m[1]))];

/** A digest of every file under `dir` outside `.memo` (tool state), by content. */
function digest(dir: string): string {
    const hash = createHash('sha256');
    const walk = (current: string) => {
        for (const name of readdirSync(current).sort()) {
            if (name === '.memo' || name === '.git') continue;
            const path = join(current, name);
            if (statSync(path).isDirectory()) walk(path);
            else hash.update(relative(dir, path)).update(readFileSync(path));
        }
    };
    walk(dir);
    return hash.digest('hex');
}

describe.runIf(compilerConfigured && examplesPresent && existsSync(join(__dirname, '../../lib/operations/index.js')))('a read-only server (A14)', () => {
    let repo: FamilyRepo;
    beforeAll(() => { repo = createFamilyRepo(); }, 60_000);
    afterAll(() => repo?.remove());

    it('refuses every message it handles that is not a read, and leaves the pinned directory as it was', async () => {
        const pinned = await buildAt(repo.root, 'rc-mapping', { config: { toolchain: { compiler: process.env.MEMO_TOOLCHAIN_COMPILER } } as never });
        const before = digest(pinned.projectDir);
        const start = `import(${JSON.stringify(OPERATIONS)}).then(m => m.startProjectServer({ port: 0, open: false, exitWhenIdle: false, readOnly: true, `
            + `pinned: { kind: 'ref', label: 'rc-mapping', notARelease: true }, preferencesRoot: ${JSON.stringify(repo.root)}, clientRoot: ${JSON.stringify(join(pinned.projectDir, 'no-client'))} }))`;
        const server = spawn('node', ['-e', start], { cwd: pinned.projectDir, env: { ...process.env, NO_COLOR: '1' }, stdio: ['ignore', 'ignore', 'inherit', 'ipc'] });
        try {
            const url = await new Promise<string>((done, fail) => {
                server.once('message', (m: { url?: string }) => m.url ? done(m.url) : fail(new Error('no url')));
                server.once('exit', code => fail(new Error(`the server exited with ${code}`)));
                setTimeout(() => fail(new Error('the server did not start')), 120_000);
            });
            const socket = new WebSocket(url.replace('http', 'ws'));
            const received: { type: string; payload?: { error?: string; requestId?: string } }[] = [];
            socket.on('message', data => received.push(JSON.parse(data.toString())));
            await new Promise(done => socket.once('open', done));
            const refusals = HANDLED.filter(type => !isReadOnlyMessage(type));
            expect(refusals.length).toBeGreaterThan(20);
            for (const type of refusals) socket.send(JSON.stringify({ type, payload: { requestId: `r-${type}` } }));
            await new Promise(done => setTimeout(done, 1500));
            for (const type of refusals) {
                const answer = received.find(m => m.type === 'app:error' && m.payload?.requestId === `r-${type}`);
                expect(answer?.payload?.error, type).toMatch(/pinned, read-only/);
            }
            // It says what it is, and it still answers a read.
            expect(received.find(m => m.type === 'pinned:info')?.payload).toMatchObject({ kind: 'ref', notARelease: true });
            socket.send(JSON.stringify({ type: 'request:refresh' }));
            await new Promise(done => setTimeout(done, 1000));
            expect(received.filter(m => m.type === 'app:error').length).toBe(refusals.length);
            socket.close();
        } finally {
            server.kill('SIGTERM');
            await new Promise(done => server.once('exit', done));
        }
        expect(digest(pinned.projectDir)).toBe(before);
        expect(existsSync(join(pinned.projectDir, 'memo.user.yaml'))).toBe(false);
        expect(existsSync(join(pinned.projectDir, '.memo', 'dev-server.json'))).toBe(false);
    }, 300_000);

    it('allows only messages that read: the allowlist holds no mutation', () => {
        for (const type of READ_ONLY_MESSAGES) {
            expect(['request:refresh', 'dhf:docs:load', 'dhf:templates:list', 'dhf:template:read', 'diagram:source:request',
                'methodology:source:request', 'diagram:parse', 'import:preview', 'rule:preview', 'open-file',
                'versions:list', 'version:open', 'release:diff']).toContain(type);
        }
    });
});
