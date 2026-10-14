// The layout statements are SysML, and the compiler is what says they are valid.
// Every statement kind, every enum literal, an escaped note and a route with a
// negative coordinate are written into a view of a real project and compiled.
import { describe, expect, it } from 'vitest';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { DiagramLayout } from '../protocol/messages.js';
import { layoutBlindRevision, readFileLayouts, replaceViewLayout } from '../model/view-layout-block.js';
import { loadProjectModel } from '../toolchain/project-model.js';
import { compilerConfigured, examplesPresent, withExample } from './helpers/compile-source.js';

const FILE = 'model/catalog/layout_probe.sysml';
const SOURCE = `package layout_probe {
    part def Pump { port flowIn; }
    part pump : Pump;
    view overview {
        expose pump::**;
    }
}
`;

const everything: DiagramLayout = {
    nodes: {
        'layout_probe::pump': {
            x: -12.5, y: 40, width: 220, height: 140, parent: null, color: '#ffeecc', borderColor: '#000', textColor: '#111',
            fontSize: 12, fontWeight: 600, textAlign: 'center', verticalAlign: 'middle', opacity: 0.5,
            ports: { flowIn: { x: 0, y: 62.25, side: 'left', size: 14 } },
        },
        'layout_probe::child': { x: 8, y: 9, parent: 'layout_probe::pump' },
    },
    edges: {
        'rel-1': {
            points: [{ x: -1, y: 2 }, { x: 3.5, y: -4 }], style: 'dotted', color: '#123', strokeWidth: 2, labelVisible: false,
            source: 'layout_probe::pump', target: 'layout_probe::child', sourcePortId: 'flowIn', targetPortId: 'in',
            manualLanding: true, sourceSide: 'top', sourceT: 0.25, targetSide: 'bottom', targetT: 0.75,
        },
    },
    annotations: { 'note-1': { kind: 'constraint', x: 5, y: 6, width: 180, height: 90, text: 'a "quoted" {brace} \\ back\nsecond', color: '#fff' } },
    canvas: {
        autoLayout: false, grid: 8, snap: true, portWalls: { 'layout_probe::pump::flowIn': 'bottom' },
        coordinateSpace: 'context-child-v1',
        layout: { provider: 'memo.layout.elk', providerVersion: '0.9.1', contractVersion: '2', preset: 'tree', seed: 7 },
    } as DiagramLayout['canvas'],
};

describe.runIf(compilerConfigured && examplesPresent)('layout statements under the compiler', () => {
    it('compile with every kind written, and read back as written', async () => {
        await withExample({ [FILE]: SOURCE }, async (_host, root) => {
            const text = replaceViewLayout(readFileSync(join(root, FILE), 'utf8'), 'layout_probe::overview', everything)!;
            writeFileSync(join(root, FILE), text);
            // A rejected compile throws; reaching the next line is the assertion.
            await loadProjectModel({ projectRoot: root, config: { modelName: 'test', toolchain: { compiler: process.env.MEMO_TOOLCHAIN_COMPILER } } as never, cache: false });
            const read = readFileLayouts(text)['layout_probe::overview'];
            expect(read.nodes['layout_probe::pump'].ports?.flowIn).toEqual({ x: 0, y: 62.25, side: 'left', size: 14 });
            expect(read.edges['rel-1'].points).toEqual([{ x: -1, y: 2 }, { x: 3.5, y: -4 }]);
            expect(read.annotations!['note-1'].text).toBe(everything.annotations!['note-1'].text);
            expect(layoutBlindRevision(text)).toBe(layoutBlindRevision(replaceViewLayout(text, 'layout_probe::overview', null)!));
        });
    });

    it('are refused when the file does not import the layout package', async () => {
        await withExample({ [FILE]: SOURCE }, async (_host, root) => {
            const withImport = replaceViewLayout(SOURCE, 'layout_probe::overview', everything)!;
            const withoutImport = withImport.replace(/^\s*private import memo_viewpoints_definitions_layout::\*;\n/m, '');
            expect(withoutImport).not.toBe(withImport);
            writeFileSync(join(root, FILE), withoutImport);
            await expect(loadProjectModel({ projectRoot: root, config: { modelName: 'test', toolchain: { compiler: process.env.MEMO_TOOLCHAIN_COMPILER } } as never, cache: false })).rejects.toThrow();
        });
    });
});
