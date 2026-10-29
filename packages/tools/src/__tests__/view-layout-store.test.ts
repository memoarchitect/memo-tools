import { afterEach, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { DiagramDTO, DiagramLayout } from '@memoarchitect/tools';
import type { OutlineSource } from '../authoring/outline-source.js';
import { isDefaultViewLayout, loadViewLayouts, saveViewLayout } from '../server/view-layout-store.js';
import { layoutBlindRevision } from '../model/view-layout-block.js';

const roots: string[] = [];
afterEach(() => { while (roots.length) rmSync(roots.pop()!, { recursive: true, force: true }); });

const SOURCE = `package coffee {
    view thermal : MemoDiagramView {
        expose heater::**;
    }
    view service : MemoDiagramView {
        expose boiler::**;
    }
}
`;
const FILE = 'model/views/thermal.sysml';

/** The compiler is not under test here; a refusing one is, in the last case. */
const accepting: OutlineSource = { outline: async () => { throw new Error('unused'); }, verify: async () => undefined };
const refusing: OutlineSource = { outline: accepting.outline, verify: async () => { throw new Error('nope'); } };

const project = () => {
    const root = mkdtempSync(join(tmpdir(), 'memo-view-layout-')); roots.push(root);
    mkdirSync(join(root, 'model/views'), { recursive: true });
    writeFileSync(join(root, FILE), SOURCE);
    return root;
};
const diagram = (name = 'thermal'): DiagramDTO => ({
    id: `view-${name}`, name, diagramType: 'ibd', viewpointId: '__model', auto: false,
    sourceFile: FILE, elementId: `coffee::${name}`,
} as DiagramDTO);
const layout: DiagramLayout = {
    nodes: { heater: { x: 120, y: 80, width: 220, height: 140, ports: { out: { x: 210, y: 62, side: 'right' } } } },
    edges: {}, canvas: { zoom: 0.9, pan: { x: 20, y: 30 } },
};

describe('a view\'s layout lives in the view', () => {
    it('saves into the declaring view and loads it back, camera excepted', async () => {
        const root = project();
        const saved = await saveViewLayout(root, diagram(), layout, accepting);
        expect(saved).toMatchObject({ success: true, changed: true, filePath: FILE });
        const text = readFileSync(join(root, FILE), 'utf8');
        expect(text).toContain('@MemoLayoutNode { :>> element = "heater"');
        const loaded = loadViewLayouts(root, [diagram(), diagram('service')]);
        expect(loaded['view-thermal'].nodes.heater).toMatchObject({ x: 120, y: 80, ports: { out: { side: 'right' } } });
        expect(loaded['view-thermal'].canvas?.zoom).toBeUndefined();
        expect(loaded['view-service']).toBeUndefined();
    });

    it('moving a symbol changes no line of the model, and the file keeps its semantic revision', async () => {
        const root = project();
        await saveViewLayout(root, diagram(), layout, accepting);
        const first = readFileSync(join(root, FILE), 'utf8');
        // the first save also adds the import the statements need; after that a drag leaves the revision alone
        const before = layoutBlindRevision(first);
        await saveViewLayout(root, diagram(), { ...layout, nodes: { heater: { x: 999, y: 1 } } }, accepting);
        const after = readFileSync(join(root, FILE), 'utf8');
        expect(after).not.toBe(first);
        expect(layoutBlindRevision(after)).toBe(before);
        expect(after.replace(/^\s*@MemoLayout.*\n/gm, '').replace(/^\s*private import memo_viewpoints_definitions_layout::\*;\n/m, '')).toBe(SOURCE);
    });

    it('says nothing changed when the file already states the layout', async () => {
        const root = project();
        await saveViewLayout(root, diagram(), layout, accepting);
        expect(await saveViewLayout(root, diagram(), layout, accepting)).toMatchObject({ success: true, changed: false });
    });

    it('writes no statement for a layout that overrides nothing, and removes the last one', async () => {
        const root = project();
        expect(await saveViewLayout(root, diagram(), { nodes: {}, edges: {}, canvas: { flowAnimation: false } }, accepting))
            .toMatchObject({ success: true, changed: false });
        expect(readFileSync(join(root, FILE), 'utf8')).toBe(SOURCE);
        await saveViewLayout(root, diagram(), layout, accepting);
        expect(await saveViewLayout(root, diagram(), { nodes: {}, edges: {} }, accepting)).toMatchObject({ changed: true });
        expect(readFileSync(join(root, FILE), 'utf8').replace(/^\s*private import memo_viewpoints_definitions_layout::\*;\n/m, '')).toBe(SOURCE);
    });

    it('keeps a canvas setting the user actually changed', () => {
        for (const canvas of [{ autoLayout: false }, { grid: 20 }, { snap: true }, { portWalls: { p: 'left' as const } }]) {
            expect(isDefaultViewLayout({ nodes: {}, edges: {}, canvas })).toBe(false);
        }
        expect(isDefaultViewLayout({ nodes: {}, edges: {}, canvas: { autoLayout: true } })).toBe(true);
    });

    it('keeps a sibling view\'s layout when one view is cleared', async () => {
        const root = project();
        await saveViewLayout(root, diagram(), layout, accepting);
        await saveViewLayout(root, diagram('service'), { nodes: { boiler: { x: 10, y: 20 } }, edges: {} }, accepting);
        await saveViewLayout(root, diagram(), { nodes: {}, edges: {} }, accepting);
        const loaded = loadViewLayouts(root, [diagram(), diagram('service')]);
        expect(loaded['view-thermal']).toBeUndefined();
        expect(loaded['view-service'].nodes.boiler).toMatchObject({ x: 10, y: 20 });
    });

    it('has nowhere to keep the layout of a diagram that is not a declared view', async () => {
        const root = project();
        const undeclared = { ...diagram(), sourceFile: undefined, elementId: undefined } as DiagramDTO;
        expect(await saveViewLayout(root, undeclared, layout, accepting)).toMatchObject({ success: false });
        expect(await saveViewLayout(root, { ...diagram(), elementId: 'coffee::gone' }, layout, accepting))
            .toMatchObject({ success: false });
    });

    it('leaves the file alone when the compiler refuses the result', async () => {
        const root = project();
        expect(await saveViewLayout(root, diagram(), layout, refusing)).toMatchObject({ success: false });
        expect(readFileSync(join(root, FILE), 'utf8')).toBe(SOURCE);
    });

    it('re-keys nodes saved under a short name', async () => {
        const root = project();
        await saveViewLayout(root, diagram(), layout, accepting);
        const loaded = loadViewLayouts(root, [diagram()], id => id === 'heater' ? 'coffee::heater' : undefined);
        expect(Object.keys(loaded['view-thermal'].nodes)).toEqual(['coffee::heater']);
    });

    it('re-keys a port saved under its declared name to the id the canvas looks up', async () => {
        const root = project();
        await saveViewLayout(root, diagram(), { ...layout, canvas: { ...layout.canvas, portWalls: { out: 'right' } } }, accepting);
        const loaded = loadViewLayouts(root, [diagram()], id => ({ heater: 'coffee::heater', out: 'coffee::heater::out' } as Record<string, string>)[id]);
        const node = loaded['view-thermal'].nodes['coffee::heater'];
        expect(Object.keys(node.ports ?? {})).toEqual(['coffee::heater::out']);
        expect(node.ports?.['coffee::heater::out']).toMatchObject({ x: 210, y: 62 });
        expect(Object.keys(loaded['view-thermal'].canvas?.portWalls ?? {})).toEqual(['coffee::heater::out']);
    });

    it('has the compiler check the write that adds the import, and no later one', async () => {
        const root = project();
        let compiles = 0;
        const counting: OutlineSource = { outline: accepting.outline, verify: async () => { compiles++; return undefined; } };
        await saveViewLayout(root, diagram(), layout, counting);
        expect(compiles).toBe(1);
        await saveViewLayout(root, diagram(), { ...layout, nodes: { heater: { x: 5, y: 6 } } }, counting);
        await saveViewLayout(root, diagram('service'), { nodes: { boiler: { x: 1, y: 2 } }, edges: {} }, counting);
        expect(compiles).toBe(1);
    });

    it('writes nothing it could not state as SysML, whatever the client sent', async () => {
        const root = project();
        const hostile = {
            nodes: {
                ok: { x: 1, y: 2, textAlign: 'diagonal', ports: { p: { x: Number.NaN, y: 1 } } },
                bad: { x: Number.POSITIVE_INFINITY, y: 0 },
            },
            edges: { e: { points: [{ x: 1, y: Number.NaN }], sourceSide: 'sideways', style: 'wavy' } },
            canvas: { portWalls: { q: 'up' } },
        } as unknown as DiagramLayout;
        await saveViewLayout(root, diagram(), hostile, accepting);
        const text = readFileSync(join(root, FILE), 'utf8');
        expect(text).not.toMatch(/NaN|Infinity|diagonal|sideways|wavy|::up/);
        expect(loadViewLayouts(root, [diagram()])['view-thermal'].nodes).toEqual({ ok: { x: 1, y: 2, ports: {} } });
    });
});


describe('native layout extensions in declared views', () => {
    it('round-trips routing settings and unknown nested fields without a companion', async () => {
        const root = project();
        const original = { nodes: { a: { x: 1, y: 2, futureNode: { opaque: true }, ports: { p: { x: 0, y: 3, futurePort: 'keep' } } } }, edges: {},
            canvas: { routingType: 'arc', routingMode: 'manual', plugin: { nodes: { a: { x: 1.123456789, y: 2 } }, future: ['keep'] }, futureCanvas: { retain: true } },
            futureLayout: { text: 'quoted "value" and \\ path' } } as unknown as DiagramLayout;
        expect(isDefaultViewLayout(original)).toBe(false);
        expect(await saveViewLayout(root, diagram(), original, accepting)).toMatchObject({ success: true, changed: true });
        const loaded = loadViewLayouts(root, [diagram()])['view-thermal'];
        expect(loaded).toMatchObject(original);
        expect(readFileSync(join(root, FILE), 'utf8')).toContain('@MemoLayoutExtension');
        expect(await saveViewLayout(root, diagram(), loaded, accepting)).toMatchObject({ success: true, changed: false });
        expect(await saveViewLayout(root, diagram(), { nodes: {}, edges: {} }, accepting)).toMatchObject({ success: true });
        expect(loadViewLayouts(root, [diagram()])).toEqual({});
    });
});
