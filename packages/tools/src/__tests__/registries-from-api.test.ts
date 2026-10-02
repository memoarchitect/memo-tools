import { describe, expect, it } from 'vitest';
import { ApiModel, type ApiElement, type Stage1Output } from '../stage2/api-model.js';
import { KindRegistry } from '../model/kind-registry.js';
import { RelationshipRegistry } from '../model/relationship-registry.js';
import { handoffRegistries } from '../stage2/registries-from-api.js';

// A library document of the ontology and a project document, as a stage 1
// compiler's API JSON states them. The library declares kinds and a
// relationship type; the project declares a kind of its own, which the
// ontology registries leave to `withProjectExtensions`.
const ref = (id: string) => ({ '@id': id });
const elements: ApiElement[] = [];
const index: NonNullable<Stage1Output['index']> = {};

function add(element: ApiElement, file: string, role: 'library' | 'project' | 'standard', qualifiedName?: string): ApiElement {
    if (role !== 'standard') elements.push(element);
    index[element['@id']] = { ...(role === 'standard' ? {} : { file }), role, ...(qualifiedName ? { qualifiedName } : {}) };
    return element;
}

/** `owner` owns `member` through a membership of the given metaclass. */
function own(owner: ApiElement, member: ApiElement, file: string, role: 'library' | 'project', metaclass = 'OwningMembership'): void {
    const membership = add({ '@type': metaclass, '@id': `${member['@id']}_om`, ownedRelatedElement: [ref(member['@id'])], memberElement: ref(member['@id']) }, file, role);
    (owner.ownedRelationship as unknown[] ?? (owner.ownedRelationship = [])).push(ref(membership['@id']));
    member.owningRelationship = ref(membership['@id']);
    membership.owningRelatedElement = ref(owner['@id']);
}

function relate(owner: ApiElement, metaclass: string, end: string, target: string, file: string, role: 'library' | 'project'): void {
    const id = `${owner['@id']}_${metaclass}_${target}`;
    add({ '@type': metaclass, '@id': id, [end]: ref(target) }, file, role);
    (owner.ownedRelationship as unknown[] ?? (owner.ownedRelationship = [])).push(ref(id));
}

function valued(owner: ApiElement, name: string, value: ApiElement, file: string, role: 'library' | 'project'): void {
    const attribute = add({ '@type': 'AttributeUsage', '@id': `${owner['@id']}__${name}`, declaredName: name }, file, role);
    own(owner, attribute, file, role, 'FeatureMembership');
    const expression = add({ ...value, '@id': `${attribute['@id']}_value` }, file, role);
    const featureValue = add({ '@type': 'FeatureValue', '@id': `${attribute['@id']}_fv`, ownedRelatedElement: [ref(expression['@id'])] }, file, role);
    attribute.ownedRelationship = [ref(featureValue['@id'])];
}

function bound(range: ApiElement, id: string, literal: ApiElement, file: string): void {
    own(range, add({ ...literal, '@id': id }, file, 'library'), file, 'library');
}

const lib = 'core/risk.sysml';
const prj = 'model/app.sysml';
// The standard library types the ontology specializes, known by name only.
add({ '@type': 'ConnectionDefinition', '@id': 'std-binary' }, '', 'standard', 'Connections::BinaryConnection');
add({ '@type': 'InterfaceDefinition', '@id': 'std-interface' }, '', 'standard', 'Interfaces::Interface');

