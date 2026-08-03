// ─── Client for a compiler speaking the sysmlc protocol ──────────────────────
//
// Spawn once, serve many revisions. Node's startup is 50–150 ms, which is fine
// for `memo validate` and hopeless for a diagram that redraws on every save —
// so the process transport is a long-lived server, not a spawn per compile.
// That is the LSP shape, and it is why the protocol is LSP: cancellation,
// document synchronisation and lifecycle come with it instead of being invented
// here.
//
// Nothing in this file knows which provider is using it. It is given a command
// and a project directory; the adapter that owns the provider ID supplies both.
// ─────────────────────────────────────────────────────────────────────────────

import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import {
    createMessageConnection,
    StreamMessageReader,
    StreamMessageWriter,
    type MessageConnection,
} from 'vscode-jsonrpc/node.js';
import {
    EMIT_IR_REQUEST,
    PROTOCOL_CAPABILITY_KEY,
    SYSMLC_PROTOCOL_VERSION,
    assertProtocolCompatible,
    type EmitIrResponse,
    type MemoIr,
    type ProtocolCapability,
} from './protocol.js';
import { MissingToolError } from './registry.js';
import { whichExecutable } from './process.js';

/**
 * Every compiler this process started.
 *
 * A server is unref'd while idle so it never keeps a command alive — which
 * means the command can exit while the server is still running, and an orphan
 * compiler is a worse bug than a slow one. One exit hook, not one per client,
 * so a host with many open projects does not trip Node's listener warning.
 */
const liveChildren = new Set<ChildProcessWithoutNullStreams>();
let exitHookInstalled = false;

function adopt(child: ChildProcessWithoutNullStreams): void {
    liveChildren.add(child);
    child.once('exit', () => liveChildren.delete(child));
    if (exitHookInstalled) return;
    exitHookInstalled = true;
    process.once('exit', () => {
        for (const live of liveChildren) live.kill();
    });
}

export interface SysmlcClientOptions {
    /** Executable to run, already resolved by the adapter. */
    command: string;
    /** Extra arguments before `serve --stdio`, e.g. a node script path. */
    args?: readonly string[];
    projectDir: string;
    /** Provider ID, used only to make a missing-tool error name the right thing. */
    providerId: string;
}

/**
 * A live compiler process.
 *
 * The handshake is standard LSP. The one thing checked beyond it is the
 * protocol version the server advertises, because a boundary that is not
 * checked is a boundary that silently is not one.
 */
export class SysmlcClient {
    private child?: ChildProcessWithoutNullStreams;
    private connection?: MessageConnection;
    private starting?: Promise<MessageConnection>;
    private revision = 0;
    private readonly pending = new Map<number, Promise<MemoIr>>();
    private capability?: ProtocolCapability;
    private disposed = false;

    constructor(private readonly options: SysmlcClientOptions) {}

    /** What the server said about itself, once the handshake has happened. */
    get serverCapability(): ProtocolCapability | undefined {
        return this.capability;
    }

    private start(): Promise<MessageConnection> {
        if (this.connection) return Promise.resolve(this.connection);
        this.starting ??= this.spawnAndHandshake().catch(error => {
            this.starting = undefined;
            throw error;
        });
        return this.starting;
    }

    private async spawnAndHandshake(): Promise<MessageConnection> {
        const { command, args = [], projectDir, providerId } = this.options;
        if (!whichExecutable(command)) {
            throw new MissingToolError(providerId, command, `"${command}" was not found on PATH`);
        }
        const child = spawn(command, [...args, 'serve', '--stdio'], {
            cwd: projectDir,
            stdio: ['pipe', 'pipe', 'pipe'],
        });
        // A compiler's own stderr is the only channel it has for the failures
        // that happen before it can answer a request. Losing it makes a crashed
        // server look like a hang.
        let stderr = '';
        child.stderr.on('data', chunk => { stderr += String(chunk); });
        child.on('error', () => { /* surfaced by the rejected request below */ });

        const connection = createMessageConnection(
            new StreamMessageReader(child.stdout),
            new StreamMessageWriter(child.stdin),
        );
        connection.onClose(() => this.forget());
        connection.listen();

        try {
            const result = await connection.sendRequest<any>('initialize', {
                processId: process.pid,
                rootUri: pathToFileURL(projectDir).toString(),
                capabilities: {},
                clientInfo: { name: 'memo-tools', version: SYSMLC_PROTOCOL_VERSION },
            });
            const capability = result?.capabilities?.experimental?.[PROTOCOL_CAPABILITY_KEY] as
                ProtocolCapability | undefined;
            assertProtocolCompatible(capability?.protocolVersion, `"${command}"`);
            connection.sendNotification('initialized', {});
            this.capability = capability;
        } catch (error) {
            child.kill();
            const detail = stderr.trim();
            throw error instanceof Error && detail
                ? new Error(`${error.message}\n${detail}`)
                : error;
        }

        this.child = child;
        this.connection = connection;
        adopt(child);
        this.idle();
        return connection;
    }

