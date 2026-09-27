// ─── Stage 2 element builder ─────────────────────────────────────────────────
//
// `buildElementsFromApi` over the committed fixture (see stage2-api-model.test.ts
// for how it is regenerated). The fixture declares no MEMO ontology, so kinds do
// not resolve here; what is held is everything that does not depend on one:
// which declarations become elements, their ids and constructs, and how values,
// metadata and nesting land in the flat attribute map MEMO reads.
//
// Parity with MEMO's own builder over the real examples is
// `scripts/check-stage2-parity.mjs`, which needs SysIDE's Python API.
// ─────────────────────────────────────────────────────────────────────────────

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ApiModel, type Stage1Output } from '../stage2/api-model.js';
import { buildElementsFromApi } from '../stage2/build-from-api.js';
import { SYSML_RESERVED_KEYWORDS, textualName } from '../stage2/sysml-names.js';

const fixture = JSON.parse(readFileSync(
    resolve(import.meta.dirname, 'fixtures/stage2/api-model.stage1.json'), 'utf8')) as Stage1Output;
const { elements } = buildElementsFromApi(new ApiModel(fixture));

describe('buildElementsFromApi', () => {
    it('makes the project declarations elements, keyed by qualified name', () => {
        expect([...elements.keys()].sort()).toEqual([
            'Lib::Component', 'Lib::Element', 'Lib::Level', 'Lib::Link',
            'Model::controller', 'Model::pump', 'Model::pump::motor',
        ]);
        expect(elements.get('Model::pump')).toMatchObject({ construct: 'part', shortName: 'pump', package: 'Model', file: 'model.sysml' });
        expect(elements.get('Lib::Element')).toMatchObject({ construct: 'part', isDefinition: true });
    });

    it('nests a typed part under its owner', () => {
        expect(elements.get('Model::pump::motor')).toMatchObject({ owner: 'Model::pump', construct: 'part' });
    });

    it('writes values as MEMO spells them', () => {
        const attributes = elements.get('Model::pump')!.attributes;
        expect(attributes).toMatchObject({
            weight: '2.5',
            critical: 'true',
            level: 'Level::high',
            // A nonunique sequence keeps its repeats and its order.
            kinds: 'a, b, a',
            usageType: 'Component',
        });
    });

    it('lets a metadata application override a directly declared attribute', () => {
        // `attribute :>> label = "Pump"` and `@Tag { :>> label = "tagged"; }`:
        // the annotation is the newer statement of intent, and names the element.
        expect(elements.get('Model::pump')!.attributes.label).toBe('tagged');
        expect(elements.get('Model::pump')!.name).toBe('tagged');
    });

    it('writes a typed attribute without a value as its type', () => {
        expect(elements.get('Lib::Element')!.attributes.weight).toBe('<Real>');
    });

    it('leaves a connection with two ends out of the elements', () => {
        expect([...elements.values()].some(e => e.construct === 'connection' && !e.isDefinition)).toBe(false);
    });
});

describe('textualName', () => {
    it('quotes a reserved keyword and any name that is not basic', () => {
        expect(textualName('stakeholder')).toBe("'stakeholder'");
        expect(textualName('high')).toBe('high');
        expect(textualName('two words')).toBe("'two words'");
    });

    it('holds the keyword list to the vendored SysML grammar', () => {
        const bnf = readFileSync(resolve(import.meta.dirname,
            '../../../../corpus/sysml-v2-release/bnf/SysML-textual-bnf.kebnf'), 'utf8');
        const production = bnf.slice(bnf.indexOf('RESERVED_KEYWORD ='), bnf.indexOf('DEFINED_BY'));
        const declared = new Set([...production.matchAll(/'([a-z]+)'/g)].map(m => m[1]));
        expect(declared).toEqual(new Set(SYSML_RESERVED_KEYWORDS));
    });
});
