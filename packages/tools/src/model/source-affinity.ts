// ─── Source Affinity ──────────────────────────────────────────────────────────
//
// "Does this file change affect what I am showing?"
//
// Pure DTO reasoning over the source graph shipped with the model, so the same
// answer is available in the browser (an open editor, a rendered view, an
// element inspector) as on the server. Building the graph needs the parser;
// consuming it does not — that split is what lets these live in the browser
// entrypoint.
// ─────────────────────────────────────────────────────────────────────────────

import type { SourceGraphDTO } from './semantic.js';

/** Empty graph, so callers can ask before the model has arrived. */
const EMPTY_GRAPH: SourceGraphDTO = { dependsOn: {} };

/**
 * Every file whose change can alter what `file` means: the file itself plus
 * everything it imports, transitively.
 */
export function affectingFiles(file: string, graph?: SourceGraphDTO): Set<string> {
    return new Set([file, ...((graph ?? EMPTY_GRAPH).dependsOn[file] ?? [])]);
}

/**
 * Whether any changed file is one the given files depend on.
 *
 * `dependencies` is the already-expanded closure — a view's `sourceFiles`, or
 * the result of `affectingFiles` for a single file. An empty closure never
 * matches: a surface that cannot state what it depends on should not claim
 * every change as its own.
 */
export function changeAffects(
    changedFiles: readonly string[],
    dependencies: Iterable<string>,
): boolean {
    const watched = dependencies instanceof Set ? dependencies : new Set(dependencies);
    if (watched.size === 0) return false;
    return changedFiles.some(file => watched.has(file));
}

/**
 * The subset of `changedFiles` the dependency closure actually covers, for
 * telling the user which file moved rather than only that something did.
 */
export function affectedBy(
    changedFiles: readonly string[],
    dependencies: Iterable<string>,
): string[] {
    const watched = dependencies instanceof Set ? dependencies : new Set(dependencies);
    return changedFiles.filter(file => watched.has(file));
}
