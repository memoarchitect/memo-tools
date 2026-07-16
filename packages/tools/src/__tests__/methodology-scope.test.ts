import { describe, it, expect } from 'vitest';
import { extractScopeInfo } from '../model/methodology-loader.js';
import type { MethodologyPart } from '../model/methodology-loader.js';

function makeScopePart(multi: Record<string, string[]>): MethodologyPart {
    const attributes: Record<string, string> = {};
    const multiAttributes: Record<string, string[]> = {};
    for (const [key, values] of Object.entries(multi)) {
        multiAttributes[key] = values;
        if (values.length > 0) attributes[key] = values[values.length - 1];
    }
    return {
        partName: 'testScope',
        partType: 'MethodologyScope',
        attributes: { id: 'SCOPE-TEST', scopeName: 'test', ...attributes },
        multiAttributes: { id: ['SCOPE-TEST'], scopeName: ['test'], ...multiAttributes },
        sourceFile: 'test.sysml',
    };
}

describe('extractScopeInfo', () => {
    it('extracts multi-valued includedViewpointTypes', () => {
        const part = makeScopePart({
            includedViewpointType: ['VP-CTX', 'VP-RISK', 'VP-CYB'],
        });
        const scope = extractScopeInfo(part);
        expect(scope.includedViewpointTypes).toEqual(['VP-CTX', 'VP-RISK', 'VP-CYB']);
    });

    it('extracts multi-valued includedArchLayers', () => {
        const part = makeScopePart({
            includedArchLayer: ['risk', 'context'],
        });
        const scope = extractScopeInfo(part);
        expect(scope.includedArchLayers).toEqual(['risk', 'context']);
    });

    it('filters out empty strings', () => {
        const part = makeScopePart({
            includedArtifactKind: [''],
            includedViewpointType: ['VP-CTX', '', 'VP-LOG'],
        });
        const scope = extractScopeInfo(part);
        expect(scope.includedArtifactKinds).toEqual([]);
        expect(scope.includedViewpointTypes).toEqual(['VP-CTX', 'VP-LOG']);
    });

    it('returns empty arrays when attributes missing', () => {
        const part: MethodologyPart = {
            partName: 'emptyScope',
            partType: 'MethodologyScope',
            attributes: { id: 'SCOPE-EMPTY', scopeName: 'empty' },
            multiAttributes: {},
            sourceFile: 'test.sysml',
        };
        const scope = extractScopeInfo(part);
        expect(scope.includedArchLayers).toEqual([]);
        expect(scope.includedStandards).toEqual([]);
        expect(scope.includedArtifactKinds).toEqual([]);
        expect(scope.includedViewpointTypes).toEqual([]);
        expect(scope.excludedKinds).toEqual([]);
    });
});
