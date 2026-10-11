import { describe, expect, it } from 'vitest';
import { ApiModel, type ApiElement, type Stage1Output } from '../stage2/api-model.js';
import { apiNativeUsages, apiPackageIndex } from '../stage2/project-from-api.js';
import type { LibraryRoot } from '../model/native-project.js';
import { apiMethodologyDocuments } from '../stage2/methodology-from-api.js';

// A project document and a library document as a stage 1 compiler's API JSON
// states them, each naming the root its file is relative to.
const projectDir = '/work/app';
const libraryDir = '/work/lib';
const ref = (id: string) => ({ '@id': id });
const elements: ApiElement[] = [];
const index: NonNullable<Stage1Output['index']> = {};
let n = 0;

function add(element: Omit<ApiElement, '@id'> & { '@id'?: string }, where: 'project' | 'library' | 'standard', qualifiedName?: string): ApiElement {
    const full = { ...element, '@id': element['@id'] ?? `e${++n}` } as ApiElement;
    if (where !== 'standard') elements.push(full);
    index[full['@id']] = where === 'standard'
        ? { role: 'standard', qualifiedName }
        : { file: where === 'project' ? 'model/app.sysml' : 'core/lib.sysml', role: where, root: where === 'project' ? projectDir : libraryDir, ...(qualifiedName ? { qualifiedName } : {}) };
    return full;
}

function own(owner: ApiElement, member: ApiElement, where: 'project' | 'library'): void {
    const membership = add({ '@type': 'OwningMembership', ownedRelatedElement: [ref(member['@id'])], memberElement: ref(member['@id']) }, where);
    ((owner.ownedRelationship ??= []) as unknown[]).push(ref(membership['@id']));
    member.owningRelationship = ref(membership['@id']);
    membership.owningRelatedElement = ref(owner['@id']);
}

function relate(owner: ApiElement, relationship: Omit<ApiElement, '@id'>, where: 'project' | 'library'): void {
    const element = add(relationship, where);
    ((owner.ownedRelationship ??= []) as unknown[]).push(ref(element['@id']));
}

/** `attribute <name> = <value>;` under owner. */
function attribute(owner: ApiElement, name: string, value: Omit<ApiElement, '@id'>, where: 'project' | 'library'): void {
    const usage = add({ '@type': 'AttributeUsage', declaredName: name }, where);
    own(owner, usage, where);
    const expression = add(value, where);
    const featureValue = add({ '@type': 'FeatureValue', ownedRelatedElement: [ref(expression['@id'])] }, where);
    usage.ownedRelationship = [ref(featureValue['@id'])];
}

/** A reference expression naming target, as `= Kind::member` or a list item is. */
function reference(target: string, where: 'project' | 'library'): Omit<ApiElement, '@id'> {
    const membership = add({ '@type': 'Membership', memberElement: ref(target) }, where);
    return { '@type': 'FeatureReferenceExpression', ownedRelationship: [ref(membership['@id'])] };
}

/** `ref :>> <name> : <Type>;` under owner. */
function narrowed(owner: ApiElement, name: string, type: ApiElement, where: 'project' | 'library'): void {
    const usage = add({ '@type': 'ReferenceUsage', declaredName: name }, where);
    own(owner, usage, where);
    relate(usage, { '@type': 'FeatureTyping', type: ref(type['@id']) }, where);
}

function typedPart(owner: ApiElement, name: string, type: ApiElement, where: 'project' | 'library'): ApiElement {
    const part = add({ '@type': 'PartUsage', declaredName: name }, where);
    own(owner, part, where);
    relate(part, { '@type': 'FeatureTyping', type: ref(type['@id']) }, where);
    return part;
}

