// ─── Moving `.viewlayout` sidecars into their views ─────────────────────────
//
// Until layout moved into the view (`view-layout-block.ts`), a diagram's layout
// was a YAML companion beside the `.sysml` that declares it: `x.viewlayout`
// (format `memo.viewlayout/v1`/`v2`, or the older `memo.sysmlview/v1`/`v2`), or
// the hidden `.memo/layouts/<id>.yaml` and `.memo/views/<id>.viewlayout` of a
// diagram that had no source file. This reads all of them, once, and says
// where each entry belongs. Nothing here writes: the caller decides, so the same
// plan serves a dry run and the real thing.
//
// The runtime no longer reads any of these. A project that has not migrated
// shows its views with automatic layout, and `memo dev` says so.
// ─────────────────────────────────────────────────────────────────────────────

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { parse } from 'yaml';
import type { DiagramLayout } from '../protocol/messages.js';
import type { DiagramDTO } from './semantic.js';
import { isDefaultViewLayout } from '../server/view-layout-store.js';
import { readFileLayouts, replaceViewLayout } from './view-layout-block.js';

export interface LegacyLayoutEntry {
    /** Project-relative path of the sidecar the entry came from. */
    sidecar: string;
    diagramId: string;
    layout: DiagramLayout;
}

const SKIPPED_DIRECTORIES = new Set(['node_modules', '.git', '.worktrees', 'dist', 'lib', 'dhf-output']);

function* walk(directory: string): Generator<string> {
    for (const name of readdirSync(directory)) {
        if (SKIPPED_DIRECTORIES.has(name)) continue;
        const path = join(directory, name);
        const stats = statSync(path);
        if (stats.isDirectory()) {
            // `.memo/` is skipped everywhere but for the two directories that held layouts.
            if (name === '.memo') { yield* hiddenLayouts(path); continue; }
            yield* walk(path);
        } else if (name.endsWith('.viewlayout')) {
            yield path;
        }
    }
}

function* hiddenLayouts(memoDirectory: string): Generator<string> {
    for (const sub of ['views', 'layouts']) {
        const directory = join(memoDirectory, sub);
        if (!existsSync(directory)) continue;
        for (const name of readdirSync(directory)) {
            if (name.endsWith('.viewlayout') || name.endsWith('.yaml')) yield join(directory, name);
        }
    }
}

