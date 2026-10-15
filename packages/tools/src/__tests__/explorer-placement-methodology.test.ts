import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { apiPackageMetadata } from '../stage2/package-metadata-from-api.js';
import { compiledExample, compilerConfigured, examplesPresent } from './helpers/compile-source.js';

// A new model's binding (`ModelMethodBinding`) is the method's, not evidence. The ontology declares it
// in methodology/core, and `core` alone is also artifacts/core (evidence): a group name is only unique
// inside its layer, so the classification is read `layer/group` first.

describe.runIf(compilerConfigured && examplesPresent)('explorer placement of the method definitions', () => {
    it('places the model binding in the methodology domain, not in assurance evidence', async () => {
        const project = await compiledExample('robot-cell-family');
        const root = resolve(__dirname, '../../../../../memo/examples/robot-cell-family');
        const packages = apiPackageMetadata(project.api, root);
        const placed = new Map<string, { domain: string; group?: string }>();
        for (const pkg of packages) for (const layer of pkg.layers) for (const kind of layer.kinds) placed.set(kind.name, { domain: layer.id, group: kind.group });
        expect(placed.get('ModelMethodBinding')).toEqual({ domain: 'methodology', group: 'methodology' });
        expect(placed.get('MethodologyDefinition')?.domain).toBe('methodology');
        // The artifacts' own `core` is still evidence.
        const artifactsCore = [...placed.entries()].filter(([, p]) => p.domain === 'assurance' && p.group === 'evidence');
        expect(artifactsCore.length).toBeGreaterThan(0);
        expect(artifactsCore.map(([name]) => name)).not.toContain('ModelMethodBinding');
    }, 180_000);
});
