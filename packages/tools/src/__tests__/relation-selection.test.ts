import { afterEach, describe, expect, it, vi } from 'vitest';
import { relationshipsOfType, undeclaredRelationshipTypes } from '../model/relation-selection.js';

const model = (registered: string[] | undefined) => ({
    relationships: [
        { id: '1', type: 'includesStep', sourceId: 'a', targetId: 'b' },
        { id: '2', type: 'flow', sourceId: 'a', targetId: 'c' },
        { id: '3', type: 'mitigates', sourceId: 'c', targetId: 'b' },
    ],
    registries: registered && { relationships: registered.map(name => ({ name })) },
}) as never;

describe('undeclaredRelationshipTypes', () => {
    it('compares the way source spells a name, and always declares the builder\'s own types', () => {
        expect(undeclaredRelationshipTypes(['IncludesStep', 'includesStep', 'flow', 'bind'], ['includesStep'])).toEqual([]);
    });

    it('names what an undeclared one was probably meant to be, and guesses nothing further', () => {
        expect(undeclaredRelationshipTypes(['Includes', 'MITIGATES', 'supports'], ['includesStep', 'mitigates']))
            .toEqual([{ name: 'Includes', suggestion: 'includesStep' }, { name: 'MITIGATES', suggestion: 'mitigates' }, { name: 'supports' }]);
    });
});

describe('relationshipsOfType', () => {
    afterEach(() => vi.restoreAllMocks());

    it('selects by type, however the name is cased at the first letter', () => {
        const found = relationshipsOfType(model(['includesStep', 'mitigates']), 'IncludesStep', 'mitigates');
        expect(found.map(r => r.id)).toEqual(['1', '3']);
    });

    it('reports a type nothing declares, with the name it looks like, and selects nothing for it', () => {
        const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
        expect(relationshipsOfType(model(['includesStep']), 'Includes')).toEqual([]);
        expect(error).toHaveBeenCalledTimes(1);
        expect(String(error.mock.calls[0][0])).toContain('"Includes"');
        expect(String(error.mock.calls[0][0])).toContain('did you mean "includesStep"');
        // Once per name: a view that renders again does not repeat it.
        relationshipsOfType(model(['includesStep']), 'Includes');
        expect(error).toHaveBeenCalledTimes(1);
    });

    it('checks nothing when the ontology did not resolve', () => {
        const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
        expect(relationshipsOfType(model(undefined), 'neverDeclared')).toEqual([]);
        expect(error).not.toHaveBeenCalled();
    });
});
