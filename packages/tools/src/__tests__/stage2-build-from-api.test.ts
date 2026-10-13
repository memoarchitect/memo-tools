// ─── Stage 2 element builder ─────────────────────────────────────────────────
//
// `buildElementsFromApi` over the committed fixture (see stage2-api-model.test.ts
// for how it is regenerated). The fixture declares no MEMO ontology, so kinds do
// not resolve here; what is held is everything that does not depend on one:
// which declarations become elements, their ids and constructs, and how values,
// metadata and nesting land in the flat attribute map MEMO reads.
//
// The real examples are held by `pnpm check:baselines`.
// ─────────────────────────────────────────────────────────────────────────────

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ApiModel, type ApiElement, type Stage1Output } from '../stage2/api-model.js';
import { buildElementsFromApi, buildFromApi } from '../stage2/build-from-api.js';
import { SYSML_RESERVED_KEYWORDS, textualName } from '../stage2/sysml-names.js';

const fixture = JSON.parse(readFileSync(
    resolve(import.meta.dirname, 'fixtures/stage2/api-model.stage1.json'), 'utf8')) as Stage1Output;
const { elements } = buildElementsFromApi(new ApiModel(fixture));

describe('buildElementsFromApi', () => {
    it('makes the project declarations elements, keyed by qualified name', () => {
        expect([...elements.keys()].sort()).toEqual([
            'Lib::Component', 'Lib::Element', 'Lib::Level', 'Lib::Link',
            'Model::controller', 'Model::pump', 'Model::pump::motor',
        ]);
        expect(elements.get('Model::pump')).toMatchObject({ construct: 'part', shortName: 'pump', package: 'Model', file: 'model.sysml' });
        expect(elements.get('Lib::Element')).toMatchObject({ construct: 'part', isDefinition: true });
    });

    it('nests a typed part under its owner', () => {
        expect(elements.get('Model::pump::motor')).toMatchObject({ owner: 'Model::pump', construct: 'part' });
    });

    it('writes values as MEMO spells them', () => {
        const attributes = elements.get('Model::pump')!.attributes;
        expect(attributes).toMatchObject({
            weight: '2.5',
            critical: 'true',
            level: 'Level::high',
            // A nonunique sequence keeps its repeats and its order.
            kinds: 'a, b, a',
            usageType: 'Component',
        });
    });

    it('lets a metadata application override a directly declared attribute', () => {
        // `attribute :>> label = "Pump"` and `@Tag { :>> label = "tagged"; }`:
        // the annotation is the newer statement of intent, and names the element.
        expect(elements.get('Model::pump')!.attributes.label).toBe('tagged');
        expect(elements.get('Model::pump')!.name).toBe('tagged');
    });

    it('writes a typed attribute without a value as its type', () => {
        expect(elements.get('Lib::Element')!.attributes.weight).toBe('<Real>');
    });

    it('leaves a connection with two ends out of the elements', () => {
        expect([...elements.values()].some(e => e.construct === 'connection' && !e.isDefinition)).toBe(false);
    });
});

describe('buildFromApi relationships', () => {
    const { relationships } = buildFromApi(new ApiModel(fixture));

    it('reads a typed connection with named ends, through a feature chain', () => {
        // `connection : Link connect source ::> controller to target ::> pump.motor;`
        expect(relationships).toContainEqual(expect.objectContaining({
            type: 'link', sourceId: 'Model::controller', sourceEnd: 'source',
            targetId: 'Model::pump::motor', targetEnd: 'target',
        }));
    });

    it('synthesizes composition from nesting', () => {
        expect(relationships).toContainEqual(expect.objectContaining({
            type: 'composes', sourceId: 'Model::pump', targetId: 'Model::pump::motor',
        }));
    });
});

