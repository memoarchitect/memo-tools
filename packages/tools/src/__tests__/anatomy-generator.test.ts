// ─── memo anatomy generate ────────────────────────────────────────────────────
//
// The generator reads a project's AnatomySelectors and the anatomy extension's
// FMA index, and writes the union as one small package per home file. The index
// here is a hand-written miniature of the real one, so each rule is visible.
// ─────────────────────────────────────────────────────────────────────────────

import { describe, expect, it } from 'vitest';
import { readAnatomySelectors, renderAnatomy, selectAnatomy, type FmaIndex } from '../anatomy/anatomy-generator.js';
import { compileSources, compilerConfigured } from './helpers/compile-source.js';

const INDEX: FmaIndex = {
    source: { title: 'Mini anatomy', version: '1', publisher: 'Test', iri: 'urn:test', licence: 'CC BY 4.0', modification: 'Converted.' },
    root: 'e',
    relations: {
        regional_part: { feature: 'regionalPartFeatures', composite: true, prefix: 'regionalPart', suffix: 'RegionalPart' },
        continuous_with: { feature: 'continuousWithFeatures', composite: false, prefix: 'continuousWith', suffix: 'ContinuousWith' },
        arterial_supply: { feature: 'arterialSupplyFeatures', composite: false, prefix: 'arterialSupply', suffix: 'ArterialSupply' },
    },
    classes: {
        e: ['AnatomicalEntity', null, 'core', null, []],
        organ: ['Organ', 'e', 'core', null, [['regional_part', 'wall']]],
        wall: ['Wall', 'e', 'core', null, []],
        stomach: ['Stomach', 'organ', 'alimentary', 'An organ.', [
            ['regional_part', 'body'], ['regional_part', 'wall'], ['continuous_with', 'duodenum'], ['arterial_supply', 'artery'],
        ]],
        body: ['BodyOfStomach', 'e', 'alimentary', null, [['regional_part', 'mucosa']]],
        mucosa: ['Mucosa', 'e', 'alimentary', null, [['regional_part', 'gland']]],
        gland: ['Gland', 'e', 'alimentary', null, []],
        duodenum: ['Duodenum', 'organ', 'alimentary', null, [['regional_part', 'bulb']]],
        bulb: ['Bulb', 'e', 'alimentary', null, []],
        artery: ['Artery', 'e', 'cardiovascular', null, []],
        loop: ['Loop', 'e', 'core', null, [['regional_part', 'body'], ['continuous_with', 'body']]],
    },
};

const select = (seeds: string[], partDepth: number) => selectAnatomy(INDEX, [{ name: 'p::s', seeds, partDepth }]);

describe('selecting anatomy', () => {
    it('takes the seeds and their parts to the depth asked, and declares what they name and every ancestor', () => {
        const s = select(['stomach'], 1);
        expect([...s.deep].sort()).toEqual(['body', 'stomach', 'wall']);
        // The mucosa is a part two levels down: declared, because the body names it, but not expanded.
        expect([...s.emitted].sort()).toEqual(['artery', 'body', 'duodenum', 'e', 'mucosa', 'organ', 'stomach', 'wall']);
        expect(s.deep.has('mucosa')).toBe(false);
        expect(s.emitted.has('gland')).toBe(false);
    });

    it('is the union of every selector, and reports an id the index does not know', () => {
        const s = selectAnatomy(INDEX, [
            { name: 'p::a', seeds: ['stomach'], partDepth: 0 },
            { name: 'p::b', seeds: ['duodenum', 'fma0'], partDepth: 1 },
        ]);
        // The depth walk follows a class's own parts: the wall the duodenum inherits from Organ is not one.
        expect([...s.deep].sort()).toEqual(['bulb', 'duodenum', 'stomach']);
        expect(s.unknown).toEqual([{ selector: 'p::b', id: 'fma0' }]);
    });
});

