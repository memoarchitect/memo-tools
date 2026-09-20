import { describe, expect, it } from 'vitest';
import { checkSelectorVocabulary, SELECTOR_UNDECLARED_NAME } from '../model/selector-vocabulary.js';
import { KindRegistry } from '../model/kind-registry.js';
import { RelationshipRegistry } from '../model/relationship-registry.js';
import { toElementIndex } from '../model/element-index.js';
import type { MemoElement, MemoModel } from '../model/semantic.js';

function element(id: string, kind: string, attributes: Record<string, string>): MemoElement {
    return {
        id, name: id, kind, construct: 'part', layer: 'viewpoints',
        file: 'model/views.sysml', attributes,
    } as MemoElement;
}

function modelOf(...elements: MemoElement[]): MemoModel {
    return {
        elements: toElementIndex(elements),
        relationships: [], incoming: new Map(), outgoing: new Map(),
    } as unknown as MemoModel;
}

function registries() {
    const kindRegistry = new KindRegistry();
    kindRegistry.register({
        name: 'UseCase', label: 'UseCase', layer: 'operational', sysmlConstruct: 'use case def',
        sourceFile: 'ontology/use_cases.sysml', attributeNames: ['realizationStage'],
    });
    kindRegistry.register({
        name: 'ScenarioKind', label: 'ScenarioKind', layer: 'operational', sysmlConstruct: 'enum def',
    });
    // A `view def` is not a kind, and a DHF index view legitimately selects one.
    kindRegistry.registerViewDefinition('MemoDocumentView', {});
    const relationshipRegistry = new RelationshipRegistry();
    relationshipRegistry.register({
        sysmlName: 'IncludesStep', name: 'includesStep', label: 'Includes step',
        layer: 'operational', ends: [],
    });
    relationshipRegistry.register({
        sysmlName: 'RealizesUseCase', name: 'realizesUseCase', label: 'Realizes use case',
        layer: 'operational', ends: [],
    });
    return { kindRegistry, relationshipRegistry };
}

describe('checkSelectorVocabulary', () => {
    it('accepts a selector whose every name is declared', () => {
        const view = element('useCaseView', 'DiagramView', {
            'selectionQuery.includeElementKinds': 'UseCase',
            'selectionQuery.includeRelationshipKinds': 'IncludesStep, RealizesUseCase',
        });

        expect(checkSelectorVocabulary(modelOf(view), registries())).toEqual([]);
    });

    it('reports a relationship no ontology declares, with the name and the file', () => {
        const view = element('useCaseView', 'DiagramView', {
            'selectionQuery.includeRelationshipKinds': 'Supports',
        });

        const [diagnostic, ...rest] = checkSelectorVocabulary(modelOf(view), registries());

        expect(rest).toEqual([]);
        expect(diagnostic).toMatchObject({
            code: SELECTOR_UNDECLARED_NAME,
            file: 'model/views.sysml',
            elementId: 'useCaseView',
            selector: 'selectionQuery.includeRelationshipKinds',
            name: 'Supports',
            vocabulary: 'relationship',
        });
        expect(diagnostic.message).toContain('Supports');
    });

    it('suggests the declared name a misspelling extends into', () => {
        // The defect this is drawn from: the builder emits `includesStep` and
        // the view asked for `Includes`, so 61 relations reached nothing.
        const view = element('useCaseView', 'DiagramView', {
            'selectionQuery.includeRelationshipKinds': 'Includes',
        });

        const [diagnostic] = checkSelectorVocabulary(modelOf(view), registries());

        expect(diagnostic.suggestion).toBe('includesStep');
        expect(diagnostic.message).toContain('Did you mean "includesStep"?');
    });

    it('accepts a relationship spelled either way, and the builder\'s native ones', () => {
        const view = element('flowView', 'DiagramView', {
            'selectionQuery.includeRelationshipKinds': 'includesStep, flow, bind, succession',
        });

        expect(checkSelectorVocabulary(modelOf(view), registries())).toEqual([]);
    });

    it('accepts a selection query naming a view definition', () => {
        const index = element('dhfIndexView', 'DiagramView', {
            'selectionQuery.includeElementKinds': 'MemoDocumentView',
        });

        expect(checkSelectorVocabulary(modelOf(index), registries())).toEqual([]);
    });

    it('reports an undeclared kind on a viewpoint rule and on a selection query', () => {
        const rule = element('riskRule', 'ViewRule', { elementTypeName: 'Risk,UseCase' });
        const view = element('riskView', 'DiagramView', {
            'selectionQuery.includeElementKinds': 'UseCase',
        });

        const diagnostics = checkSelectorVocabulary(modelOf(rule, view), registries());

        expect(diagnostics.map(d => [d.elementId, d.name, d.vocabulary]))
            .toEqual([['riskRule', 'Risk', 'kind']]);
    });

    it('checks a legend against the attributes the ontology declares', () => {
        const good = element('stageLegend', 'MemoLegend', { attributeName: 'realizationStage' });
        const bad = element('parentLegend', 'MemoLegend', { attributeName: 'parentUseCase' });
        const enumLegend = element('kindLegend', 'MemoLegend', { enumerationName: 'ScenarioKind' });

        const diagnostics = checkSelectorVocabulary(modelOf(good, bad, enumLegend), registries());

        expect(diagnostics.map(d => d.name)).toEqual(['parentUseCase']);
        expect(diagnostics[0].vocabulary).toBe('attribute');
    });

    it('names a bracketed filter as the name it is, because no reader parses one', () => {
        // Authored in gpca-pump five times. `expandKinds` compares the whole
        // string against a kind name, so the view selected nothing at all.
        const view = element('threatView', 'DiagramView', {
            'selectionQuery.includeElementKinds': 'UseCase[useCaseKind=threat]',
        });

        const [diagnostic] = checkSelectorVocabulary(modelOf(view), registries());

        expect(diagnostic.name).toBe('UseCase[useCaseKind=threat]');
        expect(diagnostic.message).toContain('no reader parses a `[attribute=value]` filter');
    });

    it('checks nothing when no ontology was resolved', () => {
        // An unresolved ontology has no vocabulary to compare against, and
        // reporting every selector as undeclared would be a lie about the model.
        const view = element('useCaseView', 'DiagramView', {
            'selectionQuery.includeRelationshipKinds': 'Supports',
            'selectionQuery.includeElementKinds': 'Anything',
        });

        expect(checkSelectorVocabulary(modelOf(view))).toEqual([]);
    });
});

describe('KindRegistry attribute vocabulary', () => {
    it('answers whether any definition declares an attribute name', () => {
        const { kindRegistry } = registries();

        expect(kindRegistry.declaresAttribute('realizationStage')).toBe(true);
        expect(kindRegistry.declaresAttribute('parentUseCase')).toBe(false);
        expect(kindRegistry.attributeNames()).toEqual(['realizationStage']);
    });
});
