import { afterEach, describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parse, stringify } from 'yaml';
import type { DiagramDTO, DiagramLayout } from '@memoarchitect/tools';
import { loadViewLayout, saveViewLayout, viewLayoutPath } from '../server/view-layout-store.js';

const roots: string[] = [];
afterEach(() => { while (roots.length) rmSync(roots.pop()!, { recursive: true, force: true }); });

const diagram = (sourceFile = 'model/views/thermal.sysml'): DiagramDTO => ({
    id: 'view-coffee-thermal', name: 'Thermal IBD', diagramType: 'ibd',
    viewpointId: '__model', auto: true, sourceFile,
});
const layout: DiagramLayout = {
    nodes: {
        heater: {
            x: 120, y: 80, width: 220, height: 140,
            ports: { heatedWaterOut: { x: 210, y: 62, side: 'right' } },
        },
    },
    edges: {}, canvas: { zoom: 0.9, pan: { x: 20, y: 30 } },
};

describe('.viewlayout companions', () => {
    it('saves beside the SysML view and round-trips the complete layout', () => {
        const root = mkdtempSync(join(tmpdir(), 'memo-view-layout-')); roots.push(root);
        mkdirSync(join(root, 'model/views'), { recursive: true });
        const d = diagram();
        const saved = saveViewLayout(root, d, layout)!;
        expect(saved).toBe(join(root, 'model/views/thermal.viewlayout'));
        expect(existsSync(saved)).toBe(true);
        expect(loadViewLayout(root, d)).toEqual(layout);
        const artifact = parse(readFileSync(saved, 'utf8'));
        expect(artifact).toMatchObject({
            format: 'memo.viewlayout/v1', viewSource: d.sourceFile,
            layouts: { [d.id]: layout },
        });
    });

    it('stores multiple diagrams from one SysML file in the same companion', () => {
        const root = mkdtempSync(join(tmpdir(), 'memo-view-layout-')); roots.push(root);
        mkdirSync(join(root, 'model/views'), { recursive: true });
        const first = diagram();
        const second = { ...diagram(), id: 'view-coffee-service', name: 'Service IBD' };
        saveViewLayout(root, first, layout);
        saveViewLayout(root, second, { nodes: { service: { x: 10, y: 20 } }, edges: {} });
        expect(viewLayoutPath(root, first)).toBe(viewLayoutPath(root, second));
        expect(loadViewLayout(root, first)).toEqual(layout);
        expect(loadViewLayout(root, second)?.nodes.service).toEqual({ x: 10, y: 20 });
    });

    it('writes no companion for a layout that overrides nothing', () => {
        const root = mkdtempSync(join(tmpdir(), 'memo-view-layout-')); roots.push(root);
        mkdirSync(join(root, 'model/views'), { recursive: true });
        const d = diagram();
        // A canvas toggle left at its default is not an override.
        const saved = saveViewLayout(root, d, { nodes: {}, edges: {}, canvas: { flowAnimation: false } });
        expect(saved).toBeNull();
        expect(existsSync(viewLayoutPath(root, d))).toBe(false);
        expect(loadViewLayout(root, d)).toBeNull();
    });

    it('keeps a companion for a canvas setting the user actually changed', () => {
        const root = mkdtempSync(join(tmpdir(), 'memo-view-layout-')); roots.push(root);
        mkdirSync(join(root, 'model/views'), { recursive: true });
        const d = diagram();
        for (const canvas of [{ flowAnimation: true }, { autoLayout: false }, { grid: 20 }] as const) {
            rmSync(viewLayoutPath(root, d), { force: true });
            expect(saveViewLayout(root, d, { nodes: {}, edges: {}, canvas })).not.toBeNull();
            expect(loadViewLayout(root, d)).toEqual({ nodes: {}, edges: {}, canvas });
        }
    });

    it('drops the companion once its last override is cleared', () => {
        const root = mkdtempSync(join(tmpdir(), 'memo-view-layout-')); roots.push(root);
        mkdirSync(join(root, 'model/views'), { recursive: true });
        const d = diagram();
        saveViewLayout(root, d, layout);
        expect(existsSync(viewLayoutPath(root, d))).toBe(true);
        expect(saveViewLayout(root, d, { nodes: {}, edges: {} })).toBeNull();
        expect(existsSync(viewLayoutPath(root, d))).toBe(false);
    });

    it('keeps a sibling diagram\'s overrides when one diagram is cleared', () => {
        const root = mkdtempSync(join(tmpdir(), 'memo-view-layout-')); roots.push(root);
        mkdirSync(join(root, 'model/views'), { recursive: true });
        const first = diagram();
        const second = { ...diagram(), id: 'view-coffee-service', name: 'Service IBD' };
        saveViewLayout(root, first, layout);
        saveViewLayout(root, second, { nodes: { service: { x: 10, y: 20 } }, edges: {} });
        expect(saveViewLayout(root, first, { nodes: {}, edges: {} })).toBe(viewLayoutPath(root, first));
        expect(loadViewLayout(root, first)).toBeNull();
        expect(loadViewLayout(root, second)?.nodes.service).toEqual({ x: 10, y: 20 });
    });

    it('loads a legacy hidden YAML sidecar until the diagram is saved again', () => {
        const root = mkdtempSync(join(tmpdir(), 'memo-view-layout-')); roots.push(root);
        const d = diagram();
        mkdirSync(join(root, '.memo/layouts'), { recursive: true });
        writeFileSync(join(root, '.memo/layouts', `${d.id}.yaml`), stringify(layout));
        expect(loadViewLayout(root, d)).toEqual(layout);
        expect(viewLayoutPath(root, d)).toContain('.viewlayout');
    });
});
