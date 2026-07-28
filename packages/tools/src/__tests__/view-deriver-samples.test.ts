import { describe, expect, it } from 'vitest';
import { deriveModelViews } from '../model/view-deriver.js';
import type { MemoElement, MemoModel } from '../model/semantic.js';

function element(id: string, kind: string, packageName?: string): MemoElement {
    return {
        id, name: id, kind, construct: 'part', layer: 'logical_structure',
        file: 'sample/model/test.sysml', package: packageName, attributes: {},
    } as MemoElement;
}

describe('explicit renderer samples', () => {
    it('places SysML views from the samples package in Model Viewpoint > Samples', () => {
        const part = element('partA', 'LogicalComponent', 'samples');
        const view = element('sampleInterconnectionView', 'DiagramView', 'samples');
        view.attributes = {
            title: 'Sample · Interconnection',
            viewKind: 'DiagramViewKind::interconnection',
            diagramType: 'ibd',
            'selectionQuery.includeElementKinds': 'LogicalComponent',
            'selectionQuery.includeRelationshipKinds': 'ExchangesWith',
        };
        const elements = new Map([[part.id, part], [view.id, view]]);
        const included = { type: 'includedIn', sourceId: part.id, targetId: view.id };
        const model = {
            elements,
            relationships: [included],
            incoming: new Map([[view.id, [included]]]),
        } as unknown as MemoModel;

        const result = deriveModelViews(model);

        expect(result.viewpoints).toEqual([]);
        expect(result.diagrams).toEqual([expect.objectContaining({
            id: 'diag-sample-sampleInterconnectionView',
            viewpointId: '__model',
            viewKind: 'interconnection',
            elementIds: ['partA'],
            relationshipTypes: ['ExchangesWith'],
            sourceFile: 'sample/model/test.sysml',
        })]);
    });

    it('uses the ontology viewpoint binding and authored IDs for views', () => {
        const viewpoint = element('logicalArchitectureViewpoint', 'Viewpoint');
        viewpoint.attributes = {
            id: 'VP-LOG',
            name: 'LogicalArchitectureViewpoint',
            title: 'Logical Viewpoint',
        };
        const view = element('gpcaActionFlowView', 'DiagramView');
        view.attributes = {
            id: 'VIEW-BHV-003',
            name: 'GPCA_InfusionDeliveryActionFlowView',
            title: 'GPCA Infusion Delivery Action Flow',
            viewpointDefinition: 'logicalArchitectureViewpoint',
            diagramType: 'afd',
        };
        const elements = new Map([[viewpoint.id, viewpoint], [view.id, view]]);
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
            name: 'GPCA Infusion Delivery Action Flow',
            viewpointId: 'VP-LOG',
        })]);
    });
});
