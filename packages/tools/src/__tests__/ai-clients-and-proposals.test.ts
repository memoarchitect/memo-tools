// ─── AI coding tools and the proposals they make ─────────────────────────────
//
// Connecting a tool writes only the `memo` entry in that tool's file, names no path on this machine,
// and leaves the project's other servers alone. A proposal an AI coding tool makes waits in the queue
// file until it is applied or discarded.
// ─────────────────────────────────────────────────────────────────────────────

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { aiClientStatus, checkAiClient, connectAiClient, disconnectAiClient } from '../mcp/clients.js';
import { appendProposals, readProposalQueue, removeProposals, PROPOSAL_QUEUE_FILE } from '../llm/proposal-queue.js';
import { stageProposal } from '../llm/chat-engine.js';
import type { QueryContext } from '../dhf/query-engine.js';

let root: string;
beforeEach(() => { root = mkdtempSync(join(tmpdir(), 'memo-ai-')); });
afterEach(() => { rmSync(root, { recursive: true, force: true }); });

const read = (file: string) => JSON.parse(readFileSync(join(root, file), 'utf8'));

describe('connecting AI coding tools', () => {
    it('writes each tool its own format, with no path on this machine', () => {
        connectAiClient(root, 'claude-code');
        connectAiClient(root, 'cursor');
        connectAiClient(root, 'vscode');
        expect(read('.mcp.json').mcpServers.memo).toMatchObject({ type: 'stdio', command: 'npx' });
        expect(read('.cursor/mcp.json').mcpServers.memo.args).toContain('${workspaceFolder}');
        expect(read('.vscode/mcp.json').servers.memo).toMatchObject({ type: 'stdio', command: 'npx' });
        for (const file of ['.mcp.json', '.cursor/mcp.json', '.vscode/mcp.json']) {
            expect(readFileSync(join(root, file), 'utf8')).not.toContain(root);
            expect(read(file)[file === '.vscode/mcp.json' ? 'servers' : 'mcpServers'].memo.args).toContain('memo-architect');
        }
        expect(readFileSync(join(root, '.cursor/rules/memo.mdc'), 'utf8')).toContain('memo_ontology');
        expect(aiClientStatus(root).every(client => client.connected && !client.proposesEdits)).toBe(true);
    });

    it('marks a connection that may propose edits', () => {
        connectAiClient(root, 'claude-code', { proposesEdits: true });
        expect(read('.mcp.json').mcpServers.memo.args).toContain('--write');
        expect(aiClientStatus(root).find(client => client.id === 'claude-code')?.proposesEdits).toBe(true);
    });

    it('keeps the project\'s other servers on connect and disconnect', () => {
        writeFileSync(join(root, '.mcp.json'), JSON.stringify({ mcpServers: { other: { command: 'other' } } }));
        connectAiClient(root, 'claude-code');
        disconnectAiClient(root, 'claude-code');
        expect(read('.mcp.json')).toEqual({ mcpServers: { other: { command: 'other' } } });
    });

    it('removes a file and a rules file only when MEMO wrote them', () => {
        connectAiClient(root, 'cursor');
        disconnectAiClient(root, 'cursor');
        expect(existsSync(join(root, '.cursor/mcp.json'))).toBe(false);
        expect(existsSync(join(root, '.cursor/rules/memo.mdc'))).toBe(false);

        mkdirSync(join(root, '.cursor/rules'), { recursive: true });
        writeFileSync(join(root, '.cursor/rules/memo.mdc'), 'my own rules');
        disconnectAiClient(root, 'cursor');
        expect(readFileSync(join(root, '.cursor/rules/memo.mdc'), 'utf8')).toBe('my own rules');
    });

    it('refuses to rewrite a file that is not JSON', () => {
        writeFileSync(join(root, '.mcp.json'), '{ not json');
        expect(() => connectAiClient(root, 'claude-code')).toThrow(/not valid JSON/);
        expect(readFileSync(join(root, '.mcp.json'), 'utf8')).toBe('{ not json');
    });
});

