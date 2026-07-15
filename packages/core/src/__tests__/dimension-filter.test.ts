import { describe, it, expect } from 'vitest';
import { filterKindsByDimension, isKindExcluded } from '../model/dimension-filter.js';
import type { OntologyKindInfo } from '../model/ontology-loader.js';
import type { MethodologyScopeInfo } from '../model/methodology-loader.js';

function makeKind(overrides: Partial<OntologyKindInfo>): OntologyKindInfo {
    return {
        name: 'TestKind',
        label: 'Test Kind',
        construct: 'part def',
        layer: 'risk',
        instanceCount: 0,
        viewpoints: [],
        ...overrides,
    };
}

function makeScope(overrides: Partial<MethodologyScopeInfo> = {}): MethodologyScopeInfo {
    return {
        id: 'SCOPE-001',
        scopeName: 'test',
        includedArchLayers: [],
        includedStandards: [],
        includedArtifactKinds: [],
        includedViewpointTypes: [],
        excludedKinds: [],
        ...overrides,
    };
}

describe('filterKindsByDimension', () => {
    const hazard = makeKind({ name: 'Hazard', layer: 'risk', standard: 'iso-14971', viewpoints: ['VP-RISK'] });
    const threat = makeKind({ name: 'Threat', layer: 'cybersecurity', viewpoints: ['VP-CYB'] });
    const actor = makeKind({ name: 'Actor', layer: 'context', viewpoints: ['VP-CTX'] });
    const allKinds = [hazard, threat, actor];

    it('passes all kinds through when scope is null', () => {
        expect(filterKindsByDimension(allKinds, 'archLayer', null)).toEqual(allKinds);
    });

    it('passes all kinds through when included set is empty', () => {
        const scope = makeScope();
        expect(filterKindsByDimension(allKinds, 'archLayer', scope)).toEqual(allKinds);
    });

    it('filters by archLayer', () => {
        const scope = makeScope({ includedArchLayers: ['risk'] });
        const result = filterKindsByDimension(allKinds, 'archLayer', scope);
        expect(result).toEqual([hazard]);
    });

    it('filters by standard', () => {
        const scope = makeScope({ includedStandards: ['iso-14971'] });
        const result = filterKindsByDimension(allKinds, 'standard', scope);
        expect(result).toEqual([hazard]);
    });

    it('filters by viewpointType', () => {
        const scope = makeScope({ includedViewpointTypes: ['VP-RISK', 'VP-CTX'] });
        const result = filterKindsByDimension(allKinds, 'viewpointType', scope);
        expect(result).toEqual([hazard, actor]);
    });

    it('filters by artifactKind (matches kind name)', () => {
        const scope = makeScope({ includedArtifactKinds: ['Threat'] });
        const result = filterKindsByDimension(allKinds, 'artifactKind', scope);
        expect(result).toEqual([threat]);
    });

    it('returns empty when no kinds match included set', () => {
        const scope = makeScope({ includedArchLayers: ['nonexistent'] });
        expect(filterKindsByDimension(allKinds, 'archLayer', scope)).toEqual([]);
    });

    it('handles multiple included values', () => {
        const scope = makeScope({ includedArchLayers: ['risk', 'context'] });
        const result = filterKindsByDimension(allKinds, 'archLayer', scope);
        expect(result).toEqual([hazard, actor]);
    });
});

describe('isKindExcluded', () => {
    const hazard = makeKind({ name: 'Hazard' });

    it('returns false when scope is null', () => {
        expect(isKindExcluded(hazard, null)).toBe(false);
    });

    it('returns false when excludedKinds is empty', () => {
        expect(isKindExcluded(hazard, makeScope())).toBe(false);
    });

    it('returns true when kind name is in excludedKinds', () => {
        const scope = makeScope({ excludedKinds: ['Hazard', 'SOUPComponent'] });
        expect(isKindExcluded(hazard, scope)).toBe(true);
    });

    it('returns false when kind name is not in excludedKinds', () => {
        const scope = makeScope({ excludedKinds: ['SOUPComponent'] });
        expect(isKindExcluded(hazard, scope)).toBe(false);
    });
});