describe('textualName', () => {
    it('quotes a reserved keyword and any name that is not basic', () => {
        expect(textualName('stakeholder')).toBe("'stakeholder'");
        expect(textualName('high')).toBe('high');
        expect(textualName('two words')).toBe("'two words'");
    });

    it('holds the keyword list to the vendored SysML grammar', () => {
        const bnf = readFileSync(resolve(import.meta.dirname,
            '../../../../corpus/sysml-v2-release/bnf/SysML-textual-bnf.kebnf'), 'utf8');
        const production = bnf.slice(bnf.indexOf('RESERVED_KEYWORD ='), bnf.indexOf('DEFINED_BY'));
        const declared = new Set([...production.matchAll(/'([a-z]+)'/g)].map(m => m[1]));
        expect(declared).toEqual(new Set(SYSML_RESERVED_KEYWORDS));
    });
});

// `first a then b;` written in a body that declares `perform a; perform b;`
// names the perform usages (each takes its name from the action it performs,
// and the local member is found first); the succession MEMO records is between
// the performed actions.
describe('buildFromApi successions between performed actions', () => {
    const ref = (id: string) => ({ '@id': id });
    const index: NonNullable<Stage1Output['index']> = {};
    const elements: ApiElement[] = [];
    const add = (element: Record<string, unknown> & { '@id': string; '@type': string }, qualifiedName?: string) => {
        elements.push(element);
        index[element['@id']] = { file: 'model.sysml', role: 'project', ...(qualifiedName ? { qualifiedName } : {}) };
        return element;
    };
    const own = (owner: Record<string, unknown>, member: { '@id': string }, metaclass = 'OwningMembership') => {
        const membership = add({ '@type': metaclass, '@id': `${member['@id']}_om`, ownedRelatedElement: [ref(member['@id'])], memberElement: ref(member['@id']) });
        ((owner.ownedRelationship ??= []) as unknown[]).push(ref(membership['@id']));
        (member as Record<string, unknown>).owningRelationship = ref(membership['@id']);
        membership.owningRelatedElement = ref(owner['@id'] as string);
    };
    const subsets = (feature: Record<string, unknown>, target: string) => {
        const relationship = add({ '@type': 'ReferenceSubsetting', '@id': `${feature['@id']}_rs`, referencedFeature: ref(target) });
        ((feature.ownedRelationship ??= []) as unknown[]).push(ref(relationship['@id']));
    };
    const root = add({ '@type': 'Namespace', '@id': 'ns' });
    const pkg = add({ '@type': 'Package', '@id': 'P', declaredName: 'P' }, 'P');
    own(root, pkg);
    const a = add({ '@type': 'ActionUsage', '@id': 'P__a', declaredName: 'a' }, 'P::a');
    const b = add({ '@type': 'ActionUsage', '@id': 'P__b', declaredName: 'b' }, 'P::b');
    const wf = add({ '@type': 'ActionUsage', '@id': 'P__wf', declaredName: 'wf' }, 'P::wf');
    for (const action of [a, b, wf]) own(pkg, action, 'FeatureMembership');
    const performA = add({ '@type': 'PerformActionUsage', '@id': 'P__wf__pa' }, 'P::wf::a');
    const performB = add({ '@type': 'PerformActionUsage', '@id': 'P__wf__pb' }, 'P::wf::b');
    subsets(performA, a['@id']);
    subsets(performB, b['@id']);
    own(wf, performA, 'FeatureMembership');
    own(wf, performB, 'FeatureMembership');
    const succession = add({ '@type': 'SuccessionAsUsage', '@id': 'P__wf__s' });
    own(wf, succession, 'FeatureMembership');
    for (const [slot, perform] of [['e0', performA], ['e1', performB]] as const) {
        const end = add({ '@type': 'ReferenceUsage', '@id': `P__wf__s_${slot}`, isEnd: true });
        own(succession, end, 'EndFeatureMembership');
        subsets(end, perform['@id']);
    }
    const { relationships } = buildFromApi(new ApiModel({
        format: 'memo-stage1/1', provider: 'test', clean: true, index,
        documents: [{ file: 'model.sysml', role: 'project', elements }],
    }));

    it('relates the performed actions', () => {
        expect(relationships.filter(r => r.type === 'succession').map(r => [r.sourceId, r.targetId]))
            .toEqual([['P::a', 'P::b']]);
    });
});

