import { describe, expect, it } from 'vitest';
import { deriveModelViews, resolveExposeIds } from '../model/view-deriver.js';
import type { MemoElement, MemoModel } from '../model/semantic.js';
import { toElementIndex } from '../model/element-index.js';

function element(id: string, kind: string, packageName?: string): MemoElement {
    return {
        id, name: id, kind, construct: 'part', layer: 'logical_structure',
        file: 'sample/model/test.sysml', package: packageName, attributes: {},
    } as MemoElement;
}

describe('explicit renderer samples', () => {
    it('supports exact element-id selections without sweeping in every element of a kind', () => {
        const selected = element('selectedPart', 'LogicalComponent');
        selected.attributes.id = 'LC-SELECTED';
        const excluded = element('excludedPart', 'LogicalComponent');
        const view = element('exactView', 'DiagramView');
        view.attributes = { 'selectionQuery.includeElementIds': 'LC-SELECTED' };
        const model = {
            elements: toElementIndex([selected, excluded, view]),
            relationships: [], incoming: new Map(),
        } as unknown as MemoModel;

        expect(deriveModelViews(model).diagrams[0].elementIds).toEqual(['selectedPart']);
    });

    it('places SysML views from the samples package in Model Viewpoint > Samples', () => {
        const part = element('partA', 'LogicalComponent', 'samples');
        const view = element('sampleInterconnectionView', 'DiagramView', 'samples');
        view.attributes = {
            title: 'Sample · Interconnection',
            viewKind: 'DiagramViewKind::interconnection',
            diagramType: 'ibd',
            'selectionQuery.includeElementKinds': 'LogicalComponent',
            'selectionQuery.includeRelationshipKinds': 'flow',
        };
        const elements = new Map([[part.id, part], [view.id, view]]);
        const model = {
            elements,
            relationships: [],
            incoming: new Map(),
        } as unknown as MemoModel;

        const result = deriveModelViews(model);

        expect(result.viewpoints).toEqual([]);
        expect(result.diagrams).toEqual([expect.objectContaining({
            id: 'diag-sample-sampleInterconnectionView',
            viewpointId: '__model',
            viewKind: 'interconnection',
            elementIds: ['partA'],
            sourceFile: 'sample/model/test.sysml',
        })]);
    });

    it('uses the ontology viewpoint binding and authored IDs for views', () => {
        const viewpoint = element('logicalArchitectureViewpoint', 'Viewpoint');
        // A label becomes the element's name, as the builder does it.
        viewpoint.attributes = { id: 'VP-LOG', label: 'Logical Viewpoint' };
        viewpoint.name = 'Logical Viewpoint';
        const view = element('gpcaActionFlowView', 'DiagramView');
        view.attributes = {
            id: 'VIEW-BHV-003',
            label: 'GPCA Infusion Delivery Action Flow',
            viewpointDefinition: 'logicalArchitectureViewpoint',
            diagramType: 'afd',
        };
        view.name = 'GPCA Infusion Delivery Action Flow';
        view.viewShortId = 'ACT-1';
        const elements = toElementIndex([viewpoint, view]);
        const model = {
            elements,
            relationships: [],
            incoming: new Map(),
        } as unknown as MemoModel;

        const result = deriveModelViews(model);

        expect(result.viewpoints).toEqual([expect.objectContaining({
            id: 'VP-LOG',
            label: 'Logical Viewpoint',
        })]);
        expect(result.diagrams).toEqual([expect.objectContaining({
            id: 'VIEW-BHV-003',
            shortId: 'ACT-1',
            name: 'GPCA Infusion Delivery Action Flow',
            viewpointId: 'VP-LOG',
        })]);
    });

    it('honors an authored viewpoint binding in a samples package', () => {
        const viewpoint = element('functionalViewpoint', 'Viewpoint', 'samples');
        viewpoint.attributes = { id: 'VP-FUNC', title: 'Functional Viewpoint' };
        const view = element('sampleActionFlowView', 'DiagramView', 'samples');
        view.attributes = { viewpointDefinition: 'functionalViewpoint' };
        const model = {
            elements: toElementIndex([viewpoint, view]),
            relationships: [], incoming: new Map(),
        } as unknown as MemoModel;

        const result = deriveModelViews(model);

        expect(result.viewpoints).toEqual([expect.objectContaining({ id: 'VP-FUNC' })]);
        expect(result.diagrams).toEqual([expect.objectContaining({ viewpointId: 'VP-FUNC' })]);
    });

    it('exposes the action a scenario performs, since the perform usage is owned', () => {
        const scenario = element('wf::scn', 'OperativeScenario', 'wf');
        scenario.construct = 'action';
        scenario.layer = 'operational';
        const step = element('acts::step', 'OperativeAction', 'acts');
        step.construct = 'action';
        step.layer = 'operational';
        const view = element('flowView', 'DiagramView', 'wf');
        view.attributes = { expose: 'wf::**' };
        const model = {
            elements: toElementIndex([scenario, step, view]),
            packages: [{ qualifiedName: 'wf' }],
            relationships: [{ type: 'performs', sourceId: 'wf::scn', targetId: 'acts::step' }],
            incoming: new Map(),
        } as unknown as MemoModel;

        expect(resolveExposeIds(view, model).sort()).toEqual(['acts::step', 'wf::scn']);
    });

    it('does not add the action a step already subsets', () => {
        const chain = element('fc', 'FunctionalFlow', 'fc');
        chain.construct = 'action';
        const step = element('fc::dock', 'OperativeAction', 'fc');
        step.owner = 'fc';
        const fn = element('fn', 'SystemFunction', 'fns');
        fn.construct = 'action';
        const view = element('v', 'DiagramView', 'fc');
        view.attributes = { expose: 'fc::**' };
        const model = {
            elements: toElementIndex([chain, step, fn, view]),
            packages: [],
            relationships: [
                { type: 'performs', sourceId: 'fc', targetId: 'fn' },
                { type: 'subsets', sourceId: 'fc::dock', targetId: 'fn' },
            ],
            incoming: new Map(),
        } as unknown as MemoModel;

        expect(resolveExposeIds(view, model)).not.toContain('fn');
    });

    it('does not pull a function of another layer into the view of the step that performs it', () => {
        const step = element('wf::scn::s', 'OperativeAction', 'wf');
        step.construct = 'action';
        step.layer = 'operational';
        const fn = element('fns::fn', 'SystemFunction', 'fns');
        fn.construct = 'action';
        fn.layer = 'functional';
        const view = element('v2', 'DiagramView', 'wf');
        view.attributes = { expose: 'wf::**' };
        const model = {
            elements: toElementIndex([step, fn, view]),
            packages: [{ qualifiedName: 'wf' }],
            relationships: [{ type: 'performs', sourceId: 'wf::scn::s', targetId: 'fns::fn' }],
            incoming: new Map(),
        } as unknown as MemoModel;

        expect(resolveExposeIds(view, model)).not.toContain('fns::fn');
    });
});
