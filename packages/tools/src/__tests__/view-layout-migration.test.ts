import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { DiagramLayout } from '../protocol/messages.js';
import type { DiagramDTO } from '../model/semantic.js';
import { planLayoutMigration, readLegacyLayouts, suggestViewsByContent } from '../model/view-layout-migration.js';

const SOURCE = `package p {
    part machine { part tank; part heater; }
    view machineView : MemoDiagramView { expose machine::**; }
}
`;

const diagram = (id: string, elementIds: string[]): DiagramDTO => ({
    id, name: id, diagramType: 'ibd', viewpointId: 'vp', auto: false,
    sourceFile: 'views.sysml', elementId: `p::${id}`, elementIds,
});

const layout: DiagramLayout = { nodes: { machine: { x: 10, y: 20 }, tank: { x: 1, y: 2 } }, edges: {} };

let root: string | undefined;
afterEach(() => { if (root) rmSync(root, { recursive: true, force: true }); root = undefined; });

function project(): string {
    root = mkdtempSync(join(tmpdir(), 'memo-migrate-'));
    writeFileSync(join(root, 'views.sysml'), SOURCE);
    return root;
}

describe('migrating a sidecar whose diagram id the model has lost', () => {
    const tight = diagram('machineView', ['p::machine', 'p::machine::tank']);
    const loose = diagram('overview', ['p::machine', 'p::machine::tank', 'p::machine::heater', 'p::other']);
    const entry = { sidecar: 'old.viewlayout', diagramId: 'diag-old-name', layout };

    it('suggests the views that hold every positioned element, tightest first', () => {
        expect(suggestViewsByContent([loose, tight], layout).map(g => g.diagram.id)).toEqual(['machineView', 'overview']);
        expect(suggestViewsByContent([diagram('x', ['p::machine'])], layout)).toEqual([]);
    });

    it('reports the suggestion and does not apply it', () => {
        const plan = planLayoutMigration(project(), [loose, tight], [entry]);
        const outcome = plan.outcomes[0];
        expect(outcome.kind).toBe('no-view');
        expect(outcome.kind === 'no-view' && outcome.reason).toContain('--map diag-old-name=<view id>');
        expect(plan.rewrites.size).toBe(0);
        expect(plan.removable).toEqual([]);
    });

    it('applies it when the caller names the view', () => {
        const plan = planLayoutMigration(project(), [loose, tight], [entry], { 'diag-old-name': 'machineView' });
        expect(plan.outcomes[0].kind).toBe('migrated');
        expect(plan.rewrites.get('views.sysml')).toContain('@MemoLayoutNode');
        expect(plan.removable).toEqual(['old.viewlayout']);
    });

    it('takes a view name for --map and suggests a view of the old name', () => {
        const named = { ...diagram('machineView', ['p::machine', 'p::machine::tank']), name: 'Machine' };
        const byName = planLayoutMigration(project(), [named], [entry], { 'diag-old-name': 'Machine' });
        expect(byName.outcomes[0].kind).toBe('migrated');
        const renamed = { sidecar: 'old.viewlayout', diagramId: 'diag-sample-Machine', layout };
        const suggested = planLayoutMigration(project(), [named], [renamed]).outcomes[0];
        expect(suggested.kind === 'no-view' && suggested.reason).toContain('a view is named "Machine"');
    });

    it('refuses a mapping to something that is not a view', () => {
        const plan = planLayoutMigration(project(), [tight], [entry], { 'diag-old-name': 'nothing' });
        const outcome = plan.outcomes[0];
        expect(outcome.kind === 'no-view' && outcome.reason).toContain('--map names nothing');
    });
});

describe('reading legacy sidecars', () => {
    it('reports a sidecar that is not valid YAML instead of skipping it silently', () => {
        const dir = project();
        mkdirSync(join(dir, 'views'));
        writeFileSync(join(dir, 'views', 'bad.viewlayout'), 'format: memo.viewlayout/v1\nlayouts:\n  a:\n    nodes:\n    nodes: {}\n');
        const unreadable: string[] = [];
        expect(readLegacyLayouts(dir, sidecar => unreadable.push(sidecar))).toEqual([]);
        expect(unreadable).toEqual(['views/bad.viewlayout']);
    });
});
