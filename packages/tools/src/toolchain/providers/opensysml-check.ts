// ─── OpenSysML: is this edit valid SysML? ────────────────────────────────────
//
// An authoring write is compiled before it reaches disk
// (plans/memo-write-back-from-handoff.md). OpenSysML's service takes a
// document's text in place of its path (`content`), so the edited file is
// sent as text and every other document by path: no scratch copy of the
// project, and no conversion or stage 2, since the verdict is all a write
// needs. Measured on temperature-alarm: a stage 1 compile with conversion and
// stage 2 took about 2.5 s; a content parse on a live service takes about
// 0.5 s.
//
// The service process is kept for the session and closed once it has been
// idle a while, so a run of edits pays for starting it once.
// ─────────────────────────────────────────────────────────────────────────────

import { resolve } from 'node:path';
import type { MEMOConfig } from '../../model/config.js';
import { discoverProjectSources } from '../../model/native-project.js';
import { findSysmlFiles } from '../../model/sysml-files.js';
import type { Diagnostic } from '../diagnostic.js';
import { OPENSYSML_DISPLAY_NAME, OPENSYSML_PROVIDER_ID } from './opensysml-names.js';
import { connectOpenSysML, openSysMLSettingsKey, toDiagnostic, type OpenSysMLConnection } from './opensysml.js';

/** How long an idle service is kept before it is closed. */
const IDLE_MS = 60_000;

interface Shared { key: string; connection: Promise<OpenSysMLConnection>; timer?: NodeJS.Timeout; active: number }

let shared: Shared | undefined;

/** Start the idle clock. It closes the service only when no call is running: a compile's Convert can outlast IDLE_MS. */
function armIdleTimer(current: Shared): void {
    if (current.timer) clearTimeout(current.timer);
    current.timer = setTimeout(() => { if (shared === current && current.active === 0) closeSharedOpenSysMLConnection(); }, IDLE_MS);
    current.timer.unref();
}

/** Run `call`, counting it as in flight until it settles, then restart the idle clock. */
function trackCall<A extends unknown[], R>(current: Shared, self: object, call: (...args: A) => R): (...args: A) => R {
    return (...args: A): R => {
        current.active += 1;
        const done = () => { current.active -= 1; if (shared === current) armIdleTimer(current); };
        let result: R;
        try {
            result = call.apply(self, args);
        } catch (error) {
            done();
            throw error;
        }
        if (result && typeof (result as { then?: unknown }).then === 'function') {
            return (result as unknown as Promise<unknown>).finally(done) as unknown as R;
        }
        done();
        return result;
    };
}

/** The same object with each of its functions counted as a call in flight; `close` is left alone. */
function tracked<T extends object>(current: Shared, target: T): T {
    return new Proxy(target, {
        get(object, property) {
            const value = Reflect.get(object, property, object) as unknown;
            if (property === 'close') return value;
            if (property === 'rpc' && value && typeof value === 'object') return tracked(current, value);
            return typeof value === 'function' ? trackCall(current, object, value as (...args: unknown[]) => unknown) : value;
        },
    });
}

/** The session's OpenSysML service, started on first use and closed once idle. */
export async function sharedOpenSysMLConnection(config: MEMOConfig): Promise<OpenSysMLConnection> {
    const key = openSysMLSettingsKey(config);
    if (shared && shared.key !== key) closeSharedOpenSysMLConnection();
    if (!shared) {
        const connection = connectOpenSysML(config);
        shared = { key, connection, active: 0 };
        connection.catch(() => { if (shared?.connection === connection) shared = undefined; });
    }
    const current = shared;
    armIdleTimer(current);
    return tracked(current, await current.connection);
}

/** Close the session's service; the next call starts another. */
export function closeSharedOpenSysMLConnection(): void {
    const closing = shared;
    shared = undefined;
    if (closing?.timer) clearTimeout(closing.timer);
    void closing?.connection.then(connection => connection.close()).catch(() => undefined);
}

/**
 * The documents a resolved compile reads: every library root a locator
 * offers, and the project's own files — the set `compileResolvedProject`
 * gives stage 1.
 */
