import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { DiagramDTO, DiagramLayout } from '@memoarchitect/tools';
import type { OutlineSource } from '../authoring/outline-source.js';
import {
    importsLayoutPackage, layoutToStatements, readFileLayouts, replaceViewLayout, scanViewLayouts, stripLayout, type Canvas,
} from '../model/view-layout-block.js';
import { atomicWrite, commitSource } from './persistor.js';

// ─── Where a view's layout lives ─────────────────────────────────────────────
//
// In the view. `@MemoLayout…` statements inside the `view` declaration
// (`model/view-layout-block.ts` reads and writes them), so a layout is reviewed,
// diffed, compiled and pinned with the view it belongs to. It used to be a
// `.viewlayout` companion beside the file, which none of those could see.
//
// A diagram that is not a declared view has nowhere to keep a layout and keeps
// none: it is laid out automatically each time. That is deliberate. A hidden
// store for the diagrams that were never declared is the same split this
// replaced.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Whether a layout says anything the model does not already say: a moved node,
 * a routed connector, a note, or a canvas setting the user changed. A layout
 * that holds none is not worth a statement — the view draws identically without.
 */
export function isDefaultViewLayout(layout: DiagramLayout): boolean {
    if (Object.keys(layout.nodes ?? {}).length > 0) return false;
    if (Object.values(layout.edges ?? {}).some(edge => Object.keys(edge).length > 0)) return false;
    if (Object.keys(layout.annotations ?? {}).length > 0) return false;
    const canvas = layout.canvas as Canvas | undefined;
    if (!canvas) return true;
    return canvas.autoLayout !== false
        && Object.keys(canvas.portWalls ?? {}).length === 0
        && canvas.grid === undefined
        && canvas.snap === undefined
        && canvas.coordinateSpace === undefined
        && canvas.layout === undefined;
}

/**
 * Every declared view's saved layout, keyed by diagram id, re-keying node
 * entries whose id the model no longer uses.
 *
 * A layout written before element ids were qualified keys its nodes by the
 * short name that was then an id — `coffeeMachine`, not
 * `Kitchen::coffeeMachine`. Without `resolveNodeId` those entries match no node
 * and every hand-placed box silently returns to automatic placement. Ports are
 * unaffected: they are nested under their owner and keyed by the name the
 * source declares. The remap is read-only; the next save writes the new spelling.
 */
export function loadViewLayouts(
    projectRoot: string,
    diagrams: DiagramDTO[],
    resolveNodeId?: (savedId: string) => string | undefined,
): Record<string, DiagramLayout> {
    const byFile = new Map<string, Record<string, DiagramLayout>>();
    const layouts: Record<string, DiagramLayout> = {};
    for (const diagram of diagrams) {
        if (!diagram.sourceFile || !diagram.elementId) continue;
        let fileLayouts = byFile.get(diagram.sourceFile);
        if (!fileLayouts) {
            const path = resolve(projectRoot, diagram.sourceFile);
            fileLayouts = existsSync(path) ? readFileLayouts(readFileSync(path, 'utf8')) : {};
            byFile.set(diagram.sourceFile, fileLayouts);
        }
        const layout = fileLayouts[diagram.elementId];
        if (layout) layouts[diagram.id] = resolveNodeId ? withResolvedNodes(layout, resolveNodeId) : layout;
    }
    return layouts;
}

export interface ViewLayoutSave {
    success: boolean;
    /** Why the layout was not written. Never a reason to write it elsewhere. */
    reason?: string;
    /** The source file written, when the layout changed. */
    filePath?: string;
    /** False when the file already said exactly this. */
    changed?: boolean;
}

/**
 * Write a diagram's layout into the `view` that declares it. A layout that
 * holds nothing removes the view's statements. The compiler checks the result
 * before it reaches disk, like every other write.
 */
export async function saveViewLayout(
    projectRoot: string, diagram: DiagramDTO, layout: DiagramLayout, outlines: OutlineSource,
): Promise<ViewLayoutSave> {
    if (!diagram.sourceFile || !diagram.elementId) {
        return { success: false, reason: `"${diagram.name}" is not a declared view, so it has no place to keep a layout` };
    }
    const absolute = resolve(projectRoot, diagram.sourceFile);
    if (!existsSync(absolute)) return { success: false, reason: `${diagram.sourceFile} does not exist` };
    const text = readFileSync(absolute, 'utf8');
    const updated = replaceViewLayout(text, diagram.elementId, isDefaultViewLayout(layout) ? null : layout);
    if (updated === undefined) {
        return { success: false, reason: `${diagram.elementId} was not found in ${diagram.sourceFile}` };
    }
    if (updated === text) return { success: true, changed: false };
    // The compiler checks a write that adds something it must resolve: the import.
    // A write that only replaces layout statements in a file that already has it
    // is checked here instead, because the statements come from a closed
    // generator over sanitised values and a whole-project compile on every drag
    // is not a price worth paying for a check this narrow can make: nothing but
    // the view's own statements changed, and they read back as written.
    if (!importsLayoutPackage(text) || !onlyThisViewChanged(text, updated, diagram.elementId, layout)) {
        const committed = await commitSource(absolute, diagram.sourceFile, updated, outlines);
        if (!committed.success) return { success: false, reason: committed.error };
        return { success: true, filePath: diagram.sourceFile, changed: true };
    }
    try {
        atomicWrite(absolute, updated);
    } catch (e) {
        return { success: false, reason: `Could not write ${diagram.sourceFile}: ${String(e)}` };
    }
    return { success: true, filePath: diagram.sourceFile, changed: true };
}

/** Whether `updated` differs from `text` only in the layout statements of `viewId`, and states what `layout` says. */
function onlyThisViewChanged(text: string, updated: string, viewId: string, layout: DiagramLayout): boolean {
    if (stripLayout(updated) !== stripLayout(text)) return false;
    const view = scanViewLayouts(updated).find(candidate => candidate.id === viewId);
    if (!view) return false;
    const wanted = isDefaultViewLayout(layout) ? 0 : layoutToStatements(layout, '').length;
    return view.statements.length === wanted;
}

/** A copy of `layout` whose node keys are the ids the current model uses. */
function withResolvedNodes(
    layout: DiagramLayout,
    resolveNodeId: (savedId: string) => string | undefined,
): DiagramLayout {
    const nodes: DiagramLayout['nodes'] = {};
    let changed = false;
    for (const [savedId, node] of Object.entries(layout.nodes ?? {})) {
        const resolved = resolveNodeId(savedId) ?? savedId;
        if (resolved !== savedId) changed = true;
        // A saved id that resolves onto one already present loses: the entry
        // written under the current spelling is the more recent of the two.
        nodes[resolved] = nodes[resolved] ?? node;
    }
    return changed ? { ...layout, nodes } : layout;
}