// The standard library and the methodology vocabulary, known by name.
add({ '@type': 'LibraryPackage', '@id': 'scalar' }, 'standard', 'ScalarValues');
const bindingDef = add({ '@type': 'PartDefinition', '@id': 'def-binding', declaredName: 'ProjectMethodBinding' }, 'library', 'lib::ProjectMethodBinding');
const methodologyDef = add({ '@type': 'PartDefinition', '@id': 'def-methodology', declaredName: 'MethodologyDefinition' }, 'library', 'lib::MethodologyDefinition');
const policyDef = add({ '@type': 'PartDefinition', '@id': 'def-policy', declaredName: 'RulePolicy' }, 'library', 'lib::RulePolicy');
const ruleDef = add({ '@type': 'ConstraintDefinition', '@id': 'def-rule', declaredName: 'HazardRule' }, 'library', 'lib::HazardRule');
const scope = add({ '@type': 'EnumerationUsage', '@id': 'scope-explicit', declaredName: 'explicit' }, 'library', 'lib::ScopeModeKind::explicit');

// The library: package `lib`, nesting `extras`, and the methodology `strict`.
const libRoot = add({ '@type': 'Namespace' }, 'library');
const lib = add({ '@type': 'LibraryPackage', '@id': 'lib', declaredName: 'lib' }, 'library', 'lib');
own(libRoot, lib, 'library');
for (const def of [bindingDef, methodologyDef, policyDef, ruleDef]) own(lib, def, 'library');
const extras = add({ '@type': 'LibraryPackage', '@id': 'extras', declaredName: 'extras' }, 'library', 'lib::extras');
own(lib, extras, 'library');
// A package the project reaches through one membership import alone.
const more = add({ '@type': 'LibraryPackage', '@id': 'more', declaredName: 'more' }, 'library', 'more');
own(libRoot, more, 'library');
const signal = add({ '@type': 'ItemDefinition', '@id': 'more-signal', declaredName: 'Signal' }, 'library', 'more::Signal');
own(more, signal, 'library');
relate(lib, { '@type': 'NamespaceImport', importedNamespace: ref('scalar') }, 'library');
const strict = typedPart(lib, 'strict', methodologyDef, 'library');
attribute(strict, 'name', { '@type': 'LiteralString', value: 'Strict' }, 'library');
attribute(strict, 'includedLayer', { '@type': 'LiteralString', value: 'safety' }, 'library');
attribute(strict, 'includedLayer', { '@type': 'LiteralString', value: 'core' }, 'library');

// The project: package `app` importing `lib::*`, `lib::extras::**` and a
// membership of `lib`, with its method binding. The three imports state their
// visibility the three ways a handoff does: OpenSysML writes `public` and
// `private`, SysIDE writes `public` and leaves the private default out.
const appRoot = add({ '@type': 'Namespace' }, 'project');
const app = add({ '@type': 'Package', '@id': 'app', declaredName: 'app' }, 'project', 'app');
own(appRoot, app, 'project');
relate(app, { '@type': 'NamespaceImport', importedNamespace: ref('lib'), visibility: 'public' }, 'project');
relate(app, { '@type': 'NamespaceImport', importedNamespace: ref('extras'), isRecursive: true, visibility: 'private' }, 'project');
const libMember = elements.find(e => e['@type'] === 'OwningMembership' && (e.memberElement as { '@id': string })['@id'] === 'more-signal')!;
relate(app, { '@type': 'MembershipImport', importedMembership: ref(libMember['@id']) }, 'project');
const binding = typedPart(app, 'appBinding', bindingDef, 'project');
attribute(binding, 'id', { '@type': 'LiteralString', value: 'B-1' }, 'project');
attribute(binding, 'scopeMode', reference(scope['@id'], 'project'), 'project');
narrowed(binding, 'selectedMethodology', strict, 'project');
const list = add({ '@type': 'OperatorExpression', operator: ',' }, 'project');
attribute(binding, 'includedModule', { ...list }, 'project');
const policy = typedPart(binding, 'relax', policyDef, 'project');
narrowed(policy, 'targetRule', ruleDef, 'project');
attribute(policy, 'disposition', { '@type': 'LiteralString', value: 'disabled' }, 'project');

