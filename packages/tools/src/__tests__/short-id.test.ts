import { describe, expect, it } from 'vitest';
import { assignSequentialShortIds, kindToPrefix } from '../model/short-id.js';
import { completeModel } from '../model/complete-model.js';
import { ElementIndex } from '../model/element-index.js';
import type { MemoElement } from '../model/semantic.js';

describe('MEMO short IDs', () => {
    it('uses the UIE family for UI elements', () => {
        expect(kindToPrefix('UIElement')).toBe('UIE');
    });
});

// A short ID is a traceability handle. If it moves, every report, review
// comment and external reference that quoted it silently points somewhere else,
// and nothing detects that. These four tests are the whole contract.
describe('short ID assignment is monotonic', () => {
    const fresh = () => assignSequentialShortIds('REQ', ['bravo', 'charlie', 'delta']);

    it('numbers a fresh model from 1', () => {
        expect(Object.fromEntries(fresh())).toEqual({
            bravo: 'REQ-1', charlie: 'REQ-2', delta: 'REQ-3',
        });
    });

    it('adding an element that sorts FIRST does not renumber the others', () => {
        // The regression this file exists for: assignment used to sort
        // lexicographically and number by position, so an `alpha` appearing
        // later pushed bravo from REQ-1 to REQ-2.
        const prior = fresh();
        const next = assignSequentialShortIds('REQ', ['alpha', 'bravo', 'charlie', 'delta'], prior);
        expect(next.get('bravo')).toBe('REQ-1');
        expect(next.get('charlie')).toBe('REQ-2');
        expect(next.get('delta')).toBe('REQ-3');
        expect(next.get('alpha')).toBe('REQ-4');
    });

    it('deleting an element does not renumber the survivors', () => {
        const prior = fresh();
        const next = assignSequentialShortIds('REQ', ['charlie', 'delta'], prior);
        expect(next.get('charlie')).toBe('REQ-2');
        expect(next.get('delta')).toBe('REQ-3');
    });

    it('never reuses the number of a deleted element', () => {
        // The gap IS the record that something was deleted. Handing REQ-1 to a
        // different element would silently repoint every reference to it.
        const prior = fresh();
        const afterDelete = assignSequentialShortIds('REQ', ['charlie', 'delta'], prior);
        const afterAdd = assignSequentialShortIds('REQ', ['charlie', 'delta', 'echo'], prior);
        expect(afterDelete.has('bravo')).toBe(false);
        expect([...afterAdd.values()]).not.toContain('REQ-1');
        expect(afterAdd.get('echo')).toBe('REQ-4');
    });

    it('ignores prior assignments belonging to another prefix family', () => {
        const prior = new Map([['other', 'HZD-9']]);
        const next = assignSequentialShortIds('REQ', ['bravo'], prior);
        expect(next.get('bravo')).toBe('REQ-1');
    });
});

// A display id's family is the ontology kind's. A project definition is a model element, not a kind,
// so what is typed by one takes the family of the ontology kind it descends from; only a definition
// that declares `@MemoKind { idPrefix }` extends the ontology with a family of its own.
describe('the family of a short id', () => {
    const element = (id: string, kind: string, extra: Partial<MemoElement> = {}): MemoElement => ({
        id, shortName: id, name: id, kind, construct: 'part', layer: 'x', file: 'a.sysml', attributes: {}, ...extra,
    } as MemoElement);
    const build = (list: MemoElement[]) => {
        const elements = new ElementIndex();
        for (const el of list) elements.set(el.id, el);
        const kindRegistry = { getKind: (k: string) => (k === 'System' ? { name: 'System' } : undefined), toDefinitionDTOs: () => [] };
        return completeModel({ elements, relationships: [], errors: [], config: {} as never, registries: { kindRegistry: kindRegistry as never } });
    };

    it('does not mint a family from the name of a project definition', () => {
        const model = build([
            element('HospitalSystem', 'System', { isDefinition: true }),
            element('HospitalSub', 'HospitalSystem', { isDefinition: true }),
            element('hospital', 'HospitalSystem'),
        ]);
        expect(model.elements.get('hospital')!.shortId).toMatch(/^SYS-/);
    });

    it('gives a definition that declares idPrefix a family of its own, and what it types', () => {
        const model = build([
            element('Pacer', 'System', { isDefinition: true, attributes: { idPrefix: 'pcr' } }),
            element('pacer1', 'Pacer'),
        ]);
        expect(model.elements.get('Pacer')!.shortId).toMatch(/^PCR-/);
        expect(model.elements.get('pacer1')!.shortId).toMatch(/^PCR-/);
    });
});