/** Every layout entry in every legacy sidecar under `projectRoot`. */
export function readLegacyLayouts(
    projectRoot: string, onUnreadable?: (sidecar: string, reason: string) => void,
): LegacyLayoutEntry[] {
    const entries: LegacyLayoutEntry[] = [];
    for (const path of walk(resolve(projectRoot))) {
        const sidecar = relative(projectRoot, path).replaceAll('\\', '/');
        let parsed: Record<string, unknown> | null;
        try {
            parsed = parse(readFileSync(path, 'utf8')) as Record<string, unknown> | null;
        } catch (error) {
            onUnreadable?.(sidecar, (error as Error).message.split('\n')[0]);
            continue;
        }
        if (!parsed || typeof parsed !== 'object') continue;
        const format = parsed.format as string | undefined;
        if (format === 'memo.viewlayout/v2' || format === 'memo.viewlayout/v1' || format === 'memo.sysmlview/v2') {
            for (const [diagramId, layout] of Object.entries((parsed.layouts ?? {}) as Record<string, DiagramLayout>)) {
                entries.push({ sidecar, diagramId, layout });
            }
        } else if (format === 'memo.sysmlview/v1' && typeof parsed.diagramId === 'string') {
            entries.push({ sidecar, diagramId: parsed.diagramId, layout: parsed.layout as DiagramLayout });
        } else if (!format && sidecar.startsWith('.memo/layouts/')) {
            // The hidden YAML store: the file IS the layout, named for its diagram.
            entries.push({ sidecar, diagramId: sidecar.replace(/^.*\//, '').replace(/\.yaml$/, ''), layout: parsed as unknown as DiagramLayout });
        }
    }
    return entries;
}

export type MigrationOutcome =
    | { kind: 'migrated'; entry: LegacyLayoutEntry; file: string; viewId: string }
    | { kind: 'nothing-to-keep'; entry: LegacyLayoutEntry }
    | { kind: 'already-in-view'; entry: LegacyLayoutEntry; file: string; viewId: string }
    | { kind: 'no-view'; entry: LegacyLayoutEntry; reason: string };

export interface MigrationPlan {
    outcomes: MigrationOutcome[];
    /** New text of each file the migration changes, keyed by project-relative path. */
    rewrites: Map<string, string>;
    /** Sidecars every entry of which is accounted for, which the caller may delete. */
    removable: string[];
}

const lastSegment = (id: string): string => id.split('::').pop() ?? id;

/** A view by its id, else by its name or short id (`--map` takes either). */
function viewNamed(diagrams: readonly DiagramDTO[], key: string): DiagramDTO | undefined {
    return diagrams.find(d => d.id === key)
        ?? diagrams.find(d => d.name === key || d.shortId === key || d.id === `diag-sample-${key}`);
}

/**
 * The views that hold every element a legacy layout positions, tightest first
 * (fewest elements beyond the ones it places). An old sidecar keyed its diagram
 * by an id the view has since lost (a renamed view), but its node keys are the
 * elements' own names, which a rename of the view does not touch. Suggested,
 * never applied: the caller decides.
 */
export function suggestViewsByContent(
    diagrams: readonly DiagramDTO[], layout: DiagramLayout,
): { diagram: DiagramDTO; size: number }[] {
    const keys = Object.keys(layout.nodes ?? {});
    if (keys.length === 0) return [];
    return diagrams.filter(d => d.sourceFile && d.elementId).flatMap(diagram => {
        const names = new Set((diagram.elementIds ?? []).map(lastSegment));
        return keys.every(k => names.has(lastSegment(k))) ? [{ diagram, size: names.size }] : [];
    }).sort((x, y) => x.size - y.size);
}

/**
 * Where each legacy entry goes. An entry whose diagram is not a declared view
 * has no home and is reported, not invented one; an entry whose view already
 * carries layout statements is not overwritten. `idMap` names the view for a
 * legacy diagram id the model no longer has (`old id -> view id`).
 */
export function planLayoutMigration(
    projectRoot: string, diagrams: readonly DiagramDTO[], entries: readonly LegacyLayoutEntry[],
    idMap: Readonly<Record<string, string>> = {},
): MigrationPlan {
    const outcomes: MigrationOutcome[] = [];
    const rewrites = new Map<string, string>();
    const textOf = (file: string) => rewrites.get(file) ?? readFileSync(resolve(projectRoot, file), 'utf8');

    for (const entry of entries) {
        const mapped = idMap[entry.diagramId];
        const diagram = mapped !== undefined ? viewNamed(diagrams, mapped) : diagrams.find(d => d.id === entry.diagramId);
        if (!diagram?.sourceFile || !diagram.elementId) {
            let reason = diagram ? `"${diagram.name}" is not a declared view`
                : mapped ? `--map names ${mapped}, which is not a view`
                    : `no view has the id ${entry.diagramId}`;
            if (!diagram) {
                const byName = mapped === undefined ? viewNamed(diagrams, entry.diagramId.replace(/^diag-sample-/, '')) : undefined;
                if (byName) reason += `; a view is named "${byName.name}" (rerun with --map ${entry.diagramId}=${byName.id})`;
                const guesses = suggestViewsByContent(diagrams, entry.layout).filter(g => g.diagram !== byName);
                if (guesses.length > 0) {
                    reason += `; holding all ${Object.keys(entry.layout.nodes).length} of its elements: ${guesses.slice(0, 4).map(g => g.diagram.id).join(', ')}`
                        + ` (rerun with --map ${entry.diagramId}=<view id>)`;
                }
            }
            outcomes.push({ kind: 'no-view', entry, reason });
            continue;
        }
        if (isDefaultViewLayout(entry.layout)) { outcomes.push({ kind: 'nothing-to-keep', entry }); continue; }
        const file = diagram.sourceFile;
        const text = textOf(file);
        if (readFileLayouts(text)[diagram.elementId]) {
            outcomes.push({ kind: 'already-in-view', entry, file, viewId: diagram.elementId });
            continue;
        }
        const updated = replaceViewLayout(text, diagram.elementId, entry.layout);
        if (updated === undefined) {
            outcomes.push({ kind: 'no-view', entry, reason: `${diagram.elementId} was not found in ${file}` });
            continue;
        }
        rewrites.set(file, updated);
        outcomes.push({ kind: 'migrated', entry, file, viewId: diagram.elementId });
    }

    // A sidecar can go once nothing in it is waiting for a home.
    const stranded = new Set(outcomes.filter(o => o.kind === 'no-view').map(o => o.entry.sidecar));
    const removable = [...new Set(entries.map(e => e.sidecar))].filter(sidecar => !stranded.has(sidecar));
    return { outcomes, rewrites, removable };
}
