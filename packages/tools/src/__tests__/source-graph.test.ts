import { describe, expect, it } from 'vitest';
import { compileSources, compilerConfigured, stubKinds } from './helpers/compile-source.js';
import { apiProjectSourcePackages } from '../stage2/project-from-api.js';
import {
    buildSourceGraphFromPackages, sourceGraphToDTO, viewSourceFiles,
} from '../model/source-graph.js';
import { affectedBy, affectingFiles, changeAffects } from '../model/source-affinity.js';
import type { MemoElement } from '../model/semantic.js';

/** Compile a set of in-memory SysML files, keeping project-relative paths, and take their source graph. */
async function parseProject(files: Record<string, string>) {
    const { api, root } = await compileSources(
        Object.entries(files).map(([filePath, source]) => ({ filePath, source })),
        { asGiven: true, stubs: stubKinds(['PartDef']) });
    const { packages, files: projectFiles } = apiProjectSourcePackages(api, root);
    // The padding document the helper adds is not part of what a test declares.
    const own = (file: string) => !file.endsWith('__stubs.sysml');
    return buildSourceGraphFromPackages(
        packages.map(entry => ({ ...entry, files: [...entry.files].filter(own) })).filter(entry => [...entry.files].length > 0),
        [...projectFiles].filter(own));
}

function element(id: string, file: string): MemoElement {
    return { id, name: id, kind: 'SoftwareComponent', construct: 'part', layer: 'software', file, attributes: {} };
}

describe.runIf(compilerConfigured)('the source graph of a compiled project', () => {
    it('links a file to the file declaring the package it imports', async () => {
        const graph = await parseProject({
            'model/views/architecture.sysml': 'package Views { private import Catalog::*; }\n',
            'model/catalog/parts.sysml': 'package Catalog { part pump : PartDef; }\n',
        });

        expect([...graph.dependsOn.get('model/views/architecture.sysml')!])
            .toEqual(['model/catalog/parts.sysml']);
        // And the reverse edge, so a change can be pushed to its dependents.
        expect([...graph.dependents.get('model/catalog/parts.sysml')!])
            .toEqual(['model/views/architecture.sysml']);
    });

    it('follows imports transitively', async () => {
        const graph = await parseProject({
            'model/a.sysml': 'package A { private import B::*; }\n',
            'model/b.sysml': 'package B { private import C::*; }\n',
            'model/c.sysml': 'package C { part leaf : PartDef; }\n',
        });

        expect([...graph.dependsOn.get('model/a.sysml')!].sort())
            .toEqual(['model/b.sysml', 'model/c.sysml']);
    });

    it('terminates on an import cycle without listing the file as its own dependency', async () => {
        const graph = await parseProject({
            'model/a.sysml': 'package A { private import B::*; }\n',
            'model/b.sysml': 'package B { private import A::*; }\n',
        });

        expect([...graph.dependsOn.get('model/a.sysml')!]).toEqual(['model/b.sysml']);
        expect(graph.dependsOn.get('model/a.sysml')!.has('model/a.sysml')).toBe(false);
    });

    it('reaches nested packages through a parent-package import', async () => {
        const graph = await parseProject({
            'model/a.sysml': 'package A { private import Lib::*; }\n',
            'model/lib.sysml': 'package Lib { package Inner { part p : PartDef; } }\n',
        });

        expect([...graph.dependsOn.get('model/a.sysml')!]).toEqual(['model/lib.sysml']);
    });

    it('gives a file with no imports an empty dependency set rather than omitting it', async () => {
        const graph = await parseProject({ 'model/solo.sysml': 'package Solo { }\n' });
        expect(graph.dependsOn.get('model/solo.sysml')).toEqual(new Set());
    });

    it('survives a package with no name instead of taking the rebuild down', async () => {
        // An unnamed package has no qualified name to index by. Indexing it
        // anyway put an undefined key in the package→files map, and the prefix
        // scan then called .startsWith on it — a TypeError that failed the
        // whole rebuild, not just this file. Source that is mid-edit and not
        // yet well-formed is an ordinary state (§1.1), so it has to be a file
        // that contributes nothing rather than an exception.
        const graph = await parseProject({
            'model/anonymous.sysml': 'package { part def P; }\n',
            'model/importer.sysml': 'package Importer { }\n',
        });
        expect([...graph.dependsOn.keys()].sort())
            .toEqual(['model/anonymous.sysml', 'model/importer.sysml']);
        // It resolves to nothing — it cannot satisfy an import it has no name for
        // (an import of a package nothing declares is a stage 1 error, so none reaches here).
        expect(graph.dependsOn.get('model/importer.sysml')).toEqual(new Set());
    });
});

describe('viewSourceFiles', () => {
    it('covers the view source, its element files, and their import closure', async () => {
        const graph = await parseProject({
            'model/views/overview.sysml': 'package Views { private import Catalog::*; }\n',
            'model/catalog/parts.sysml': 'package Catalog { private import Shared::*; }\n',
            'model/shared/types.sysml': 'package Shared { }\n',
            'model/other/unrelated.sysml': 'package Other { }\n',
        });

        const files = viewSourceFiles(
            { sourceFile: 'model/views/overview.sysml', elementIds: ['pump'] },
            { pump: element('pump', 'model/catalog/parts.sysml') },
            graph,
        );

        expect(files).toEqual([
            'model/catalog/parts.sysml',
            'model/shared/types.sysml',
            'model/views/overview.sysml',
        ]);
        expect(files).not.toContain('model/other/unrelated.sysml');
    });

    it('accepts a Map of elements as well as a record', async () => {
        const graph = await parseProject({ 'model/catalog/parts.sysml': 'package Catalog { }\n' });
        const files = viewSourceFiles(
            { elementIds: ['pump'] },
            new Map([['pump', element('pump', 'model/catalog/parts.sysml')]]),
            graph,
        );
        expect(files).toEqual(['model/catalog/parts.sysml']);
    });

    it('reports nothing for a view with neither a source file nor known elements', async () => {
        const graph = await parseProject({ 'model/a.sysml': 'package A { }\n' });
        expect(viewSourceFiles({ elementIds: ['missing'] }, {}, graph)).toEqual([]);
    });
});

describe('source affinity', () => {
    it('treats a file as affected by itself and by what it imports', async () => {
        const graph = sourceGraphToDTO(await parseProject({
            'model/a.sysml': 'package A { private import B::*; }\n',
            'model/b.sysml': 'package B { }\n',
        }));

        expect([...affectingFiles('model/a.sysml', graph)].sort())
            .toEqual(['model/a.sysml', 'model/b.sysml']);
        expect(changeAffects(['model/b.sysml'], affectingFiles('model/a.sysml', graph))).toBe(true);
    });

    it('does not treat an unrelated change as affecting the view', () => {
        expect(changeAffects(['model/other.sysml'], ['model/a.sysml'])).toBe(false);
    });

    it('claims nothing when the dependency set is unknown', () => {
        expect(changeAffects(['model/a.sysml'], [])).toBe(false);
    });

    it('names which of the changed files were the relevant ones', () => {
        expect(affectedBy(['model/a.sysml', 'model/x.sysml'], ['model/a.sysml']))
            .toEqual(['model/a.sysml']);
    });
});
