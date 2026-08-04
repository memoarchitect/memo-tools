// §1.1 — a project source that does not parse is an ordinary working state.
//
// The rule these pin down, on the server side of the boundary:
//
//   project source stops parsing  → mutations HELD, model withheld, no restart
//   it parses again               → hold releases by itself
//   reusable/ontology source moves → mutation LOCKOUT + mandatory relaunch
//
// The middle row is the one that was missing. Before this, an incoherent
// rebuild escalated to `dependency-closure-uncomputable`, which locks mutations
// until the process is relaunched — so a stray character in a .sysml file cost
// a restart, and the lock had no release path short of one.

import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDevServer } from '../server/dev-server.js';
import type { MemoModelDTO, ServerMessage } from '@memoarchitect/tools';

const lastGoodModel = {
    elements: {
        pump: {
            id: 'pump', name: 'pump', kind: 'SoftwareComponent', construct: 'part',
            layer: 'software', file: 'model/parts.sysml', attributes: {},
        },
    },
    relationships: [],
    errors: [],
    revision: 7,
} as unknown as MemoModelDTO;

const incoherent = {
    coherent: false,
    files: ['model/parts.sysml'],
    diagnostics: [{ file: 'model/parts.sysml', message: "expecting ';'", line: 12, column: 3 }],
    lastGoodRevision: 7,
};

let servers: Array<{ close(): void }> = [];

afterEach(() => {
    for (const server of servers) server.close();
    servers = [];
});

async function startServer() {
    const projectRoot = mkdtempSync(join(tmpdir(), 'memo-coherence-'));
    const initialMessages: ServerMessage[] = [{ type: 'model:update', payload: lastGoodModel }];
    const server = await createDevServer({
        port: 0,
        projectRoot,
        // No index.html here, so no Vite: this test wants the WebSocket only.
        webPackagePath: projectRoot,
        initialMessages,
    });
    servers.push(server);
    return { server, projectRoot };
}

/** Connect, and collect every message the server pushes. */
async function connect(port: number) {
    const { default: WebSocket } = await import('ws');
    const socket = new WebSocket(`ws://127.0.0.1:${port}`);
    const received: any[] = [];
    socket.on('message', (raw: any) => received.push(JSON.parse(raw.toString())));
    await new Promise<void>((resolve, reject) => {
        socket.on('open', () => resolve());
        socket.on('error', reject);
    });
    const settle = () => new Promise<void>(resolve => setTimeout(resolve, 60));
    await settle();
    return { socket, received, settle };
}

describe('source coherence', () => {
    it('publishes the break to connected clients without demanding a restart', async () => {
        const { server } = await startServer();
        const { received, settle } = await connect(server.port);

        server.setSourceCoherence(incoherent);
        await settle();

        const coherence = received.find(m => m.type === 'source:coherence');
        expect(coherence?.payload.files).toEqual(['model/parts.sysml']);
        expect(coherence?.payload.lastGoodRevision).toBe(7);
        expect(received.some(m => m.type === 'app:restart-required')).toBe(false);
    });

    it('replays the break to a client that connects while it is broken', async () => {
        const { server } = await startServer();
        server.setSourceCoherence(incoherent);

        const { received } = await connect(server.port);

        // The model it just received is the last good one, so it has to be told.
        expect(received.some(m => m.type === 'model:update')).toBe(true);
        expect(received.some(m => m.type === 'source:coherence')).toBe(true);
    });

    it('holds model mutations while the source does not parse', async () => {
        const { server } = await startServer();
        const { socket, received, settle } = await connect(server.port);
        server.setSourceCoherence(incoherent);
        await settle();
        received.length = 0;

        socket.send(JSON.stringify({ type: 'element:update', payload: { element: { id: 'pump' } } }));
        await settle();

        // Held with the coherence message, not escalated to a relaunch demand.
        expect(received.some(m => m.type === 'source:coherence')).toBe(true);
        expect(received.some(m => m.type === 'app:restart-required')).toBe(false);
    });

    it('releases the hold when the source parses again', async () => {
        const { server } = await startServer();
        const { socket, received, settle } = await connect(server.port);
        server.setSourceCoherence(incoherent);
        await settle();

        server.setSourceCoherence({ coherent: true, files: [], diagnostics: [], lastGoodRevision: 8 });
        await settle();
        expect(received.at(-1)).toMatchObject({ type: 'source:coherence', payload: { coherent: true } });
        received.length = 0;

        socket.send(JSON.stringify({ type: 'element:update', payload: { element: { id: 'pump' } } }));
        await settle();

        // Whatever the write does now, it is no longer refused by the hold.
        expect(received.some(m => m.type === 'source:coherence')).toBe(false);
    });

    it('stays quiet when a coherent project simply keeps compiling', async () => {
        const { server } = await startServer();
        const { received, settle } = await connect(server.port);
        received.length = 0;

        server.setSourceCoherence({ coherent: true, files: [], diagnostics: [], lastGoodRevision: 8 });
        server.setSourceCoherence({ coherent: true, files: [], diagnostics: [], lastGoodRevision: 9 });
        await settle();

        expect(received.filter(m => m.type === 'source:coherence')).toHaveLength(0);
    });
});
