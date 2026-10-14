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
