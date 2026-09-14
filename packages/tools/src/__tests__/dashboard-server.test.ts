// Custom dashboards over the dev-server WebSocket: writes answer and broadcast,
// a file edited outside the app reaches clients, and a broken model source
// never holds a dashboard write. See plans/memo-custom-dashboards.md.

import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDevServer, isModelMutationMessage } from '../server/dev-server.js';

let servers: Array<{ close(): void }> = [];
let sockets: Array<{ close(): void }> = [];

afterEach(() => {
    for (const socket of sockets) socket.close();
    for (const server of servers) server.close();
    sockets = [];
    servers = [];
});

async function start() {
    const projectRoot = mkdtempSync(join(tmpdir(), 'memo-dashboards-'));
    const server = await createDevServer({ port: 0, projectRoot, webPackagePath: projectRoot, initialMessages: [] });
    servers.push(server);
    const { default: WebSocket } = await import('ws');
    const socket = new WebSocket(`ws://127.0.0.1:${server.port}`);
    sockets.push(socket);
    const received: any[] = [];
    socket.on('message', (raw: any) => received.push(JSON.parse(raw.toString())));
    await new Promise<void>((resolve, reject) => { socket.on('open', () => resolve()); socket.on('error', reject); });
    const send = (msg: unknown) => socket.send(JSON.stringify(msg));
    const waitFor = async (predicate: (m: any) => boolean, ms = 3000) => {
        const until = Date.now() + ms;
        while (Date.now() < until) {
            const hit = received.find(predicate);
            if (hit) return hit;
            await new Promise(r => setTimeout(r, 25));
        }
        throw new Error('timed out waiting for message');
    };
    return { server, projectRoot, received, send, waitFor };
}

const lastDashboards = (received: any[]) =>
    [...received].reverse().find(m => m.type === 'dashboards')?.payload.dashboards ?? [];

describe('dashboard protocol', () => {
    it('sends dashboards on connect', async () => {
        const { received, waitFor } = await start();
        await waitFor(m => m.type === 'dashboards');
        expect(lastDashboards(received)).toEqual([]);
    });

    it('saves, broadcasts, moves, and deletes', async () => {
        const { projectRoot, received, send, waitFor } = await start();
        send({ type: 'dashboard:save', payload: { requestId: 'r1', dashboard: { id: 'ops', scope: 'user', content: '# Ops\n' } } });
        expect((await waitFor(m => m.type === 'dashboard:result' && m.payload.requestId === 'r1')).payload.ok).toBe(true);
        await waitFor(m => m.type === 'dashboards' && m.payload.dashboards.length === 1);
        expect(existsSync(join(projectRoot, 'dashboards', 'user', 'ops.md'))).toBe(true);

        send({ type: 'dashboard:move', payload: { requestId: 'r2', id: 'ops', from: 'user', to: 'shared' } });
        expect((await waitFor(m => m.type === 'dashboard:result' && m.payload.requestId === 'r2')).payload.ok).toBe(true);
        await waitFor(m => m.type === 'dashboards' && m.payload.dashboards[0]?.scope === 'shared');

        send({ type: 'dashboard:delete', payload: { requestId: 'r3', id: 'ops', scope: 'shared' } });
        await waitFor(m => m.type === 'dashboard:result' && m.payload.requestId === 'r3');
        expect(lastDashboards(received)).toEqual([]);
    });

    it('reports a refused write instead of throwing', async () => {
        const { send, waitFor } = await start();
        send({ type: 'dashboard:save', payload: { requestId: 'bad', dashboard: { id: '../x', scope: 'shared', content: '' } } });
        const result = await waitFor(m => m.type === 'dashboard:result' && m.payload.requestId === 'bad');
        expect(result.payload).toMatchObject({ ok: false });
        expect(result.payload.error).toMatch(/Invalid dashboard id/);
    });

    it('pushes a dashboard edited outside the app', async () => {
        const { projectRoot, waitFor } = await start();
        await waitFor(m => m.type === 'dashboards');
        await new Promise(r => setTimeout(r, 300)); // let the watcher become ready
        mkdirSync(join(projectRoot, 'dashboards'), { recursive: true });
        writeFileSync(join(projectRoot, 'dashboards', 'external.md'), '# From git\n');
        const pushed = await waitFor(m => m.type === 'dashboards' && m.payload.dashboards.some((d: any) => d.id === 'external'), 5000);
        expect(pushed.payload.dashboards[0].title).toBe('From git');
    });

    it('pushes a user dashboard edited outside the app', async () => {
        const { projectRoot, waitFor } = await start();
        await waitFor(m => m.type === 'dashboards');
        await new Promise(r => setTimeout(r, 300));
        mkdirSync(join(projectRoot, 'dashboards', 'user'), { recursive: true });
        writeFileSync(join(projectRoot, 'dashboards', 'user', 'scratch.md'), '# Scratch\n');
        const pushed = await waitFor(m => m.type === 'dashboards' && m.payload.dashboards.some((d: any) => d.id === 'scratch'), 5000);
        expect(pushed.payload.dashboards.find((d: any) => d.id === 'scratch').scope).toBe('user');
    });

    it('is not a model mutation, so the source hold never blocks it', () => {
        for (const type of ['dashboard:save', 'dashboard:delete', 'dashboard:move']) {
            expect(isModelMutationMessage(type)).toBe(false);
        }
    });
});
