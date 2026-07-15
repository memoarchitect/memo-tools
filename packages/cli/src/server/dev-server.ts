// ─── Dev Server ──────────────────────────────────────────────────────────────
//
// HTTP server with:
//   - Vite dev middleware (serves the @memo/web React app)
//   - WebSocket endpoint for pushing model updates to browser
// ─────────────────────────────────────────────────────────────────────────────

import { createServer as createHttpServer, type Server } from 'node:http';
import { isAbsolute, relative, resolve } from 'node:path';
import { existsSync, readFileSync, realpathSync, writeFileSync, mkdirSync, createReadStream, statSync } from 'node:fs';
import { extname } from 'node:path';
import type { ServerMessage, ModelUpdateMessage, DiagramDTO } from '@memo/core';
import type { BuilderRegistries } from '@memo/core';
import { loadViewLayouts, saveViewLayout } from './view-layout-store.js';
import {
    loadDhfDocs, saveDhfDoc, deleteDhfDoc,
    loadDhfSettings, saveDhfSettings,
    listRepoTemplates, readRepoTemplate,
} from './dhf-doc-store.js';

export interface DevServerOptions {
    port: number;
    projectRoot: string;
    webPackagePath: string;
    initialMessages: ServerMessage[];
    /** Frozen ontology registries from bootstrap — used to validate diagrams/layouts on load */
    ontologyRegistries?: BuilderRegistries;
}

export interface DevServer {
    broadcast(messages: ServerMessage[]): void;
    close(): void;
}

// ─── User-diagram persistence helpers ──────────────────────────────────────

function userDiagramsPath(projectRoot: string): string {
    return resolve(projectRoot, '.memo', 'user-diagrams.json');
}

function loadUserDiagrams(projectRoot: string): DiagramDTO[] {
    const p = userDiagramsPath(projectRoot);
    if (!existsSync(p)) return [];
    try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return []; }
}

function saveUserDiagrams(projectRoot: string, diagrams: DiagramDTO[]): void {
    const dir = resolve(projectRoot, '.memo');
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(userDiagramsPath(projectRoot), JSON.stringify(diagrams, null, 2), 'utf8');
}

const STATIC_MIME: Record<string, string> = {
    '.html': 'text/html; charset=utf-8',
    '.css':  'text/css',
    '.js':   'application/javascript',
    '.json': 'application/json',
    '.svg':  'image/svg+xml',
    '.png':  'image/png',
    '.ico':  'image/x-icon',
    '.woff2': 'font/woff2',
    '.woff':  'font/woff',
    '.xml':  'application/xml',
    '.gz':   'application/gzip',
};

function streamFile(res: any, fullPath: string, status = 200): void {
    const mime = STATIC_MIME[extname(fullPath)] ?? 'application/octet-stream';
    const size = statSync(fullPath).size;
    res.writeHead(status, { 'Content-Type': mime, 'Content-Length': size });
    createReadStream(fullPath).pipe(res);
}

