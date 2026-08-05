// ─── memo-sysmlc serve --stdio ───────────────────────────────────────────────
//
// MEMO's compiler as a long-lived server. Node starts in 50–150 ms, which is
// fine once and hopeless on every save, so the process transport is a server
// that is spawned once and answers many revisions — and the protocol it speaks
// is LSP, because LSP already solved lifecycle, document synchronisation and
// cancellation, and because an editor that speaks it gets MEMO diagnostics
// without anyone writing a MEMO client.
//
// Exactly one request is added: `memo/emitIr`. Everything else here is standard
// LSP.
// ─────────────────────────────────────────────────────────────────────────────

import { createHash } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    createConnection,
    DiagnosticSeverity,
    ProposedFeatures,
    TextDocumentSyncKind,
    TextDocuments,
    type Connection,
    type Diagnostic as LspDiagnostic,
} from 'vscode-languageserver/node.js';
import { TextDocument } from 'vscode-languageserver-textdocument';
import {
    EMIT_IR_REQUEST,
    PROTOCOL_CAPABILITY_KEY,
    SYSMLC_IR_VERSION,
    SYSMLC_PROTOCOL_VERSION,
    lowerProject,
    resolveSources,
    parseText,
    type EmitIrParams,
    type EmitIrResponse,
    type MemoIr,
    type ProtocolCapability,
} from '@memoarchitect/tools';

export const IMPLEMENTATION_NAME = 'sysmlc';

export function protocolCapability(version?: string): ProtocolCapability {
    return {
        protocolVersion: SYSMLC_PROTOCOL_VERSION,
        irVersion: SYSMLC_IR_VERSION,
        implementation: IMPLEMENTATION_NAME,
        implementationVersion: version,
    };
}

/**
 * Per-project state: the newest revision asked for, and the last IR computed.
 *
 * The revision counter is what makes the supersession rule enforceable, and the
 * fingerprint is what keeps two roles in one refresh — "is this valid?" and
 * "what can MEMO ingest?" — from compiling the same unchanged project twice.
 */
interface ProjectState {
    latestRequested: number;
    cached?: { fingerprint: string; ir: MemoIr };
}

/**
 * What the project looks like on disk right now.
 *
 * Path, size and mtime of every source file. Deliberately not a content hash:
 * this runs before every compile, and the point is to be cheaper than the
 * compile it might avoid. A same-millisecond same-size edit would defeat it,
 * which is why it only ever *skips work*, never decides an answer.
 */
function fingerprintProject(projectDir: string, files?: readonly string[]): string {
    const hash = createHash('sha256');
    // The requested source list is part of the fingerprint, not just its
    // contents: two requests against one directory with different file sets are
    // different questions, and a cache that could not tell them apart would
    // answer the second with the first one's model.
    for (const file of resolveSources(projectDir, files)) {
        try {
            const stat = statSync(file);
            hash.update(`${file}:${stat.size}:${stat.mtimeMs}\n`);
        } catch {
            hash.update(`${file}:missing\n`);
        }
    }
    return hash.digest('hex');
}

export class SysmlcServer {
    private readonly projects = new Map<string, ProjectState>();

    constructor(private readonly version?: string) {}

    private state(projectDir: string): ProjectState {
        const key = resolve(projectDir);
        const existing = this.projects.get(key);
        if (existing) return existing;
        const created: ProjectState = { latestRequested: 0 };
        this.projects.set(key, created);
        return created;
    }

    /**
     * Answer `memo/emitIr`, or refuse to answer stale.
     *
     * The check happens after the work, not before it: a revision is superseded
     * by whatever arrived *while* it was compiling, and that is precisely the
     * window this rule exists to close. Handing back the finished-but-old model
     * would put a picture on the canvas of a revision the user has already
     * edited past, with nothing to tell them so.
     */
    async emitIr(params: EmitIrParams): Promise<EmitIrResponse> {
        const projectDir = resolve(params.projectDir);
        const state = this.state(projectDir);
        state.latestRequested = Math.max(state.latestRequested, params.revision);

        const fingerprint = fingerprintProject(projectDir, params.files);
        const ir = state.cached?.fingerprint === fingerprint
            ? state.cached.ir
            : await lowerProject(projectDir, { files: params.files });
        state.cached = { fingerprint, ir };

        if (state.latestRequested > params.revision) {
            return {
                outcome: 'superseded',
                protocolVersion: SYSMLC_PROTOCOL_VERSION,
                revision: params.revision,
                supersededBy: state.latestRequested,
            };
        }
        return {
            outcome: 'ir',
            protocolVersion: SYSMLC_PROTOCOL_VERSION,
            revision: params.revision,
            ir,
        };
    }

    /** Syntax diagnostics for one open document, in LSP's own shape. */
    async documentDiagnostics(text: string): Promise<LspDiagnostic[]> {
        const { errors } = await parseText(text);
        return errors.map(error => {
            const line = Math.max(0, (error.line ?? 1) - 1);
            const character = Math.max(0, (error.column ?? 1) - 1);
            return {
                severity: DiagnosticSeverity.Error,
                range: { start: { line, character }, end: { line, character: character + 1 } },
                message: error.message,
                source: IMPLEMENTATION_NAME,
            };
        });
    }

    /** Wire the server onto a connection. Split out so tests can drive it. */
    listen(connection: Connection): void {
        const documents = new TextDocuments(TextDocument);

        connection.onInitialize(() => ({
            capabilities: {
                textDocumentSync: TextDocumentSyncKind.Incremental,
                experimental: { [PROTOCOL_CAPABILITY_KEY]: protocolCapability(this.version) },
            },
            serverInfo: { name: IMPLEMENTATION_NAME, version: this.version },
        }));

        // Editor-facing half: fast, local, advisory. §1.1 — the editor gives
        // syntax errors while you type; it never refuses the edit.
        documents.onDidChangeContent(async change => {
            connection.sendDiagnostics({
                uri: change.document.uri,
                diagnostics: await this.documentDiagnostics(change.document.getText()),
            });
        });
        documents.onDidClose(event => {
            connection.sendDiagnostics({ uri: event.document.uri, diagnostics: [] });
        });

        // The one custom request. Lowering reads the revision on disk, which is
        // the revision the canvas draws: MEMO saves before it redraws, and a
        // model built from unsaved buffers would show something no file says.
        connection.onRequest(EMIT_IR_REQUEST, (params: EmitIrParams) => this.emitIr(params));

        connection.onShutdown(() => { this.projects.clear(); });
        connection.onExit(() => process.exit(0));

        documents.listen(connection);
        connection.listen();
    }
}

/** Entry point for `memo-sysmlc serve --stdio`. */
export function serveStdio(version?: string): void {
    // stdout is the protocol channel. Anything written to it that is not a
    // JSON-RPC message corrupts the stream, so stray logging goes to stderr.
    console.log = console.error;
    // A client that dies without saying goodbye closes the pipe. Outliving it
    // would leave a compiler running with nobody to answer, so end of input is
    // end of server — the same rule every language server follows.
    process.stdin.on('close', () => process.exit(0));
    new SysmlcServer(version).listen(createConnection(ProposedFeatures.all));
}

/** Read this package's own version, for `--version` and the handshake. */
export function packageVersion(): string | undefined {
    try {
        const path = fileURLToPath(new URL('../../../../package.json', import.meta.url));
        return JSON.parse(readFileSync(path, 'utf8')).version as string;
    } catch {
        return undefined;
    }
}