const libRoot = add({ '@type': 'Namespace', '@id': 'lib-ns' }, lib, 'library');
const pkg = add({ '@type': 'LibraryPackage', '@id': 'memo_risk', declaredName: 'memo_risk' }, lib, 'library', 'memo_risk');
own(libRoot, pkg, lib, 'library');
const base = add({ '@type': 'PartDefinition', '@id': 'memo_risk__RiskItem', declaredName: 'RiskItem', isAbstract: true }, lib, 'library', 'memo_risk::RiskItem');
own(pkg, base, lib, 'library');
const hazard = add({ '@type': 'PartDefinition', '@id': 'memo_risk__Hazard', declaredName: 'Hazard' }, lib, 'library', 'memo_risk::Hazard');
own(pkg, hazard, lib, 'library');
relate(hazard, 'Subclassification', 'superclassifier', base['@id'], lib, 'library');
valued(hazard, 'severity', { '@type': 'LiteralString', '@id': '', value: 'high' }, lib, 'library');
const port = add({ '@type': 'InterfaceDefinition', '@id': 'memo_risk__Link', declaredName: 'Link' }, lib, 'library', 'memo_risk::Link');
own(pkg, port, lib, 'library');
relate(port, 'Subclassification', 'superclassifier', base['@id'], lib, 'library');
relate(port, 'Subclassification', 'superclassifier', 'std-interface', lib, 'library');
// An enumeration definition is a variation, abstract by the metamodel.
const level = add({ '@type': 'EnumerationDefinition', '@id': 'memo_risk__Level', declaredName: 'Level', isAbstract: true, isVariation: true }, lib, 'library', 'memo_risk::Level');
own(pkg, level, lib, 'library');

const mitigates = add({ '@type': 'ConnectionDefinition', '@id': 'memo_risk__Mitigates', declaredName: 'Mitigates' }, lib, 'library', 'memo_risk::Mitigates');
own(pkg, mitigates, lib, 'library');
relate(mitigates, 'Subclassification', 'superclassifier', 'std-binary', lib, 'library');
const doc = add({ '@type': 'Documentation', '@id': 'memo_risk__Mitigates_doc', body: 'A control mitigates\na hazard.' }, lib, 'library');
own(mitigates, doc, lib, 'library');
valued(mitigates, 'isReflexive', { '@type': 'LiteralBoolean', '@id': '', value: false }, lib, 'library');
for (const [name, type, bounds] of [
    ['control', base['@id'], [['LiteralInteger', 0], ['LiteralInteger', 1]]],
    ['hazard', hazard['@id'], [['LiteralInteger', 1], ['LiteralInfinity']]],
    ['exact', hazard['@id'], [['LiteralInteger', 3]]],
    ['any', hazard['@id'], [['LiteralInfinity']]],
] as [string, string, [string, number?][]][]) {
    const end = add({ '@type': 'ReferenceUsage', '@id': `memo_risk__Mitigates__${name}`, declaredName: name, isEnd: true }, lib, 'library');
    own(mitigates, end, lib, 'library', 'EndFeatureMembership');
    relate(end, 'FeatureTyping', 'type', type, lib, 'library');
    const range = add({ '@type': 'MultiplicityRange', '@id': `${end['@id']}_mult` }, lib, 'library');
    own(end, range, lib, 'library');
    bounds.forEach(([metaclass, value], i) => bound(range, `${range['@id']}_b${i}`, { '@type': metaclass, '@id': '', ...(value !== undefined ? { value } : {}) }, lib));
}

const view = add({ '@type': 'ViewDefinition', '@id': 'memo_risk__RiskView', declaredName: 'RiskView' }, lib, 'library', 'memo_risk::RiskView');
own(pkg, view, lib, 'library');
valued(view, 'generationRule', { '@type': 'LiteralString', '@id': '', value: 'Include hazards.' }, lib, 'library');

// The project's own kind.
const prjRoot = add({ '@type': 'Namespace', '@id': 'prj-ns' }, prj, 'project');
const app = add({ '@type': 'Package', '@id': 'app', declaredName: 'app' }, prj, 'project', 'app');
own(prjRoot, app, prj, 'project');
const local = add({ '@type': 'PartDefinition', '@id': 'app__Pump', declaredName: 'Pump' }, prj, 'project', 'app::Pump');
own(app, local, prj, 'project');
relate(local, 'Subclassification', 'superclassifier', hazard['@id'], prj, 'project');