export async function createDevServer(options: DevServerOptions): Promise<DevServer> {
    const { port, webPackagePath, initialMessages } = options;
    const host = '127.0.0.1';

    // Vite dev middleware needs the @memo/web source tree (index.html at the
    // package root). Packaged installs ship only the prebuilt dist/, which is
    // served statically instead — no Vite required in the user's folder.
    const hasWebSource = existsSync(resolve(webPackagePath, 'index.html'));
    const webDistPath = resolve(webPackagePath, 'dist');
    const hasWebDist = existsSync(resolve(webDistPath, 'index.html'));

    // Dynamic import Vite (it's a dev dependency of @memo/web)
    let vite: any;
    if (hasWebSource) {
        try {
            vite = await import('vite');
        } catch {
            // Vite not available — fall back to static serving
            console.warn(hasWebDist
                ? 'Vite not found, serving the prebuilt web app from dist/'
                : 'Vite not found, using static file serving');
        }
    }

    let server: Server;
    let viteServer: any;

    // Resolve docs/dist relative to the repo root (two levels up from cli package)
    const docsDistPath = resolve(webPackagePath, '../../docs/dist');
    const hasLocalDocs = existsSync(resolve(docsDistPath, 'index.html'));

    /** Serve a static file from docsDistPath. Returns true if handled. */
    function serveHelp(req: any, res: any): boolean {
        if (!hasLocalDocs) return false;
        const url: string = req.url ?? '/';
        if (!url.startsWith('/help')) return false;

        // Strip /help prefix, default to index.html
        let filePath = url.slice('/help'.length) || '/';
        if (filePath.endsWith('/')) filePath += 'index.html';
        const fullPath = resolve(docsDistPath, filePath.replace(/^\//, ''));

        if (!existsSync(fullPath)) {
            // MkDocs 404 page
            const notFound = resolve(docsDistPath, '404.html');
            if (existsSync(notFound)) {
                res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
                createReadStream(notFound).pipe(res);
            } else {
                res.writeHead(404); res.end('Not found');
            }
            return true;
        }

        streamFile(res, fullPath);
        return true;
    }

    /** Serve the prebuilt @memo/web dist as an SPA. Returns true if handled. */
    function serveWebDist(req: any, res: any): boolean {
        if (!hasWebDist) return false;
        const url: string = (req.url ?? '/').split('?')[0];
        const requested = resolve(webDistPath, url.replace(/^\//, ''));
        // Path traversal guard + SPA fallback: unknown routes get index.html.
        // A string-prefix check is insufficient: a sibling such as dist-backup
        // also starts with the dist path.
        const requestedRelative = relative(webDistPath, requested);
        const isWithinDist = requestedRelative !== '..'
            && !requestedRelative.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`)
            && !requestedRelative.startsWith('../')
            && !requestedRelative.startsWith('..\\');
        const fullPath = isWithinDist && existsSync(requested) && statSync(requested).isFile()
            ? requested
            : resolve(webDistPath, 'index.html');
        streamFile(res, fullPath);
        return true;
    }

    if (vite) {
        // Create Vite dev server in middleware mode
        viteServer = await vite.createServer({
            root: webPackagePath,
            server: { middlewareMode: true, host },
            appType: 'spa',
        });

        server = createHttpServer((req, res) => {
            if (serveHelp(req, res)) return;
            viteServer.middlewares(req, res);
        });
    } else if (hasWebDist) {
        // Packaged install: serve the prebuilt web app statically
        server = createHttpServer((req, res) => {
            if (serveHelp(req, res)) return;
            serveWebDist(req, res);
        });
    } else {
        // Fallback: serve a basic page that connects via WebSocket
        server = createHttpServer((req, res) => {
            res.writeHead(200, { 'Content-Type': 'text/html' });
            res.end(`
                <!DOCTYPE html>
                <html>
                <head><title>MEMO Dev</title></head>
                <body>
                    <h1>MEMO Dev Server</h1>
                    <p>Web package not found at ${webPackagePath}. Install @memo/web.</p>
                    <pre id="log"></pre>
                    <script>
                        const ws = new WebSocket('ws://' + location.host);
                        ws.onmessage = (e) => {
                            const msg = JSON.parse(e.data);
                            document.getElementById('log').textContent += JSON.stringify(msg.type) + '\\n';
                        };
                    </script>
                </body>
                </html>
            `);
        });
    }

    // WebSocket setup
    const { WebSocketServer } = await import('ws');
    const wss = new WebSocketServer({ server });
    const clients = new Set<any>();

    const currentDiagrams = (): DiagramDTO[] => {
        const model = initialMessages.find(m => m.type === 'model:update') as ModelUpdateMessage | undefined;
        return model?.payload.diagrams ?? [];
    };

    /** Push an updated model:update message (with modified diagrams) to all clients */
    function broadcastDiagramChange(changedDiagram: DiagramDTO, op: 'create' | 'update' | 'delete'): void {
        const modelMsgIdx = initialMessages.findIndex(m => m.type === 'model:update');
        if (modelMsgIdx < 0) return;
        const prev = initialMessages[modelMsgIdx] as ModelUpdateMessage;
        let diagrams: DiagramDTO[] = prev.payload.diagrams ?? [];
        if (op === 'create') {
            diagrams = [...diagrams, changedDiagram];
        } else if (op === 'update') {
            diagrams = diagrams.map(d => d.id === changedDiagram.id ? { ...d, ...changedDiagram } : d);
        } else {
            diagrams = diagrams.filter(d => d.id !== changedDiagram.id);
        }
        const updatedMsg: ModelUpdateMessage = { type: 'model:update', payload: { ...prev.payload, diagrams } };
        initialMessages[modelMsgIdx] = updatedMsg;
        for (const client of clients) {
            if (client.readyState === 1) client.send(JSON.stringify(updatedMsg));
        }
    }

    /** Convert a DhfBlock (from document IR) to a markdown string */
    function blockToMarkdown(block: any): string {
        switch (block.type) {
            case 'heading': return `${'#'.repeat(block.level)} ${block.text}\n`;
            case 'paragraph': return block.inlines.map((i: any) => i.text ?? '').join('') + '\n';
            case 'list': return block.items.map((item: any[]) => `- ${item.map((i: any) => i.text ?? '').join('')}`).join('\n') + '\n';
            case 'table': {
                const header = `| ${block.headers.join(' | ')} |`;
                const sep = `| ${block.headers.map(() => '---').join(' | ')} |`;
                const rows = block.rows.map((r: any[][]) => `| ${r.map(cell => cell.map((i: any) => i.text ?? '').join('')).join(' | ')} |`);
                return [header, sep, ...rows].join('\n') + '\n';
            }
            case 'divider': return '---\n';
            default: return '';
        }
    }

    /** Extract element IDs from a SysML text snippet by matching names against the model */
    function extractElementIdsFromText(text: string, elements: Record<string, any>): string[] {
        // Match `part|requirement|action|port|item|attribute <name> :` patterns
        const regex = /\b(?:part|requirement|action|port|item|attribute|connection)\s+(\w+)\s*:/g;
        const ids: string[] = [];
        let m: RegExpExecArray | null;
        while ((m = regex.exec(text)) !== null) {
            const name = m[1];
            if (elements[name]) ids.push(name);
        }
        return ids;
    }

    /** Resolve only the project-local .sysml source declared by the diagram. */
    function diagramSource(diagramId: string): { sourceFile: string; path: string } {
        const diagram = currentDiagrams().find(d => d.id === diagramId);
        if (!diagram) throw new Error('Diagram not found.');
        if (!diagram.sourceFile) throw new Error('This diagram is not backed by an editable SysML file.');

        const projectRoot = realpathSync(resolve(options.projectRoot));
        const requestedPath = resolve(projectRoot, diagram.sourceFile);
        if (!existsSync(requestedPath)) throw new Error('The diagram source file does not exist.');
        // Resolve symlinks before checking containment so an in-tree symlink
        // cannot be used to read or write a file outside the project.
        const path = realpathSync(requestedPath);
        const rel = relative(projectRoot, path);
        const outsideProject = rel === '..' || rel.startsWith('../') || rel.startsWith('..\\') || isAbsolute(rel);
        if (outsideProject || extname(path).toLowerCase() !== '.sysml') {
            throw new Error('The diagram source must be a project-local .sysml file.');
        }
        return { sourceFile: rel, path };
    }

    wss.on('connection', (ws: any) => {
        clients.add(ws);

        // Send initial state to new connections
        for (const msg of initialMessages) {
            ws.send(JSON.stringify(msg));
        }

        // Send all sidecar layouts on connect
        const layouts = loadViewLayouts(options.projectRoot, currentDiagrams());
        if (Object.keys(layouts).length > 0) {
            ws.send(JSON.stringify({ type: 'diagram:layout', payload: { layouts } }));
        }

        // Send persisted DHF documents and settings on connect
        try {
            const docs = loadDhfDocs(options.projectRoot);
            ws.send(JSON.stringify({ type: 'dhf:docs', payload: { docs } }));
            const dhfSettings = loadDhfSettings(options.projectRoot);
            if (dhfSettings) {
                ws.send(JSON.stringify({ type: 'dhf:settings', payload: { settings: dhfSettings } }));
            }
        } catch (e) {
            console.error('[DHF] initial load failed:', e);
        }

        // Announce LLM availability on connect
        {
            const hasAnthropic = !!(process.env.ANTHROPIC_API_KEY);
            const hasOpenAI = !!(process.env.OPENAI_API_KEY);
            const available = hasAnthropic || hasOpenAI;
            const provider = hasAnthropic ? 'anthropic' : hasOpenAI ? 'openai' : undefined;
            const model = process.env.MEMO_LLM_MODEL
                || (hasAnthropic ? 'claude-sonnet-4-20250514' : hasOpenAI ? 'gpt-4o' : undefined);
            ws.send(JSON.stringify({ type: 'llm:status', payload: { available, provider, model } }));
        }

        ws.on('close', () => clients.delete(ws));

        ws.on('message', async (data: any) => {
            try {
                const msg = JSON.parse(data.toString());
                if (msg.type === 'request:refresh') {
                    // Re-send current state
                    for (const m of initialMessages) {
                        ws.send(JSON.stringify(m));
                    }
                } else if (msg.type === 'element:update' || msg.type === 'element:create') {
                    // 1. Persist to FS
                    const { saveElementToFile } = await import('./persistor.js');
                    const { projectRoot } = options;

                    const result = saveElementToFile(projectRoot, msg.payload);
                    if (result.success) {
                        // The file watcher will catch this change and broadcast to all clients
                        console.log(`[Persisted] ${msg.type} to ${result.filePath}`);
                    }
                } else if (msg.type === 'diagram:create') {
                    const { projectRoot } = options;
                    const diagram: DiagramDTO = { ...msg.payload, auto: false };
                    const userDiagrams = loadUserDiagrams(projectRoot);
                    userDiagrams.push(diagram);
                    saveUserDiagrams(projectRoot, userDiagrams);
                    broadcastDiagramChange(diagram, 'create');
                    console.log(`[Diagram] Created: ${diagram.name} (${diagram.id})`);
                } else if (msg.type === 'diagram:update') {
                    const { projectRoot } = options;
                    const userDiagrams = loadUserDiagrams(projectRoot);
                    const idx = userDiagrams.findIndex(d => d.id === msg.payload.id);
                    if (idx >= 0) {
                        userDiagrams[idx] = { ...userDiagrams[idx], ...msg.payload };
                        saveUserDiagrams(projectRoot, userDiagrams);
                        broadcastDiagramChange(userDiagrams[idx], 'update');
                    }
                } else if (msg.type === 'diagram:delete') {
                    const { projectRoot } = options;
                    const userDiagrams = loadUserDiagrams(projectRoot);
                    const filtered = userDiagrams.filter(d => d.id !== msg.payload.id);
                    saveUserDiagrams(projectRoot, filtered);
                    broadcastDiagramChange({ id: msg.payload.id } as DiagramDTO, 'delete');
                    console.log(`[Diagram] Deleted: ${msg.payload.id}`);
                } else if (msg.type === 'diagram:layout:update') {
                    const { diagramId, layout } = msg.payload;
                    const diagram = currentDiagrams().find(d => d.id === diagramId)
                        ?? { id: diagramId, name: diagramId, diagramType: 'bdd', viewpointId: '__model', auto: false };
                    const savedPath = saveViewLayout(options.projectRoot, diagram, layout);
                    console.log(`[Diagram] Saved layout: ${savedPath}`);
                    // Broadcast to other clients (not the sender)
                    const layoutMsg = JSON.stringify({ type: 'diagram:layout', payload: { layouts: { [diagramId]: layout } } });
                    for (const client of clients) {
                        if (client !== ws && client.readyState === 1) client.send(layoutMsg);
                    }
                } else if (msg.type === 'relationship:add') {
                    const { saveRelationshipToFile } = await import('./persistor.js');
                    const { projectRoot } = options;
                    const result = saveRelationshipToFile(projectRoot, msg.payload);
                    if (result.success) {
                        console.log(`[Persisted] relationship:add (${msg.payload.type}) to ${result.filePath}`);
                    } else {
                        console.error(`[Error] relationship:add failed: ${result.error}`);
                    }
                } else if (msg.type === 'element:remap-kinds') {
                    // Remap orphaned kind references: for each element whose kind is in the
                    // mappings, persist the element with the new kind. The file watcher will
                    // pick up changes and broadcast an updated model.
                    const { projectRoot } = options;
                    const mappings: Record<string, string> = msg.payload?.mappings ?? {};
                    if (Object.keys(mappings).length > 0) {
                        const modelMsg = initialMessages.find(m => m.type === 'model:update') as ModelUpdateMessage | undefined;
                        const elements = modelMsg?.payload?.elements ?? {};
                        const { saveElementToFile } = await import('./persistor.js');
                        let remappedCount = 0;
                        for (const element of Object.values(elements) as any[]) {
                            const newKind = mappings[element.kind];
                            if (newKind) {
                                const result = saveElementToFile(projectRoot, { ...element, kind: newKind });
                                if (result.success) remappedCount++;
                            }
                        }
                        console.log(`[Remap] Remapped ${remappedCount} elements across ${Object.keys(mappings).length} kind(s)`);
                        ws.send(JSON.stringify({ type: 'remap:result', payload: { success: true, count: remappedCount } }));
                    }
                } else if (msg.type === 'open-file') {
                    // N-ONTO §6.5 — right-click "Open source" from the ontology viewer.
                    // Resolve the path against projectRoot, confirm it's within the tree,
                    // then hand off to the system-default opener.
                    const { projectRoot } = options;
                    const requested = String(msg.payload?.path ?? '');
                    if (!requested) return;
                    try {
                        const absPath = resolve(projectRoot, requested);
                        const relRoot = resolve(projectRoot);
                        // Guardrail: only open files inside the project tree
                        if (!absPath.startsWith(relRoot)) {
                            console.warn(`[OpenFile] Refused path outside project: ${absPath}`);
                            return;
                        }
                        if (!existsSync(absPath)) {
                            console.warn(`[OpenFile] Path does not exist: ${absPath}`);
                            return;
                        }
                        const { execFile } = await import('node:child_process');
                        const platform = process.platform;
                        const cmd = platform === 'darwin' ? 'open'
                            : platform === 'win32' ? 'explorer'
                            : 'xdg-open';
                        execFile(cmd, [absPath], (err) => {
                            if (err) console.warn(`[OpenFile] ${cmd} failed for ${absPath}:`, err.message);
                            else console.log(`[OpenFile] Opened ${absPath}`);
                        });
                    } catch (e: any) {
                        console.warn('[OpenFile] Failed:', e?.message ?? e);
                    }
                } else if (msg.type === 'diagram:parse') {
                    // Extract element IDs from SysML text by name-matching against current model
                    const modelMsg = initialMessages.find(m => m.type === 'model:update') as ModelUpdateMessage | undefined;
                    const elementIds = extractElementIdsFromText(msg.payload.text, modelMsg?.payload?.elements ?? {});
                    ws.send(JSON.stringify({
                        type: 'diagram:parse:result',
                        payload: { diagramId: msg.payload.diagramId, elementIds, errors: [] },
                    }));
                } else if (msg.type === 'diagram:source:request') {
                    const { requestId, diagramId } = msg.payload ?? {};
                    try {
                        const source = diagramSource(String(diagramId ?? ''));
                        const text = readFileSync(source.path, 'utf8');
                        ws.send(JSON.stringify({
                            type: 'diagram:source:result',
                            payload: {
                                requestId, diagramId, operation: 'load', success: true,
                                sourceFile: source.sourceFile, text,
                            },
                        }));
                    } catch (e: any) {
                        ws.send(JSON.stringify({
                            type: 'diagram:source:result',
                            payload: { requestId, diagramId, operation: 'load', success: false, error: e?.message ?? String(e) },
                        }));
                    }
                } else if (msg.type === 'diagram:source:save') {
                    const { requestId, diagramId, text } = msg.payload ?? {};
                    try {
                        if (typeof text !== 'string') throw new Error('SysML source text is required.');
                        const source = diagramSource(String(diagramId ?? ''));
                        writeFileSync(source.path, text, 'utf8');
                        ws.send(JSON.stringify({
                            type: 'diagram:source:result',
                            payload: {
                                requestId, diagramId, operation: 'save', success: true,
                                sourceFile: source.sourceFile,
                            },
                        }));
                        // The project watcher rebuilds and broadcasts the resulting model.
                        console.log(`[Diagram] Saved SysML source: ${source.sourceFile}`);
                    } catch (e: any) {
                        ws.send(JSON.stringify({
                            type: 'diagram:source:result',
                            payload: { requestId, diagramId, operation: 'save', success: false, error: e?.message ?? String(e) },
                        }));
                    }
                } else if (msg.type === 'ontology:save-selection') {
                    // Persist ontology selection to disk (SysML + YAML), then signal
                    // restart-required. No rebuild — ontology must not be hot-swapped.
                    const { projectRoot } = options;
                    const selected: string[] = msg.payload?.selected ?? [];
                    let changedFile = resolve(projectRoot, 'memo.config.yaml');

                    // ── 1. Write SysML import declarations ──────────────────────
                    try {
                        const { mkdirSync: mkd } = await import('node:fs');
                        const modelDir = resolve(projectRoot, 'model');
                        if (!existsSync(modelDir)) mkd(modelDir, { recursive: true });

                        const PACKAGE_NAMESPACE: Record<string, string> = {
                            '@memo/ontology': 'MEMO_Ontology_Arch',
                            '@memo/medical-modeling-profile': 'MEMO_Medical_Profile',
                        };
                        const importLines = selected
                            .map(name => {
                                const ns = PACKAGE_NAMESPACE[name]
                                    ?? name.replace(/^@/, '').replace(/[/\-]/g, '_').toUpperCase();
                                return `    import ${ns}::*;`;
                            })
                            .join('\n');

                        const sysmlContent = [
                            '// ── Ontology Selection ───────────────────────────────────────────────────────',
                            '//',
                            '// Auto-generated by MEMO when the user saves their ontology selection.',
                            '// Do not edit manually — use the Ontology Viewer instead.',
                            '//',
                            '// This file is the SysML v2 source-of-truth for which ontology packages are',
                            '// active in this project. Restart the dev server after changing selection.',
                            '// ─────────────────────────────────────────────────────────────────────────────',
                            '',
                            'package OntologySelection {',
                            importLines,
                            '}',
                            '',
                        ].join('\n');

                        const sysmlPath = resolve(modelDir, 'ontology-selection.sysml');
                        writeFileSync(sysmlPath, sysmlContent, 'utf8');
                        changedFile = sysmlPath;
                        console.log(`[Ontology] Wrote SysML import declarations to ${sysmlPath}`);
                    } catch (e) {
                        console.error('[Ontology] Failed to write SysML selection file:', e);
                    }

                    // ── 2. Update YAML config ──────────────────────────────────
                    const configCandidates = ['memo.package.yaml', 'memo.package.yml', 'memo.config.yaml', 'memo.config.yml'];
                    let configPath = '';
                    for (const name of configCandidates) {
                        const p = resolve(projectRoot, name);
                        if (existsSync(p)) { configPath = p; break; }
                    }
                    if (configPath) {
                        try {
                            const { parse, stringify } = require('yaml');
                            const content = readFileSync(configPath, 'utf8');
                            const doc = parse(content) as Record<string, any>;
                            const existingMap = new Map<string, any>(
                                (doc.ontologies ?? []).map((e: any) => [e.name, e])
                            );
                            doc.ontologies = selected.map(name => existingMap.get(name) ?? { name });
                            writeFileSync(configPath, stringify(doc), 'utf8');
                            console.log(`[Ontology] Updated config selection (${selected.length} packages) in ${configPath}`);
                        } catch (e) {
                            console.error('[Ontology] Failed to update config:', e);
                        }
                    }

                    // ── 3. Signal restart-required — do NOT rebuild ─────────────
                    const restartMsg = {
                        type: 'app:restart-required' as const,
                        reason: 'ontology-selection-changed' as const,
                        changedFile,
                        instruction: 'Ontology selection saved. Stop dev server (Ctrl+C) and run `memo dev` again to apply.',
                    };
                    for (const client of clients) {
                        if (client.readyState === 1) client.send(JSON.stringify(restartMsg));
                    }
                    console.log('[Ontology] Selection saved — restart required to apply.');
                } else if (msg.type === 'ontology:install') {
                    // Install an ontology from git URL, npm package, or local path
                    const { projectRoot } = options;
                    const source = msg.payload?.source;
                    if (!source) {
                        ws.send(JSON.stringify({ type: 'ontology:install:result', payload: { success: false, error: 'No source provided' } }));
                    } else {
                        try {
                            const { execSync } = await import('node:child_process');
                            const { detectInstallMode } = await import('../commands/install.js');
                            const mode = detectInstallMode(source);
                            const memoPkgsDir = resolve(projectRoot, 'memo_packages');
                            if (!existsSync(memoPkgsDir)) mkdirSync(memoPkgsDir, { recursive: true });

                            if (mode === 'git') {
                                // Clone into memo_packages/<repo-name>
                                const repoName = source.split('/').pop()?.replace('.git', '') ?? 'ontology';
                                const destDir = resolve(memoPkgsDir, repoName);
                                if (!existsSync(destDir)) {
                                    execSync(`git clone --depth 1 ${source} ${destDir}`, { stdio: 'pipe' });
                                }
                            } else if (mode === 'local') {
                                // Symlink local path
                                const { basename: bn } = await import('node:path');
                                const { symlinkSync } = await import('node:fs');
                                const resolvedSource = resolve(projectRoot, source);
                                const destDir = resolve(memoPkgsDir, bn(resolvedSource));
                                if (!existsSync(destDir)) {
                                    symlinkSync(resolvedSource, destDir);
                                }
                            }

                            // Refresh packages and broadcast
                            const { getPackageMetadata } = await import('@memo/core');
                            const packages = getPackageMetadata(projectRoot);
                            const pkgMsg = { type: 'ontology:packages' as const, payload: { packages } };
                            for (const client of clients) {
                                if (client.readyState === 1) client.send(JSON.stringify(pkgMsg));
                            }
                            ws.send(JSON.stringify({
                                type: 'ontology:install:result',
                                payload: { success: true, packageName: source },
                            }));
                            console.log(`[Ontology] Installed package from ${source}`);
                        } catch (e: any) {
                            ws.send(JSON.stringify({
                                type: 'ontology:install:result',
                                payload: { success: false, error: e?.message ?? String(e) },
                            }));
                            console.error('[Ontology] Install failed:', e);
                        }
                    }
                } else if (msg.type === 'csv:import') {
                    // Bulk import elements and/or relationships from CSV text.
                    // Generates a .sysml file; the file watcher broadcasts a model update.
                    const { projectRoot } = options;
                    const { elementsCsv, relationshipsCsv, packageName, targetFile } = msg.payload ?? {};
                    try {
                        const {
                            parseElementsCsv,
                            parseRelationshipsCsv,
                            generateFile,
                            attachProvenance,
                            findConfigFile,
                        } = await import('@memo/core');
                        const { loadAndResolveConfig } = await import('./config-resolver.js');

                        const configPath = findConfigFile(projectRoot);
                        if (!configPath) {
                            ws.send(JSON.stringify({
                                type: 'import:result',
                                payload: { success: false, elementsImported: 0, relationshipsImported: 0, errors: ['No memo config found'], warnings: [] },
                            }));
                            return;
                        }
                        const config = await loadAndResolveConfig(configPath);

                        const errors: string[] = [];
                        const warnings: string[] = [];
                        let elementsImported = 0;
                        let relationshipsImported = 0;

                        let elements: any[] = [];
                        let relationships: any[] = [];

                        if (elementsCsv) {
                            const result = parseElementsCsv(elementsCsv, config);
                            errors.push(...result.errors);
                            warnings.push(...result.warnings);
                            // Attach provenance
                            const sessionId = `ws-${Date.now().toString(36)}`;
                            elements = attachProvenance(result.items, {
                                sourceFile: targetFile ?? 'web-import',
                                importTimestamp: new Date().toISOString(),
                                importSessionId: sessionId,
                            });
                            elementsImported = elements.length;
                        }

                        if (relationshipsCsv) {
                            const knownIds = elementsImported > 0
                                ? new Set(elements.map((e: any) => e.id))
                                : undefined;
                            const result = parseRelationshipsCsv(relationshipsCsv, config, knownIds);
                            errors.push(...result.errors);
                            warnings.push(...result.warnings);
                            relationships = result.items;
                            relationshipsImported = relationships.length;
                        }

                        if (errors.length > 0 && elements.length === 0 && relationships.length === 0) {
                            ws.send(JSON.stringify({
                                type: 'import:result',
                                payload: { success: false, elementsImported: 0, relationshipsImported: 0, errors, warnings },
                            }));
                            return;
                        }

                        const pkgName = (packageName || 'imported').replace(/[^a-zA-Z0-9_]/g, '_');
                        const sysml = generateFile(elements, relationships, pkgName);

                        const outFile = targetFile || `${pkgName}.sysml`;
                        const outPath = resolve(projectRoot, outFile);
                        writeFileSync(outPath, sysml, 'utf-8');
                        console.log(`[Import] Wrote ${elementsImported} element(s) + ${relationshipsImported} rel(s) → ${outFile}`);

                        ws.send(JSON.stringify({
                            type: 'import:result',
                            payload: { success: true, elementsImported, relationshipsImported, errors, warnings, generatedFile: outFile },
                        }));
                    } catch (e: any) {
                        console.error('[Import] csv:import failed:', e);
                        ws.send(JSON.stringify({
                            type: 'import:result',
                            payload: { success: false, elementsImported: 0, relationshipsImported: 0, errors: [e?.message ?? String(e)], warnings: [] },
                        }));
                    }
                } else if (msg.type === 'llm:ask') {
                    // Q&A about the model via LLM (#52)
                    const { requestId, question } = msg.payload ?? {};
                    try {
                        const { resolveLLMConfig, createProvider } = await import('@memo/core');
                        const { createQueryContext, findConfigFile } = await import('@memo/core');
                        const { askModel } = await import('@memo/core');
                        const { loadAndResolveConfig } = await import('./config-resolver.js');

                        const llmConfig = resolveLLMConfig();
                        if (!llmConfig) {
                            ws.send(JSON.stringify({ type: 'llm:ask:result', payload: { requestId, error: 'No LLM provider configured. Set ANTHROPIC_API_KEY or OPENAI_API_KEY.' } }));
                        } else {
                            const modelMsg = initialMessages.find((m: any) => m.type === 'model:update') as any;
                            const validMsg = initialMessages.find((m: any) => m.type === 'validation:update') as any;
                            const compMsg = initialMessages.find((m: any) => m.type === 'completeness:update') as any;
                            const configPath = findConfigFile(options.projectRoot);
                            const config = configPath ? await loadAndResolveConfig(configPath) : {} as any;
                            const ctx = createQueryContext(modelMsg?.payload ?? {}, validMsg?.payload ?? { violations: [] }, compMsg?.payload ?? { overall: 0, layers: [] }, config);
                            const provider = createProvider(llmConfig);
                            const result = await askModel(question, ctx, provider);
                            ws.send(JSON.stringify({ type: 'llm:ask:result', payload: { requestId, answer: result.answer } }));
                        }
                    } catch (e: any) {
                        console.error('[LLM] ask failed:', e);
                        ws.send(JSON.stringify({ type: 'llm:ask:result', payload: { requestId, error: e?.message ?? String(e) } }));
                    }
                } else if (msg.type === 'llm:generate') {
                    // Generate SysML v2 from natural language (#54)
                    const { requestId, description } = msg.payload ?? {};
                    try {
                        const { resolveLLMConfig, createProvider, generateSysml, findConfigFile } = await import('@memo/core');
                        const { loadAndResolveConfig } = await import('./config-resolver.js');

                        const llmConfig = resolveLLMConfig();
                        if (!llmConfig) {
                            ws.send(JSON.stringify({ type: 'llm:generate:result', payload: { requestId, error: 'No LLM provider configured.' } }));
                        } else {
                            const configPath = findConfigFile(options.projectRoot);
                            const config = configPath ? await loadAndResolveConfig(configPath) : {} as any;
                            const provider = createProvider(llmConfig);
                            const result = await generateSysml(description, config, provider);
                            ws.send(JSON.stringify({ type: 'llm:generate:result', payload: { requestId, sysml: result.sysml, explanation: result.explanation, suggestedFile: result.suggestedFile } }));
                        }
                    } catch (e: any) {
                        console.error('[LLM] generate failed:', e);
                        ws.send(JSON.stringify({ type: 'llm:generate:result', payload: { requestId, error: e?.message ?? String(e) } }));
                    }
                } else if (msg.type === 'llm:draft') {
                    // Draft DHF document sections via LLM (#55)
                    const { requestId, documentTypeId, targetSections } = msg.payload ?? {};
                    try {
                        const { resolveLLMConfig, createProvider, createQueryContext, findConfigFile, getDocumentType } = await import('@memo/core');
                        const { draftDocument } = await import('@memo/core');
                        const { loadAndResolveConfig } = await import('./config-resolver.js');

                        const llmConfig = resolveLLMConfig();
                        if (!llmConfig) {
                            ws.send(JSON.stringify({ type: 'llm:draft:result', payload: { requestId, error: 'No LLM provider configured.' } }));
                        } else {
                            const modelMsg = initialMessages.find((m: any) => m.type === 'model:update') as any;
                            const validMsg = initialMessages.find((m: any) => m.type === 'validation:update') as any;
                            const compMsg = initialMessages.find((m: any) => m.type === 'completeness:update') as any;
                            const configPath = findConfigFile(options.projectRoot);
                            const config = configPath ? await loadAndResolveConfig(configPath) : {} as any;
                            const ctx = createQueryContext(modelMsg?.payload ?? {}, validMsg?.payload ?? { violations: [] }, compMsg?.payload ?? { overall: 0, layers: [] }, config);
                            const docType = getDocumentType(documentTypeId);
                            if (!docType) {
                                ws.send(JSON.stringify({ type: 'llm:draft:result', payload: { requestId, error: `Unknown document type: ${documentTypeId}` } }));
                            } else {
                                const provider = createProvider(llmConfig);
                                const result = await draftDocument(ctx, provider, { documentType: docType, targetSections });
                                // Serialize sections as Markdown for the web UI
                                const lines: string[] = [`# ${docType.title}\n`];
                                for (const sec of result.document.sections) {
                                    lines.push(`## ${sec.title}\n`);
                                    for (const block of sec.blocks) {
                                        lines.push(blockToMarkdown(block));
                                    }
                                    lines.push('');
                                }
                                ws.send(JSON.stringify({ type: 'llm:draft:result', payload: { requestId, markdown: lines.join('\n'), summary: result.summary } }));
                            }
                        }
                    } catch (e: any) {
                        console.error('[LLM] draft failed:', e);
                        ws.send(JSON.stringify({ type: 'llm:draft:result', payload: { requestId, error: e?.message ?? String(e) } }));
                    }
                } else if (msg.type === 'llm:suggest') {
                    // Completeness suggestions via LLM (#53)
                    const { requestId } = msg.payload ?? {};
                    try {
                        const { resolveLLMConfig, createProvider, createQueryContext, findConfigFile, serializeModelContext } = await import('@memo/core');
                        const { loadAndResolveConfig } = await import('./config-resolver.js');

                        const llmConfig = resolveLLMConfig();
                        if (!llmConfig) {
                            ws.send(JSON.stringify({ type: 'llm:suggest:result', payload: { requestId, error: 'No LLM provider configured.' } }));
                        } else {
                            const modelMsg = initialMessages.find((m: any) => m.type === 'model:update') as any;
                            const validMsg = initialMessages.find((m: any) => m.type === 'validation:update') as any;
                            const compMsg = initialMessages.find((m: any) => m.type === 'completeness:update') as any;
                            const configPath = findConfigFile(options.projectRoot);
                            const config = configPath ? await loadAndResolveConfig(configPath) : {} as any;
                            const ctx = createQueryContext(modelMsg?.payload ?? {}, validMsg?.payload ?? { violations: [] }, compMsg?.payload ?? { overall: 0, layers: [] }, config);
                            const modelContext = serializeModelContext(ctx, { includeGaps: true, maxElements: 200 });
                            const provider = createProvider(llmConfig);
                            const result = await provider.complete({
                                messages: [
                                    {
                                        role: 'system',
                                        content: `You are MEMO Completeness Assistant, an expert in medical device systems engineering and SysML v2 modeling. Analyze the provided model and suggest the top 5-8 most impactful next modeling steps to improve completeness and regulatory compliance (ISO 14971, IEC 62304, ISO 13485).

Return ONLY a JSON array of strings. Each string is a concise, actionable suggestion (one sentence). Example format:
["Add RiskControl elements for 3 unmitigated Hazard elements", "Define VerificationActivity for each TestCase requirement"]`,
                                    },
                                    {
                                        role: 'user',
                                        content: `Model context:\n\n${modelContext}\n\nSuggest the top modeling improvements as a JSON array of strings.`,
                                    },
                                ],
                                temperature: 0.3,
                                maxTokens: 1024,
                            });
                            let suggestions: string[] = [];
                            try {
                                const arrMatch = result.content.match(/\[[\s\S]*\]/);
                                if (arrMatch) suggestions = JSON.parse(arrMatch[0]);
                            } catch { suggestions = [result.content]; }
                            ws.send(JSON.stringify({ type: 'llm:suggest:result', payload: { requestId, suggestions } }));
                        }
                    } catch (e: any) {
                        console.error('[LLM] suggest failed:', e);
                        ws.send(JSON.stringify({ type: 'llm:suggest:result', payload: { requestId, error: e?.message ?? String(e) } }));
                    }
                } else if (msg.type === 'dhf:docs:load') {
                    const docs = loadDhfDocs(options.projectRoot);
                    ws.send(JSON.stringify({ type: 'dhf:docs', payload: { docs } }));
                } else if (msg.type === 'dhf:doc:save') {
                    const doc = msg.payload?.doc;
                    if (doc?.id) {
                        saveDhfDoc(options.projectRoot, doc);
                        // Keep other connected clients in sync
                        const docsMsg = JSON.stringify({ type: 'dhf:docs', payload: { docs: loadDhfDocs(options.projectRoot) } });
                        for (const client of clients) {
                            if (client !== ws && client.readyState === 1) client.send(docsMsg);
                        }
                    }
                } else if (msg.type === 'dhf:doc:delete') {
                    const docId = msg.payload?.docId;
                    if (docId) {
                        deleteDhfDoc(options.projectRoot, docId);
                        const docsMsg = JSON.stringify({ type: 'dhf:docs', payload: { docs: loadDhfDocs(options.projectRoot) } });
                        for (const client of clients) {
                            if (client !== ws && client.readyState === 1) client.send(docsMsg);
                        }
                    }
                } else if (msg.type === 'dhf:settings:save') {
                    if (msg.payload?.settings) {
                        saveDhfSettings(options.projectRoot, msg.payload.settings);
                    }
                } else if (msg.type === 'dhf:templates:list') {
                    const { requestId } = msg.payload ?? {};
                    const templates = listRepoTemplates(options.projectRoot);
                    ws.send(JSON.stringify({ type: 'dhf:templates:result', payload: { requestId, templates } }));
                } else if (msg.type === 'dhf:template:read') {
                    const { requestId, path } = msg.payload ?? {};
                    try {
                        const content = readRepoTemplate(options.projectRoot, path);
                        ws.send(JSON.stringify({ type: 'dhf:template:content', payload: { requestId, path, content } }));
                    } catch (e: any) {
                        ws.send(JSON.stringify({ type: 'dhf:template:content', payload: { requestId, path, error: e?.message ?? String(e) } }));
                    }
                } else if (msg.type === 'ontology:remove') {
                    // Remove an installed ontology package
                    const { projectRoot } = options;
                    const pkgName = msg.payload?.packageName;
                    if (!pkgName) {
                        ws.send(JSON.stringify({ type: 'ontology:remove:result', payload: { success: false, packageName: '', error: 'No package name' } }));
                    } else {
                        try {
                            const shortName = pkgName.replace('@memo/', '');
                            const memoPkgsPath = resolve(projectRoot, 'memo_packages', shortName);
                            if (existsSync(memoPkgsPath)) {
                                const { rmSync } = await import('node:fs');
                                rmSync(memoPkgsPath, { recursive: true, force: true });
                            }
                            // Refresh and broadcast
                            const { getPackageMetadata } = await import('@memo/core');
                            const packages = getPackageMetadata(projectRoot);
                            const pkgMsg = { type: 'ontology:packages' as const, payload: { packages } };
                            for (const client of clients) {
                                if (client.readyState === 1) client.send(JSON.stringify(pkgMsg));
                            }
                            ws.send(JSON.stringify({
                                type: 'ontology:remove:result',
                                payload: { success: true, packageName: pkgName },
                            }));
                            console.log(`[Ontology] Removed package ${pkgName}`);
                        } catch (e: any) {
                            ws.send(JSON.stringify({
                                type: 'ontology:remove:result',
                                payload: { success: false, packageName: pkgName, error: e?.message ?? String(e) },
                            }));
                            console.error('[Ontology] Remove failed:', e);
                        }
                    }
                }
            } catch (e) {
                console.error('WebSocket Error:', e);
            }
        });
    });

    // Start listening
    await new Promise<void>((resolve) => {
        server.listen(port, host, () => resolve());
    });

    return {
        broadcast(messages: ServerMessage[]) {
            // Update initial messages for new connections
            initialMessages.length = 0;
            initialMessages.push(...messages);

            for (const client of clients) {
                if (client.readyState === 1) { // WebSocket.OPEN
                    for (const msg of messages) {
                        client.send(JSON.stringify(msg));
                    }
                }
            }
        },
        close() {
            wss.close();
            viteServer?.close();
            server.close();
        },
    };
}
