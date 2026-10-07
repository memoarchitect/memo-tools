// ─── OpenSysML's compact api-json, read as the element array ─────────────────
import { describe, expect, it } from 'vitest';
import { expandCompactApiJson, parseApiJson } from '../toolchain/providers/opensysml-compact.js';

const compact = {
    format: 'api-json-compact/1',
    ids: ['P', 'P__m', 'P__A', 'Lib__Base'],
    elementCount: 3,
    elementIdsAreIds: true,
    referenceKeys: ['ownedRelatedElement', 'owningRelatedElement', 'general'],
    elements: [
        { '@type': 'Namespace', ownedRelationship: [{ '@id': 1 }] },
        { '@type': 'OwningMembership', owningRelatedElement: 0, ownedRelatedElement: [2] },
        // `value` carries numbers, so a reference under it is `{ "@id": n }`; a name stays `{ "@ref": … }`.
        { '@type': 'PartDefinition', declaredName: 'A', general: 3, value: 7, subsettedFeature: [{ '@id': 3 }, { '@ref': 'x' }] },
    ],
};

describe('the compact api-json document', () => {
    it('expands to the element array', () => {
        expect(expandCompactApiJson(JSON.stringify(compact))).toEqual([
            { '@type': 'Namespace', '@id': 'P', elementId: 'P', ownedRelationship: [{ '@id': 'P__m' }] },
            { '@type': 'OwningMembership', '@id': 'P__m', elementId: 'P__m', owningRelatedElement: { '@id': 'P' }, ownedRelatedElement: [{ '@id': 'P__A' }] },
            {
                '@type': 'PartDefinition', '@id': 'P__A', elementId: 'P__A', declaredName: 'A',
                general: { '@id': 'Lib__Base' }, value: 7, subsettedFeature: [{ '@id': 'Lib__Base' }, { '@ref': 'x' }],
            },
        ]);
    });

    it('writes an elementId of its own when the document does not say they are the ids', () => {
        const own = { ...compact, elementIdsAreIds: undefined, elements: [{ '@type': 'Namespace', elementId: 'other' }] , elementCount: 1 };
        expect(expandCompactApiJson(JSON.stringify(own))[0]).toEqual({ '@type': 'Namespace', '@id': 'P', elementId: 'other' });
    });

    it('refuses a document of another format', () => {
        expect(() => expandCompactApiJson(JSON.stringify({ ...compact, format: 'api-json-compact/2' }))).toThrow(/api-json-compact\/2/);
    });

    it('reads either form of a conversion', () => {
        const array = [{ '@type': 'Namespace', '@id': 'P' }];
        expect(parseApiJson(JSON.stringify(array))).toEqual(array);
        expect(parseApiJson(JSON.stringify(compact))).toHaveLength(3);
    });
});
