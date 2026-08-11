// ─── Extension packages ──────────────────────────────────────────────────────
//
// An extension is a reusable ontology package that specializes the base and is
// selected by a methodology or a project binding. Two properties have to hold
// at once, and each was broken in a different direction before session 4:
//
//   1. A project that IMPORTS an extension gets its kinds registered, placed
//      where the base type they specialize is placed. Extensions were not
//      library roots at all, so every extension type came back unregistered —
//      visible by name, with no layer, no supertype, and no legality.
//   2. A project that does NOT import one gets nothing from it. Making them
//      library roots exposed the opposite defect: `validate` treated every
//      resolved-but-unimported root as the project's own source, so an
//      extension's usages were counted as an unrelated project's content.
// ─────────────────────────────────────────────────────────────────────────────

import { describe, it, expect } from 'vitest';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadOntologyRegistries } from '../model/ontology-loader.js';
import { resolveNativeProject } from '../model/native-project.js';
import { resolveContentPackageRoot } from '../model/paths.js';

const CONTENT_ROOT = resolveContentPackageRoot();
const ROS_PROJECT = resolve(CONTENT_ROOT, 'examples/ros-mobile-robot');
const PLAIN_PROJECT = resolve(CONTENT_ROOT, 'examples/temperature-alarm');

describe.runIf(existsSync(ROS_PROJECT))('a project that imports an extension', () => {
    it('registers the extension kinds, placed by what they specialize', async () => {
        const { registries } = await loadOntologyRegistries(ROS_PROJECT);
        // The project imports the base ontology and the extension, so both
        // registries are a required part of this acceptance fixture. The
        // public loader type keeps them optional for lightweight callers.
        expect(registries.kindRegistry).toBeDefined();
        expect(registries.relationshipRegistry).toBeDefined();
        const kinds = registries.kindRegistry!;

        // Declared in extensions/ros/src, which is under no `src/<layer>/`
        // path — so placement can only come from the specialization.
        expect(kinds.getKind('RosNode')).toMatchObject({
            superType: 'SoftwareComponent', layer: 'implementation',
        });
        // Two links up: RosContainerImage -> ContainerImage -> DeploymentUnit.
        expect(kinds.getKind('RosContainerImage')).toMatchObject({
            superType: 'ContainerImage', layer: 'realization',
        });
        expect(kinds.getKind('ContainerImage')?.layer).toBe('realization');

        // The relations an extension declares are registered too, which is
        // what makes rule 1 of extensions/README.md worth allowing.
        const names = new Set(registries.relationshipRegistry!.entries().map(entry => entry.name));
        expect(names).toContain('rosPublishesTo');
        expect(names).toContain('rosSubscribesTo');
        // And the base relations the ROS deployment chain reuses unchanged.
        for (const base of ['buildsInto', 'deploysTo', 'providesEnvironment']) {
            expect(names).toContain(base);
        }
    });
});

describe.runIf(existsSync(PLAIN_PROJECT))('a project that imports no extension', () => {
    it('reaches no extension package and treats none of them as its own source', async () => {
        const resolution = await resolveNativeProject(PLAIN_PROJECT);

        const reached = [...resolution.closure.keys()].filter(name => name.includes('memo_extension'));
        expect(reached).toEqual([]);

        // Every extension root is offered by the manifest and reached by no
        // import, so each is an unused root — and `validate` computes project
        // source by subtracting selected AND unused roots alike.
        const unusedDirs = resolution.unusedRoots.map(root => root.sysmlDir);
        expect(unusedDirs.some(dir => dir.includes(`extensions`))).toBe(true);

        const projectSource = resolution.documents.filter(doc =>
            ![...resolution.selectedRoots, ...resolution.unusedRoots]
                .some(root => doc.filePath.startsWith(root.sysmlDir)));
        expect(projectSource.every(doc => !doc.filePath.includes('/extensions/'))).toBe(true);
        expect(projectSource.length).toBeGreaterThan(0);
    });
});
