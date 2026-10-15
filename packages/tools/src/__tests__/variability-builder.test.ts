import { describe, expect, it } from 'vitest';
import { selectRelease } from '../model/variability.js';
import { computeWorkspaceMembership } from '../model/workspace-membership.js';
import type { ProjectModel } from '../toolchain/project-model.js';
import { compilerConfigured, examplesPresent, withExample } from './helpers/compile-source.js';
import { variabilityFiles } from './helpers/variability-fixture.js';

// T4: design options in the builder. E0 has no variation, so the fixture seeds it
// (`helpers/variability-fixture.ts`). Before T4 an owned `variant part` was a plain part with
// a `composes` edge, `isVariation` was dropped, and every `#Name dependency` was an untyped
// `dependency`.

const nameOf = (project: ProjectModel) => (id: string) => project.model.elements.get(id)?.shortName ?? id;
const edges = (project: ProjectModel, ...types: string[]) => {
    const name = nameOf(project);
    return project.model.relationships.filter(r => types.includes(r.type)).map(r => `${r.type}: ${name(r.sourceId)} -> ${name(r.targetId)}`).sort();
};
const idOf = (project: ProjectModel, shortName: string) => [...project.model.elements.values()].find(e => e.shortName === shortName)!.id;
const withVariability = <T>(use: (project: ProjectModel) => T | Promise<T>) => withExample(variabilityFiles(), use, 'robot-cell-family');

describe.runIf(compilerConfigured && examplesPresent)('variation and variants in the builder (T4)', () => {
    it('marks a variation point, and only it, from the handoff flag', async () => {
        await withVariability(project => {
            const flag = (name: string) => project.model.elements.get(idOf(project, name))!.attributes.isVariation;
            expect(flag('outputStage')).toBe('true');
            expect(flag('euOutput')).toBeUndefined();
            expect(flag('motionController')).toBeUndefined();
        });
    }, 120_000);

    it('builds a variant edge for an owned variant, variation point first', async () => {
        await withVariability(project => {
            expect(edges(project, 'variant')).toEqual(['variant: outputStage -> euOutput', 'variant: outputStage -> usOutput']);
        });
    }, 120_000);

    it('builds each typed dependency as its relation, and no plain dependency beside it', async () => {
        await withVariability(project => {
            expect(edges(project, 'realizesFeature')).toEqual([
                'realizesFeature: euOutput -> featEuMarket', 'realizesFeature: usOutput -> featUsMarket']);
            expect(edges(project, 'selectsFeature')).toEqual([
                'selectsFeature: relEu -> featEuMarket', 'selectsFeature: relUs -> featIrrigatedTip', 'selectsFeature: relUs -> featUsMarket']);
            expect(edges(project, 'alternative')).toEqual(['alternative: decOutputStage -> euOutput', 'alternative: decOutputStage -> usOutput']);
            expect(edges(project, 'selected')).toEqual(['selected: decOutputStage -> euOutput']);
            const typedSources = new Set(['euOutput', 'usOutput', 'relEu', 'relUs', 'decOutputStage']);
            const name = nameOf(project);
            expect(project.model.relationships.filter(r => r.type === 'dependency' && typedSources.has(name(r.sourceId)))).toEqual([]);
        });
    }, 120_000);

    it('selects different variants for the EU and US releases', async () => {
        await withVariability(project => {
            const name = nameOf(project);
            const view = (record: string) => selectRelease(project.model, idOf(project, record));
            const eu = view('relEu');
            const us = view('relUs');
            expect(eu.points.map(p => p.selected.map(name))).toEqual([['euOutput']]);
            expect(us.points.map(p => p.selected.map(name))).toEqual([['usOutput']]);
            expect([...eu.excluded].map(name)).toEqual(['usOutput']);
            expect([...us.excluded].map(name)).toEqual(['euOutput']);
            expect(eu.features.map(name)).toEqual(['featEuMarket']);
        });
    }, 120_000);

    it('places a feature with the system whose variant realizes it', async () => {
        await withVariability(project => {
            const membership = computeWorkspaceMembership(project.model, project.registries!);
            const systems = (name: string) => (membership.systems.get(idOf(project, name)) ?? []).map(nameOf(project));
            expect(systems('featEuMarket')).toEqual(['OutputStageSystem']);
            expect(systems('featUsMarket')).toEqual(['OutputStageSystem']);
            // Required by a feature, but realized by no variant: nothing places it.
            expect(membership.unassigned.map(nameOf(project))).toContain('featIrrigatedTip');
        });
    }, 120_000);
});