describe('checking a connected tool', () => {
    // A stand-in MCP server: answers initialize with a version and tools/list with the tools given.
    const fakeServer = (tools: string[]) => {
        const script = join(root, 'fake-mcp.cjs');
        writeFileSync(script, `
            const rl = require('readline').createInterface({ input: process.stdin });
            rl.on('line', line => {
                const m = JSON.parse(line);
                if (m.id === 1) console.log(JSON.stringify({ jsonrpc: '2.0', id: 1, result: { serverInfo: { name: 'memo', version: '9.9.9' } } }));
                if (m.id === 2) console.log(JSON.stringify({ jsonrpc: '2.0', id: 2, result: { tools: ${JSON.stringify(tools.map(name => ({ name })))} } }));
            });`);
        writeFileSync(join(root, '.mcp.json'), JSON.stringify({ mcpServers: { memo: { command: process.execPath, args: [script, '${workspaceFolder}'] } } }));
    };

    it('reports the version and tools the entry runs', async () => {
        fakeServer(['memo_search_elements', 'propose_create_element']);
        expect(await checkAiClient(root, 'claude-code', 10_000)).toMatchObject({
            ok: true, version: '9.9.9', proposesEdits: true, writesDirectly: false,
        });
    });

    it('flags an Architect that writes straight to the model', async () => {
        fakeServer(['memo_search_elements', 'memo_create_element']);
        expect(await checkAiClient(root, 'claude-code', 10_000)).toMatchObject({ ok: true, writesDirectly: true });
    });

    it('says when a tool is not connected or its entry does not start', async () => {
        expect((await checkAiClient(root, 'cursor', 5_000)).error).toMatch(/not connected/);
        writeFileSync(join(root, '.mcp.json'), JSON.stringify({ mcpServers: { memo: { command: join(root, 'missing'), args: [] } } }));
        expect((await checkAiClient(root, 'claude-code', 5_000)).ok).toBe(false);
    });
});

describe('proposals from AI coding tools', () => {
    const elements = [
        { id: 'haz-001', name: 'OverPressure', kind: 'Hazard', construct: 'part', layer: 'risk', file: 'risk.sysml', attributes: {} },
    ];
    const ctx = {
        element: (id: string) => elements.find(e => e.id === id),
        allRelationships: () => [],
    } as unknown as QueryContext;
    const ontology = {
        kinds: { Requirement: { label: 'Requirement', layer: 'requirements', sysmlConstruct: 'requirement def' as const } },
        relationshipTypes: [{ name: 'mitigates', label: 'Mitigates', layer: 'risk', color: '#000' }],
    } as any;

    it('stages with the assistant\'s checks, against what is already waiting', () => {
        const first = stageProposal('propose_create_element', { id: 'req-9', name: 'Limit', kind: 'Requirement' }, { ctx, ontology });
        expect(first?.isError).toBeFalsy();
        appendProposals(root, first!.added, 'claude-code');

        const second = stageProposal('propose_create_relationship', { type: 'mitigates', sourceId: 'req-9', targetId: 'haz-001' },
            { ctx, ontology, waiting: readProposalQueue(root) });
        expect(second?.isError).toBeFalsy();
        appendProposals(root, second!.added, 'claude-code');

        const queue = readProposalQueue(root);
        expect(queue.map(p => p.kind)).toEqual(['create-element', 'create-relationship']);
        expect(queue[0].client).toBe('claude-code');
        expect(new Set(queue.map(p => p.id)).size).toBe(2);

        const bad = stageProposal('propose_create_element', { id: 'x', name: 'X', kind: 'Nonsense' }, { ctx, ontology });
        expect(bad?.isError).toBe(true);
        expect(stageProposal('memo_search_elements', {}, { ctx, ontology })).toBeUndefined();
    });

    it('proposes what a hand-curated view shows, and refuses a view that fills itself', () => {
        const withViews = {
            element: (id: string) => ({
                'v::manual': { id: 'v::manual', attributes: { autoPopulate: 'false' } },
                'v::auto': { id: 'v::auto', attributes: { autoPopulate: 'true' } },
                'haz-001': elements[0],
            } as Record<string, any>)[id],
            allRelationships: () => [],
        } as unknown as QueryContext;
        const views = [
            { id: 'V-1', name: 'Curated', diagramType: 'bdd', elementId: 'v::manual', elementIds: [] },
            { id: 'V-2', name: 'Auto', diagramType: 'bdd', elementId: 'v::auto', elementIds: [] },
        ];
        const ok = stageProposal('propose_update_view', { view: 'V-1', add: ['haz-001'] }, { ctx: withViews, ontology, views });
        expect(ok?.isError).toBeFalsy();
        expect(ok?.added[0]).toMatchObject({ kind: 'update-view', viewId: 'V-1', add: ['haz-001'], remove: [] });
        expect(stageProposal('propose_update_view', { view: 'V-2', add: ['haz-001'] }, { ctx: withViews, ontology, views })?.message)
            .toMatch(/fills itself/);
        expect(stageProposal('propose_update_view', { view: 'V-1', remove: ['haz-001'] }, { ctx: withViews, ontology, views })?.message)
            .toMatch(/does not show/);
        expect(stageProposal('propose_update_view', { view: 'nope', add: ['haz-001'] }, { ctx: withViews, ontology, views })?.message)
            .toMatch(/No view/);
    });

    it('keeps the queue out of git and drops what was applied or discarded', () => {
        const staged = stageProposal('propose_create_element', { id: 'req-9', name: 'Limit', kind: 'Requirement' }, { ctx, ontology })!;
        appendProposals(root, staged.added);
        expect(readFileSync(join(root, '.gitignore'), 'utf8')).toContain(PROPOSAL_QUEUE_FILE);
        expect(removeProposals(root, staged.added.map(c => c.id))).toEqual([]);
        expect(readProposalQueue(root)).toEqual([]);
    });
});