// `part mapEngine : LogicalComponent :> component;` in a definition is a part the
// definition contains: typing plus subsetting, neither of which makes it a binding.
describe('buildElementsFromApi nested parts that subset a feature', () => {
    const ref = (id: string) => ({ '@id': id });
    const index: NonNullable<Stage1Output['index']> = {};
    const elements: ApiElement[] = [];
    const add = (element: Record<string, unknown> & { '@id': string; '@type': string }, qualifiedName?: string) => {
        elements.push(element);
        index[element['@id']] = { file: 'model.sysml', role: 'project', ...(qualifiedName ? { qualifiedName } : {}) };
        return element;
    };
    const own = (owner: Record<string, unknown>, member: { '@id': string }, metaclass = 'OwningMembership') => {
        const membership = add({ '@type': metaclass, '@id': `${member['@id']}_om`, ownedRelatedElement: [ref(member['@id'])], memberElement: ref(member['@id']) });
        ((owner.ownedRelationship ??= []) as unknown[]).push(ref(membership['@id']));
        (member as Record<string, unknown>).owningRelationship = ref(membership['@id']);
        membership.owningRelatedElement = ref(owner['@id'] as string);
    };
    const relate = (feature: Record<string, unknown>, metaclass: string, field: string, target: string) => {
        const relationship = add({ '@type': metaclass, '@id': `${feature['@id']}_${metaclass}`, [field]: ref(target) });
        ((feature.ownedRelationship ??= []) as unknown[]).push(ref(relationship['@id']));
    };
    const root = add({ '@type': 'Namespace', '@id': 'ns' });
    const pkg = add({ '@type': 'Package', '@id': 'P', declaredName: 'P' }, 'P');
    own(root, pkg);
    const component = add({ '@type': 'PartDefinition', '@id': 'P__Component', declaredName: 'Component' }, 'P::Component');
    const system = add({ '@type': 'PartDefinition', '@id': 'P__System', declaredName: 'System' }, 'P::System');
    const slot = add({ '@type': 'PartUsage', '@id': 'P__System__component', declaredName: 'component' }, 'P::System::component');
    own(pkg, component); own(pkg, system); own(system, slot, 'FeatureMembership');
    relate(slot, 'FeatureTyping', 'type', component['@id']);
    const engine = add({ '@type': 'PartUsage', '@id': 'P__System__engine', declaredName: 'engine' }, 'P::System::engine');
    own(system, engine, 'FeatureMembership');
    relate(engine, 'FeatureTyping', 'type', component['@id']);
    relate(engine, 'Subsetting', 'subsettedFeature', slot['@id']);
    const fn = add({ '@type': 'ActionUsage', '@id': 'P__fn', declaredName: 'fn' }, 'P::fn');
    own(pkg, fn, 'FeatureMembership');
    // `allocate fn to engine;` written inside the definition (SysML-textual-bnf.kebnf:802).
    const allocation = add({ '@type': 'AllocationUsage', '@id': 'P__System__alloc' });
    own(system, allocation, 'FeatureMembership');
    for (const [slotName, target] of [['e0', fn], ['e1', engine]] as const) {
        const end = add({ '@type': 'ReferenceUsage', '@id': `P__System__alloc__${slotName}`, isEnd: true });
        own(allocation, end, 'EndFeatureMembership');
        relate(end, 'ReferenceSubsetting', 'referencedFeature', target['@id']);
    }
    const api = new ApiModel({
        format: 'memo-stage1/1', provider: 'test', clean: true, index,
        documents: [{ file: 'model.sysml', role: 'project', elements }],
    });
    const { elements: built } = buildElementsFromApi(api);
    const { relationships } = buildFromApi(api);

    it('builds the part, owned by its definition', () => {
        expect(built.get('P::System::engine')).toMatchObject({ construct: 'part', owner: 'P::System' });
    });

    it('reads an allocation written inside the definition', () => {
        expect(relationships.filter(r => r.type === 'allocatedTo').map(r => [r.sourceId, r.targetId]))
            .toEqual([['P::fn', 'P::System::engine']]);
    });
});
