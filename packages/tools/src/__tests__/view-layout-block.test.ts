import { describe, expect, it } from 'vitest';
import type { DiagramLayout } from '../protocol/messages.js';
import {
    layoutBlindRevision, layoutFromStatements, layoutToStatements, readFileLayouts,
    replaceViewLayout, scanViewLayouts, stripLayout,
} from '../model/view-layout-block.js';

const SOURCE = `package outer::inner {
    private import ScalarValues::*;
    part def Pump { port flowIn; }
    part pump : Pump;
    view overview : MemoDiagramView {
        expose pump::**;
        @MemoIdentity { :>> label = "Overview {raw}"; }
    }
    view oneLine : MemoDiagramView { expose pump; }
    // a view in another package must not be confused with the one above
    package later {
        view overview : MemoDiagramView {
            expose pump;
        }
    }
    part after : Pump;
}
`;

/** What the first layout save leaves behind besides the statements: the import they need. */
const IMPORTED = SOURCE.replace('{\n', '{\n    private import memo_viewpoints_definitions_layout::*;\n');

const layout: DiagramLayout = {
    nodes: {
        'outer::inner::pump': {
            x: 120.5, y: -40, width: 220, height: 140, parent: null, color: '#ffeecc',
            ports: { flowIn: { x: 0, y: 62.25, side: 'left', size: 14 } },
        },
        'outer::inner::child': { x: 8, y: 9, parent: 'outer::inner::pump' },
        legacy: { x: 1, y: 2 },
    },
    edges: {
        'rel-1': { points: [{ x: 1, y: 2 }, { x: 3, y: 4.5 }], sourceSide: 'top', sourceT: 0.25, manualLanding: true, style: 'dashed' },
        'rel-2': {},
    },
    annotations: { 'note-1': { kind: 'note', x: 5, y: 6, width: 180, height: 90, text: 'a "quoted" {brace}\nsecond line', color: '#fff' } },
    canvas: {
        autoLayout: false, grid: 8, snap: true, portWalls: { 'outer::inner::pump::flowIn': 'bottom' }, zoom: 2, pan: { x: 3, y: 4 },
        coordinateSpace: 'context-child-v1',
        layout: { provider: 'memo.layout.elk', providerVersion: '0.9.1', contractVersion: '2' },
    } as DiagramLayout['canvas'],
};

