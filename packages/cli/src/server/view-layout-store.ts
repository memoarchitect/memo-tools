import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, resolve } from 'node:path';
import { parse, stringify } from 'yaml';
import type { DiagramDTO, DiagramLayout } from '@memo/core';

export const VIEW_LAYOUT_EXTENSION = '.viewlayout';

interface SysmlViewLayoutArtifact {
    format: 'memo.viewlayout/v1';
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
            if (artifact.format === 'memo.viewlayout/v1' || artifact.format === 'memo.sysmlview/v2') return artifact.layouts?.[diagram.id] ?? null;
            if (artifact.format === 'memo.sysmlview/v1' && artifact.diagramId === diagram.id) return artifact.layout ?? null;
        } catch { /* malformed companion is ignored */ }
    }
    // Read-only compatibility with the previous hidden YAML sidecar. Saving
    // writes the new companion, providing migration without destructive moves.
    const legacy = legacyLayoutPath(projectRoot, diagram.id);
    if (!existsSync(legacy)) return null;
    try { return parse(readFileSync(legacy, 'utf8')) as DiagramLayout; } catch { return null; }
}

export function saveViewLayout(projectRoot: string, diagram: DiagramDTO, layout: DiagramLayout): string {
    const path = viewLayoutPath(projectRoot, diagram);
    mkdirSync(dirname(path), { recursive: true });
    let existingLayouts: Record<string, DiagramLayout> = {};
    if (existsSync(path)) {
        try {
            const existing = parse(readFileSync(path, 'utf8')) as Partial<SysmlViewLayoutArtifact> & {
                format?: string; diagramId?: string; layout?: DiagramLayout;
            };
            if (existing.format === 'memo.viewlayout/v1' || existing.format === 'memo.sysmlview/v2') existingLayouts = existing.layouts ?? {};
            else if (existing.diagramId && existing.layout) existingLayouts = { [existing.diagramId]: existing.layout };
        } catch { /* replace malformed companion */ }
    }
    const artifact: SysmlViewLayoutArtifact = {
        format: 'memo.viewlayout/v1',
        ...(diagram.sourceFile ? { viewSource: diagram.sourceFile } : {}),
        layouts: { ...existingLayouts, [diagram.id]: layout },
    };
    writeFileSync(path, stringify(artifact), 'utf8');
    return path;
}

export function loadViewLayouts(projectRoot: string, diagrams: DiagramDTO[]): Record<string, DiagramLayout> {
    const layouts: Record<string, DiagramLayout> = {};
    for (const diagram of diagrams) {
        const layout = loadViewLayout(projectRoot, diagram);
        if (layout) layouts[diagram.id] = layout;
    }
    return layouts;
}
