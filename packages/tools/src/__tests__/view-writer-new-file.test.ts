import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { writeViewDeclaration } from '../server/view-writer.js';
import type { OutlineSource } from '../authoring/outline-source.js';

// A view that needs a file of its own is written in one piece. Writing the package first and the view into it
// after cost a compile to outline the half-written file and a second rebuild for every client watching.

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

function project() {
    const root = mkdtempSync(join(tmpdir(), 'view-writer-'));
    roots.push(root);
    mkdirSync(join(root, 'model/views'), { recursive: true });
    writeFileSync(join(root, 'model/views/overview.sysml'), [
        'package plant_views_overview {',
        '    private import memo::*;',
        '    view overview : MemoDiagramView;',
        '}',
        '',
    ].join('\n'));
    const model = {
        elements: {
            'plant_views_overview::overview': {
                id: 'plant_views_overview::overview', name: 'overview', kind: 'View',
                file: 'model/views/overview.sysml', package: 'plant_views_overview', attributes: {},
            },
        },
        diagrams: [{
            id: 'overview', name: 'Overview', diagramType: 'bdd', viewKind: 'general', viewpointId: '__model', auto: false,
            sourceFile: 'model/views/overview.sysml', elementId: 'plant_views_overview::overview',
        }],
        packages: [],
    } as any;
    return { root, model };
}

function countingOutlines() {
    const calls = { outline: 0, verify: 0 };
    const outlines: OutlineSource = {
        async outline() { calls.outline++; throw new Error('a new file needs no outline'); },
        async verify() { calls.verify++; return undefined; },
    };
    return { calls, outlines };
}

describe('declaring a view in a new file', () => {
    it('writes the package, its imports and the view at once, with one compile', async () => {
        const { root, model } = project();
        const { calls, outlines } = countingOutlines();
        const result = await writeViewDeclaration(root, model, {
            name: 'Needs to requirements', diagramType: 'alloc', viewKind: 'grid', viewpointId: '__unassigned',
            viewDefinition: 'MemoTraceabilityMatrixView', matrix: { rowAxis: { query: 'kind: Need' } },
        } as any, outlines);

        expect(result).toMatchObject({ success: true, created: true, qualifiedName: 'plant_views_needs_to_requirements::needsToRequirements' });
        expect(calls).toEqual({ outline: 0, verify: 1 });
        const text = readFileSync(join(root, (result as any).filePath), 'utf8');
        expect(text).toContain('package plant_views_needs_to_requirements {\n    private import memo::*;\n    view needsToRequirements : MemoTraceabilityMatrixView {');
        expect(text).toContain('        attribute :>> query = "kind: Need";');
        expect(text.trimEnd().endsWith('    }\n}')).toBe(true);
    });

    it('writes nothing when the compiler refuses the file', async () => {
        const { root, model } = project();
        const outlines: OutlineSource = {
            async outline() { throw new Error('unused'); },
            async verify() { throw new Error('no such definition'); },
        };
        const result = await writeViewDeclaration(root, model, {
            name: 'Refused', diagramType: 'alloc', viewKind: 'grid', viewpointId: '__unassigned',
            viewDefinition: 'MemoTraceabilityMatrixView', matrix: {},
        } as any, outlines);
        expect(result.success).toBe(false);
        expect(() => readFileSync(join(root, 'model/views/view_refused.sysml'), 'utf8')).toThrow();
    });
});