const api = new ApiModel({
    format: 'memo-stage1/1', provider: 'test', clean: true, index,
    documents: [
        { file: lib, role: 'library', elements: elements.filter(e => index[e['@id']]?.file === lib) },
        { file: prj, role: 'project', elements: elements.filter(e => index[e['@id']]?.file === prj) },
    ],
});
// The absolute files resolution read: the layer comes from `src/<layer>/`.
const fileOf = (element: ApiElement) => `/work/memo/src/${api.source(element['@id'])?.file ?? ''}`;

describe('ontology registries read from a stage 1 handoff', () => {
    const kinds = new KindRegistry();
    kinds.populateFromApi(api, fileOf);
    const relationships = new RelationshipRegistry();
    relationships.populateFromApi(api, fileOf);

    it('registers the library kinds, not the project\'s own', () => {
        expect(kinds.kindNames().sort()).toEqual(['Hazard', 'Level', 'Link', 'RiskItem']);
    });

    it('reads a kind as the parse reader does', () => {
        expect(kinds.getKind('Hazard')).toMatchObject({
            sysmlConstruct: 'part def',
            superType: 'RiskItem',
            qualifiedName: 'memo_risk::Hazard',
            attributeNames: ['severity'],
            sourceFile: '/work/memo/src/core/risk.sysml',
            layer: 'core',
        });
        expect(kinds.getKind('RiskItem')?.isAbstract).toBe(true);
    });

    it('records the abstract keyword, not the abstractness a variation has by the metamodel', () => {
        expect(kinds.getKind('Level')).toMatchObject({ sysmlConstruct: 'enum def' });
        expect(kinds.getKind('Level')?.isAbstract).toBeUndefined();
    });

    it('keeps further supertypes by simple name', () => {
        expect(kinds.getKind('Link')).toMatchObject({ superType: 'RiskItem', additionalSuperTypes: ['Interface'] });
    });

    it('reads a view definition\'s defaults', () => {
        expect(kinds.getViewDefaults('RiskView')).toEqual({ generationRule: 'Include hazards.' });
    });

    it('reads a relationship type: library supertype by qualified name, ends, bounds, doc and flags', () => {
        const entry = relationships.getRelType('mitigates');
        expect(entry).toMatchObject({
            sysmlName: 'Mitigates',
            label: 'Mitigates',
            sysmlConstruct: 'connection def',
            superType: 'Connections::BinaryConnection',
            description: 'A control mitigates a hazard.',
            isReflexive: false,
            attributes: ['isReflexive'],
            layer: 'core',
        });
        expect(entry?.ends).toEqual([
            { name: 'control', type: 'RiskItem', multiplicity: { lower: 0, upper: 1 } },
            { name: 'hazard', type: 'Hazard', multiplicity: { lower: 1, upper: null } },
            { name: 'exact', type: 'Hazard', multiplicity: { lower: 3, upper: 3 } },
            { name: 'any', type: 'Hazard', multiplicity: { lower: 0, upper: null } },
        ]);
    });

    it('extends a copy with the project\'s own kinds, placed by their library supertype', () => {
        const extended = kinds.withProjectExtensionsFromApi(api, fileOf);
        expect(extended.getKind('Pump')).toMatchObject({ superType: 'Hazard', layer: 'core', qualifiedName: 'app::Pump' });
        expect(kinds.has('Pump')).toBe(false);
    });

    it('builds stage 2\'s registries from the handoff, keeping the base\'s provenance', () => {
        const provenance = new Map() as never;
        const parsed = { kindRegistry: new KindRegistry(), relationshipRegistry: new RelationshipRegistry(), provenance };
        const registries = handoffRegistries(api, parsed, undefined);
        expect(registries.provenance).toBe(provenance);
        expect(registries.kindRegistry).not.toBe(parsed.kindRegistry);
        expect(registries.kindRegistry?.kindNames().sort()).toEqual(['Hazard', 'Level', 'Link', 'RiskItem']);
        expect(registries.relationshipRegistry?.has('mitigates')).toBe(true);
    });

    it('registers the language-native relations, as the parse reader does', () => {
        const parsed = new RelationshipRegistry();
        parsed.populateFromDocuments([]);
        for (const name of parsed.relTypeNames()) expect(relationships.has(name)).toBe(true);
    });
});
