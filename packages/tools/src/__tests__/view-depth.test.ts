// ─── `depth` grows a view along composition ──────────────────────────────────

import { describe, expect, it } from 'vitest';
import { deriveModelViews } from '../model/view-deriver.js';
import type { MemoElement, MemoModel, MemoRelationship } from '../model/semantic.js';

const element = (id: string, over: Partial<MemoElement> = {}): MemoElement => ({
    id, name: id, kind: 'LogicalComponent', construct: 'part',
    layer: 'logical_structure', file: 'test.sysml', attributes: {}, ...over,
} as MemoElement);

const composes = (source: string, target: string): MemoRelationship => ({
    id: `r-${source}-${target}`, type: 'composes', sourceId: source, targetId: target,
} as MemoRelationship);

const modelOf = (els: MemoElement[], rels: MemoRelationship[] = []) => ({
    elements: new Map(els.map(e => [e.id, e])), relationships: rels, incoming: new Map(),
    packages: [], errors: [],
} as unknown as MemoModel);

/** root → a, b ; a → a1 ; a1 → a2 */
const chain = () => [
    element('root'), element('a'), element('b'), element('a1'), element('a2'),
];
const chainRels = () => [
    composes('root', 'a'), composes('root', 'b'), composes('a', 'a1'), composes('a1', 'a2'),
];

function idsOf(view: MemoElement, els: MemoElement[], rels: MemoRelationship[]): string[] {
    const [diagram] = deriveModelViews(modelOf([...els, view], rels)).diagrams;
    expect(diagram).toBeDefined();
    return [...(diagram!.elementIds ?? [])].sort();
}

describe('view depth', () => {
    it('takes the subject and the levels below it', () => {
        const view = element('v', { kind: 'DiagramView', attributes: { expose: 'root', depth: '2' } });
        expect(idsOf(view, chain(), chainRels())).toEqual(['a', 'a1', 'b', 'root']);
    });

    it('stops at the declared depth', () => {
        const view = element('v', { kind: 'DiagramView', attributes: { expose: 'root', depth: '1' } });
        expect(idsOf(view, chain(), chainRels())).toEqual(['a', 'b', 'root']);
    });

    it('measures depth from the subject, not from everything selected', () => {
        // `a1` is already listed and sits two levels down. Expanding from every
        // seed would pull `a2` in as well; a view is a view OF something, and
        // its depth is depth beneath that thing.
        const view = element('v', { kind: 'DiagramView', attributes: { expose: 'root,a1', depth: '1' } });
        expect(idsOf(view, chain(), chainRels())).toEqual(['a', 'a1', 'b', 'root']);
    });

    it('treats a wildcard expose as scope, not as the subject', () => {
        const els = [...chain().map(e => ({ ...e, package: 'pkg' }))];
        const view = element('v', { kind: 'DiagramView', attributes: { expose: 'pkg::*, root', depth: '1' } });
        // The wildcard admits the package; the subject is the element it names.
        expect(idsOf(view, els, chainRels())).toContain('a');
    });

    it('changes nothing when no depth is declared', () => {
        const view = element('v', { kind: 'DiagramView', attributes: { expose: 'root' } });
        expect(idsOf(view, chain(), chainRels())).toEqual(['root']);
    });

    it('follows a usage to the definition that holds its parts', () => {
        // SysML declares composition on the definition, so a usage has none of
        // its own — the same hop the block diagram makes to draw the tree.
        const def = element('Board', { isDefinition: true });
        const usage = element('board1', { attributes: { usageType: 'pkg::Board' } });
        const part = element('fpga');
        const view = element('v', { kind: 'DiagramView', attributes: { expose: 'board1', depth: '1' } });
        expect(idsOf(view, [def, usage, part], [composes('Board', 'fpga')]))
            .toEqual(['board1', 'fpga']);
    });
});