export function resolvedCompileDocuments(projectRoot: string): string[] {
    const sources = discoverProjectSources(projectRoot);
    const libraryDirs = [...new Set(sources.libraryRoots.map(root => root.sysmlDir))];
    const libraryFiles = libraryDirs.flatMap(dir => findSysmlFiles(dir)).map(file => resolve(file));
    return [...new Set([...libraryFiles, ...sources.projectFiles.map(file => resolve(file))])];
}

/**
 * Stage 1's verdict on the project with some files' text replaced: the error
 * diagnostics, empty when OpenSysML accepts it. `content` is keyed by
 * absolute path; a path the project does not have yet is added.
 */
export async function checkWithOpenSysML(
    config: MEMOConfig, projectRoot: string, content: ReadonlyMap<string, string>,
): Promise<Diagnostic[]> {
    const documents = resolvedCompileDocuments(projectRoot);
    for (const file of content.keys()) if (!documents.includes(file)) documents.push(file);
    const connection = await sharedOpenSysMLConnection(config);
    const version = connection.info?.version;
    let parsed;
    try {
        parsed = await connection.rpc.parseSources({
            documents: documents.map(file => {
                const text = content.get(file);
                return text === undefined
                    ? { source: { case: 'filePath' as const, value: file } }
                    : { source: { case: 'content' as const, value: text }, name: file };
            }),
        });
    } catch (error) {
        // A service that died is not kept for the next edit.
        closeSharedOpenSysMLConnection();
        throw error;
    }
    const diagnostics = parsed.diagnostics.map(d => toDiagnostic(d, version)).filter(d => d.severity === 'error');
    if (parsed.error) {
        diagnostics.push({ domain: 'sysml', provider: OPENSYSML_PROVIDER_ID, providerVersion: version, severity: 'error', message: parsed.error });
    }
    return diagnostics;
}

/** The capability that lets an edit follow references into the model's other documents. */
const EDIT_DOCUMENTS = 'edit_documents';

/** What renaming a declaration across the project came to. */
export type RenameOutcome =
    /** The service rewrote these documents (absolute path to text): the declaration and every reference to it. */
    | { documents: Map<string, string> }
    /** The service refused, or cannot do it; the declaration alone can be renamed, by hand. */
    | { refused: string };

/**
 * Rename a declaration and every reference to it, in every document of the
 * project. `content` is the project's documents whose text differs from disk
 * (absolute path), `target` the declaration's qualified name, `file` the
 * document that declares it. Refused for a library target, for a reference the
 * service cannot rewrite, and by a service without `edit_documents`.
 */
export async function renameWithOpenSysML(
    config: MEMOConfig, projectRoot: string, content: ReadonlyMap<string, string>,
    file: string, target: string, newName: string,
): Promise<RenameOutcome> {
    const connection = await sharedOpenSysMLConnection(config);
    if (!connection.info?.has?.(EDIT_DOCUMENTS) || !connection.edit || !connection.applyEdits) {
        return { refused: `${OPENSYSML_DISPLAY_NAME} ${connection.info?.version ?? ''} cannot edit across documents`.replace('  ', ' ') };
    }
    const documents = resolvedCompileDocuments(projectRoot);
    for (const path of content.keys()) if (!documents.includes(path)) documents.push(path);
    try {
        const parsed = await connection.rpc.parseSources({
            documents: documents.map(path => {
                const text = content.get(path);
                return text === undefined
                    ? { source: { case: 'filePath' as const, value: path } }
                    : { source: { case: 'content' as const, value: text }, name: path };
            }),
        });
        if (parsed.error || parsed.diagnostics.some(d => d.severity === 'error')) {
            return { refused: parsed.error ?? 'the project does not compile' };
        }
        const editor = connection.edit(parsed.modelHash);
        editor.rename(target, newName);
        // The document is named explicitly: left out, the model's first is edited, and a target
        // declared in another is refused as not in the model's source.
        const edited = await connection.applyEdits!(parsed.modelHash, editor.operations, { acceptDocuments: true, document: file });
        return { documents: new Map(edited.documents.map(d => [d.name, d.content] as const)) };
    } catch (error) {
        // A refusal is the service's answer (a library target, a reference in a
        // document it cannot rewrite); anything else is a service that died.
        const referrers = (error as { referringElements?: string[] }).referringElements;
        if (referrers !== undefined || (error as { failure?: unknown }).failure !== undefined) {
            return { refused: error instanceof Error ? error.message : String(error) };
        }
        closeSharedOpenSysMLConnection();
        throw error;
    }
}
