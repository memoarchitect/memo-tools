import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { basename, dirname, resolve } from 'node:path';
import { parse, stringify } from 'yaml';
import type { DiagramDTO, DiagramLayout } from '@memoarchitect/tools';

export const VIEW_LAYOUT_EXTENSION = '.viewlayout';

interface SysmlViewLayoutArtifact {
    format: 'memo.viewlayout/v2' | 'memo.viewlayout/v1';
    viewSource?: string;
    layouts: Record<string, DiagramLayout>;
}

const safeId = (id: string): string => id.replace(/[^a-zA-Z0-9._-]/g, '_');

/** Companion location beside the SysML file that defines the view. */
export function viewLayoutPath(projectRoot: string, diagram: DiagramDTO): string {
    if (diagram.sourceFile) {
        const source = resolve(projectRoot, diagram.sourceFile);
        const stem = basename(source).replace(/\.sysml$/i, '');
        return resolve(dirname(source), `${stem}${VIEW_LAYOUT_EXTENSION}`);
    }
    return resolve(projectRoot, '.memo', 'views', `${safeId(diagram.id)}${VIEW_LAYOUT_EXTENSION}`);
}

function legacyLayoutPath(projectRoot: string, diagramId: string): string {
    return resolve(projectRoot, '.memo', 'layouts', `${diagramId}.yaml`);
}

export function loadViewLayout(projectRoot: string, diagram: DiagramDTO): DiagramLayout | null {
    const companion = viewLayoutPath(projectRoot, diagram);
    if (existsSync(companion)) {
        try {
            const artifact = parse(readFileSync(companion, 'utf8')) as SysmlViewLayoutArtifact & {
                format: string; diagramId?: string; layout?: DiagramLayout;
            };
            if (artifact.format === 'memo.viewlayout/v2' || artifact.format === 'memo.viewlayout/v1' || artifact.format === 'memo.sysmlview/v2') return artifact.layouts?.[diagram.id] ?? null;
            if (artifact.format === 'memo.sysmlview/v1' && artifact.diagramId === diagram.id) return artifact.layout ?? null;
        } catch { /* malformed companion is ignored */ }
    }
    // Read-only compatibility with the previous hidden YAML sidecar. Saving
    // writes the new companion, providing migration without destructive moves.
    const legacy = legacyLayoutPath(projectRoot, diagram.id);
    if (!existsSync(legacy)) return null;
    try { return parse(readFileSync(legacy, 'utf8')) as DiagramLayout; } catch { return null; }
}

/**
 * Whether a layout says anything the model does not already say: a moved node,
 * a routed connector, or a canvas setting the user changed. A companion exists
 * to record overrides, so a layout that holds none is not worth a file — the
 * view renders identically without it.
 */
export function isDefaultViewLayout(layout: DiagramLayout): boolean {
    if (Object.keys(layout.nodes ?? {}).length > 0) return false;
    if (Object.keys(layout.edges ?? {}).length > 0) return false;
    if (Object.keys(layout.annotations ?? {}).length > 0) return false;
    const canvas = layout.canvas;
    if (!canvas) return true;
    // Automatic layout and still connectors are the defaults; every other
    // canvas field is unset until the user sets it.
    return canvas.autoLayout !== false
        && canvas.flowAnimation !== true
        && Object.keys(canvas.portWalls ?? {}).length === 0
        && canvas.zoom === undefined
        && canvas.pan === undefined
        && canvas.grid === undefined
        && canvas.snap === undefined;
}

/** Existing companion entries, keyed by diagram id; empty for a new file. */
function readViewLayouts(path: string): Record<string, DiagramLayout> {
    if (!existsSync(path)) return {};
    try {
        const existing = parse(readFileSync(path, 'utf8')) as Partial<SysmlViewLayoutArtifact> & {
            format?: string; diagramId?: string; layout?: DiagramLayout;
        };
        if (existing.format === 'memo.viewlayout/v2' || existing.format === 'memo.viewlayout/v1' || existing.format === 'memo.sysmlview/v2') return existing.layouts ?? {};
        if (existing.diagramId && existing.layout) return { [existing.diagramId]: existing.layout };
    } catch { /* replace malformed companion */ }
    return {};
}

/**
 * Persist a diagram's overrides beside its SysML source. Returns the companion
 * path, or null when there was nothing to persist — a layout that carries no
 * override drops its entry instead, and the companion is removed once it holds
 * no entries at all, so a purely visual toggle never dirties the project.
 */
export function saveViewLayout(projectRoot: string, diagram: DiagramDTO, layout: DiagramLayout): string | null {
    const path = viewLayoutPath(projectRoot, diagram);
    const existingLayouts = readViewLayouts(path);

    if (isDefaultViewLayout(layout)) {
        if (!(diagram.id in existingLayouts)) {
            if (existsSync(path) && Object.keys(existingLayouts).length === 0) rmSync(path, { force: true });
            return null;
        }
        const remaining = { ...existingLayouts };
        delete remaining[diagram.id];
        if (Object.keys(remaining).length === 0) {
            rmSync(path, { force: true });
            return null;
        }
        writeFileSync(path, stringify({
            format: 'memo.viewlayout/v1' as const,
            ...(diagram.sourceFile ? { viewSource: diagram.sourceFile } : {}),
            layouts: remaining,
        }), 'utf8');
        return path;
    }

    mkdirSync(dirname(path), { recursive: true });
    const artifact: SysmlViewLayoutArtifact = {
        // v2 records each node's coordinate frame (`parent`). v1 files still
        // load — a node with no recorded frame is left where it is rather than
        // rebased on a guess — and are rewritten as v2 on the next save.
        format: 'memo.viewlayout/v2',
        ...(diagram.sourceFile ? { viewSource: diagram.sourceFile } : {}),
        layouts: { ...existingLayouts, [diagram.id]: layout },
    };
    writeFileSync(path, stringify(artifact), 'utf8');
    return path;
}

/**
 * Load every diagram's saved layout, re-keying node entries whose id the model
 * no longer uses.
 *
 * A `.viewlayout` written before element ids were qualified keys its nodes by
 * the short name that was then an id — `coffeeMachine`, not
 * `Kitchen::coffeeMachine`. Without `resolveNodeId` those entries match no
 * node, and every hand-placed box in every saved layout silently returns to
 * automatic placement. Ports are unaffected: they are already nested under
 * their owner and keyed by the name the source declares.
 *
 * The remap is read-only. The file is rewritten in the new spelling by the
 * next save, so nothing is migrated destructively and an older MEMO can still
 * read the file until then.
 */
export function loadViewLayouts(
    projectRoot: string,
    diagrams: DiagramDTO[],
    resolveNodeId?: (savedId: string) => string | undefined,
): Record<string, DiagramLayout> {
    const layouts: Record<string, DiagramLayout> = {};
    for (const diagram of diagrams) {
        const layout = loadViewLayout(projectRoot, diagram);
        if (layout) layouts[diagram.id] = resolveNodeId ? withResolvedNodes(layout, resolveNodeId) : layout;
    }
    return layouts;
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
