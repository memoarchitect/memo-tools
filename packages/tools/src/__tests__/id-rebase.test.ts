import { describe, expect, it } from 'vitest';
import { providedIdLiterals, rebaseProvidedIds, rebaseRegistry } from '../model/id-rebase.js';

const reg = (entries: Record<string, string>) => Object.fromEntries(Object.entries(entries).map(([k, v]) => [k, { shortId: v, uuid: `u-${k}` }]));

describe('short ids that two branches both handed out', () => {
    it('keeps the target\'s id and gives the branch\'s clashing element the next number above the mark', () => {
        const target = reg({ 'p::a': 'REQ-1', 'p::b': 'REQ-124' });
        const branch = reg({ 'p::a': 'REQ-1', 'p::b': 'REQ-124', 'p::mine': 'REQ-124' });
        const { registry, changes } = rebaseRegistry(target, branch);
        expect(registry['p::b'].shortId).toBe('REQ-124');
        expect(registry['p::mine']).toEqual({ shortId: 'REQ-125', uuid: 'u-p::mine' });
        expect(changes).toEqual([{ where: 'p::mine', from: 'REQ-124', to: 'REQ-125' }]);
    });

    it('leaves a number above the target\'s mark alone, and several new ones clear of each other', () => {
        const target = reg({ 'p::a': 'REQ-10' });
        const branch = reg({ 'p::a': 'REQ-10', 'p::n1': 'REQ-11', 'p::n2': 'REQ-5', 'p::n3': 'REQ-10' });
        const { registry, changes } = rebaseRegistry(target, branch);
        expect(registry['p::n1'].shortId).toBe('REQ-11');
        // n2 reuses a retired number and n3 takes the target's: both move above everything in use
        expect(new Set(Object.values(registry).map(e => e.shortId)).size).toBe(4);
        expect(changes.map(c => c.where).sort()).toEqual(['p::n2', 'p::n3']);
        expect(changes.every(c => Number(c.to.split('-')[1]) > 11)).toBe(true);
    });

    it('does nothing when nothing clashes, and never renumbers another family', () => {
        const target = reg({ 'p::a': 'REQ-3' });
        const branch = reg({ 'p::a': 'REQ-3', 'p::h': 'HZD-1' });
        expect(rebaseRegistry(target, branch).changes).toEqual([]);
    });
});

describe('authored ids that two branches both wrote', () => {
    const sysml = (...ids: string[]) => ids.map((id, i) => `part p${i} { @MemoIdentity { :>> providedId = "${id}"; } }`).join('\n');

    it('finds the literals and where they are', () => {
        expect(providedIdLiterals(sysml('A-1', 'B-2')).map(l => [l.id, l.line])).toEqual([['A-1', 1], ['B-2', 2]]);
    });

    it('renumbers the surplus copy a branch added and keeps the target\'s', () => {
        const target = new Map([['a.sysml', sysml('REQ-123', 'REQ-124')]]);
        const branch = new Map([['a.sysml', sysml('REQ-123', 'REQ-124')], ['b.sysml', sysml('REQ-124')]]);
        const { files, changes } = rebaseProvidedIds(target, branch);
        expect(files.get('b.sysml')).toContain('"REQ-125"');
        expect(files.has('a.sysml')).toBe(false);
        expect(changes).toEqual([{ where: 'b.sysml:1', from: 'REQ-124', to: 'REQ-125' }]);
    });

    it('leaves an id the branch did not duplicate, and one the target already had twice', () => {
        const target = new Map([['a.sysml', sysml('X-1', 'X-1')]]);
        const same = rebaseProvidedIds(target, new Map(target));
        expect(same.changes).toEqual([]);
        expect(rebaseProvidedIds(new Map(), new Map([['a.sysml', sysml('X-1')]])).changes).toEqual([]);
    });
});

describe('two sibling branches that took the same number above the mark', () => {
    it('keeps it for the first element and renumbers the others', () => {
        const target = reg({ 'p::a': 'REQ-10' });
        const branch = reg({ 'p::a': 'REQ-10', 'p::x': 'REQ-11', 'p::y': 'REQ-11' });
        const { registry, changes } = rebaseRegistry(target, branch);
        expect(registry['p::x'].shortId).toBe('REQ-11');
        expect(registry['p::y'].shortId).toBe('REQ-12');
        expect(changes).toEqual([{ where: 'p::y', from: 'REQ-11', to: 'REQ-12' }]);
    });
});

describe('authored ids told apart by the lines the branch added', () => {
    const line = (id: string) => `part p { @MemoIdentity { :>> providedId = "${id}"; } }`;

    it('renumbers the added copy even when it comes first in the file', () => {
        const target = new Map([['a.sysml', `${line('REQ-5')}\n`]]);
        const branch = new Map([['a.sysml', `${line('REQ-5')}\n${line('REQ-5')}\n`]]);
        const first = rebaseProvidedIds(target, branch, new Map([['a.sysml', new Set([1])]]));
        expect(first.changes).toEqual([{ where: 'a.sysml:1', from: 'REQ-5', to: 'REQ-6' }]);
        expect(first.files.get('a.sysml')!.split('\n')[0]).toContain('"REQ-6"');
    });

    it('lets one sibling keep an id the target never had and renumbers the other', () => {
        const target = new Map<string, string>();
        const branch = new Map([['a.sysml', `${line('REQ-9')}\n`], ['b.sysml', `${line('REQ-9')}\n`]]);
        const added = new Map([['a.sysml', new Set([1])], ['b.sysml', new Set([1])]]);
        const { changes } = rebaseProvidedIds(target, branch, added);
        expect(changes).toEqual([{ where: 'b.sysml:1', from: 'REQ-9', to: 'REQ-10' }]);
    });
});
