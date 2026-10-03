import { describe, expect, it } from 'vitest';
import { ApiModel, type ApiElement, type Stage1Output } from '../stage2/api-model.js';
import { apiEnumerations, apiProjectSourcePackages } from '../stage2/project-from-api.js';
import { buildSourceGraphFromPackages, sourceGraphToDTO } from '../model/source-graph.js';

// Two project files and a library file, as a stage 1 handoff states them:
//   model/a.sysml   package a { import b::*; import lib::*; enum def Mode { enum on; enum off; } }
//   model/b.sysml   package b;
//   model/notes.sysml  (no package)
//   core/lib.sysml  library package lib { enum def Level { enum low; } }
const projectDir = '/work/app';
const ref = (id: string) => ({ '@id': id });
const elements: ApiElement[] = [];
const index: NonNullable<Stage1Output['index']> = {};
let n = 0;

function add(element: Omit<ApiElement, '@id'>, file: string, role: 'project' | 'library', qualifiedName?: string): ApiElement {
    const full = { ...element, '@id': `e${++n}` } as ApiElement;
    elements.push(full);
    index[full['@id']] = { file, role, root: role === 'project' ? projectDir : '/work/lib', ...(qualifiedName ? { qualifiedName } : {}) };
    return full;
}

function own(owner: ApiElement, member: ApiElement, file: string, role: 'project' | 'library'): void {
    const membership = add({ '@type': 'OwningMembership', ownedRelatedElement: [ref(member['@id'])], memberElement: ref(member['@id']) }, file, role);
    ((owner.ownedRelationship ??= []) as unknown[]).push(ref(membership['@id']));
    member.owningRelationship = ref(membership['@id']);
    membership.owningRelatedElement = ref(owner['@id']);
}

function document(file: string, role: 'project' | 'library'): ApiElement {
    return add({ '@type': 'Namespace' }, file, role);
}

function enumDef(owner: ApiElement, name: string, literals: string[], file: string, role: 'project' | 'library'): void {
    const definition = add({ '@type': 'EnumerationDefinition', declaredName: name }, file, role);
    own(owner, definition, file, role);
    for (const literal of literals) own(definition, add({ '@type': 'EnumerationUsage', declaredName: literal }, file, role), file, role);
}

const libDoc = document('core/lib.sysml', 'library');
const lib = add({ '@type': 'LibraryPackage', declaredName: 'lib' }, 'core/lib.sysml', 'library', 'lib');
own(libDoc, lib, 'core/lib.sysml', 'library');
enumDef(lib, 'Level', ['low'], 'core/lib.sysml', 'library');

const bDoc = document('model/b.sysml', 'project');
const b = add({ '@type': 'Package', declaredName: 'b' }, 'model/b.sysml', 'project', 'b');
own(bDoc, b, 'model/b.sysml', 'project');

const aDoc = document('model/a.sysml', 'project');
const a = add({ '@type': 'Package', declaredName: 'a' }, 'model/a.sysml', 'project', 'a');
own(aDoc, a, 'model/a.sysml', 'project');
for (const target of [b, lib]) {
    const imported = add({ '@type': 'NamespaceImport', importedNamespace: ref(target['@id']) }, 'model/a.sysml', 'project');
    ((a.ownedRelationship ??= []) as unknown[]).push(ref(imported['@id']));
}
enumDef(a, 'Mode', ['on', 'off'], 'model/a.sysml', 'project');

document('model/notes.sysml', 'project');

const handoff = new ApiModel({
    format: 'memo-stage1/1', provider: 'test', clean: true, index,
    documents: ['core/lib.sysml', 'model/a.sysml', 'model/b.sysml', 'model/notes.sysml'].map(file => ({
        file,
        role: file.startsWith('core/') ? 'library' as const : 'project' as const,
        root: file.startsWith('core/') ? '/work/lib' : projectDir,
        elements: elements.filter(e => index[e['@id']]?.file === file),
    })),
});

describe('memo dev facts read from a stage 1 handoff', () => {
    it('builds the view source graph over the project files, named relative to the project', () => {
        const { packages, files } = apiProjectSourcePackages(handoff, projectDir);
        expect(files.sort()).toEqual(['model/a.sysml', 'model/b.sysml', 'model/notes.sysml']);
        const graph = buildSourceGraphFromPackages(packages, files);
        // a imports b, and the library file is not a project file.
        expect(sourceGraphToDTO(graph)).toEqual({ dependsOn: { 'model/a.sysml': ['model/b.sysml'] } });
        expect(graph.dependsOn.get('model/notes.sysml')).toEqual(new Set());
    });

    it('reads the project\'s enumerations, not the library\'s', () => {
        expect(apiEnumerations(handoff)).toEqual([{ name: 'Mode', literals: ['on', 'off'] }]);
    });
});
