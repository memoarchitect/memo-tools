import { describe, expect, it } from 'vitest';
import { openSysMLHandoff } from '../toolchain/providers/opensysml-lowering.js';
import type { ApiElement } from '../stage2/api-model.js';

// Two documents of one model as OpenSysML's API JSON writes them: one root
// namespace for the whole model, each document's root carrying
// sysx:sourceDocument, positions on declared elements, and a standard library
// element the model references, stated under its normative id.
const project = '/work/project';
const library = '/work/library';
const app = `${project}/app.sysml`;
const lib = `${library}/core/lib.sysml`;
const appText = 'package App {\n    part e : Engine;\n}\n';
const libText = 'package Lib { part def Engine; }\n';

const elements: ApiElement[] = [
    { '@type': 'Namespace', '@id': 'App_ns', ownedRelationship: [{ '@id': 'App_om' }, { '@id': 'Lib_om' }] },
    { '@type': 'OwningMembership', '@id': 'App_om', memberElement: { '@id': 'App' }, ownedRelatedElement: [{ '@id': 'App' }], owningRelatedElement: { '@id': 'App_ns' } },
    { '@type': 'OwningMembership', '@id': 'Lib_om', memberElement: { '@id': 'Lib' }, ownedRelatedElement: [{ '@id': 'Lib' }], owningRelatedElement: { '@id': 'App_ns' } },
    {
        '@type': 'Package', '@id': 'App', qualifiedName: 'App', 'sysx:sourceDocument': app,
        'sysx:sourceLine': 1, 'sysx:sourceColumn': 1, 'sysx:sourceEndLine': 3, 'sysx:sourceEndColumn': 2,
        owningRelationship: { '@id': 'App_om' },
    },
    {
        '@type': 'PartUsage', '@id': 'App__e', qualifiedName: 'App::e',
        'sysx:sourceLine': 2, 'sysx:sourceColumn': 5, 'sysx:sourceEndLine': 2, 'sysx:sourceEndColumn': 21,
        owner: { '@id': 'App' }, ownedRelationship: [{ '@id': 'App__e_ft0' }],
    },
    { '@type': 'FeatureTyping', '@id': 'App__e_ft0', owner: { '@id': 'App__e' }, type: { '@id': 'Lib__Engine' } },
    {
        '@type': 'Package', '@id': 'Lib', qualifiedName: 'Lib', 'sysx:sourceDocument': lib,
        'sysx:sourceLine': 1, 'sysx:sourceColumn': 1, 'sysx:sourceEndLine': 1, 'sysx:sourceEndColumn': 33,
        owningRelationship: { '@id': 'Lib_om' },
    },
    { '@type': 'PartDefinition', '@id': 'Lib__Engine', qualifiedName: 'Lib::Engine', owner: { '@id': 'Lib' } },
    {
        '@type': 'DataType', '@id': '14c0aa22-5489-59b5-b438-ded26e83ba31', qualifiedName: 'ScalarValues::Real',
        declaredName: 'Real', isLibraryElement: true,
    },
];

const handoff = openSysMLHandoff(elements, {
    projectDir: project,
    libraryDirs: [library],
    providerVersion: 'test',
    source: path => (path === app ? Buffer.from(appText) : path === lib ? Buffer.from(libText) : undefined),
});

describe('the OpenSysML stage 1 handoff', () => {
    it('groups each element under the document its root names, with its role', () => {
        const byFile = Object.fromEntries((handoff.documents ?? []).map(d => [d.file, d]));
        expect(Object.keys(byFile).sort()).toEqual(['app.sysml', 'core/lib.sysml']);
        expect(byFile['app.sysml'].role).toBe('project');
        expect(byFile['core/lib.sysml'].role).toBe('library');
        const ids = (file: string) => byFile[file].elements.map(e => e['@id']);
        expect(ids('app.sysml')).toEqual(expect.arrayContaining(['App', 'App__e', 'App__e_ft0', 'App_om']));
        expect(ids('core/lib.sysml')).toEqual(expect.arrayContaining(['Lib', 'Lib__Engine', 'Lib_om']));
    });

    it('gives each document a root namespace owning only its own roots', () => {
        const roots = (handoff.documents ?? []).map(d => ({
            file: d.file,
            owned: d.elements.filter(e => e['@type'] === 'Namespace')
                .flatMap(e => (e.ownedRelationship as { '@id': string }[]).map(r => r['@id'])),
        }));
        expect(roots).toEqual(expect.arrayContaining([
            { file: 'app.sysml', owned: ['App_om'] },
            { file: 'core/lib.sysml', owned: ['Lib_om'] },
        ]));
        const all = (handoff.documents ?? []).flatMap(d => d.elements.map(e => e['@id']));
        expect(all).not.toContain('App_ns');
    });

    it('indexes positions as lines, columns and byte offsets', () => {
        expect(handoff.index?.['App__e']).toEqual({
            file: 'app.sysml', role: 'project', qualifiedName: 'App::e',
            line: 2, column: 5, startByte: 18, endByte: 34,
        });
        expect(appText.slice(18, 34)).toBe('part e : Engine;');
    });

    it('indexes a referenced standard library element by name and does not export it', () => {
        expect(handoff.index?.['14c0aa22-5489-59b5-b438-ded26e83ba31']).toEqual({ role: 'standard', qualifiedName: 'ScalarValues::Real' });
        const all = (handoff.documents ?? []).flatMap(d => d.elements.map(e => e['@id']));
        expect(all).not.toContain('14c0aa22-5489-59b5-b438-ded26e83ba31');
    });

    it('is a clean memo-stage1/1 handoff from opensysml', () => {
        expect(handoff).toMatchObject({ format: 'memo-stage1/1', provider: 'opensysml', providerVersion: 'test', clean: true });
    });
});
