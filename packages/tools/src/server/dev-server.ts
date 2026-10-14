// ─── Dev Server ──────────────────────────────────────────────────────────────
//
// HTTP server with:
//   - Optional client middleware supplied by a higher-level application
//   - WebSocket endpoint for pushing model updates to browser
// ─────────────────────────────────────────────────────────────────────────────

import { serveValidate } from './dev-validate.js';
import { createServer as createHttpServer, type Server } from 'node:http';
import { createHash, randomUUID } from 'node:crypto';
import { isAbsolute, relative, resolve } from 'node:path';
import { existsSync, readFileSync, realpathSync, writeFileSync, mkdirSync, createReadStream, statSync } from 'node:fs';
import { extname } from 'node:path';
import type { OntologyView } from '@memoarchitect/tools';
import type {
    ServerMessage, ModelUpdateMessage, DiagramDTO, MemoModelDTO,
    RelationshipCreateRequest, RelationshipCreateResultMessage,
    RelationshipDeleteRequest, RelationshipDeleteResultMessage,
    RelationshipUpdateRequest, RelationshipUpdateResultMessage,
    ElementDeleteResultMessage,
    RelationshipDiagnostic, OntologyRegistriesDTO,
    QueryContext, MEMOConfig, ProposedChange, RestartRequiredMessage, EditConflictMessage,
    SourceCoherenceMessage,
    ModelMutationPrecondition,
} from '@memoarchitect/tools';
import type { BuilderRegistries, OntologyPackageInfo } from '@memoarchitect/tools';
import { findMemoManifests, validateRelationshipMutation, validateRelationshipDeletion } from '@memoarchitect/tools';
import { indexFromIdentityTable, type IrIdentityIndex } from '../model/ir-identity.js';
import { recompileProject, writeElement, type AuthoringContext } from '../operations/authoring.js';
import {
    isWritableRelationshipFile, removeRelationship, resolveRelationshipPlacement,
    reviewTraceBaselines, updateRelationship, writeRelationship, type RelationshipWriterOptions,
} from './relationship-writer.js';
import { resolveSuspectReviews } from './suspect-review.js';
import { prepareSourceImport, type SourceImportContext } from '../import/source-import.js';
import { dtoToModel } from '../model/semantic.js';
import type { SourceImportPayload, SourceImportResultMessage, SuspectReviewMessage, SuspectReviewResultMessage } from '../protocol/messages.js';
import { removeElement } from './element-writer.js';
import { projectEntrypoint } from '../model/native-project.js';
import {
    createPackage, deletePackage, moveElementToPackage, moveIntoGroupingPackage, movePackage, renamePackage,
    type PackageWriteResult,
} from './package-writer.js';
import { writeRelease, type ReleaseCreateRequest } from './release-writer.js';
import { assertSingleDomainMutation, isReadOnlyMessage, MixedMutationDomainError } from './mutation-domain.js';
import { classifyConflict } from './conflict-policy.js';
import type { SemanticOrigin } from '../model/source-provenance.js';
import { checkRulePolicy, insertRulePolicy, renderRulePolicy } from './rule-policy-writer.js';
import { createRule, previewRule } from './rule-service.js';
import { loadViewLayouts, saveViewLayout } from './view-layout-store.js';
import { layoutBlindRevision } from '../model/view-layout-block.js';
import { assertWritable } from './write-guard.js';
import { updateViewDisplay, updateViewExpose, writeViewDeclaration } from './view-writer.js';
import { usageKeyword } from '../model/semantic.js';
import {
    loadDhfDocs, saveDhfDoc, deleteDhfDoc,
    loadDhfSettings, saveDhfSettings,
    listRepoTemplates, readRepoTemplate, saveRepoTemplate,
} from './dhf-doc-store.js';
import { loadDashboards, saveDashboard, deleteDashboard, moveDashboard } from './dashboard-store.js';
import { loadUserPreferences, saveUserPreferences } from './user-preferences.js';
import { createDashboardWatcher } from './file-watcher.js';
import { selectedOutlineSource, type OutlineSource } from '../authoring/outline-source.js';

export interface DevServerOptions {
    port: number;
    /**
     * Serve the model read-only: every client message outside `READ_ONLY_MESSAGES` is refused.
     * A pinned build runs this way, so no write path is reachable from it.
     */
    readOnly?: boolean;
    /** What the working tree's change reaches, measured from the commit it branched from. */
    impact?: { compute(target?: string): Promise<import('../model/impact.js').ImpactReport> };
    /** Where the model stands against its method, for one workspace. */
    guide?: { evaluate(workspace?: string): import('../methodology/guide-service.js').GuideResult };
    /** Generating the design history of a regulated device from the releases it covers. */
    devices?: { generate(device: string): Promise<import('../dhf/device-dhf.js').DeviceDhfResult> };
    /** Opening another version: the refs on offer, and a read-only server for a chosen one. */
    versions?: import('./version-servers.js').VersionServers;
    /** What a read-only server tells each client about itself. */
    pinned?: import('../protocol/messages.js').PinnedInfo;
    /** The model the last accepted build made, which the query engines read. */
    memoModel?: () => import('../model/semantic.js').MemoModel | undefined;
    /** The scope of one workspace (a system or the system of systems), or undefined when it is not one. */
    workspaceScope?: (root: string) => Pick<import('../model/workspace-membership.js').WorkspaceScope, 'subjects' | 'foreign'> | undefined;
    /** Where the person's role and workspace are read from: the working project, for a pinned one. */
    preferencesRoot?: string;
    projectRoot: string;
    /** Client application root supplied by the caller (for example Architect). */
    webPackagePath: string;
    initialMessages: ServerMessage[];
    /** Frozen ontology registries from bootstrap — used to validate diagrams/layouts on load */
    ontologyRegistries?: BuilderRegistries;
    /**
     * Absolute roots of installed ontology packages. Authoring never writes
     * into these — they are read-only library content.
     */
    ontologyRoots?: string[];
    /** The ontology packages of the last accepted build, for the browser's package list. */
    packageMetadata?: () => OntologyPackageInfo[];
    /** Per-package relationship files from project config. */
    relationshipFiles?: Record<string, string>;
    /** Configured canonical relationship file from project config. */
    canonicalRelationshipFile?: string;
    /**
     * Last-chance rewrite of the client's HTML shell, applied to both the Vite
     * and prebuilt-dist paths. Tools hosts a client it does not own, so
     * anything the client needs inlined ahead of its bundle — Architect splices
     * in its feature grants this way — goes through here rather than teaching
     * the server a vocabulary that belongs to the client.
     */
    transformClientHtml?: (html: string) => string;
    /** Notified whenever a browser WebSocket connects or disconnects. */
    onClientCountChanged?: (count: number) => void;
    /**
     * The project as last built, for previewing and writing a user's rule. The
     * host owns the build, so it hands over the state; absent, the server
     * refuses rule previews and writes.
     */
    ruleContext?: () => import('./rule-service.js').RuleServiceContext | undefined;
    /**
     * Runs `memo validate` on the model the host holds (dev-validate.ts), for a
     * caller presenting `validateToken`; absent, the route answers 404.
     */
    validate?: (options: import('../commands/validate.js').ValidateOptions) => Promise<import('./dev-validate.js').ValidationReply>;
    validateToken?: string;
}

export interface DevServer {
    /** The port actually bound — the requested one, or the assigned one for port 0. */
    readonly port: number;
    /** Replace the current state and push it to every client. */
    broadcast(messages: ServerMessage[], changedSourceIds?: readonly string[]): void;
    /**
     * Send transient messages to connected clients without recording them as
     * state. A client connecting later must not be told about an event it was
     * not present for — a stale "your file just changed" is worse than silence.
     */
    notify(messages: ServerMessage[]): void;
    /** Match watcher events to writes accepted through this server. */
    consumeWriteTransactions(files: readonly string[]): {
        matched: Record<string, string>;
        escalationFile?: string;
    };
    /**
     * Send every client the saved layouts of the views declared in these source
     * files, after a layout changed that this server did not write (a `git pull`,
     * an editor).
     */
    refreshLayouts(files: readonly string[]): void;
    /** Reject every model mutation until a clean runtime is relaunched. */
    lockMutations(message: RestartRequiredMessage): void;
    /**
     * Publish whether the project source currently compiles.
     *
     * An incoherent source holds model mutations — the dependency closure is
     * unknown, so a write cannot be placed safely — but it never demands a
     * restart, and passing a coherent payload releases the hold. That is the
     * difference between a typo and a stale semantic environment.
     */
    setSourceCoherence(payload: SourceCoherenceMessage['payload']): void;
    close(): void;
}

const MODEL_MUTATION_MESSAGES = new Set([
    'element:update', 'element:create', 'element:delete', 'element:remap-kinds', 'element:move-package',
    'package:create', 'package:rename', 'package:delete', 'package:move',
    'relationship:create', 'relationship:delete', 'relationship:update', 'release:create',
    'diagram:create', 'diagram:update', 'diagram:display:update', 'diagram:delete', 'diagram:layout:update', 'diagram:source:save',
    'methodology:source:save', 'csv:import', 'import:apply', 'suspect:review', 'screen-capture:upload',
    'ontology:install', 'ontology:remove', 'ontology:save-selection',
    'dhf:doc:save', 'dhf:doc:delete', 'dhf:settings:save', 'dhf:template:save',
    'llm:chat:apply', 'llm:settings:save',
]);

/** Exported so the lockout boundary is mechanically testable. */
export function isModelMutationMessage(type: string): boolean {
    return MODEL_MUTATION_MESSAGES.has(type);
}

/**
 * Project/model state is reconciled over the MEMO WebSocket. Vite must never
 * turn these writes into a browser reload, even when a local ontology package
 * is symlinked beneath Vite's dependency graph.
 */
