import { describe, expect, it } from 'vitest';
import { compilerConfigured, examplesPresent, withExample } from './helpers/compile-source.js';
import { variabilityFiles } from './helpers/variability-fixture.js';

// O5, O15 and the release shell: features, design options and design decisions with typed
// options, as the ontology declares them. Seeded onto E0 (`helpers/variability-fixture.ts`)
// because E0 has no variation yet. These are the ontology's own constructs compiled; what the
// builder makes of them is `variability-builder.test.ts`.

const withVariability = <T>(use: Parameters<typeof withExample<T>>[1], files: Record<string, string> = variabilityFiles()) =>
    withExample(files, use, 'robot-cell-family');

describe.runIf(compilerConfigured && examplesPresent)('features and design options (O5, O15)', () => {
    it('compiles features, a variation point with variants, a release and a decision', async () => {
        await withVariability(project => {
            const kindOf = (name: string) => [...project.model.elements.values()].find(e => e.shortName === name)?.kind;
            expect(kindOf('featEuMarket')).toBe('ProductFeature');
            expect(kindOf('relEu')).toBe('ReleaseRecord');
            expect(kindOf('decOutputStage')).toBe('DesignDecision');
            expect(kindOf('euOutput')).toBe('LogicalComponent');
        });
    }, 120_000);

    it('builds requires and excludes between features as relations, source first', async () => {
        await withVariability(project => {
            const name = (id: string) => project.model.elements.get(id)?.shortName;
            const edges = [...project.model.relationships.values()]
                .filter(r => r.type === 'requiresFeature' || r.type === 'excludesFeature')
                .map(r => `${r.type}: ${name(r.sourceId)} -> ${name(r.targetId)}`).sort();
            expect(edges).toEqual([
                'excludesFeature: featEuMarket -> featUsMarket',
                'requiresFeature: featIrrigatedTip -> featUsMarket',
            ]);
        });
    }, 120_000);

    it('declares the typed dependencies, so a misspelt one does not compile', async () => {
        const files = variabilityFiles();
        files['model/catalog/sos/releases.sysml'] = files['model/catalog/sos/releases.sysml'].replace('#SelectsFeature dependency from relEu', '#SelectsFeatur dependency from relEu');
        await expect(withVariability(() => 'compiled', files)).rejects.toThrow(/SelectsFeatur/);
    }, 120_000);

    it('has no string options on a design decision: they are typed links to variants', async () => {
        const files = variabilityFiles();
        files['model/catalog/sos/decisions.sysml'] = files['model/catalog/sos/decisions.sysml'].replace(
            '#Selected dependency', 'attribute :>> selectedOption = "euOutput";\n        #Selected dependency');
        await expect(withVariability(() => 'compiled', files)).rejects.toThrow(/selectedOption/);
    }, 120_000);
});
