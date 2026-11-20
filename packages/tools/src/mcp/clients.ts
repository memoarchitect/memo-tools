// ─── AI coding tools connected to the model ──────────────────────────────────
//
// Each AI coding tool reads its MCP servers from its own file in the project. Connecting one adds a
// `memo` entry there that runs `memo-architect mcp`; disconnecting removes only that entry, so the
// project's other servers are left alone. Architect's Settings › Assistant and `memo-architect mcp
// init` both call these functions, so the two always write the same thing.
//
// The entries name no absolute path, so they can be committed and work on every engineer's machine:
// VS Code and Cursor expand `${workspaceFolder}`, and Claude Code starts a project's servers in the
// project, where the server finds the model by walking up from its working directory.
// ─────────────────────────────────────────────────────────────────────────────

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { agentRulesMarkdown } from '../llm/sysml-guidance.js';

export type AiClientId = 'claude-code' | 'cursor' | 'vscode';

interface ClientDescriptor {
    id: AiClientId;
    label: string;
    /** The client's MCP file, project-relative. */
    file: string;
    /** The key that holds the servers. */
    serversKey: 'mcpServers' | 'servers';
    /** How the client names the project folder in an argument, if it expands one. */
    workspaceVariable?: string;
    /** Extra fields the client wants on a stdio entry. */
    entryFields?: Record<string, unknown>;
    /** A rules file the client reads, written with the connection. */
    rulesFile?: string;
}

export const AI_CLIENTS: readonly ClientDescriptor[] = [
    { id: 'claude-code', label: 'Claude Code', file: '.mcp.json', serversKey: 'mcpServers', entryFields: { type: 'stdio' } },
    {
        id: 'cursor', label: 'Cursor', file: '.cursor/mcp.json', serversKey: 'mcpServers',
        workspaceVariable: '${workspaceFolder}', rulesFile: '.cursor/rules/memo.mdc',
    },
    { id: 'vscode', label: 'VS Code', file: '.vscode/mcp.json', serversKey: 'servers', workspaceVariable: '${workspaceFolder}', entryFields: { type: 'stdio' } },
];

const SERVER_NAME = 'memo';
/** Marks a rules file MEMO wrote, so disconnecting never removes one a person wrote. */
const RULES_MARKER = 'Written by MEMO Architect';

export interface AiClientStatus {
    id: AiClientId;
    label: string;
    file: string;
    connected: boolean;
    /** The connection lets the tool propose model edits (they still wait for approval). */
    proposesEdits: boolean;
}

function descriptor(id: string): ClientDescriptor {
    const found = AI_CLIENTS.find(client => client.id === id);
    if (!found) throw new Error(`Unknown AI coding tool "${id}". Known: ${AI_CLIENTS.map(c => c.id).join(', ')}.`);
    return found;
}

function readConfig(path: string): Record<string, any> {
    if (!existsSync(path)) return {};
    try {
        const parsed = JSON.parse(readFileSync(path, 'utf8'));
        return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
        throw new Error(`${path} is not valid JSON. Fix or remove it, then connect again.`);
    }
}

function serverEntry(client: ClientDescriptor, proposesEdits: boolean): Record<string, unknown> {
    // npx resolves the project's own installed Architect first, so no global install is needed.
    const args = ['-y', '--package=@memoarchitect/architect', 'memo-architect', 'mcp'];
    if (client.workspaceVariable) args.push('--project', client.workspaceVariable);
    if (proposesEdits) args.push('--write');
    return { ...client.entryFields, command: 'npx', args };
}

export function aiClientStatus(projectRoot: string): AiClientStatus[] {
    return AI_CLIENTS.map(client => {
        let entry: any;
        try { entry = readConfig(join(projectRoot, client.file))[client.serversKey]?.[SERVER_NAME]; } catch { entry = undefined; }
        return {
            id: client.id, label: client.label, file: client.file,
            connected: Boolean(entry),
            proposesEdits: Array.isArray(entry?.args) && entry.args.includes('--write'),
        };
    });
}

/** Add or replace the `memo` server in one client's file, and its rules file if it reads one. */
export function connectAiClient(projectRoot: string, id: string, options: { proposesEdits?: boolean; rules?: boolean } = {}): AiClientStatus {
    const client = descriptor(id);
    const path = join(projectRoot, client.file);
    const config = readConfig(path);
    const servers = config[client.serversKey] && typeof config[client.serversKey] === 'object' ? config[client.serversKey] : {};
    servers[SERVER_NAME] = serverEntry(client, options.proposesEdits === true);
    config[client.serversKey] = servers;
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
    if (client.rulesFile && options.rules !== false) {
        const rulesPath = join(projectRoot, client.rulesFile);
        mkdirSync(dirname(rulesPath), { recursive: true });
        writeFileSync(rulesPath, agentRulesMarkdown(), 'utf8');
    }
    return aiClientStatus(projectRoot).find(status => status.id === client.id)!;
}

/** Remove the `memo` server from one client's file; the file goes only when nothing else is in it. */
export function disconnectAiClient(projectRoot: string, id: string): AiClientStatus {
    const client = descriptor(id);
    const path = join(projectRoot, client.file);
    const config = readConfig(path);
    const servers = config[client.serversKey];
    if (servers && typeof servers === 'object' && SERVER_NAME in servers) {
        delete servers[SERVER_NAME];
        const empty = Object.keys(servers).length === 0 && Object.keys(config).every(key => key === client.serversKey);
        if (empty) rmSync(path, { force: true });
        else writeFileSync(path, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
    }
    if (client.rulesFile) {
        const rulesPath = join(projectRoot, client.rulesFile);
        if (existsSync(rulesPath) && readFileSync(rulesPath, 'utf8').includes(RULES_MARKER)) rmSync(rulesPath, { force: true });
    }
    return aiClientStatus(projectRoot).find(status => status.id === client.id)!;
}