    private forget(): void {
        this.connection = undefined;
        this.starting = undefined;
        this.child = undefined;
    }

    /**
     * Keep the event loop alive only while a request is outstanding.
     *
     * Without this a one-shot `memo` command would hang on a server that is
     * perfectly healthy and simply still running. The server survives between
     * commands within one process — which is the point — but it never becomes
     * the reason the process will not exit.
     */
    private idle(): void {
        if (this.pending.size > 0) return;
        this.child?.unref();
        this.holdStreams(false);
    }

    private active(): void {
        this.child?.ref();
        this.holdStreams(true);
    }

    /**
     * Child stdio are pipes, and a pipe holds the event loop open. Node types
     * them as plain streams, so the ref/unref every pipe actually has is
     * reached by feature test rather than by cast.
     */
    private holdStreams(hold: boolean): void {
        for (const stream of [this.child?.stdout, this.child?.stdin]) {
            const handle = stream as unknown as { ref?: () => void; unref?: () => void } | undefined;
            if (hold) handle?.ref?.();
            else handle?.unref?.();
        }
    }

    /**
     * Ask for the IR of the current revision.
     *
     * Every call takes a new revision token. If a newer one overtakes it while
     * the server is working, the server refuses to answer with the older result
     * and says which revision superseded it — and this method then waits for
     * *that* answer. The caller cannot be handed a stale model; the worst case
     * is that it waits slightly longer for a fresher one.
     */
    async emitIr(): Promise<MemoIr> {
        const revision = (this.revision += 1);
        const request = this.send(revision);
        this.pending.set(revision, request);
        try {
            return await request;
        } finally {
            this.pending.delete(revision);
            this.idle();
        }
    }

    private async send(revision: number): Promise<MemoIr> {
        const connection = await this.start();
        this.active();
        const response = await connection.sendRequest<EmitIrResponse>(EMIT_IR_REQUEST, {
            projectDir: this.options.projectDir,
            revision,
            protocolVersion: SYSMLC_PROTOCOL_VERSION,
        });
        if (response.outcome === 'ir') return response.ir;
        // Superseded. Prefer the in-flight request that superseded us; if it has
        // already settled and been forgotten, ask again rather than return the
        // result the server correctly refused to give.
        const newer = this.pending.get(response.supersededBy) ?? this.pending.get(this.revision);
        if (newer) return newer;
        return this.send((this.revision += 1));
    }

    async dispose(): Promise<void> {
        if (this.disposed) return;
        this.disposed = true;
        const { child, connection } = this;
        this.forget();
        // A server that has already gone does not need to be asked to go, and
        // asking it writes to a destroyed pipe — a rejection nobody is waiting
        // for. Every send here is awaited and swallowed for that reason.
        if (connection && child && !child.killed && child.stdin.writable) {
            this.child = child;
            this.active();
            await connection.sendRequest('shutdown').catch(() => undefined);
            await connection.sendNotification('exit').catch(() => undefined);
            this.child = undefined;
        }
        connection?.dispose();
        child?.kill();
    }
}

/**
 * One server per (executable, project). Two commands in one process share it,
 * which is exactly the saving a long-lived server exists for.
 */
const clients = new Map<string, SysmlcClient>();

export function getSysmlcClient(options: SysmlcClientOptions): SysmlcClient {
    const key = `${options.command} ${(options.args ?? []).join('')} ${options.projectDir}`;
    const existing = clients.get(key);
    if (existing) return existing;
    const client = new SysmlcClient(options);
    clients.set(key, client);
    return client;
}

/** Shut every pooled server down. Long-running hosts call this on teardown. */
export async function disposeSysmlcClients(): Promise<void> {
    const live = [...clients.values()];
    clients.clear();
    await Promise.all(live.map(client => client.dispose()));
}
