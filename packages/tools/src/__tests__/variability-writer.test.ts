import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { outlineSourceFor } from '../authoring/outline-source.js';
import { modelToDTO } from '../model/semantic.js';
import { compatibleRelationshipTargets, legalRelationshipDirections } from '../model/relationship-legality.js';
import { removeRelationship, writeRelationship } from '../server/relationship-writer.js';
import { loadProjectModel, type ProjectModel } from '../toolchain/project-model.js';
import { compilerConfigured, examplesPresent, withExample } from './helpers/compile-source.js';
import { variabilityFiles } from './helpers/variability-fixture.js';

// A7's write path: a typed dependency is written and removed through the same relationship writer as
// every other link, as `#<Qualified> dependency from a to b;` with qualified endpoints, so it resolves
// from whichever file the writer chooses.

const config = { modelName: 'test', toolchain: { compiler: process.env.MEMO_TOOLCHAIN_COMPILER } } as never;
const idOf = (project: ProjectModel, shortName: string) => [...project.model.elements.values()].find(e => e.shortName === shortName)!.id;
const fixtureWithoutRelUsSelection = () => {
    const files = variabilityFiles();
    files['model/catalog/sos/releases.sysml'] = files['model/catalog/sos/releases.sysml']
        .replace('#SelectsFeature dependency from relUs to featUsMarket, featIrrigatedTip;', '#SelectsFeature dependency from relUs to featUsMarket;');
    return files;
};

describe.runIf(compilerConfigured && examplesPresent)('typed dependencies through the relationship writer (A7)', () => {
    it('writes a selection, reads it back as the relation, and removes it', async () => {
        await withExample(fixtureWithoutRelUsSelection(), async (project, root) => {
            const definition = project.registries!.relationshipRegistry!.toDefinitionDTOs().find(d => d.name === 'selectsFeature')!;
            expect(definition.typedDependency).toBe('memo_architecture_variability::SelectsFeature');

            const dto = modelToDTO(project.model);
            const sourceId = idOf(project, 'relUs');
            const targetId = idOf(project, 'featIrrigatedTip');
            const options = { projectRoot: root, outlines: outlineSourceFor(root, config, project), irIndex: undefined as never };
            const written = await writeRelationship(
                { requestId: 'r1', type: 'selectsFeature', sourceId, targetId, direction: 'outgoing' }, definition, dto, options);
            expect(written.error).toBeUndefined();
            expect(written).toMatchObject({ success: true, notation: 'typedDependency' });
            expect(readFileSync(join(root, written.sourceFile!), 'utf8'))
                .toContain(`#memo_architecture_variability::SelectsFeature dependency from ${sourceId} to ${targetId};`);

            const after = await loadProjectModel({ projectRoot: root, config, cache: false });
            const edge = after.model.relationships.find(r => r.type === 'selectsFeature' && r.sourceId === sourceId && r.targetId === targetId)!;
            expect(edge).toBeDefined();

            const removed = await removeRelationship(edge, { ...options, outlines: outlineSourceFor(root, config, after) });
            expect(removed.success).toBe(true);
            const finalModel = await loadProjectModel({ projectRoot: root, config, cache: false });
            expect(finalModel.model.relationships.some(r => r.type === 'selectsFeature' && r.targetId === targetId)).toBe(false);
        }, 'robot-cell-family');
    }, 180_000);

    it('refuses to cut one link out of a statement that declares several', async () => {
        await withExample(variabilityFiles(), async (project, root) => {
            const edge = project.model.relationships.find(r => r.type === 'selectsFeature' && r.targetId === idOf(project, 'featIrrigatedTip'))!;
            const file = join(root, edge.file);
            const before = readFileSync(file, 'utf8');
            const removed = await removeRelationship(edge, { projectRoot: root, outlines: outlineSourceFor(root, config, project), irIndex: undefined as never });
            expect(removed.success).toBe(false);
            expect(removed.error).toContain('several links');
            expect(readFileSync(file, 'utf8')).toBe(before);
        }, 'robot-cell-family');
    }, 180_000);
});

describe.runIf(compilerConfigured && examplesPresent)('requires and excludes through the relationship writer', () => {
    // The Variability page shows them and they were only declarable in source: the connection is written into a
    // package that does not import the features' package, so its type and both ends are named by qualified name.
    for (const type of ['requiresFeature', 'excludesFeature'] as const) {
        it(`writes ${type} between two features in another package, reads it back, and removes it`, async () => {
            await withExample({ ...variabilityFiles(), 'model/catalog/sos/links.sysml': 'package robot_cell_family_links {\n}\n' }, async (project, root) => {
                const definition = project.registries!.relationshipRegistry!.toDefinitionDTOs().find(d => d.name === type)!;
                expect(definition.qualifiedName).toBe(`memo_architecture_variability::${type[0].toUpperCase()}${type.slice(1)}`);

                const dto = modelToDTO(project.model);
                const sourceId = idOf(project, 'featIrrigatedTip');
                const targetId = idOf(project, 'featEuMarket');
                const options = { projectRoot: root, outlines: outlineSourceFor(root, config, project), irIndex: undefined as never };
                const written = await writeRelationship(
                    { requestId: 'r1', type, sourceId, targetId, direction: 'outgoing', owningFile: 'model/catalog/sos/links.sysml' }, definition, dto, options);
                expect(written.error).toBeUndefined();
                expect(written).toMatchObject({ success: true, notation: 'connection' });
                const text = readFileSync(join(root, 'model/catalog/sos/links.sysml'), 'utf8');
                expect(text).toContain(`: ${definition.qualifiedName} connect`);
                expect(text).toContain(`::> ${sourceId} to `);

                const after = await loadProjectModel({ projectRoot: root, config, cache: false });
                const edge = after.model.relationships.find(r => r.type === type && r.sourceId === sourceId && r.targetId === targetId)!;
                expect(edge).toBeDefined();

                const removed = await removeRelationship(edge, { ...options, outlines: outlineSourceFor(root, config, after) });
                expect(removed.error).toBeUndefined();
                expect(removed.success).toBe(true);
                const finalModel = await loadProjectModel({ projectRoot: root, config, cache: false });
                expect(finalModel.model.relationships.some(r => r.type === type && r.sourceId === sourceId && r.targetId === targetId)).toBe(false);
            }, 'robot-cell-family');
        }, 240_000);
    }
});

describe.runIf(compilerConfigured && examplesPresent)('what the relationship picker offers for requires and excludes', () => {
    // The picker asks legality, from the ontology's registries as the server ships them, what may join a feature:
    // the app can only author a link the ontology says is legal between the two elements.
    it('offers RequiresFeature and ExcludesFeature from a feature, and the other features as targets', async () => {
        await withExample(variabilityFiles(), project => {
            const registries = {
                relationships: project.registries!.relationshipRegistry!.toDefinitionDTOs(),
                kinds: project.registries!.kindRegistry!.toDefinitionDTOs(),
            };
            const dto = modelToDTO(project.model);
            const feature = dto.elements[idOf(project, 'featIrrigatedTip')];
            const other = idOf(project, 'featEuMarket');
            for (const type of ['requiresFeature', 'excludesFeature']) {
                const definition = registries.relationships.find(d => d.name === type)!;
                expect(legalRelationshipDirections(feature, definition, registries), type).toContain('outgoing');
                const targets = compatibleRelationshipTargets(feature, definition, 'outgoing', dto, registries);
                expect(targets.map(t => t.element.id), type).toContain(other);
                expect(targets.map(t => t.element.id), type).not.toContain(feature.id);
            }
        }, 'robot-cell-family');
    }, 180_000);
});