describe('layout statements in a view', () => {
    it('finds a view by its qualified id, and tells two views of one name apart', () => {
        expect(scanViewLayouts(SOURCE).map(v => v.id)).toEqual([
            'outer::inner::overview', 'outer::inner::oneLine', 'outer::inner::later::overview',
        ]);
    });

    it('round-trips a layout, minus what is deliberately not stored', () => {
        const written = replaceViewLayout(SOURCE, 'outer::inner::overview', layout)!;
        const read = readFileLayouts(written)['outer::inner::overview'];
        const { zoom: _z, pan: _p, ...canvas } = layout.canvas!;
        expect(read.canvas).toEqual(canvas);
        // node ports come back under the node; an edge that overrides nothing is not written
        expect(read.nodes['outer::inner::pump']).toMatchObject({
            x: 120.5, y: -40, width: 220, height: 140, parent: null, color: '#ffeecc',
        });
        expect(Object.keys(read.nodes).sort()).toEqual(['legacy', 'outer::inner::child', 'outer::inner::pump']);
        expect(read.nodes['outer::inner::pump'].ports).toEqual(layout.nodes['outer::inner::pump'].ports);
        expect(read.nodes['outer::inner::pump'].parent).toBeNull();
        expect(read.nodes['outer::inner::child'].parent).toBe('outer::inner::pump');
        // a frame nobody recorded stays unrecorded
        expect(read.nodes.legacy.parent).toBeUndefined();
        expect(read.edges['rel-1']).toEqual(layout.edges['rel-1']);
        expect(read.edges['rel-2']).toBeUndefined();
        expect(read.annotations!['note-1']).toEqual(layout.annotations!['note-1']);
    });

    it('touches only its own view, and strips back to the original text', () => {
        const written = replaceViewLayout(SOURCE, 'outer::inner::overview', layout)!;
        expect(written).not.toBe(SOURCE);
        expect(stripLayout(written)).toBe(IMPORTED);
        expect(readFileLayouts(written)['outer::inner::later::overview']).toBeUndefined();
        expect(layoutBlindRevision(written)).toBe(layoutBlindRevision(IMPORTED));
    });

    it('replaces rather than appends, and removes cleanly', () => {
        const once = replaceViewLayout(SOURCE, 'outer::inner::overview', layout)!;
        const moved = structuredClone(layout);
        moved.nodes['outer::inner::pump'].x = 999;
        const twice = replaceViewLayout(once, 'outer::inner::overview', moved)!;
        expect(twice.match(/@MemoLayoutNode \{ :>> element = "outer::inner::pump"/g)).toHaveLength(1);
        // a drag changes the line of the box that moved and no other
        const changed = twice.split('\n').filter((line, i) => line !== once.split('\n')[i]);
        expect(changed).toHaveLength(1);
        expect(replaceViewLayout(twice, 'outer::inner::overview', null)).toBe(IMPORTED);
        // the import is added once, and only when the file lacks it
        expect(twice.match(/import memo_viewpoints_definitions_layout/g)).toHaveLength(1);
        expect(replaceViewLayout(IMPORTED, 'outer::inner::overview', layout)).toBe(once);
    });

    it('writes into a one-line view and into a view with no body convention', () => {
        const written = replaceViewLayout(SOURCE, 'outer::inner::oneLine', { nodes: { a: { x: 1, y: 2 } }, edges: {} })!;
        expect(readFileLayouts(written)['outer::inner::oneLine'].nodes.a).toMatchObject({ x: 1, y: 2 });
        expect(scanViewLayouts(written).map(v => v.id)).toHaveLength(3);
    });

    it('refuses a view the file does not declare', () => {
        expect(replaceViewLayout(SOURCE, 'outer::inner::nope', layout)).toBeUndefined();
    });

    it('ignores statements that are not in a view, and comments and strings that look like them', () => {
        const text = `package p {
    part x { @MemoLayoutNode { :>> element = "a"; :>> x = 1; :>> y = 2; } }
    view v : MemoDiagramView {
        // @MemoLayoutNode { :>> element = "commented"; :>> x = 1; :>> y = 2; }
        doc /* @MemoLayoutNode { :>> element = "doc"; :>> x = 1; :>> y = 2; } */
        attribute note = "@MemoLayoutNode { :>> element = \\"s\\"; }";
    }
}`;
        expect(readFileLayouts(text)).toEqual({});
        expect(layoutBlindRevision(text)).toBe(layoutBlindRevision(text.replace('x = 1', 'x = 1')));
    });

    it('keeps the hash of a file with no layout equal to the hash of its text', () => {
        expect(stripLayout(SOURCE)).toBe(SOURCE);
    });

    it('preserves exact fractional coordinates rather than drifting on reload', () => {
        const [line] = layoutToStatements({ nodes: { a: { x: 53.400000000000006, y: -0.001 } }, edges: {} }, '');
        expect(line).toBe('@MemoLayoutNode { :>> element = "a"; :>> x = 53.400000000000006; :>> y = -0.001; }');
    });

    it('reads nothing from a malformed statement and leaves it where it is', () => {
        const text = SOURCE.replace('expose pump::**;', 'expose pump::**;\n        @MemoLayoutNode { :>> element = ; }');
        expect(layoutFromStatements(scanViewLayouts(text)[0].statements)).toBeNull();
    });
});


describe('renderer extension validation', () => {
    it('does not let an extension override typed geometry or camera state', () => {
        const text = replaceViewLayout(SOURCE, 'outer::inner::overview', layout)!;
        const payload = JSON.stringify({ version: 1, layout: { nodes: { 'outer::inner::pump': { x: 999, future: true } }, canvas: { zoom: 9, pan: { x: 1, y: 2 }, renderer: 'memo.renderer.x6' } } });
        const injected = text.replace('expose pump::**;', `@MemoLayoutExtension { :>> payload = ${JSON.stringify(payload)}; }\n        expose pump::**;`);
        const loaded = readFileLayouts(injected)['outer::inner::overview'];
        expect(loaded.nodes['outer::inner::pump'].x).toBe(layout.nodes['outer::inner::pump'].x);
        expect(loaded.canvas?.zoom).toBeUndefined();
        expect(loaded.canvas?.pan).toBeUndefined();
        expect(loaded.canvas?.renderer).toBe('memo.renderer.x6');
        expect(loaded.nodes['outer::inner::pump']).toMatchObject({ future: true });
    });
});


it('retains an explicit automatic placement setting with routing and exact route points', () => {
    const original = { nodes: {}, edges: { line: { points: [{ x: 1.123456789, y: -0.00001 }] } }, canvas: { autoLayout: true, routingMode: 'manual' } } as DiagramLayout;
    const text = replaceViewLayout(SOURCE, 'outer::inner::overview', original)!;
    const actual = readFileLayouts(text)['outer::inner::overview'];
    expect(actual).toMatchObject(original);
});
