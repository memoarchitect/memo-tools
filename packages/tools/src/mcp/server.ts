// ─── MEMO MCP Server ─────────────────────────────────────────────────────────
//
// Model Context Protocol server over stdio, letting Cursor, Claude Code, and
// any other MCP client query and (optionally) edit the MEMO model.
//
// MCP over stdio is JSON-RPC 2.0 in newline-delimited JSON, so it is
// implemented directly rather than pulling in an SDK — consistent with the
// fetch-only LLM providers, and one less dependency for consumers of this
// published package.
//
// stdout carries protocol frames and nothing else. Every diagnostic goes to
// stderr; a stray console.log here corrupts the session.
// ─────────────────────────────────────────────────────────────────────────────

import { createInterface } from 'node:readline';
import { listTools, callTool, type McpSession } from './tools.js';
import { agentInstructions } from '../llm/sysml-guidance.js';
import { getPrompt, listPrompts, listResources, listResourceTemplates, readResource } from './prompts-and-resources.js';

/** Protocol revisions this server implements. */
const SUPPORTED_PROTOCOL_VERSIONS = ['2025-06-18', '2025-03-26', '2024-11-05'];
const DEFAULT_PROTOCOL_VERSION = SUPPORTED_PROTOCOL_VERSIONS[0];

const SERVER_NAME = 'memo';

// JSON-RPC 2.0 reserved error codes.
const PARSE_ERROR = -32700;
const INVALID_REQUEST = -32600;
const METHOD_NOT_FOUND = -32601;
const INVALID_PARAMS = -32602;
const INTERNAL_ERROR = -32603;

interface JsonRpcRequest {
    jsonrpc: '2.0';
    id?: string | number | null;
    method: string;
    params?: any;
}

export interface McpServerOptions {
    projectRoot: string;
    /** Expose the model-editing tools. Read-only when false. */
    allowWrites?: boolean;
    version?: string;
}

export function startMcpServer(options: McpServerOptions): Promise<void> {
    const { projectRoot, allowWrites = false, version = '0.0.0' } = options;

    // Recorded with each proposal, so the engineer sees which tool proposed it.
    let clientName: string | undefined;
    // The system this session's answers are scoped to (memo_select_system).
    const session: McpSession = {};

    function send(payload: unknown): void {
        process.stdout.write(`${JSON.stringify(payload)}\n`);
    }

    function respond(id: string | number, result: unknown): void {
        send({ jsonrpc: '2.0', id, result });
    }

    function respondError(id: string | number, code: number, message: string): void {
        send({ jsonrpc: '2.0', id, error: { code, message } });
    }

    async function handle(request: JsonRpcRequest): Promise<void> {
        const { id, method, params } = request;
        // A message with no id is a notification: act on it, never reply.
        const isNotification = id === undefined || id === null;

        switch (method) {
            case 'initialize': {
                if (isNotification) return;
                // Speak the client's revision when we know it, so a client
                // pinned to an older one is not forced to downgrade us.
                if (typeof params?.clientInfo?.name === 'string') clientName = params.clientInfo.name;
                const requested = params?.protocolVersion;
                const protocolVersion = SUPPORTED_PROTOCOL_VERSIONS.includes(requested)
                    ? requested
                    : DEFAULT_PROTOCOL_VERSION;
                respond(id, {
                    protocolVersion,
                    capabilities: { tools: { listChanged: false }, prompts: { listChanged: false }, resources: { listChanged: false } },
                    serverInfo: { name: SERVER_NAME, version },
                    instructions: agentInstructions(),
                });
                return;
            }

            case 'notifications/initialized':
            case 'notifications/cancelled':
                return; // Nothing to do, and notifications take no reply.

            case 'ping':
                if (!isNotification) respond(id, {});
                return;

            case 'prompts/list':
            case 'prompts/get':
            case 'resources/list':
            case 'resources/templates/list':
            case 'resources/read': {
                if (isNotification) return;
                try {
                    const result = method === 'prompts/list' ? { prompts: await listPrompts(projectRoot, session) }
                        : method === 'prompts/get' ? await getPrompt(projectRoot, String(params?.name ?? ''), params?.arguments ?? {}, session, allowWrites)
                        : method === 'resources/list' ? { resources: listResources() }
                        : method === 'resources/templates/list' ? { resourceTemplates: listResourceTemplates() }
                        : await readResource(projectRoot, String(params?.uri ?? ''), session);
                    respond(id, result);
                } catch (e: any) {
                    // A prompt or resource that does not exist is the caller's mistake, said plainly.
                    respondError(id, INVALID_PARAMS, e?.message ?? String(e));
                }
                return;
            }

            case 'tools/list':
                if (isNotification) return;
                respond(id, { tools: listTools(allowWrites) });
                return;

            case 'tools/call': {
                if (isNotification) return;
                const name = params?.name;
                if (typeof name !== 'string') {
                    respondError(id, INVALID_REQUEST, 'tools/call requires a tool name.');
                    return;
                }
                try {
                    const result = await callTool(name, params?.arguments ?? {}, projectRoot, allowWrites, clientName, session);
                    respond(id, {
                        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
                    });
                } catch (e: any) {
                    // A failing tool is a normal result the model should see and
                    // recover from — not a transport-level JSON-RPC error.
                    respond(id, {
                        content: [{ type: 'text', text: e?.message ?? String(e) }],
                        isError: true,
                    });
                }
                return;
            }

            default:
                if (!isNotification) {
                    respondError(id, METHOD_NOT_FOUND, `Unknown method "${method}".`);
                }
        }
    }

    return new Promise<void>(resolve => {
        const rl = createInterface({ input: process.stdin });

        // Requests are handled one at a time. The model loader caches, so
        // serialising costs little and avoids concurrent reloads of the same
        // project racing each other.
        let queue: Promise<void> = Promise.resolve();

        rl.on('line', line => {
            const trimmed = line.trim();
            if (!trimmed) return;

            let request: JsonRpcRequest;
            try {
                request = JSON.parse(trimmed);
            } catch {
                send({ jsonrpc: '2.0', id: null, error: { code: PARSE_ERROR, message: 'Invalid JSON.' } });
                return;
            }

            queue = queue.then(() => handle(request)).catch(e => {
                console.error('[memo-architect mcp] handler failed:', e);
                const id = request.id;
                if (id !== undefined && id !== null) {
                    respondError(id, INTERNAL_ERROR, e?.message ?? String(e));
                }
            });
        });

        rl.on('close', () => {
            void queue.finally(() => resolve());
        });

        console.error(
            `[memo-architect mcp] serving ${projectRoot} (${allowWrites ? 'read-write' : 'read-only'})`,
        );
    });
}