describe('rendering anatomy', () => {
    const files = renderAnatomy(INDEX, select(['stomach'], 1), 'proj_anatomy_fma', [{ name: 'p::s', seeds: ['stomach'], partDepth: 1 }]);
    const text = [...files.values()].join('\n');

    it('writes one package per home file under a facade that imports them all', () => {
        expect([...files.keys()].sort()).toEqual([
            'proj_anatomy_fma.sysml', 'proj_anatomy_fma_alimentary.sysml', 'proj_anatomy_fma_cardiovascular.sysml', 'proj_anatomy_fma_core.sysml',
        ]);
        const facade = files.get('proj_anatomy_fma.sysml')!;
        for (const home of ['alimentary', 'cardiovascular', 'core']) expect(facade).toContain(`public import proj_anatomy_fma_${home}::*;`);
        expect(facade).toContain('//   p::s: stomach (part depth 1)');
        expect(files.get('proj_anatomy_fma_alimentary.sysml')).toContain('private import proj_anatomy_fma::*;');
    });

    it('roots the anatomy in the extension and keeps the source id as the short name', () => {
        expect(text).toContain('part def <e> AnatomicalEntity :> AnatomyEntity;');
        expect(text).toContain('part def <stomach> Stomach :> Organ {');
        expect(text).toContain('doc /* An organ. */');
    });

    it('names a part for what it is and any other relation for the relation', () => {
        expect(text).toContain('part bodyOfStomach : BodyOfStomach[1..*] :> regionalPartFeatures;');
        expect(text).toContain('ref part continuousWithDuodenum : Duodenum[1..*] :> continuousWithFeatures;');
        expect(text).toContain('ref part arterialSupplyArtery : Artery[1..*] :> arterialSupplyFeatures;');
    });

    it('does not restate a relation a declared ancestor already gives', () => {
        // Organ has the wall as a regional part, and Stomach restates it.
        expect(text).toContain('part wall : Wall[1..*] :> regionalPartFeatures;');
        expect(text.match(/part wall : Wall/g)).toHaveLength(1);
    });

    it('declares a class outside the selection without its own relations', () => {
        // The duodenum is named by the stomach, so it is declared, but its bulb is not.
        expect(text).toContain('part def <duodenum> Duodenum :> Organ;');
        expect(text).not.toContain('Bulb');
    });
});

describe('a relation clash inside one class', () => {
    it('suffixes the relation when one target is reached by two relations of different kinds', () => {
        const files = renderAnatomy(INDEX, select(['loop'], 0), 'p_anatomy_fma', []);
        const core = files.get('p_anatomy_fma_core.sysml')!;
        expect(core).toContain('part bodyOfStomach : BodyOfStomach[1..*] :> regionalPartFeatures;');
        expect(core).toContain('ref part continuousWithBodyOfStomach : BodyOfStomach[1..*] :> continuousWithFeatures;');
    });
});

describe.runIf(compilerConfigured)('reading a project\'s selectors', () => {
    it('reads each selector, and a preset\'s values through the usage that subsets it', async () => {
        const { api } = await compileSources([{
            filePath: 'p.sysml',
            source: `package P {
    private import ScalarValues::*;
    part def AnatomySelector {
        attribute fmaSeeds : String[1..*];
        attribute partDepth : Integer default 2;
    }
    part upperGastrointestinal : AnatomySelector {
        attribute :>> fmaSeeds = ("fma7131", "fma7148");
        attribute :>> partDepth = 3;
    }
    part upperGi :> upperGastrointestinal;
    part vagal : AnatomySelector {
        attribute :>> fmaSeeds = ("fma6226");
        attribute :>> partDepth = 1;
    }
}`,
        }]);
        expect(readAnatomySelectors(api, () => true)).toEqual([
            { name: 'P::upperGastrointestinal', seeds: ['fma7131', 'fma7148'], partDepth: 3 },
            { name: 'P::upperGi', seeds: ['fma7131', 'fma7148'], partDepth: 3 },
            { name: 'P::vagal', seeds: ['fma6226'], partDepth: 1 },
        ]);
    });
});
