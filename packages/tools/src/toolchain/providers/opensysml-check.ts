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
import { OPENSYSML_PROVIDER_ID } from './opensysml-names.js';
import { connectOpenSysML, openSysMLSettingsKey, toDiagnostic, type OpenSysMLConnection } from './opensysml.js';

/** How long an idle service is kept before it is closed. */
const IDLE_MS = 60_000;

let shared: { key: string; connection: Promise<OpenSysMLConnection>; timer?: NodeJS.Timeout } | undefined;

/** The session's OpenSysML service, started on first use and closed once idle. */
export async function sharedOpenSysMLConnection(config: MEMOConfig): Promise<OpenSysMLConnection> {
    const key = openSysMLSettingsKey(config);
    if (shared && shared.key !== key) closeSharedOpenSysMLConnection();
    if (!shared) {
        const connection = connectOpenSysML(config);
        shared = { key, connection };
        connection.catch(() => { if (shared?.connection === connection) shared = undefined; });
    }
    const current = shared;
    if (current.timer) clearTimeout(current.timer);
    current.timer = setTimeout(() => { if (shared === current) closeSharedOpenSysMLConnection(); }, IDLE_MS);
    current.timer.unref();
    return current.connection;
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