const api = new ApiModel({
    format: 'memo-stage1/1', provider: 'test', clean: true, index,
    documents: [
        { file: 'model/app.sysml', role: 'project', root: projectDir, elements: elements.filter(e => index[e['@id']]?.role === 'project') },
        { file: 'core/lib.sysml', role: 'library', root: libraryDir, elements: elements.filter(e => index[e['@id']]?.role === 'library') },
    ],
});
const fileOf = (element: ApiElement) => api.absoluteFile(element['@id']) ?? '';
const libraryRoot = { dir: libraryDir, sysmlDir: libraryDir } as LibraryRoot;
const fileToRoot = new Map<string, LibraryRoot | undefined>([
    [`${projectDir}/model/app.sysml`, undefined],
    [`${libraryDir}/core/lib.sysml`, libraryRoot],
]);

describe('project resolution read from a stage 1 handoff', () => {
    const packages = apiPackageIndex(api, fileToRoot, fileOf);

    it('indexes every package, nested ones too, by name with its files and root', () => {
        expect([...packages.keys()].sort()).toEqual(['app', 'extras', 'lib', 'more']);
        expect([...packages.get('app')!.files]).toEqual([`${projectDir}/model/app.sysml`]);
        expect(packages.get('app')!.root).toBeUndefined();
        expect(packages.get('extras')!.root).toBe(libraryRoot);
    });

    it('reads each import as the package it reads from: P::*, P::** and P::X', () => {
        expect([...packages.get('app')!.imports].sort()).toEqual(['lib', 'lib::extras', 'more']);
        expect([...packages.get('lib')!.imports]).toEqual(['ScalarValues']);
    });

    it('keeps the public imports apart: an explicit private one and an omitted default are not public', () => {
        expect([...packages.get('app')!.publicImports]).toEqual(['lib']);
        expect([...packages.get('lib')!.publicImports]).toEqual([]);
    });

    it('reads the method binding and the methodology it selects', () => {
        const { bindings, methodologies } = apiNativeUsages(api, fileOf);
        expect(bindings).toEqual([expect.objectContaining({
            usageName: 'appBinding',
            bindingId: 'B-1',
            scopeMode: 'explicit',
            selectedMethodologyName: 'strict',
            sourceFile: `${projectDir}/model/app.sysml`,
            packageQualifiedName: 'app',
            rulePolicies: [expect.objectContaining({ usageName: 'relax', targetRuleType: 'HazardRule', disposition: 'disabled' })],
        })]);
        expect(methodologies).toEqual([expect.objectContaining({
            usageName: 'strict', displayName: 'Strict', includedLayers: ['safety', 'core'], packageQualifiedName: 'lib',
        })]);
    });
});

describe('methodology content read from a stage 1 handoff', () => {
    const documents = apiMethodologyDocuments(api, projectDir);

    it('reads each document\'s part definitions, parts and packages, as the parse walker does', () => {
        const library = documents.get(`${libraryDir}/core/lib.sysml`)!;
        expect(library.namespaces).toEqual(['lib', 'extras', 'more']);
        expect(library.partDefs.map(d => d.name)).toEqual(['ProjectMethodBinding', 'MethodologyDefinition', 'RulePolicy']);
        expect(library.parts).toEqual([expect.objectContaining({
            partName: 'strict', partType: 'MethodologyDefinition', namespace: 'lib',
            attributes: { name: 'Strict', includedLayer: 'core' },
            multiAttributes: { name: ['Strict'], includedLayer: ['safety', 'core'] },
        })]);
    });

    it('reads an enumeration value as written, and a part nested in a part', () => {
        const project = documents.get(`${projectDir}/model/app.sysml`)!;
        const binding = project.parts.find(p => p.partName === 'appBinding')!;
        expect(binding.attributes).toMatchObject({ id: 'B-1', scopeMode: 'explicit', scopeMode__qualified: 'ScopeModeKind::explicit' });
        expect(project.parts.map(p => p.partName)).toContain('relax');
        expect(binding.sourceFile).toBe('model/app.sysml');
    });
});