export function isModelOwnedWatchPath(path: string): boolean {
    const normalized = path.replaceAll('\\', '/');
    return normalized.endsWith('.sysml')
        || normalized.endsWith('/memo.config.yaml')
        || normalized.endsWith('/memo.package.yaml')
        || normalized.includes('/.memo/')
        || normalized.includes('/model/assets/');
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
    '.jpg':  'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.webp': 'image/webp',
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

/**
 * The subtrees a project's screen captures may be served from.
 *
 * `model/assets` is where MEMO put them back when the whole model lived under
 * `model/`. A project laid out with its source in `src/` has no `model/`
 * directory at all and keeps its captures in `assets/` beside it — and those
 * were unreachable, so its UI Screens workspace drew every region over a
 * blank backdrop with no error to explain it. The request simply fell through
 * to the SPA and the `<img>` got an HTML document back.
 *
 * Naming roots at all is the allow-list, and that part is not negotiable:
 * this server hands project files to a browser, so it serves these two
 * subtrees and nothing else — not `.env`, not `.git/`, not the source.
 */
const CAPTURE_ROOTS = ['model/assets', 'assets'] as const;

/** True when `candidate` is a real descendant of `root` — the traversal guard. */
function isWithinRoot(root: string, candidate: string): boolean {
    const fromRoot = relative(root, candidate);
    return Boolean(fromRoot)
        && fromRoot !== '..'
        && !fromRoot.startsWith('../')
        && !fromRoot.startsWith('..\\');
}

/** Resolve only project-owned screen captures, under either capture root. */
export function resolveProjectAssetRequest(projectRoot: string, requestUrl: string): string | undefined {
    let pathname: string;
    try {
        pathname = decodeURIComponent(requestUrl.split('?')[0]);
    } catch {
        return undefined;
    }
    if (!pathname.startsWith('/model/') && !pathname.startsWith('/assets/')) return undefined;
    const requested = resolve(projectRoot, pathname.replace(/^\//, ''));
    const within = CAPTURE_ROOTS.some(root => isWithinRoot(resolve(projectRoot, root), requested));
    return within ? requested : undefined;
}

/**
 * Report views that share an id.
 *
 * Kind collisions are already recorded this way (`KindNameCollision`) for the
 * same reason: a `Map` keyed by a name silently keeps one writer, and which one
 * survives then depends on file iteration order. A view is looked up by id from
 * the URL, from the explorer and from every permalink, so a collision does not
 * make views ambiguous — it makes the shadowed ones unreachable.
 */
function reportDuplicateViewIds(diagrams: readonly DiagramDTO[]): void {
    const byId = new Map<string, DiagramDTO[]>();
    for (const diagram of diagrams) {
        const list = byId.get(diagram.id);
        if (list) list.push(diagram); else byId.set(diagram.id, [diagram]);
    }
    const collisions = [...byId.values()].filter(group => group.length > 1);
    if (collisions.length === 0) return;
    const shadowed = collisions.reduce((sum, group) => sum + group.length - 1, 0);
    console.error(`[Views] ${shadowed} view(s) are UNREACHABLE: ${collisions.length} id(s) are `
        + 'declared by more than one view, and a view is addressed by its id. '
        + 'Give each view its own `providedId`:');
    for (const group of collisions) {
        const reachable = group[0].shortId ?? group[0].name ?? group[0].id;
        console.error(`  - ${group[0].id} is claimed by ${group.length} views; only ${reachable} can be opened`);
        for (const shadow of group.slice(1)) {
            console.error(`      shadowed: ${shadow.shortId ?? shadow.name ?? shadow.id}`
                + `${shadow.sourceFile ? `  (${shadow.sourceFile})` : ''}`);
        }
    }
}

export async function createDevServer(options: DevServerOptions): Promise<DevServer> {
    const { port, webPackagePath, initialMessages, transformClientHtml } = options;
    const host = '127.0.0.1';

    // State publications are ordered independently of model semantics. The
    // three state payloads from a rebuild share one revision so the browser
    // cannot combine a model from one build with validation from another.
    const workspaceSessionId = randomUUID();
    /** The model writes in flight, in order. */
    let mutationQueue: Promise<void> = Promise.resolve();
    /** The newest layout message seen for each diagram. */
    const latestLayoutMessage = new Map<string, number>();
    const writeTransactions = new Map<string, {
        id: string; hash: string; createdAt: number; unmatchedWrites: number;
    }>();
    let workspaceRevision = 1;
    let mutationLockout: RestartRequiredMessage | undefined;
    /** Set while the project source does not compile; cleared by the next clean rebuild. */
    let sourceIncoherence: SourceCoherenceMessage | undefined;
    function stampWorkspace(
        messages: ServerMessage[], baseRevision: number | null, snapshot = false,
        changedSourceIds: readonly string[] = [],
    ): ServerMessage[] {
        const model = messages.find(message => message.type === 'model:update') as ModelUpdateMessage | undefined;
        const sourceGraphHash = createHash('sha256')
            .update(JSON.stringify(model?.payload.sourceGraph ?? {})).digest('hex').slice(0, 16);
        const reusableRegistryHash = String((model?.payload as any)?.ontologyHash ?? 'none');
        const projectRegistryHash = createHash('sha256')
            .update(JSON.stringify(model?.payload.registries ?? {})).digest('hex').slice(0, 16);
        const previous = initialMessages.find(message => message.type === 'model:update') as ModelUpdateMessage | undefined;
        const modelDelta = !snapshot && model && previous
            ? {
                upsertElements: Object.fromEntries(Object.entries(model.payload.elements).filter(([id, element]) =>
                    JSON.stringify(previous.payload.elements[id]) !== JSON.stringify(element))),
                removeElementIds: Object.keys(previous.payload.elements).filter(id => !(id in model.payload.elements)),
                patch: Object.fromEntries(Object.entries(model.payload).filter(([key]) => key !== 'elements')),
            }
            : undefined;
        return messages.map(message => {
            if (message.type !== 'model:update' &&
                message.type !== 'validation:update' &&
                message.type !== 'completeness:update') return message;
            return {
                ...message,
                revision: {
                    workspaceSessionId, revision: workspaceRevision, baseRevision, snapshot,
                    sourceGraphHash, reusableRegistryHash, projectRegistryHash,
                    changedSourceIds: [...changedSourceIds].sort(),
                    modelDelta,
                },
            } as ServerMessage;
        });
    }
    const initialSnapshot = stampWorkspace(initialMessages, null, true);
    initialMessages.length = 0;
    initialMessages.push(...initialSnapshot);

    function recordWriteTransaction(sourceFile: string, text: string): string {
        const id = randomUUID();
        writeTransactions.set(sourceFile.replaceAll('\\', '/'), {
            // The same revision the watcher's match is made with, which ignores layout.
            id, hash: fileRevision(text),
            createdAt: Date.now(), unmatchedWrites: 0,
        });
        return id;
    }

    // A source client can use Vite middleware. A packaged client can provide a
    // prebuilt dist/ directory. Tools does not resolve or depend on that client.
    const hasWebSource = existsSync(resolve(webPackagePath, 'index.html'));
    const webDistPath = resolve(webPackagePath, 'dist');
    const hasWebDist = existsSync(resolve(webDistPath, 'index.html'));

    // Dynamic import Vite for a caller-provided source client.
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

    /** Serve captures referenced by project-relative ScreenCapture.imageUri. */
    function serveProjectAsset(req: any, res: any): boolean {
        const requestUrl = req.url ?? '/';
        const pathname = requestUrl.split('?')[0];
        if (!pathname.startsWith('/model/') && !pathname.startsWith('/assets/')) return false;
        const requested = resolveProjectAssetRequest(options.projectRoot, requestUrl);
        const owned = Boolean(requested) && existsSync(requested!) && statSync(requested!).isFile();
        if (!owned) {
            // `/assets/` is ALSO where the client's own hashed bundles live,
            // and this handler runs before the web dist. Claiming every
            // `/assets/` request would 404 the application's own JavaScript,
            // so an unclaimed one falls through; `/model/` is unambiguous and
            // still reports a missing capture as a missing capture.
            if (pathname.startsWith('/assets/')) return false;
            res.writeHead(404); res.end('Capture not found');
            return true;
        }
        streamFile(res, requested!);
        return true;
    }

    /** Serve the caller-provided prebuilt client as an SPA. */
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
        // Only the SPA shell goes through the client's rewrite; every other
        // asset streams untouched.
        if (transformClientHtml && extname(fullPath) === '.html') {
            const html = transformClientHtml(readFileSync(fullPath, 'utf8'));
            const body = Buffer.from(html, 'utf8');
            res.writeHead(200, { 'Content-Type': STATIC_MIME['.html'], 'Content-Length': body.byteLength });
            res.end(body);
            return true;
        }
        streamFile(res, fullPath);
        return true;
    }

    if (vite) {
        // Create Vite dev server in middleware mode
        viteServer = await vite.createServer({
            root: webPackagePath,
            server: {
                middlewareMode: true,
                host,
                watch: { ignored: isModelOwnedWatchPath },
            },
            appType: 'spa',
            plugins: transformClientHtml
                ? [{ name: 'memo-client-html', transformIndexHtml: transformClientHtml }]
                : [],
        });

        server = createHttpServer((req, res) => {
            if (serveValidate(req, res, options.validateToken, options.validate)) return;
            if (serveProjectAsset(req, res)) return;
            if (serveHelp(req, res)) return;
            viteServer.middlewares(req, res);
        });
    } else if (hasWebDist) {
        // Packaged install: serve the prebuilt web app statically
        server = createHttpServer((req, res) => {
            if (serveValidate(req, res, options.validateToken, options.validate)) return;
            if (serveProjectAsset(req, res)) return;
            if (serveHelp(req, res)) return;
            serveWebDist(req, res);
        });
    } else {
        // Fallback: serve a basic page that connects via WebSocket
        server = createHttpServer((req, res) => {
            if (serveValidate(req, res, options.validateToken, options.validate)) return;
            if (serveProjectAsset(req, res)) return;
            res.writeHead(200, { 'Content-Type': 'text/html' });
            res.end(`
                <!DOCTYPE html>
                <html>
                <head><title>MEMO Dev</title></head>
                <body>
                    <h1>MEMO Dev Server</h1>
                    <p>Architect client not found at ${webPackagePath}. Run this server through @memoarchitect/architect.</p>
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

    const broadcastDashboards = () => {
        let message: string;
        try {
            message = JSON.stringify({ type: 'dashboards', payload: { dashboards: loadDashboards(options.projectRoot) } });
        } catch (e) {
            console.error('[Dashboards] reload failed:', e);
            return;
        }
        for (const client of clients) {
            if (client.readyState === 1) client.send(message);
        }
    };
    const dashboardWatcher = createDashboardWatcher(options.projectRoot, broadcastDashboards);

    // Every view is DECLARED in SysML — see `view-writer.ts`. The sidecar at
    // .memo/user-diagrams.json used to be merged in here as a second class of
    // view, which is how a view could exist for Architect and for nothing else:
    // no source file, so invisible to `memo validate`, to the selected compiler, to
    // review, and — wherever `.memo/` is ignored — to git.
    //
    // Rows left in that file are therefore not views but UNDECLARED views: an
    // error to be fixed by declaring them, not a state to render. They are
    // reported by id and not merged. The file is never rewritten or deleted
    // here — those rows are the only record of what still needs declaring.
    const undeclared = loadUserDiagrams(options.projectRoot);
    if (undeclared.length > 0) {
        const initialModel = initialMessages.find(m => m.type === 'model:update') as ModelUpdateMessage | undefined;
        const declaredIds = new Set((initialModel?.payload.diagrams ?? []).map(diagram => diagram.id));
        const orphans = undeclared.filter(diagram => !declaredIds.has(diagram.id));
        if (orphans.length > 0) {
            console.error(`[Views] ${orphans.length} view(s) in .memo/user-diagrams.json have no SysML declaration `
                + 'and were NOT loaded. Declare each as a `view … { }` in source, then delete its row:');
            for (const orphan of orphans) {
                console.error(`  - ${orphan.id}  ${orphan.name ?? ''} (${orphan.viewKind ?? 'unknown kind'})`);
            }
        }
    }

    // A view is addressed by its id, so two views sharing one is not a
    // duplicate label — it is one view the product can never open. Every lookup
    // returns whichever loaded first and the rest are shadowed silently, with
    // no error anywhere, which is the worst way for a model to be wrong.
    //
    // Found in affera as 11 of 95 views unreachable: ten clinical-step views
    // all declaring VIEW-AFR-OP-SOS-004, and a CIU interconnect view claiming
    // the id of the CIU decomposition view, so opening it showed the other.
    reportDuplicateViewIds(
        (initialMessages.find(m => m.type === 'model:update') as ModelUpdateMessage | undefined)
            ?.payload.diagrams ?? []);

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

    function broadcastEditConflict(payload: EditConflictMessage['payload']): void {
        const message: EditConflictMessage = { type: 'app:edit-conflict', payload };
        for (const client of clients) {
            if (client.readyState === 1) client.send(JSON.stringify(message));
        }
    }

    /**
     * Provenance origin of a file being written.
     *
     * The caller has already established the path is inside the project root,
     * so the only distinction left that changes the conflict route is whether
     * it is reusable source the project happens to vendor — a methodology or
     * extension package living in the workspace. Those are frozen for the
     * session exactly as an installed package is, so a change to one escalates.
     */
    function originOf(sourcePath: string): SemanticOrigin {
        const methodology = initialMessages.find(m => m.type === 'methodology:update') as any;
        const methodologyFiles = new Set<string>((methodology?.payload?.folders ?? [])
            .flatMap((folder: any) => (folder.sourceFiles ?? [])
                .map((file: string) => resolve(options.projectRoot, file))));
        if (methodologyFiles.has(sourcePath)) return 'methodology';
        return 'project';
    }

    function checkMutationPrecondition(
        precondition: ModelMutationPrecondition | undefined,
        rejectedCommandId: string,
        rejectedDraft: unknown,
    ): string | undefined {
        if (!precondition) return 'The mutation has no source precondition; reload before saving.';
        const projectPath = realpathSync(resolve(options.projectRoot));
        const sourcePath = resolve(projectPath, precondition.sourceFile);
        if (!sourcePath.startsWith(`${projectPath}/`)) return 'Mutation source is outside the project.';
        const currentHash = existsSync(sourcePath) ? fileRevision(readFileSync(sourcePath, 'utf8')) : '';

        // Section 13.5's two routes. The decision is in `conflict-policy.ts`
        // so it can be tested without driving a live server; this applies it.
        const decision = classifyConflict({
            commandSessionId: precondition.workspaceSessionId,
            currentSessionId: workspaceSessionId,
            expectedSourceHash: precondition.expectedSourceHash,
            currentSourceHash: currentHash,
            origin: originOf(sourcePath),
            // Source incoherence is deliberately NOT folded in here. It is held
            // earlier, on the message handler, so no mutation reaches this
            // classifier while the project does not parse. Routing it through
            // here instead would classify a stale hash as
            // `dependency-closure-uncomputable` and demand a relaunch — which
            // is the one outcome a source typo must never produce.
            dependencyClosureComputable: !mutationLockout,
        });
        if (decision.outcome === 'accept') return undefined;

        if (decision.outcome === 'lockout') {
            const lockout: RestartRequiredMessage = {
                type: 'app:restart-required',
                reason: decision.escalation === 'reusable-source-changed'
                    ? 'ontology-source-changed' : 'dependency-closure-uncomputable',
                changedFile: precondition.sourceFile,
                instruction: decision.reason,
            };
            mutationLockout = lockout;
            for (const client of clients) {
                if (client.readyState === 1) client.send(JSON.stringify(lockout));
            }
            return decision.reason;
        }

        broadcastEditConflict({
            sourceFile: precondition.sourceFile,
            targetElementIds: precondition.targetElementIds,
            baseRevision: precondition.baseRevision,
            currentRevision: workspaceRevision,
            expectedSourceHash: precondition.expectedSourceHash,
            currentSourceHash: currentHash,
            rejectedCommandId,
            rejectedDraft,
        });
        return `${precondition.sourceFile} changed on disk; no write was made.`;
    }

    /** Latest model DTO — broadcast() replaces initialMessages on every rebuild. */
    const currentModel = (): MemoModelDTO | undefined =>
        (initialMessages.find(m => m.type === 'model:update') as ModelUpdateMessage | undefined)?.payload;

    /**
     * Identities minted by the most recent authoring recompile.
     *
     * A write-back recompiles through the lowering provider and therefore knows
     * the addresses its own edit produced before the file watcher has caught
     * up. Holding them here is what lets a user make two edits in a row without
     * the second one being addressed to a revision that no longer exists.
     * Cleared by `broadcast`, because a published model supersedes it.
     */
    let writeBackIndex: IrIdentityIndex | undefined;

    /**
     * A recompiled index, when it addresses anything. A compiler that builds
     * the model from its handoff states no syntax tree, so its recompile
     * mints no identities; adopting that empty index would refuse every
     * further write until the watcher republished. The published one stands.
     */
    const addressable = (index: IrIdentityIndex): IrIdentityIndex | undefined =>
        index.byIdentity.size > 0 ? index : writeBackIndex;

    /** The index every write resolves its identities against. */
    const irIndex = (): IrIdentityIndex =>
        writeBackIndex ?? indexFromIdentityTable(currentModel()?.irIdentities);

    /**
     * Recompile after a semantic write, through the *selected* lowering
     * provider (§6.2).
     *
     * Not a refresh optimisation: the watcher rebuild that follows is what
     * publishes the new model. This exists so the identities handed back with
     * the write are the ones the write created, rather than whatever the client
     * happened to be holding. It costs a project lowering per authored change,
     * which is the price of an address that is never a revision behind.
     */
    /** What every authoring operation is given: the project, its settings, and the index. */
    async function authoringContext(): Promise<AuthoringContext & { outlines: OutlineSource }> {
        const { loadAndResolveConfig } = await import('./config-resolver.js');
        const { findConfigFile, loadProjectSettings } = await import('@memoarchitect/tools');
        const configPath = findConfigFile(options.projectRoot);
        const config = configPath ? loadAndResolveConfig(configPath) : loadProjectSettings(options.projectRoot);
        return {
            projectDir: options.projectRoot,
            config,
            irIndex: irIndex(),
            outlines: selectedOutlineSource(options.projectRoot, config),
        };
    }

    async function recompileAfterWrite(): Promise<void> {
        try {
            writeBackIndex = addressable((await recompileProject(await authoringContext())).index);
        } catch (e) {
            // A recompile that fails leaves the previous index in place: the
            // write itself already succeeded, and refusing to answer would be
            // reporting a failure that did not happen. The next watcher rebuild
            // republishes the identities either way.
            console.warn(`[Authoring] Recompile after write failed: ${e instanceof Error ? e.message : String(e)}`);
        }
    }

    /**
     * What the query engines read: the model the last build made (not the DTO clients are sent, which has no
     * indexes to query), the validation and completeness the server holds, and, when the person is working in
     * one workspace, its scope, so a question about one system is answered from that system.
     */
    async function scopedQueryContext(config: MEMOConfig, workspaceRoot?: string): Promise<QueryContext> {
        const { createQueryContext } = await import('../dhf/query-engine.js');
        const model = options.memoModel?.();
        if (!model) throw new Error('The model is not built yet.');
        const validMsg = initialMessages.find(m => m.type === 'validation:update') as any;
        const compMsg = initialMessages.find(m => m.type === 'completeness:update') as any;
        const scope = workspaceRoot ? options.workspaceScope?.(workspaceRoot) : undefined;
        return createQueryContext(
            model,
            validMsg?.payload ?? { violations: [] },
            compMsg?.payload ?? { overall: 0, layers: [] },
            config, undefined, scope,
        );
    }

    /**
     * Build the query context the LLM engines read from, against whatever the
     * server currently holds. Every LLM handler needs the same four pieces, so
     * they share this rather than each re-deriving them.
     */
    async function llmQueryContext(workspaceRoot?: string): Promise<{ ctx: QueryContext; config: MEMOConfig; ontology: OntologyView }> {
        const { findConfigFile, loadProjectOntology, ontologyViewFrom, EMPTY_ONTOLOGY_VIEW } =
            await import('@memoarchitect/tools');
        const { loadAndResolveConfig } = await import('./config-resolver.js');

        const modelMsg = initialMessages.find(m => m.type === 'model:update') as any;
        const validMsg = initialMessages.find(m => m.type === 'validation:update') as any;
        const compMsg = initialMessages.find(m => m.type === 'completeness:update') as any;
        const configPath = findConfigFile(options.projectRoot);
        const config = configPath ? loadAndResolveConfig(configPath) : { modelName: 'untitled' } as MEMOConfig;

        // Kinds and relationships come from the resolved SysML, not from the
        // settings file the config path points at.
        let ontology = EMPTY_ONTOLOGY_VIEW;
        try {
            const loaded = await loadProjectOntology({ projectRoot: options.projectRoot, config });
            ontology = ontologyViewFrom(loaded.registries.kindRegistry, loaded.registries.relationshipRegistry);
        } catch {
            // A project whose ontology does not resolve still has a model to query.
        }

        const ctx = await scopedQueryContext(config, workspaceRoot);
        return { ctx, config, ontology };
    }

    /** Settings status for the client — provider/model/origin, never the key. */
    async function toolchainSettings() {
        const { userToolchainStatus } = await import('../toolchain/user-settings-status.js');
        const { defaultRegistry } = await import('../toolchain/default-registry.js');
        const { loadProjectSettings } = await import('../model/config-loader.js');
        return userToolchainStatus(defaultRegistry, {}, process.env, loadProjectSettings(options.projectRoot).projectToolchain ?? {});
    }

    async function llmSettings() {
        const { llmSettingsStatus } = await import('@memoarchitect/tools');
        return llmSettingsStatus(options.projectRoot);
    }

    /**
     * Apply one approved change from the chat.
     *
     * Element writes go through the same persistor the properties panel uses,
     * and relationship writes through the same legality-checked handlers as the
     * relationship dialog — so an LLM-originated edit is validated exactly like
     * a hand-made one, and the file watcher broadcasts the result either way.
     */
    async function applyProposedChange(change: ProposedChange): Promise<void> {
        const { saveElementToFile } = await import('./persistor.js');

        switch (change.kind) {
            case 'create-element': {
                const { ontology } = await llmQueryContext();
                const kindDef = ontology.kinds[change.elementKind];
                const result = await saveElementToFile(options.projectRoot, {
                    id: change.elementId,
                    name: change.name,
                    kind: change.elementKind,
                    // `sysmlConstruct` is how the kind is DECLARED (`part def`);
                    // this writes a usage of it.
                    construct: usageKeyword(kindDef?.sysmlConstruct),
                    layer: change.layer ?? kindDef?.layer ?? '',
                    doc: change.doc ?? '',
                    attributes: change.attributes ?? {},
                }, irIndex(), (await authoringContext()).outlines);
                if (!result.success) throw new Error(result.error ?? 'Failed to write the element.');
                await recompileAfterWrite();
                return;
            }

            case 'update-element': {
                const existing = currentModel()?.elements?.[change.elementId];
                if (!existing) throw new Error(`Element "${change.elementId}" no longer exists.`);
                const result = await saveElementToFile(options.projectRoot, {
                    ...existing,
                    ...(change.changes.name !== undefined ? { name: change.changes.name } : {}),
                    ...(change.changes.doc !== undefined ? { doc: change.changes.doc } : {}),
                    attributes: { ...existing.attributes, ...(change.changes.attributes ?? {}) },
                }, irIndex(), (await authoringContext()).outlines);
                if (!result.success) throw new Error(result.error ?? 'Failed to write the element.');
                await recompileAfterWrite();
                return;
            }

            case 'create-relationship': {
                const response = await handleRelationshipCreate({
                    requestId: change.id,
                    type: change.relationshipType,
                    sourceId: change.sourceId,
                    targetId: change.targetId,
                    direction: 'outgoing',
                });
                if (!response.payload.success) {
                    throw new Error(response.payload.error ?? 'The relationship was rejected.');
                }
                return;
            }

            case 'delete-relationship': {
                const response = await handleRelationshipDelete({
                    requestId: change.id,
                    relationshipId: change.relationshipId,
                });
                if (!response.payload.success) {
                    throw new Error(response.payload.error ?? 'The relationship could not be removed.');
                }
                return;
            }
        }
    }

    /**
     * Ontology registries in serializable form. The server validates against
     * the same DTOs the client reasons over, so both sides apply identical
     * legality rules — but the server derives them from its own frozen
     * registries rather than trusting anything in the request.
     */
    function serverRegistries(): OntologyRegistriesDTO {
        const registries = options.ontologyRegistries;
        return {
            relationships: registries?.relationshipRegistry?.toDefinitionDTOs()
                ?? currentModel()?.registries?.relationships ?? [],
            // The current model also contains project-local kinds that derive
            // from the frozen ontology registry. Prefer that effective kind
            // registry so authoring honors the same extension chain as build.
            kinds: currentModel()?.registries?.kinds
                ?? registries?.kindRegistry?.toDefinitionDTOs() ?? [],
        };
    }

    async function relationshipWriterOptions(): Promise<RelationshipWriterOptions> {
        return {
            projectRoot: options.projectRoot,
            ontologyRoots: options.ontologyRoots,
            designatedFiles: options.relationshipFiles,
            canonicalFile: options.canonicalRelationshipFile,
            irIndex: irIndex(),
            outlines: (await authoringContext()).outlines,
        };
    }

    /**
     * Create one model relationship.
     *
     * Client-side filtering is only a convenience: every request is validated
     * again here, against the server's own model and registries, before any
     * file is touched. A stale or hand-crafted request fails with the same
     * REL-xxx diagnostics the UI uses.
     */
    async function handleRelationshipCreate(
        payload: RelationshipCreateRequest & { precondition?: ModelMutationPrecondition },
    ): Promise<RelationshipCreateResultMessage> {
        const requestId = payload?.requestId ?? '';
        const reject = (error: string, diagnostics?: RelationshipDiagnostic[]): RelationshipCreateResultMessage => ({
            type: 'relationship:create:result',
            payload: { requestId, success: false, error, diagnostics },
        });
        const conflict = checkMutationPrecondition(payload.precondition, requestId, payload);
        if (conflict) return reject(conflict);

        const model = currentModel();
        if (!model) return reject('The model is not loaded yet.');

        const registries = serverRegistries();
        const writerOptions = await relationshipWriterOptions();

        // The active view's profile only downgrades to a warning, so a
        // relationship the view cannot draw is still created in the model.
        const diagram = payload.diagramId
            ? currentDiagrams().find(d => d.id === payload.diagramId)
            : undefined;
        const viewProfile = diagram
            ? {
                diagramId: diagram.id,
                permittedRelationshipTypes: diagram.relationshipTypes,
                elementIds: diagram.elementIds,
            }
            : undefined;

        const placement = resolveRelationshipPlacement(payload, model, writerOptions);
        const validation = validateRelationshipMutation(payload, model, registries, {
            viewProfile,
            hasWritableOwner: isWritableRelationshipFile(placement.file, writerOptions),
        });

        if (!validation.valid || !validation.definition) {
            const first = validation.diagnostics.find(d => d.severity === 'error');
            console.warn(`[Relationship] Rejected ${payload.type} ${payload.sourceId}→${payload.targetId}: ` +
                `${first?.code} ${first?.message}`);
            return reject(first?.message ?? 'The relationship is not valid.', validation.diagnostics);
        }

        const result = await writeRelationship(payload, validation.definition, model, writerOptions);
        if (!result.success) {
            console.error(`[Relationship] Write failed: ${result.error}`);
            return reject(result.error ?? 'The relationship could not be written.', validation.diagnostics);
        }

        console.log(`[Persisted] relationship ${result.relationshipId ?? `(${result.notation})`} ` +
            `(${validation.normalizedType}) to ${result.sourceFile} [${result.placementReason}]`);
        if (result.sourceFile) {
            recordWriteTransaction(result.sourceFile, readFileSync(resolve(options.projectRoot, result.sourceFile), 'utf8'));
        }
        await recompileAfterWrite();

        // The file watcher rebuilds and broadcasts the canonical model; this
        // response only confirms the write and carries the IDs the client needs
        // to replace its pending row.
        return {
            type: 'relationship:create:result',
            payload: {
                requestId,
                success: true,
                relationshipId: result.relationshipId,
                notation: result.notation,
                declaration: result.declaration,
                type: validation.normalizedType,
                sourceId: payload.sourceId,
                targetId: payload.targetId,
                sourceFile: result.sourceFile,
                diagnostics: validation.diagnostics.filter(d => d.severity === 'warning'),
            },
        };
    }

    /** Create one release record with all its statements, or none. */
    async function handleReleaseCreate(
        payload: ReleaseCreateRequest & { precondition?: ModelMutationPrecondition },
    ): Promise<import('../protocol/messages.js').ReleaseCreateResultMessage> {
        const requestId = payload?.requestId ?? '';
        const reject = (error: string) => ({ type: 'release:create:result' as const, payload: { requestId, success: false, error } });
        const conflict = checkMutationPrecondition(payload.precondition, requestId, payload);
        if (conflict) return reject(conflict);
        const model = currentModel();
        if (!model) return reject('The model is not loaded yet.');
        const result = await writeRelease(payload, {
            projectRoot: options.projectRoot,
            outlines: (await authoringContext()).outlines,
            fileOf: id => model.elements[id]?.file,
            commitOf: id => model.elements[id]?.attributes?.modelCommit,
        });
        if (!result.success) return reject(result.error ?? 'The release could not be written.');
        console.log(`[Persisted] release ${result.name} (${result.modelCommit?.slice(0, 7)}) to ${result.filePath}`);
        recordWriteTransaction(result.filePath!, readFileSync(resolve(options.projectRoot, result.filePath!), 'utf8'));
        await recompileAfterWrite();
        return { type: 'release:create:result', payload: { requestId, ...result } };
    }

    /** Delete one relationship usage, leaving both endpoint elements in place. */
    async function handleRelationshipDelete(
        payload: RelationshipDeleteRequest & { precondition?: ModelMutationPrecondition },
    ): Promise<RelationshipDeleteResultMessage> {
        const requestId = payload?.requestId ?? '';
        const relationshipId = payload?.relationshipId ?? '';
        const reject = (error: string, diagnostics?: RelationshipDiagnostic[]): RelationshipDeleteResultMessage => ({
            type: 'relationship:delete:result',
            payload: { requestId, success: false, relationshipId, error, diagnostics },
        });
        const conflict = checkMutationPrecondition(payload.precondition, requestId, payload);
        if (conflict) return reject(conflict);

        const model = currentModel();
        if (!model) return reject('The model is not loaded yet.');

        // Resolve the relationship from the server's model, never from the
        // request — the client cannot name a file it does not own.
        const validation = validateRelationshipDeletion(payload, model);
        if (!validation.valid || !validation.relationship) {
            const first = validation.diagnostics[0];
            return reject(first?.message ?? 'The relationship was not found.', validation.diagnostics);
        }

        const result = await removeRelationship(validation.relationship, await relationshipWriterOptions());
        if (!result.success) {
            console.error(`[Relationship] Delete failed: ${result.error}`);
            return reject(result.error ?? 'The relationship could not be removed.');
        }

        console.log(`[Persisted] removed relationship ${relationshipId} from ${result.sourceFile}`);
        if (result.sourceFile) {
            recordWriteTransaction(result.sourceFile, readFileSync(resolve(options.projectRoot, result.sourceFile), 'utf8'));
        }
        await recompileAfterWrite();
        return {
            type: 'relationship:delete:result',
            payload: {
                requestId,
                success: true,
                relationshipId,
                sourceFile: result.sourceFile,
                removedDeclaration: result.removedDeclaration,
            },
        };
    }

    /**
     * Preview or apply an import from another system. A preview writes nothing; an
     * apply writes the one file the source owns, then recompiles. Both run the
     * same computation, so the preview is what the apply does.
     */
    async function handleSourceImport(mode: 'preview' | 'apply', payload: SourceImportPayload): Promise<SourceImportResultMessage> {
        const requestId = payload?.requestId ?? '';
        const fail = (...errors: string[]): SourceImportResultMessage => ({
            type: 'source-import:result', payload: { requestId, mode, success: false, errors },
        });
        const model = currentModel();
        const registries = options.ontologyRegistries;
        if (!model) return fail('The model is not loaded yet.');
        if (!registries?.kindRegistry || !registries.relationshipRegistry) return fail('The ontology is not loaded yet.');
        if (!payload.system?.trim()) return fail('Name the system the export came from.');
        const context: SourceImportContext = { kindRegistry: registries.kindRegistry, relationshipRegistry: registries.relationshipRegistry };
        const prepared = prepareSourceImport(dtoToModel(model), context, {
            system: payload.system.trim(), format: payload.format, text: payload.text,
            defaultKind: payload.kind, defaultRelation: payload.relation,
        }, { sourceFile: payload.fileName });
        const { records, preview, rendered } = prepared;
        // An export that read nothing must not look like a source that dropped every record.
        if (records.errors.length > 0 && records.items.length === 0 && !records.partial) return fail(...records.errors);
        const target = resolve(options.projectRoot, rendered.file);
        const base = {
            requestId, mode, success: true, preview, dropped: rendered.dropped,
            warnings: [...records.warnings, ...rendered.warnings], errors: records.errors,
            sourceFile: rendered.file,
            sourceHash: existsSync(target) ? fileRevision(readFileSync(target, 'utf8')) : '',
        };
        if (mode === 'preview') return { type: 'source-import:result', payload: base };

        // The preview named the file this writes and the hash the client saw of it; if the file has
        // changed since (a second tab, a CLI import, a text edit), what the person reviewed is not
        // what this would do.
        if (payload.precondition?.sourceFile !== rendered.file) return fail('The apply is not for the file this import writes; preview it again.');
        const conflict = checkMutationPrecondition(payload.precondition, requestId, payload);
        if (conflict) return fail(conflict);

        if (!isWritableRelationshipFile(rendered.file, await relationshipWriterOptions())) return fail(`${rendered.file} is not a writable project file`);
        mkdirSync(resolve(target, '..'), { recursive: true });
        assertWritable(target);
        writeFileSync(target, rendered.text, 'utf-8');
        recordWriteTransaction(rendered.file, rendered.text);
        console.log(`[Import] ${payload.system}: wrote ${rendered.file}`);
        await recompileAfterWrite();
        return { type: 'source-import:result', payload: base };
    }

    /**
     * Mark suspect links reviewed: each is rewritten to the current revision of the
     * record it was suspect about. What is suspect is decided here from the whole
     * model, never from the request, so a stale or invented link is refused.
     */
    async function handleSuspectReview(payload: SuspectReviewMessage['payload']): Promise<SuspectReviewResultMessage> {
        const requestId = payload?.requestId ?? '';
        const reject = (error: string): SuspectReviewResultMessage => ({
            type: 'suspect:review:result', payload: { requestId, success: false, reviewed: [], error },
        });
        if (!payload.preconditions?.length) return reject('The review has no source preconditions; reload before saving.');
        for (const precondition of payload.preconditions) {
            const conflict = checkMutationPrecondition(precondition, requestId, payload);
            if (conflict) return reject(conflict);
        }
        const model = currentModel();
        if (!model) return reject('The model is not loaded yet.');
        const resolved = resolveSuspectReviews(model, payload.reviews ?? []);
        if ('error' in resolved) return reject(resolved.error);
        const { reviews } = resolved;
        const result = await reviewTraceBaselines(reviews, await relationshipWriterOptions());
        if (!result.success) return reject(result.error ?? 'The review could not be written.');
        for (const file of result.sourceFiles ?? []) {
            recordWriteTransaction(file, readFileSync(resolve(options.projectRoot, file), 'utf8'));
        }
        await recompileAfterWrite();
        return {
            type: 'suspect:review:result',
            payload: { requestId, success: true, reviewed: reviews.map(r => r.relationship.id), sourceFiles: result.sourceFiles },
        };
    }

    /** Move relationship endpoints as one source edit, including anonymous flows. */
    async function handleRelationshipUpdate(
        payload: RelationshipUpdateRequest & { precondition?: ModelMutationPrecondition },
    ): Promise<RelationshipUpdateResultMessage> {
        const requestId = payload?.requestId ?? '';
        const relationshipId = payload?.relationshipId ?? '';
        const reject = (error: string, diagnostics?: RelationshipDiagnostic[]): RelationshipUpdateResultMessage => ({
            type: 'relationship:update:result',
            payload: { requestId, relationshipId, success: false, error, diagnostics },
        });
        const conflict = checkMutationPrecondition(payload.precondition, requestId, payload);
        if (conflict) return reject(conflict);

        const model = currentModel();
        if (!model) return reject('The model is not loaded yet.');
        const relationship = model.relationships.find(candidate => candidate.id === relationshipId);
        if (!relationship) return reject(`Relationship "${relationshipId}" was not found.`);

        const mutation = {
            ...payload,
            type: relationship.type,
            direction: 'outgoing' as const,
            selectedElementId: payload.sourceId,
            owningFile: relationship.file,
            flowItem: relationship.flowItem,
        };
        // The relationship being replaced cannot consume its own uniqueness or
        // endpoint multiplicity while validating the proposed endpoints.
        const validationModel = {
            ...model,
            relationships: model.relationships.filter(candidate => candidate.id !== relationshipId),
        };
        const validation = validateRelationshipMutation(mutation, validationModel, serverRegistries());
        if (!validation.valid || !validation.definition) {
            const first = validation.diagnostics.find(diagnostic => diagnostic.severity === 'error');
            return reject(first?.message ?? 'The relationship update is not valid.', validation.diagnostics);
        }

        const result = await updateRelationship(payload, relationship, validation.definition, model, await relationshipWriterOptions());
        if (!result.success) return reject(result.error ?? 'The relationship could not be updated.');

        if (result.sourceFile) {
            recordWriteTransaction(result.sourceFile, readFileSync(resolve(options.projectRoot, result.sourceFile), 'utf8'));
        }
        await recompileAfterWrite();
        return {
            type: 'relationship:update:result',
            payload: {
                requestId,
                relationshipId,
                success: true,
                sourceId: payload.sourceId,
                targetId: payload.targetId,
                sourceFile: result.sourceFile,
                diagnostics: validation.diagnostics.filter(diagnostic => diagnostic.severity === 'warning'),
            },
        };
    }

    /**
     * Apply one package mutation, resolving what the client named to a file.
     *
     * The client addresses a package by qualified name because that is what its
     * tree is built from; which file declares it is the server's question, and
     * answering it here keeps the browser from guessing at project layout. A
     * package with no members yet still has a file — the model carries the
     * declared packages, not only the ones with contents.
     */
    async function handlePackageMutation(
        type: 'package:create' | 'package:rename' | 'package:delete' | 'package:move' | 'element:move-package',
        payload: Record<string, any>,
    ): Promise<PackageWriteResult> {
        const { projectRoot } = options;
        const model = currentModel();
        if (!model) return { success: false, filePaths: [], error: 'The model is not loaded yet.' };

        /**
         * The file declaring a package: its own declaration, else its members'.
         *
         * The last fallback resolves the two things a NAMESPACE package is not:
         * a grouping package declared inside a usage body, and the usage that
         * holds one. Neither appears in `model.packages` — the qualified name
         * runs through the usage — and both are addressed by their final
         * segment, which is a MEMO element id and therefore unique.
         */
        const fileOf = (qualifiedName: string): string | undefined =>
            model.packages?.find(pkg => pkg.qualifiedName === qualifiedName)?.file
            ?? Object.values(model.elements).find(el => el.package === qualifiedName)?.file
            ?? model.elements[qualifiedName.split('::').pop() ?? '']?.file;

        if (type === 'package:create') {
            const parent: string | undefined = payload.parent || undefined;
            const file = payload.file || (parent ? fileOf(parent) : undefined) || projectEntrypoint(projectRoot);
            if (!file) {
                return { success: false, filePaths: [], error: 'No project entrypoint configured in memo.package.yaml.' };
            }
            if (parent && !fileOf(parent)) {
                return { success: false, filePaths: [], error: `Package "${parent}" was not found.` };
            }
            return createPackage(projectRoot, { file, parent, name: String(payload.name ?? '') }, (await authoringContext()).outlines);
        }

        const qualifiedName = String(payload.qualifiedName ?? '');
        if (type === 'package:rename' || type === 'package:delete' || type === 'package:move') {
            const file = fileOf(qualifiedName);
            if (!file) return { success: false, filePaths: [], error: `Package "${qualifiedName}" was not found.` };
            if (type === 'package:rename') {
                return renamePackage(projectRoot, { file, qualifiedName, name: String(payload.name ?? '') }, (await authoringContext()).outlines);
            }
            if (type === 'package:delete') return deletePackage(projectRoot, { file, qualifiedName }, (await authoringContext()).outlines);
            const targetParent: string | undefined = payload.targetParent || undefined;
            const targetFile = targetParent ? fileOf(targetParent) : file;
            if (targetParent && !targetFile) {
                return { success: false, filePaths: [], error: `Package "${targetParent}" was not found.` };
            }
            return movePackage(projectRoot, { file, qualifiedName, targetParent, targetFile: targetFile! }, (await authoringContext()).outlines);
        }

        const elementId = String(payload.elementId ?? '');
        const element = model.elements[elementId];
        if (!element) return { success: false, filePaths: [], error: `Element "${elementId}" was not found.` };
        if (element.provenance && !element.provenance.declaration.writable) {
            return {
                success: false, filePaths: [],
                error: `Element "${elementId}" is read-only ${element.provenance.declaration.origin} content.`,
            };
        }
        const targetPackage: string | undefined = payload.targetPackage || undefined;
        const targetFile = targetPackage ? fileOf(targetPackage) : element.file;
        if (targetPackage && !targetFile) {
            return { success: false, filePaths: [], error: `Package "${targetPackage}" was not found.` };
        }

        /** Where a declaration sits in the file, as a path of names. */
        const declarationPath = (start: typeof element): string => {
            const chain: string[] = [];
            const seen = new Set<string>();
            for (let node: typeof element | undefined = start; node && !seen.has(node.id);) {
                seen.add(node.id);
                chain.unshift(node.id);
                node = node.owner ? model.elements[node.owner] : undefined;
            }
            return [start.package, ...chain].filter(Boolean).join('::');
        };

        // A grouping package is not a namespace package: it is declared inside
        // a usage body, so neither it nor anything nested in one has an IR
        // identity to be addressed by. Both are addressed by name path, which
        // is an address for the same reason a package's qualified name is.
        const isGroupingTarget = Boolean(targetPackage)
            && !model.packages?.some(pkg => pkg.qualifiedName === targetPackage);
        if (targetPackage && (isGroupingTarget || element.owner)) {
            return moveIntoGroupingPackage(projectRoot, {
                file: element.file,
                qualifiedName: declarationPath(element),
                targetPackage,
            }, (await authoringContext()).outlines);
        }
        const irIdentity = irIndex().byMemoElement[elementId];
        if (!irIdentity) {
            return {
                success: false, filePaths: [],
                error: `"${elementId}" has no address in the current revision; reload before moving it.`,
            };
        }
        return moveElementToPackage(projectRoot, {
            elementId, irIdentity, sourceFile: element.file, targetFile: targetFile!, targetPackage,
        }, irIndex(), (await authoringContext()).outlines);
    }

    async function handleElementDelete(payload: {
        requestId?: string;
        elementId?: string;
        precondition?: ModelMutationPrecondition;
    }): Promise<ElementDeleteResultMessage> {
        const requestId = payload?.requestId ?? '';
        const elementId = payload?.elementId ?? '';
        const reject = (error: string): ElementDeleteResultMessage => ({
            type: 'element:delete:result',
            payload: { requestId, elementId, success: false, error },
        });
        const conflict = checkMutationPrecondition(payload.precondition, requestId, payload);
        if (conflict) return reject(conflict);
        const model = currentModel();
        if (!model) return reject('The model is not loaded yet.');
        const element = model.elements[elementId];
        if (!element) return reject(`Element "${elementId}" was not found.`);
        if (element.provenance && !element.provenance.declaration.writable) {
            return reject(`Element "${elementId}" is read-only ${element.provenance.declaration.origin} content.`);
        }
        const result = await removeElement(element, model, options.projectRoot, (await authoringContext()).outlines);
        if (result.success) {
            for (const sourceFile of result.sourceFiles ?? []) {
                const path = resolve(options.projectRoot, sourceFile);
                if (existsSync(path)) recordWriteTransaction(sourceFile, readFileSync(path, 'utf8'));
            }
            // The only rows left in the sidecar are UNDECLARED views awaiting
            // migration; none is loaded as a view. They are still kept accurate,
            // because they are the record of what needs declaring and a dangling
            // element ID would carry straight into the declaration.
            const diagrams = loadUserDiagrams(options.projectRoot);
            let changed = false;
            const cleaned = diagrams.map(diagram => {
                if (!diagram.elementIds?.includes(elementId)) return diagram;
                changed = true;
                return { ...diagram, elementIds: diagram.elementIds.filter(id => id !== elementId) };
            });
            if (changed) saveUserDiagrams(options.projectRoot, cleaned);
        }
        return {
            type: 'element:delete:result',
            payload: {
                requestId,
                elementId,
                success: result.success,
                sourceFiles: result.sourceFiles,
                removedRelationshipIds: result.removedRelationshipIds,
                error: result.error,
            },
        };
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

    /**
     * Content revision of a file — a hash of exactly what is on disk.
     *
     * Content, not mtime: an editor that rewrites a file with identical bytes
     * has not changed anything the user needs to be warned about, and mtime
     * granularity is too coarse to trust for conflict detection.
     */
    function fileRevision(contents: string): string {
        // Layout-blind: a box moved on a canvas is not an edit of the file. For a
        // targeted edit, which is computed again from the file as it is.
        return layoutBlindRevision(contents);
    }

    /**
     * The revision of a whole file's text, layout included. A save that replaces
     * the file with text an editor loaded earlier must not pass when a layout was
     * written into the file since: it would put the old statements back.
     */
    function textRevision(contents: string): string {
        return createHash('sha256').update(contents).digest('hex').slice(0, 16);
    }

    /**
     * What the selected compiler says about SysML text, so the editor can show
     * it without waiting for the rebuild. The write already stands, so a
     * compiler that cannot be reached is not a save failure.
     */
    async function sysmlParseErrors(file: string, text: string): Promise<string[]> {
        try {
            const { loadAndResolveConfig } = await import('./config-resolver.js');
            const { findConfigFile, loadProjectSettings } = await import('@memoarchitect/tools');
            const configPath = findConfigFile(options.projectRoot);
            const config = configPath ? loadAndResolveConfig(configPath) : loadProjectSettings(options.projectRoot);
            await selectedOutlineSource(options.projectRoot, config).verify(file, text);
            return [];
        } catch (error) {
            return [(error instanceof Error ? error.message : String(error))];
        }
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
        options.onClientCountChanged?.(clients.size);

        // Send initial state to new connections
        for (const msg of initialMessages) {
            ws.send(JSON.stringify(msg));
        }
        if (mutationLockout) ws.send(JSON.stringify(mutationLockout));
        // A client that connects while the source is broken must learn that the
        // model it just received is the last good one, not the current file.
        if (sourceIncoherence) ws.send(JSON.stringify(sourceIncoherence));

        // Send all sidecar layouts on connect
        const layouts = loadViewLayouts(options.projectRoot, currentDiagrams(), savedId => {
            const model = currentModel();
            if (!model || model.elements[savedId]) return undefined;
            // A layout written before ids were qualified keys its nodes by the
            // declared name. Accept it when exactly one element answers to it.
            const matches = Object.keys(model.elements)
                .filter(id => (model.elements[id].shortName ?? id) === savedId);
            return matches.length === 1 ? matches[0] : undefined;
        });
        if (Object.keys(layouts).length > 0) {
            ws.send(JSON.stringify({ type: 'diagram:layout', payload: { layouts } }));
        }

        // The person's own choices for this model (memo.user.yaml)
        try {
            ws.send(JSON.stringify({ type: 'user-preferences', payload: loadUserPreferences(options.preferencesRoot ?? options.projectRoot) }));
            if (options.readOnly) ws.send(JSON.stringify({ type: 'pinned:info', payload: options.pinned ?? { kind: 'read-only', label: 'read-only' } }));
        } catch (e) {
            console.error('[Preferences] load failed:', e);
        }

        // Send custom dashboards on connect
        try {
            ws.send(JSON.stringify({ type: 'dashboards', payload: { dashboards: loadDashboards(options.projectRoot) } }));
        } catch (e) {
            console.error('[Dashboards] initial load failed:', e);
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

        // The user's own toolchain settings: shown in Architect, written to their file.
        void (async () => {
            try {
                ws.send(JSON.stringify({ type: 'toolchain:settings', payload: { settings: await toolchainSettings() } }));
            } catch (e) {
                console.error('[toolchain] settings load failed:', e);
            }
        })();

        // Announce LLM availability and settings on connect. Resolution spans
        // the environment, a project .env, project settings and stored
        // credentials — never just process.env.
        void (async () => {
            try {
                const settings = await llmSettings();
                ws.send(JSON.stringify({
                    type: 'llm:status',
                    payload: { available: settings.configured, provider: settings.provider, model: settings.model },
                }));
                ws.send(JSON.stringify({ type: 'llm:settings', payload: { settings } }));
            } catch (e) {
                console.error('[LLM] settings load failed:', e);
            }
        })();

        ws.on('close', () => {
            clients.delete(ws);
            options.onClientCountChanged?.(clients.size);
        });

        const handleMessage = async (data: any) => {
            try {
                const msg = JSON.parse(data.toString());
                if (options.readOnly && !isReadOnlyMessage(msg.type)) {
                    // Refused by name, not by what it would have written: see READ_ONLY_MESSAGES.
                    ws.send(JSON.stringify({
                        type: 'app:error',
                        payload: {
                            requestId: msg.payload?.requestId,
                            error: 'This is a pinned, read-only view; nothing can be changed in it. Open the working version to edit.',
                        },
                    }));
                    return;
                }
                if (mutationLockout && isModelMutationMessage(msg.type)) {
                    // A section 13.5 escalation is a hard server boundary;
                    // stale and hand-authored clients cannot write through it.
                    ws.send(JSON.stringify(mutationLockout));
                    return;
                }
                if (sourceIncoherence && isModelMutationMessage(msg.type)) {
                    // Held, not locked out: the write cannot be placed while the
                    // closure is unknown, but the hold lifts by itself as soon
                    // as the source parses again.
                    ws.send(JSON.stringify(sourceIncoherence));
                    return;
                }
                // One action writes one store (§6.2). A semantic mutation
                // carrying canvas geometry is refused here rather than at the
                // writer, so no handler has to remember the rule.
                try {
                    assertSingleDomainMutation(msg.type, msg.payload);
                } catch (e) {
                    if (!(e instanceof MixedMutationDomainError)) throw e;
                    console.warn(`[Mutation] ${e.message}`);
                    ws.send(JSON.stringify({
                        type: 'app:error',
                        payload: { requestId: msg.payload?.requestId, error: e.message },
                    }));
                    return;
                }
                if (msg.type === 'request:refresh') {
                    // A missed publication always falls back to one coherent
                    // snapshot, never a partial replay of old deltas.
                    for (const m of stampWorkspace(initialMessages, null, true)) {
                        ws.send(JSON.stringify(m));
                    }
                } else if (msg.type === 'element:update' || msg.type === 'element:create') {
                    const { projectRoot } = options;
                    const { requestId = '', id = '' } = msg.payload ?? {};
                    const reply = (payload: Record<string, unknown>) => ws.send(JSON.stringify({
                        type: 'element:mutation:result',
                        payload: { requestId, elementId: id, ...payload },
                    }));

                    const existing = currentModel()?.elements[msg.payload?.id];
                    if (existing?.provenance && !existing.provenance.declaration.writable) {
                        reply({ success: false, rejectedDraft: msg.payload,
                            error: `Element "${existing.id}" is read-only ${existing.provenance.declaration.origin} content.` });
                        return;
                    }
                    const precondition = msg.payload?.precondition;
                    if (!precondition) {
                        reply({ success: false, conflict: true, rejectedDraft: msg.payload,
                            error: 'The edit has no source precondition; reload it before saving.' });
                        return;
                    }
                    if (precondition) {
                        if (precondition.workspaceSessionId !== workspaceSessionId) {
                            reply({ success: false, conflict: true, rejectedDraft: msg.payload,
                                error: 'The workspace runtime changed; no write was made.' });
                            return;
                        }
                        const sourcePath = resolve(projectRoot, precondition.sourceFile);
                        const projectPath = realpathSync(resolve(projectRoot));
                        // A precondition that does not name a project file is
                        // untrustworthy: do not silently turn it into a write.
                        if (!sourcePath.startsWith(`${projectPath}/`) ||
                            (msg.type === 'element:update' && !existsSync(sourcePath))) {
                            reply({ success: false, conflict: true, rejectedDraft: msg.payload,
                                error: 'Mutation source is not a current project file.' });
                            return;
                        }
                        const currentHash = existsSync(sourcePath)
                            ? fileRevision(readFileSync(sourcePath, 'utf8')) : '';
                        if (precondition.expectedSourceHash !== currentHash) {
                            broadcastEditConflict({
                                sourceFile: precondition.sourceFile,
                                targetElementIds: precondition.targetElementIds,
                                baseRevision: precondition.baseRevision,
                                currentRevision: workspaceRevision,
                                expectedSourceHash: precondition.expectedSourceHash,
                                currentSourceHash: currentHash,
                                rejectedCommandId: requestId,
                                rejectedDraft: msg.payload,
                            });
                            reply({ success: false, conflict: true, rejectedDraft: msg.payload,
                                sourceFile: precondition.sourceFile,
                                expectedSourceHash: precondition.expectedSourceHash,
                                currentSourceHash: currentHash,
                                error: `${precondition.sourceFile} changed on disk; no write was made.`,
                            });
                            return;
                        }
                    }
                    // One operation: write the source, then recompile through
                    // the selected lowering provider so the identity the client
                    // edits next is the one this write produced. The file
                    // watcher still publishes the model.
                    const result = await writeElement(await authoringContext(), msg.payload);
                    let transactionId: string | undefined;
                    if (result.success) {
                        transactionId = recordWriteTransaction(
                            result.filePath, readFileSync(resolve(projectRoot, result.filePath), 'utf8'));
                        if (result.revision) writeBackIndex = addressable(result.revision.index);
                        console.log(`[Persisted] ${msg.type} to ${result.filePath}`);
                    }
                    if (result.stale) {
                        // The file may be byte-identical and the edit still
                        // wrong, so this is announced as its own kind of
                        // conflict rather than as "the file changed".
                        broadcastEditConflict({
                            reason: 'stale-identity',
                            detail: result.error,
                            sourceFile: result.filePath,
                            targetElementIds: [id],
                            baseRevision: precondition.baseRevision,
                            currentRevision: workspaceRevision,
                            expectedSourceHash: precondition.expectedSourceHash,
                            currentSourceHash: precondition.expectedSourceHash,
                            rejectedCommandId: requestId,
                            rejectedDraft: msg.payload,
                        });
                    }
                    reply({
                        success: result.success,
                        sourceFile: result.filePath,
                        transactionId,
                        error: result.error,
                        // A stale address is a conflict, not a malformed request:
                        // the client's answer to both is to reload and retry.
                        ...(result.stale ? { conflict: true, stale: true, rejectedDraft: msg.payload } : {}),
                        ...(result.warnings ? { warnings: result.warnings } : {}),
                        ...(result.success ? { irIdentity: irIndex().byMemoElement[id] } : {}),
                    });
                } else if (msg.type === 'package:create' || msg.type === 'package:rename' ||
                           msg.type === 'package:delete' || msg.type === 'package:move' ||
                           msg.type === 'element:move-package') {
                    // Containment is package membership, so every one of these is
                    // a source edit on a `package` declaration — never a
                    // directory, and never an attribute standing in for one.
                    const { requestId = '' } = msg.payload ?? {};
                    const reply = (payload: Record<string, unknown>) => ws.send(JSON.stringify({
                        type: 'package:mutation:result',
                        payload: { requestId, ...payload },
                    }));
                    try {
                        const result = await handlePackageMutation(msg.type, msg.payload ?? {});
                        if (result.success) {
                            await recompileAfterWrite();
                            console.log(`[Persisted] ${msg.type} to ${result.filePaths.join(', ')}`);
                        }
                        reply({ ...result });
                    } catch (e: any) {
                        reply({ success: false, filePaths: [], error: e?.message ?? String(e) });
                    }
                } else if (msg.type === 'screen-capture:upload') {
                    const { requestId, viewName, fileName, base64, mediaType } = msg.payload ?? {};
                    const reply = (payload: Record<string, unknown>) => ws.send(JSON.stringify({
                        type: 'screen-capture:upload:result',
                        payload: { requestId, ...payload },
                    }));
                    try {
                        if (!requestId || typeof base64 !== 'string') throw new Error('The image payload is missing.');
                        const extensions: Record<string, string> = {
                            'image/png': '.png',
                            'image/jpeg': '.jpg',
                            'image/webp': '.webp',
                        };
                        const extension = extensions[mediaType];
                        if (!extension) throw new Error('Only PNG, JPEG, and WebP captures are supported.');
                        const bytes = Buffer.from(base64, 'base64');
                        if (!bytes.length) throw new Error('The selected image is empty.');
                        if (bytes.length > 25 * 1024 * 1024) throw new Error('Screen captures must be 25 MB or smaller.');

                        const safeView = String(viewName || 'ui-screen')
                            .normalize('NFKD').replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-+|-+$/g, '')
                            || 'ui-screen';
                        const rawStem = String(fileName || 'capture').replace(/\.[^.]+$/, '');
                        const safeStem = rawStem
                            .normalize('NFKD').replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-+|-+$/g, '')
                            || 'capture';
                        // Write into the layout the project actually uses. Creating
                        // `model/` under a project whose source lives in `src/`
                        // resurrects a directory that layout deliberately does not
                        // have, and the capture would then sit outside the tree the
                        // rest of the model is kept in.
                        const captureRoot = existsSync(resolve(options.projectRoot, 'model'))
                            ? resolve(options.projectRoot, 'model', 'assets')
                            : resolve(options.projectRoot, 'assets');
                        const assetDir = resolve(captureRoot, safeView);
                        const assetPath = resolve(assetDir, `${safeStem}${extension}`);
                        if (!isWithinRoot(captureRoot, assetPath)) throw new Error('Invalid capture path.');
                        mkdirSync(assetDir, { recursive: true });
                        writeFileSync(assetPath, bytes);
                        const imageUri = relative(options.projectRoot, assetPath).replaceAll('\\', '/');
                        reply({
                            success: true,
                            imageUri,
                            imageHash: createHash('sha256').update(bytes).digest('hex'),
                        });
                        console.log(`[Screen Capture] Saved ${imageUri}`);
                    } catch (e: any) {
                        reply({ success: false, error: e?.message ?? String(e) });
                    }
                } else if (msg.type === 'diagram:create') {
                    const { projectRoot } = options;
                    const diagram: DiagramDTO = { ...msg.payload, auto: false };
                    // A view is model content, so it is DECLARED, not recorded in
                    // a sidecar. Writing the SysML puts it where `memo validate`,
                    // the selected compiler, review and git can all see it, and — the
                    // derived diagram then carrying a `sourceFile` — has a place to keep
                    // its layout.
                    const declared = await writeViewDeclaration(
                        projectRoot, currentModel() ?? ({ elements: {}, diagrams: [] } as any), diagram, (await authoringContext()).outlines);
                    if (!declared.success) {
                        // No fallback. A view that cannot be declared is not one
                        // this project can hold, and recording it in a sidecar
                        // would only hide that until something downstream needed
                        // the declaration.
                        const error = `The view "${diagram.name}" was not created: ${declared.reason}. `
                            + 'Every view must be declared in SysML.';
                        console.error(`[Diagram] REFUSED: ${error}`);
                        ws.send(JSON.stringify({ type: 'app:error', payload: { requestId: (msg.payload as any)?.requestId, error } }));
                        return;
                    }
                    console.log(`[Diagram] Declared: ${diagram.name} (${diagram.id}) as ${declared.identifier} in ${declared.filePath}`);
                    // The file watcher recompiles and `view-deriver` emits the
                    // diagram; no broadcast here, or clients would briefly hold
                    // a second, sidecar-shaped copy of it.
                    await recompileAfterWrite();
                } else if (msg.type === 'diagram:update') {
                    // What a view shows lives in its `expose` members, not in a
                    // list of ids in a sidecar, so the update is applied to the
                    // declaration. This used to edit the sidecar, which meant
                    // that for a DECLARED view it silently did nothing at all.
                    const { projectRoot } = options;
                    const declared = currentDiagrams().find(d => d.id === (msg.payload as any)?.id);
                    const result = declared
                        ? await updateViewExpose(
                            projectRoot, currentModel() ?? ({ elements: {} } as any), declared,
                            (msg.payload as any)?.elementIds, (await authoringContext()).outlines)
                        : { success: false, reason: `no view "${(msg.payload as any)?.id}" is declared` } as const;
                    if (result.success) {
                        console.log(`[Diagram] Exposed ${(result as any).exposed.join(', ')} on ${declared!.name} (${(result as any).filePath})`);
                        await recompileAfterWrite();
                    } else {
                        const error = `The view "${declared?.name ?? (msg.payload as any)?.id}" was not changed: ${result.reason}.`;
                        console.error(`[Diagram] REFUSED: ${error}`);
                        ws.send(JSON.stringify({ type: 'app:error', payload: { requestId: (msg.payload as any)?.requestId, error } }));
                    }
                } else if (msg.type === 'diagram:display:update') {
                    const { projectRoot } = options;
                    const declared = currentDiagrams().find(d => d.id === (msg.payload as any)?.diagramId);
                    const result = declared
                        ? await updateViewDisplay(
                            projectRoot, currentModel() ?? ({ elements: {} } as any), declared,
                            (msg.payload as any)?.display ?? {}, (await authoringContext()).outlines)
                        : { success: false, reason: `no view "${(msg.payload as any)?.diagramId}" is declared` } as const;
                    if (result.success) {
                        await recompileAfterWrite();
                    } else {
                        ws.send(JSON.stringify({ type: 'app:error', payload: {
                            requestId: (msg.payload as any)?.requestId,
                            error: `How "${declared?.name ?? (msg.payload as any)?.diagramId}" is shown was not saved: ${result.reason}.`,
                        } }));
                    }
                } else if (msg.type === 'diagram:delete') {
                    // Deleting a view means deleting its declaration, which is
                    // `element:delete` on the view element — not a sidecar edit.
                    const declared = currentDiagrams().find(d => d.id === (msg.payload as any)?.id);
                    const where = declared?.sourceFile
                        ? `Remove its \`view\` declaration from ${declared.sourceFile}.`
                        : 'It is not declared in SysML.';
                    const error = `The view "${declared?.name ?? (msg.payload as any)?.id}" cannot be deleted from here — `
                        + `a view exists because it is declared. ${where}`;
                    console.error(`[Diagram] REFUSED: ${error}`);
                    ws.send(JSON.stringify({ type: 'app:error', payload: { requestId: (msg.payload as any)?.requestId, error } }));
                } else if (msg.type === 'diagram:layout:update') {
                    const { diagramId, layout } = msg.payload;
                    const diagram = currentDiagrams().find(d => d.id === diagramId);
                    // The layout is written into the `view` that declares the
                    // diagram, and nowhere else. A diagram that is not a declared
                    // view keeps its layout for the session only.
                    const saved = diagram
                        ? await saveViewLayout(options.projectRoot, diagram, layout, (await authoringContext()).outlines)
                        : { success: false, reason: `no view "${diagramId}" is declared` } as const;
                    if (!saved.success) {
                        console.log(`[Diagram] Layout of ${diagramId} not saved: ${saved.reason}`);
                        // Said to the sender, who is showing a layout the file does not hold.
                        ws.send(JSON.stringify({ type: 'app:error', payload: {
                            requestId: (msg.payload as any)?.requestId,
                            error: `The layout of "${diagram?.name ?? diagramId}" was not saved: ${saved.reason}.`,
                        } }));
                        return;
                    } else if ('changed' in saved && saved.changed && saved.filePath) {
                        console.log(`[Diagram] Saved layout: ${saved.filePath}`);
                        // The file watcher sees this write, finds it layout-only and
                        // does not rebuild; the write is matched here so it is not
                        // mistaken for an outside edit.
                        recordWriteTransaction(saved.filePath, readFileSync(resolve(options.projectRoot, saved.filePath), 'utf8'));
                    } else {
                        console.log(`[Diagram] No change to the layout of ${diagramId}`);
                    }
                    // Broadcast to other clients (not the sender)
                    const layoutMsg = JSON.stringify({ type: 'diagram:layout', payload: { layouts: { [diagramId]: layout } } });
                    for (const client of clients) {
                        if (client !== ws && client.readyState === 1) client.send(layoutMsg);
                    }
                } else if (msg.type === 'relationship:create') {
                    ws.send(JSON.stringify(await handleRelationshipCreate(msg.payload)));
                } else if (msg.type === 'release:create') {
                    ws.send(JSON.stringify(await handleReleaseCreate(msg.payload)));
                } else if (msg.type === 'relationship:delete') {
                    ws.send(JSON.stringify(await handleRelationshipDelete(msg.payload)));
                } else if (msg.type === 'relationship:update') {
                    ws.send(JSON.stringify(await handleRelationshipUpdate(msg.payload)));
                } else if (msg.type === 'import:preview' || msg.type === 'import:apply') {
                    ws.send(JSON.stringify(await handleSourceImport(msg.type === 'import:preview' ? 'preview' : 'apply', msg.payload)));
                } else if (msg.type === 'suspect:review') {
                    ws.send(JSON.stringify(await handleSuspectReview(msg.payload)));
                } else if (msg.type === 'element:delete') {
                    ws.send(JSON.stringify(await handleElementDelete(msg.payload)));
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
                        const remapOutlines = (await authoringContext()).outlines;
                        for (const element of Object.values(elements) as any[]) {
                            const newKind = mappings[element.kind];
                            if (newKind) {
                                const result = await saveElementToFile(
                                    projectRoot, { ...element, kind: newKind }, irIndex(), remapOutlines);
                                if (result.success) remappedCount++;
                            }
                        }
                        if (remappedCount > 0) await recompileAfterWrite();
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
                } else if (msg.type === 'methodology:source:request' || msg.type === 'methodology:source:save') {
                    const { requestId, sourceFile } = msg.payload ?? {};
                    const operation = msg.type === 'methodology:source:save' ? 'save' : 'load';
                    const reply = (payload: Record<string, unknown>) => ws.send(JSON.stringify({
                        type: 'methodology:source:result',
                        payload: { requestId, sourceFile, operation, ...payload },
                    }));
                    try {
                        const methodology = initialMessages.find(message => message.type === 'methodology:update') as any;
                        const allowed = new Set<string>((methodology?.payload?.folders ?? []).flatMap((folder: any) =>
                            (folder.sourceFiles ?? []).map((file: string) => resolve(options.projectRoot, file))));
                        const path = resolve(options.projectRoot, String(sourceFile ?? ''));
                        if (!allowed.has(path) || !path.endsWith('.sysml')) {
                            throw new Error('The requested file is not in the resolved methodology source set.');
                        }
                        const onDisk = readFileSync(path, 'utf8');
                        const revision = textRevision(onDisk);
                        if (operation === 'load') {
                            reply({ success: true, text: onDisk, revision });
                            return;
                        }
                        const { text, baseRevision } = msg.payload;
                        if (typeof text !== 'string' || typeof baseRevision !== 'string') {
                            throw new Error('Text and source revision are required.');
                        }
                        if (baseRevision !== revision) {
                            const lockout: RestartRequiredMessage = {
                                type: 'app:restart-required',
                                reason: 'ontology-source-changed',
                                changedFile: String(sourceFile),
                                instruction: 'Reusable methodology source changed externally. Model mutations are locked; Relaunch Memo Architect.',
                            };
                            mutationLockout = lockout;
                            for (const client of clients) {
                                if (client.readyState === 1) client.send(JSON.stringify(lockout));
                            }
                            reply({ success: false, conflict: true, text: onDisk, revision,
                                error: `${sourceFile} changed on disk; no write was made.` });
                            return;
                        }
                        writeFileSync(path, text, 'utf8');
                        const transactionId = recordWriteTransaction(String(sourceFile), text);
                        reply({ success: true, revision: textRevision(text), transactionId });
                    } catch (error) {
                        reply({ success: false, error: error instanceof Error ? error.message : String(error) });
                    }
                } else if (msg.type === 'rule:policy:write') {
                    // Tailoring a rule from the browser goes through exactly
                    // the path a hand edit does: the same allowed-source check,
                    // the same base-revision precondition, the same transaction
                    // ID. The editor supplies a decision; the SysML is rendered
                    // here, so the browser never composes model source.
                    const { requestId } = msg.payload ?? {};
                    const reply = (payload: any) => ws.send(JSON.stringify({
                        type: 'rule:policy:write:result', payload: { requestId, ...payload },
                    }));
                    try {
                        const request = msg.payload;
                        const methodology = initialMessages.find(
                            message => message.type === 'methodology:update') as any;
                        const effectiveRules: any[] = (initialMessages.find(
                            message => message.type === 'rules:update') as any)?.payload?.rules ?? [];
                        const refusal = checkRulePolicy(request, effectiveRules);
                        if (refusal) {
                            reply({ success: false, code: refusal.code, error: refusal.message });
                            return;
                        }

                        const allowed = new Set<string>((methodology?.payload?.folders ?? []).flatMap((folder: any) =>
                            (folder.sourceFiles ?? []).map((file: string) => resolve(options.projectRoot, file))));
                        const path = resolve(options.projectRoot, String(request.sourceFile ?? ''));
                        if (!allowed.has(path) || !path.endsWith('.sysml')) {
                            throw new Error('The target file is not in the resolved methodology source set.');
                        }

                        const onDisk = readFileSync(path, 'utf8');
                        const revision = textRevision(onDisk);
                        if (request.baseRevision !== revision) {
                            reply({ success: false, conflict: true, revision,
                                error: `${request.sourceFile} changed on disk; no write was made.` });
                            return;
                        }

                        const updated = insertRulePolicy(onDisk, renderRulePolicy(request));
                        if (!updated) {
                            throw new Error(
                                `${request.sourceFile} declares no ModelMethodBinding or MethodologyDefinition to attach the policy to.`);
                        }
                        writeFileSync(path, updated, 'utf8');
                        const transactionId = recordWriteTransaction(String(request.sourceFile), updated);
                        reply({ success: true, revision: textRevision(updated), transactionId });
                    } catch (error) {
                        reply({ success: false, error: error instanceof Error ? error.message : String(error) });
                    }
                } else if (msg.type === 'rule:preview' || msg.type === 'rule:create') {
                    // A rule of the user's. Preview and write take the same
                    // request through the same checks (rule-service.ts); the
                    // browser names the rule and Tools renders and verifies it.
                    const { requestId } = msg.payload ?? {};
                    const resultType = msg.type === 'rule:preview' ? 'rule:preview:result' : 'rule:create:result';
                    const reply = (payload: any) => ws.send(JSON.stringify({ type: resultType, payload: { requestId, ...payload } }));
                    try {
                        const context = options.ruleContext?.();
                        if (!context) {
                            reply({ success: false, error: 'The project has not built yet, so a rule cannot be checked against it.' });
                            return;
                        }
                        const form = msg.payload as any;
                        if (msg.type === 'rule:preview') {
                            reply(previewRule(context, form));
                        } else {
                            const written = await createRule(context, form);
                            if (written.success) {
                                const transactionId = recordWriteTransaction(String(form.file), written.text);
                                reply({ success: true, revision: written.revision, transactionId });
                            } else {
                                reply(written);
                            }
                        }
                    } catch (error) {
                        reply({ success: false, error: error instanceof Error ? error.message : String(error) });
                    }
                } else if (msg.type === 'diagram:source:request') {
                    const { requestId, diagramId } = msg.payload ?? {};
                    try {
                        const source = diagramSource(String(diagramId ?? ''));
                        const text = readFileSync(source.path, 'utf8');
                        ws.send(JSON.stringify({
                            type: 'diagram:source:result',
                            payload: {
                                requestId, diagramId, operation: 'load', success: true,
                                sourceFile: source.sourceFile, text, revision: textRevision(text),
                            },
                        }));
                    } catch (e: any) {
                        ws.send(JSON.stringify({
                            type: 'diagram:source:result',
                            payload: { requestId, diagramId, operation: 'load', success: false, error: e?.message ?? String(e) },
                        }));
                    }
                } else if (msg.type === 'diagram:source:save') {
                    const { requestId, diagramId, text, baseRevision } = msg.payload ?? {};
                    try {
                        if (typeof text !== 'string') throw new Error('SysML source text is required.');
                        if (typeof baseRevision !== 'string') throw new Error('A source revision is required; reload the file before saving.');
                        const source = diagramSource(String(diagramId ?? ''));

                        // Refuse to overwrite work that arrived after this edit
                        // began. The client gets the current file back so it can
                        // show the conflict instead of losing one of the two.
                        const onDisk = readFileSync(source.path, 'utf8');
                        const currentRevision = textRevision(onDisk);
                        if (baseRevision !== currentRevision) {
                            console.warn(`[Diagram] Refused stale save of ${source.sourceFile} ` +
                                `(based on ${baseRevision}, disk is ${currentRevision})`);
                            broadcastEditConflict({
                                sourceFile: source.sourceFile,
                                targetElementIds: currentDiagrams().find(d => d.id === diagramId)?.elementIds ?? [],
                                baseRevision,
                                currentRevision,
                                expectedSourceHash: baseRevision,
                                currentSourceHash: currentRevision,
                                rejectedCommandId: requestId,
                                rejectedDraft: { diagramId, text },
                            });
                            ws.send(JSON.stringify({
                                type: 'diagram:source:result',
                                payload: {
                                    requestId, diagramId, operation: 'save', success: false, conflict: true,
                                    sourceFile: source.sourceFile, text: onDisk, revision: currentRevision,
                                    error: `${source.sourceFile} changed on disk since this edit began.`,
                                },
                            }));
                            return;
                        }

                        assertWritable(source.path);
                        writeFileSync(source.path, text, 'utf8');
                        const transactionId = recordWriteTransaction(source.sourceFile, text);
                        ws.send(JSON.stringify({
                            type: 'diagram:source:result',
                            payload: {
                                requestId, diagramId, operation: 'save', success: true,
                                sourceFile: source.sourceFile, revision: textRevision(text),
                                transactionId,
                                parseErrors: await sysmlParseErrors(source.sourceFile, text),
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

                        const contentManifests = findMemoManifests(projectRoot);
                        const namespaces = [...new Set(selected.map(name =>
                            contentManifests.find(entry => name in entry.manifest.packages)?.manifest.init.rootImport
                                ?? name.replace(/^@/, '').replace(/[/\-]/g, '_').toUpperCase()
                        ))];
                        const importLines = namespaces
                            .map(ns => `    import ${ns}::*;`)
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
                        instruction: 'Ontology selection saved. Stop dev server (Ctrl+C) and run `memo-architect dev` again to apply.',
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
                            // The list is read from the last build's handoff: a package just
                            // installed joins it when the project next compiles.
                            const packages = options.packageMetadata?.() ?? [];
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
                            loadProjectSettings,
                        } = await import('@memoarchitect/tools');
                        const config = loadProjectSettings(projectRoot);
                        const { ontology } = await llmQueryContext();

                        const errors: string[] = [];
                        const warnings: string[] = [];
                        let elementsImported = 0;
                        let relationshipsImported = 0;

                        let elements: any[] = [];
                        let relationships: any[] = [];

                        if (elementsCsv) {
                            const result = parseElementsCsv(elementsCsv, ontology);
                            errors.push(...result.errors);
                            warnings.push(...result.warnings);
                            elements = result.items;
                            elementsImported = elements.length;
                        }

                        if (relationshipsCsv) {
                            const knownIds = elementsImported > 0
                                ? new Set(elements.map((e: any) => e.id))
                                : undefined;
                            const result = parseRelationshipsCsv(relationshipsCsv, ontology, knownIds);
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
                        const { resolveLLMConfig, createProvider } = await import('@memoarchitect/tools');
                        const { findConfigFile } = await import('@memoarchitect/tools');
                        const { askModel } = await import('@memoarchitect/tools');
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
                            const ctx = await scopedQueryContext(config, msg.payload?.workspace);
                            const provider = createProvider(llmConfig);
                            const result = await askModel(question, ctx, provider);
                            ws.send(JSON.stringify({ type: 'llm:ask:result', payload: { requestId, answer: result.answer } }));
                        }
                    } catch (e: any) {
                        console.error('[LLM] ask failed:', e);
                        ws.send(JSON.stringify({ type: 'llm:ask:result', payload: { requestId, error: e?.message ?? String(e) } }));
                    }
                } else if (msg.type === 'llm:chat') {
                    // Multi-turn conversation about the model, with optional edit proposals.
                    const { requestId, question, history, allowEdits } = msg.payload ?? {};
                    try {
                        const { resolveLLMConfig, createProvider, runChatTurn } = await import('@memoarchitect/tools');

                        const llmConfig = resolveLLMConfig(options.projectRoot);
                        if (!llmConfig) {
                            ws.send(JSON.stringify({ type: 'llm:chat:result', payload: { requestId, error: 'No LLM provider configured. Add an API key in Settings, set ANTHROPIC_API_KEY or OPENAI_API_KEY, or put one in a project .env file.' } }));
                        } else {
                            const { ctx, ontology } = await llmQueryContext(msg.payload?.workspace);
                            const provider = createProvider(llmConfig);
                            const result = await runChatTurn({
                                question, history, ctx, provider, ontology,
                                allowEdits: allowEdits === true,
                            });
                            ws.send(JSON.stringify({
                                type: 'llm:chat:result',
                                payload: {
                                    requestId,
                                    answer: result.answer,
                                    proposedChanges: result.proposedChanges,
                                    messages: result.messages,
                                    truncated: result.truncated,
                                },
                            }));
                        }
                    } catch (e: any) {
                        console.error('[LLM] chat failed:', e);
                        ws.send(JSON.stringify({ type: 'llm:chat:result', payload: { requestId, error: e?.message ?? String(e) } }));
                    }
                } else if (msg.type === 'llm:chat:apply') {
                    // Apply the subset of proposals the engineer approved.
                    const { requestId, changes } = msg.payload ?? {};
                    const applied: string[] = [];
                    const failed: Array<{ id: string; error: string }> = [];
                    try {
                        // Sequential on purpose: a relationship may depend on an
                        // element created earlier in the same batch.
                        for (const change of (changes ?? []) as ProposedChange[]) {
                            try {
                                await applyProposedChange(change);
                                applied.push(change.id);
                            } catch (e: any) {
                                failed.push({ id: change.id, error: e?.message ?? String(e) });
                            }
                        }
                        console.log(`[LLM] applied ${applied.length} change(s), ${failed.length} failed`);
                        ws.send(JSON.stringify({ type: 'llm:chat:apply:result', payload: { requestId, applied, failed } }));
                    } catch (e: any) {
                        console.error('[LLM] apply failed:', e);
                        ws.send(JSON.stringify({ type: 'llm:chat:apply:result', payload: { requestId, applied, failed, error: e?.message ?? String(e) } }));
                    }
                } else if (msg.type === 'toolchain:settings:save') {
                    // Not a model mutation: it writes the user's own file, and is how a
                    // user gets out of a compiler that rejects their project.
                    const { requestId, path, value, scope } = msg.payload ?? {};
                    try {
                        const { applyUserSetting, applyProjectSetting } = await import('../toolchain/user-settings-status.js');
                        const { defaultRegistry } = await import('../toolchain/default-registry.js');
                        const wanted = typeof value === 'string' && value.length > 0 ? value : undefined;
                        // The project's own file is watched: the change reaches the restart-required flow by itself.
                        if (scope === 'project') applyProjectSetting(options.projectRoot, String(path ?? ''), wanted, defaultRegistry);
                        else applyUserSetting(String(path ?? ''), wanted, defaultRegistry);
                        const settings = await toolchainSettings();
                        ws.send(JSON.stringify({ type: 'toolchain:settings:save:result', payload: { requestId, settings, appliesOnRestart: true } }));
                        const settingsMsg = JSON.stringify({ type: 'toolchain:settings', payload: { settings } });
                        for (const client of clients) {
                            if (client.readyState === 1) client.send(settingsMsg);
                        }
                    } catch (e: any) {
                        ws.send(JSON.stringify({ type: 'toolchain:settings:save:result', payload: { requestId, error: e?.message ?? String(e) } }));
                    }
                } else if (msg.type === 'llm:settings:save') {
                    const { requestId, provider, model, baseUrl, apiKey } = msg.payload ?? {};
                    try {
                        const {
                            saveLlmProjectSettings, loadLlmProjectSettings,
                            saveLlmCredential, clearLlmCredential,
                        } = await import('@memoarchitect/tools');

                        // Omitted fields keep their current value; the client
                        // sends only what the user actually edited.
                        const existing = loadLlmProjectSettings(options.projectRoot);
                        saveLlmProjectSettings(options.projectRoot, {
                            provider: provider ?? existing.provider,
                            model: model ?? existing.model,
                            baseUrl: baseUrl ?? existing.baseUrl,
                        });

                        if (typeof apiKey === 'string') {
                            const target = provider ?? existing.provider ?? 'anthropic';
                            if (apiKey) saveLlmCredential(target, apiKey);
                            else clearLlmCredential(target);
                        }

                        const settings = await llmSettings();
                        ws.send(JSON.stringify({ type: 'llm:settings:save:result', payload: { requestId, settings } }));
                        // Everyone watching this project should see the new status.
                        const settingsMsg = JSON.stringify({ type: 'llm:settings', payload: { settings } });
                        for (const client of clients) {
                            if (client.readyState === 1) client.send(settingsMsg);
                        }
                    } catch (e: any) {
                        console.error('[LLM] settings save failed:', e);
                        ws.send(JSON.stringify({ type: 'llm:settings:save:result', payload: { requestId, error: e?.message ?? String(e) } }));
                    }
                } else if (msg.type === 'llm:generate') {
                    // Argument marshalling only: memo-tools owns generation,
                    // validation, repair, and normalized diagnostics.
                    const { requestId, description } = msg.payload ?? {};
                    try {
                        const { generateValidatedSysml } = await import('../operations/ai-authoring.js');
                        const result = await generateValidatedSysml({ projectRoot: options.projectRoot, description });
                        ws.send(JSON.stringify({ type: 'llm:generate:result', payload: { requestId, ...result } }));
                    } catch (e: any) {
                        console.error('[LLM] generate failed:', e);
                        ws.send(JSON.stringify({ type: 'llm:generate:result', payload: { requestId, error: e?.message ?? String(e) } }));
                    }
                } else if (msg.type === 'llm:draft') {
                    // Draft DHF document sections via LLM (#55)
                    const { requestId, documentTypeId, targetSections } = msg.payload ?? {};
                    try {
                        const { resolveLLMConfig, createProvider, findConfigFile, getDocumentType } = await import('@memoarchitect/tools');
                        const { draftDocument } = await import('@memoarchitect/tools');
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
                            const ctx = await scopedQueryContext(config, msg.payload?.workspace);
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
                        const { resolveLLMConfig, createProvider, findConfigFile, serializeModelContext } = await import('@memoarchitect/tools');
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
                            const ctx = await scopedQueryContext(config, msg.payload?.workspace);
                            const modelContext = serializeModelContext(ctx, { includeGaps: true, maxElements: 200 });
                            const provider = createProvider(llmConfig);
                            const result = await provider.complete({
                                messages: [
                                    {
                                        role: 'system',
                                        content: `You are MEMO Completeness Assistant, an expert in medical device systems engineering and SysML v2 modeling. Analyze the provided model and suggest the top 5-8 most impactful next modeling steps to improve completeness and regulatory compliance (ISO 14971, IEC 62304, ISO 13485).

Return ONLY a JSON array of strings. Each string is a concise, actionable suggestion (one sentence). Example format:
["Add RiskControlMeasure elements for 3 unmitigated Hazard elements", "Define VerificationActivity for each TestCase requirement"]`,
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
                } else if (msg.type === 'versions:list') {
                    // The unreleased refs; the releases are read from the model the client already has.
                    const refs = options.versions ? await options.versions.refs() : [];
                    ws.send(JSON.stringify({ type: 'versions:update', payload: { refs } }));
                } else if (msg.type === 'version:open') {
                    const requestId = msg.payload?.requestId;
                    try {
                        if (!options.versions) throw new Error('A pinned view is opened from the working version; open that one first.');
                        const opened = await options.versions.open({ release: msg.payload?.release, ref: msg.payload?.ref });
                        ws.send(JSON.stringify({ type: 'version:ready', payload: { requestId, ...opened } }));
                    } catch (e: any) {
                        ws.send(JSON.stringify({ type: 'version:error', payload: { requestId, error: e?.message ?? String(e) } }));
                    }
                } else if (msg.type === 'impact:compute') {
                    const requestId = msg.payload?.requestId;
                    try {
                        if (!options.impact) throw new Error('Impact is computed from the working version.');
                        ws.send(JSON.stringify({ type: 'impact:result', payload: { requestId, report: await options.impact.compute(msg.payload?.target || undefined) } }));
                    } catch (e: any) {
                        ws.send(JSON.stringify({ type: 'impact:result', payload: { requestId, error: e?.message ?? String(e) } }));
                    }
                } else if (msg.type === 'guide:evaluate') {
                    const requestId = msg.payload?.requestId;
                    try {
                        if (!options.guide) throw new Error('The Guide is not available here.');
                        ws.send(JSON.stringify({ type: 'guide:result', payload: { requestId, ...options.guide.evaluate(msg.payload?.workspace || undefined) } }));
                    } catch (e: any) {
                        ws.send(JSON.stringify({ type: 'guide:result', payload: { requestId, steps: [], methodologies: [], roleViews: [], error: e?.message ?? String(e) } }));
                    }
                } else if (msg.type === 'dhf:device:generate') {
                    const requestId = msg.payload?.requestId;
                    try {
                        if (!options.devices) throw new Error('Documents are generated from the working version.');
                        const result = await options.devices.generate(String(msg.payload?.device ?? ''));
                        ws.send(JSON.stringify({ type: 'dhf:device:result', payload: { requestId, success: true, ...result } }));
                    } catch (e: any) {
                        ws.send(JSON.stringify({ type: 'dhf:device:result', payload: { requestId, success: false, error: e?.message ?? String(e) } }));
                    }
                } else if (msg.type === 'release:diff') {
                    const requestId = msg.payload?.requestId;
                    try {
                        if (!options.versions) throw new Error('Releases are compared from the working version.');
                        const result = await options.versions.diff(String(msg.payload?.release ?? ''), String(msg.payload?.against ?? 'previous'));
                        ws.send(JSON.stringify({ type: 'release:diff:result', payload: { requestId, ...result } }));
                    } catch (e: any) {
                        ws.send(JSON.stringify({ type: 'release:diff:result', payload: { requestId, error: e?.message ?? String(e) } }));
                    }
                } else if (msg.type === 'dashboard:save' || msg.type === 'dashboard:delete' || msg.type === 'dashboard:move') {
                    // Dashboards are presentation, not model source: they are
                    // deliberately absent from MODEL_MUTATION_MESSAGES, so a
                    // typo in the SysML never stops a user writing notes.
                    const p = msg.payload ?? {};
                    try {
                        if (msg.type === 'dashboard:save') {
                            saveDashboard(options.projectRoot, p.dashboard?.scope, p.dashboard?.id, p.dashboard?.content);
                        } else if (msg.type === 'dashboard:delete') {
                            deleteDashboard(options.projectRoot, p.scope, p.id);
                        } else {
                            moveDashboard(options.projectRoot, p.id, p.from, p.to);
                        }
                        ws.send(JSON.stringify({ type: 'dashboard:result', payload: { requestId: p.requestId, ok: true } }));
                        // Answer at once rather than waiting on the watcher's
                        // debounce, so the writer sees its own save immediately.
                        broadcastDashboards();
                    } catch (e: any) {
                        ws.send(JSON.stringify({ type: 'dashboard:result', payload: { requestId: p.requestId, ok: false, error: e?.message ?? String(e) } }));
                    }
                } else if (msg.type === 'user-preferences:save') {
                    // Not model source either: one person's choice, written to a
                    // git-ignored file, and only that person's clients hear it.
                    try {
                        const saved = saveUserPreferences(options.projectRoot, msg.payload ?? {});
                        ws.send(JSON.stringify({ type: 'user-preferences', payload: saved }));
                    } catch (e: any) {
                        console.error('[Preferences] save failed:', e);
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
                } else if (msg.type === 'dhf:template:save') {
                    const { requestId, title, content } = msg.payload ?? {};
                    try {
                        const path = saveRepoTemplate(options.projectRoot, title, content);
                        ws.send(JSON.stringify({ type: 'dhf:template:save:result', payload: { requestId, path } }));
                    } catch (e: any) {
                        ws.send(JSON.stringify({ type: 'dhf:template:save:result', payload: { requestId, error: e?.message ?? String(e) } }));
                    }
                } else if (msg.type === 'ontology:remove') {
                    // Remove an installed ontology package
                    const { projectRoot } = options;
                    const pkgName = msg.payload?.packageName;
                    if (!pkgName) {
                        ws.send(JSON.stringify({ type: 'ontology:remove:result', payload: { success: false, packageName: '', error: 'No package name' } }));
                    } else {
                        try {
                            const shortName = pkgName.replace('@memoarchitect/', '');
                            const memoPkgsPath = resolve(projectRoot, 'memo_packages', shortName);
                            if (existsSync(memoPkgsPath)) {
                                const { rmSync } = await import('node:fs');
                                rmSync(memoPkgsPath, { recursive: true, force: true });
                            }
                            // Refresh and broadcast
                            const packages = options.packageMetadata?.() ?? [];
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
        };
        // Every write is made from a read of the file it writes, with the compiler
        // between the two, so two writes in flight would each start from the text
        // before the other and one would be lost. They run one at a time, in the
        // order they arrived. A layout message names the whole layout of its
        // diagram, so one that a newer message for the same diagram has overtaken
        // is dropped rather than written.
        ws.on('message', (data: any) => {
            let type: string | undefined;
            let layoutOf: string | undefined;
            try {
                const parsed = JSON.parse(data.toString());
                type = parsed?.type;
                if (type === 'diagram:layout:update') layoutOf = String(parsed?.payload?.diagramId);
            } catch { /* the handler reports a message that does not parse */ }
            if (!type || !isModelMutationMessage(type)) { void handleMessage(data); return; }
            const seq = layoutOf === undefined ? 0 : (latestLayoutMessage.get(layoutOf) ?? 0) + 1;
            if (layoutOf !== undefined) latestLayoutMessage.set(layoutOf, seq);
            const run = mutationQueue.then(() =>
                layoutOf !== undefined && latestLayoutMessage.get(layoutOf) !== seq ? undefined : handleMessage(data));
            mutationQueue = run.then(() => undefined, () => undefined);
        });
    });

    // Start listening
    await new Promise<void>((resolve) => {
        server.listen(port, host, () => resolve());
    });

    const address = server.address();
    return {
        port: typeof address === 'object' && address ? address.port : port,
        broadcast(messages: ServerMessage[], changedSourceIds: readonly string[] = []) {
            // Update initial messages for new connections
            const baseRevision = workspaceRevision;
            workspaceRevision++;
            const publication = stampWorkspace(messages, baseRevision, false, changedSourceIds);
            // A published model carries its own identities; the write-back's
            // provisional index has been superseded.
            writeBackIndex = undefined;
            initialMessages.length = 0;
            initialMessages.push(...publication);

            for (const client of clients) {
                if (client.readyState === 1) { // WebSocket.OPEN
                    for (const msg of publication) {
                        client.send(JSON.stringify(msg));
                    }
                }
            }
        },
        notify(messages: ServerMessage[]) {
            for (const client of clients) {
                if (client.readyState === 1) {
                    for (const msg of messages) client.send(JSON.stringify(msg));
                }
            }
        },
        refreshLayouts(files: readonly string[]) {
            const wanted = new Set(files.map(file => file.replaceAll('\\', '/')));
            const diagrams = currentDiagrams().filter(d => d.sourceFile && wanted.has(d.sourceFile.replaceAll('\\', '/')));
            const layouts = loadViewLayouts(options.projectRoot, diagrams);
            // A diagram whose statements are all gone is sent as an empty layout,
            // or the clients would keep the one they had.
            for (const diagram of diagrams) layouts[diagram.id] ??= { nodes: {}, edges: {} };
            if (Object.keys(layouts).length === 0) return;
            const message = JSON.stringify({ type: 'diagram:layout', payload: { layouts } });
            for (const client of clients) if (client.readyState === 1) client.send(message);
        },
        consumeWriteTransactions(files: readonly string[]) {
            const matched: Record<string, string> = {};
            let escalationFile: string | undefined;
            for (const file of files) {
                const normalized = file.replaceAll('\\', '/');
                const transaction = writeTransactions.get(normalized);
                if (!transaction) continue;
                const path = resolve(options.projectRoot, normalized);
                const currentHash = existsSync(path) ? fileRevision(readFileSync(path, 'utf8')) : '';
                if (currentHash === transaction.hash) {
                    matched[normalized] = transaction.id;
                    writeTransactions.delete(normalized);
                    continue;
                }
                transaction.unmatchedWrites++;
                if (Date.now() - transaction.createdAt > 5000) {
                    writeTransactions.delete(normalized);
                } else if (transaction.unmatchedWrites >= 2) {
                    escalationFile = normalized;
                    writeTransactions.delete(normalized);
                }
            }
            return { matched, escalationFile };
        },
        lockMutations(message: RestartRequiredMessage) {
            mutationLockout = message;
            for (const client of clients) {
                if (client.readyState === 1) client.send(JSON.stringify(message));
            }
        },
        setSourceCoherence(payload: SourceCoherenceMessage['payload']) {
            const message: SourceCoherenceMessage = { type: 'source:coherence', payload };
            // Recovery is announced once, not on every clean rebuild after it —
            // a coherent project is the ordinary case and says nothing.
            if (payload.coherent && !sourceIncoherence) return;
            sourceIncoherence = payload.coherent ? undefined : message;
            for (const client of clients) {
                if (client.readyState === 1) client.send(JSON.stringify(message));
            }
        },
        close() {
            dashboardWatcher.close();
            wss.close();
            viteServer?.close();
            server.close();
        },
    };
}
