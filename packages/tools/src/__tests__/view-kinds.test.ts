import { describe, it, expect } from 'vitest';
import { deriveModelViews } from '../model/view-deriver.js';
import { KindRegistry } from '../model/kind-registry.js';
import { validateViews } from '../validator/view-validator.js';
import {
    VIEW_KINDS,
    DIAGRAM_TYPE_TO_VIEW_KIND,
    isViewKind,
    normalizeViewKind,
    resolveViewKind,
} from '../model/view-kinds.js';
import { shortNameOf } from '../model/element-index.js';
import { toElementIndex } from '../model/element-index.js';
import type { MemoElement, MemoModel } from '../model/semantic.js';
import { compiledExample, compilerConfigured, examplesPresent } from './helpers/compile-source.js';

/** An element as the builder would state it: views and viewpoints are read from their flat attributes. */
function el(shortName: string, kind: string, attributes: Record<string, string> = {}, construct: MemoElement['construct'] = 'part'): MemoElement {
    return {
        id: `TestViews::${shortName}`, shortName, name: shortName, kind, construct, layer: 'views',
        file: 'model/views.sysml', package: 'TestViews', attributes,
    } as MemoElement;
}

function modelOf(...elements: MemoElement[]): MemoModel {
    return {
        elements: toElementIndex(elements), relationships: [], packages: [], errors: [],
        elementsByKind: new Map(), elementsByLayer: new Map(), relationshipsByType: new Map(),
        unresolvedReferences: [],
    } as unknown as MemoModel;
}

// ─── KK-1: diagramType → view kind mapping ──────────────────────────────────

describe('KK-1: view-kind taxonomy', () => {
    it('defines exactly the 8 spec view kinds', () => {
        expect(VIEW_KINDS).toEqual([
            'general', 'interconnection', 'actionflow', 'statetransition',
            'sequence', 'grid', 'browser', 'geometry',
        ]);
    });

    it('maps every legacy diagramType key to exactly one spec view kind', () => {
        const legacyKeys = [
            'bdd', 'ibd', 'req', 'ucd', 'context', 'act', 'afd', 'pkg', 'par', 'risk',
            'stm', 'seq', 'fmea', 'alloc', 'threat-model', 'ofd', 'ffd',
        ];
        for (const key of legacyKeys) {
            const kind = DIAGRAM_TYPE_TO_VIEW_KIND[key];
            expect(kind, `diagramType "${key}" must map to a view kind`).toBeDefined();
            expect(isViewKind(kind)).toBe(true);
        }
    });

    it('maps operational and functional flows to the activity-flow base renderer', () => {
        expect(resolveViewKind(undefined, 'ofd')).toBe('actionflow');
        expect(resolveViewKind(undefined, 'ffd')).toBe('actionflow');
    });

    it('KK-9: geometry is reachable only by explicit declaration (ADR-1-19)', () => {
        // No legacy diagramType may silently map to geometry: a geometry view
        // needs authored bounds to draw, so it is only ever reached by an
        // explicit `viewKind` declaration. Adding a mapping must be deliberate.
        expect(Object.values(DIAGRAM_TYPE_TO_VIEW_KIND)).not.toContain('geometry');
        expect(resolveViewKind('DiagramViewKind::geometry', undefined)).toBe('geometry');
        expect(resolveViewKind('DiagramViewKind::geometry', 'bdd')).toBe('geometry');
    });

    it('normalizes qualified enum references', () => {
        expect(normalizeViewKind('DiagramViewKind::statetransition')).toBe('statetransition');
        expect(normalizeViewKind('general')).toBe('general');
        // DocumentView declares DocumentViewKind values under the same
        // attribute name — those are not spec view kinds
        expect(normalizeViewKind('DocumentViewKind::RMF')).toBeUndefined();
        expect(normalizeViewKind(undefined)).toBeUndefined();
        expect(normalizeViewKind('bogus')).toBeUndefined();
    });

    it('resolves declared viewKind over diagramType, falls back to mapping, then browser', () => {
        expect(resolveViewKind('DiagramViewKind::grid', 'bdd')).toBe('grid');
        expect(resolveViewKind(undefined, 'stm')).toBe('statetransition');
        expect(resolveViewKind(undefined, 'unknown-type')).toBe('general');
        expect(resolveViewKind(undefined, undefined)).toBe('browser');
        expect(resolveViewKind('DocumentViewKind::DHF', undefined)).toBe('browser');
    });
});

// ─── KK-1: derived views carry viewKind ─────────────────────────────────────

describe('KK-1: deriveModelViews view kinds', () => {
    it('every derived view resolves to exactly one spec view kind', () => {
        const model = modelOf(
            el('fmeaView', 'DiagramView', { name: 'FMEA View', viewKind: 'DiagramViewKind::grid', diagramType: 'fmea' }),
            el('modeView', 'DiagramView', { name: 'Mode View', diagramType: 'stm' }),
            el('dhfView', 'DocumentView', { name: 'DHF Index', viewKind: 'DocumentViewKind::DHF' }),
        );
        const { diagrams } = deriveModelViews(model);

        expect(diagrams).toHaveLength(3);
        for (const d of diagrams) {
            expect(d.viewKind, `diagram "${d.name}" must carry a view kind`).toBeDefined();
            expect(isViewKind(d.viewKind!)).toBe(true);
        }
        const byName = new Map(diagrams.map(d => [d.name, d]));
        expect(byName.get('FMEA View')?.viewKind).toBe('grid');
        expect(byName.get('Mode View')?.viewKind).toBe('statetransition');
        expect(byName.get('DHF Index')?.viewKind).toBe('browser');
    });

    it('inherits an ontology view definition binding after project extensions are applied', () => {
        const registry = new KindRegistry();
        registry.registerViewDefinition('GeometryView', { viewKind: 'DiagramViewKind::geometry' }, 'DiagramView');
        const model = modelOf(el('screenLayout', 'GeometryView', { name: 'Screen layout' }));

        expect(deriveModelViews(model, registry).diagrams[0].viewKind).toBe('geometry');
    });

    it.runIf(compilerConfigured && examplesPresent)('derives the shipped UI screen-region views as geometry', async () => {
        const project = await compiledExample('ui-screen-regions');
        const diagrams = deriveModelViews(project.model, project.registries?.kindRegistry).diagrams;

        expect(diagrams.find(view => view.id === 'UIE-001')?.viewKind).toBe('geometry');
        expect(diagrams.find(view => view.id === 'UIE-008')?.viewKind).toBe('geometry');
        expect(diagrams.find(view => view.id === 'UIV-001')?.viewKind).toBe('general');
        expect(diagrams.find(view => view.id === 'REQ-101')?.viewKind).toBe('grid');
        expect(diagrams.find(view => view.id === 'FUN-101')?.viewKind).toBe('general');
        expect(diagrams.find(view => view.id === 'RSK-101')?.viewKind).toBe('general');
    });

    it('lists one reusable view under every bound viewpoint', () => {
        const model = modelOf(
            el('softwareViewpoint', 'Viewpoint', { id: 'VP-SW', title: 'Software' }),
            el('safetyViewpoint', 'Viewpoint', { id: 'VP-SAFE', title: 'Safety' }),
            el('firmwareView', 'DiagramView', {
                name: 'Firmware Review', diagramType: 'bdd', viewpointDefinition: 'softwareViewpoint, safetyViewpoint',
            }),
        );
        const { viewpoints, diagrams } = deriveModelViews(model);

        expect(viewpoints.map(vp => vp.id)).toEqual(['VP-SW', 'VP-SAFE']);
        expect(diagrams[0].viewpointId).toBe('VP-SW');
        expect(diagrams[0].viewpointIds).toEqual(['VP-SW', 'VP-SAFE']);
    });

    it('recognizes extension kinds through the transitive specialization closure', () => {
        const model = modelOf(
            el('softwareViewpoint', 'Viewpoint', { id: 'VP-SW' }),
            el('firmware', 'FirmwareComponent'),
            el('firmwareView', 'DiagramView', {
                name: 'Firmware Review', diagramType: 'bdd', viewpointDefinition: 'softwareViewpoint',
                'selectionQuery.includeElementKinds': 'SoftwareComponent',
            }),
        );
        const registry = new KindRegistry();
        registry.register({ name: 'SoftwareComponent', label: 'Software Component', layer: 'software', sysmlConstruct: 'part def' });
        registry.register({ name: 'FirmwareComponent', label: 'Firmware Component', layer: 'software', sysmlConstruct: 'part def', superType: 'SoftwareComponent' });
        registry.computeDerivedBy();
        const { viewpoints, diagrams } = deriveModelViews(model, registry);

        expect(viewpoints[0].visibleKinds).toEqual(['SoftwareComponent', 'FirmwareComponent']);
        expect(diagrams[0].elementIds?.map(id => shortNameOf(id))).toContain('firmware');
    });
});

// ─── KK-1 acceptance: every GPCA view resolves to one of the 8 kinds ────────

describe.runIf(compilerConfigured && examplesPresent)('KK-1 acceptance: GPCA views', () => {
    it('every GPCA view resolves to exactly one of the 8 spec view kinds, with no validation warnings', async () => {
        const project = await compiledExample('gpca-pump');
        const { diagrams } = deriveModelViews(project.model, project.registries?.kindRegistry);

        expect(diagrams.length).toBeGreaterThan(0);
        for (const d of diagrams) {
            expect(d.viewKind, `GPCA view "${d.name}" must resolve to a spec view kind`).toBeDefined();
            expect(isViewKind(d.viewKind!), `"${d.viewKind}" is not a spec view kind`).toBe(true);
        }
        expect(validateViews(project.model)).toHaveLength(0);
    });
});

describe.runIf(compilerConfigured && examplesPresent)('action-flow sample subtypes', () => {
    it('derives the three explicitly declared diagram types without collapsing them', async () => {
        const project = await compiledExample('sysml-diagram-samples');
        const { diagrams } = deriveModelViews(project.model, project.registries?.kindRegistry);
        const byId = new Map(diagrams.map(diagram => [diagram.id, diagram]));

        expect(byId.get('diag-sample-therapySessionFlow')?.diagramType).toBe('afd');
        expect(byId.get('diag-sample-processStepsDetail')?.diagramType).toBe('afd');
        expect(byId.get('diag-sample-medicationDeliveryFlow')?.diagramType).toBe('ffd');
        expect(byId.get('diag-sample-clinicalSetupActivity')?.diagramType).toBe('ofd');
        const actionFlowIds = ['diag-sample-therapySessionFlow', 'diag-sample-processStepsDetail',
            'diag-sample-medicationDeliveryFlow', 'diag-sample-clinicalSetupActivity'];
        expect(actionFlowIds.every(id => byId.get(id)?.viewKind === 'actionflow')).toBe(true);
    });
});

// ─── KK-2/KK-3 acceptance: template views ship with the GPCA example ─────────

describe.runIf(compilerConfigured && examplesPresent)('KK-2/KK-3 acceptance: GPCA template views', () => {
    async function deriveGpcaViews() {
        const project = await compiledExample('gpca-pump');
        return deriveModelViews(project.model, project.registries?.kindRegistry).diagrams;
    }

    it('KK-2: ships a General view whose layoutHint drives the template mode', async () => {
        const diagrams = await deriveGpcaViews();
        const decomp = diagrams.find(d => d.name === 'GPCA_SystemDecompositionView');
        expect(decomp).toBeDefined();
        expect(decomp!.viewKind).toBe('general');
        // The renderer honors this presentation hint as the initial mode
        expect(decomp!.properties?.layoutHint).toBe('containment');
        expect(decomp!.relationshipTypes).toContain('Composes');
    });

    it('KK-3: ships an Interconnection view with parts, ports, and typed connectors declared', async () => {
        const diagrams = await deriveGpcaViews();
        const interconnect = diagrams.find(d => d.name === 'GPCA_DeviceInterconnectView');
        expect(interconnect).toBeDefined();
        expect(interconnect!.viewKind).toBe('interconnection');
        // `flow` carries what moves and `bind` carries port delegation; both
        // replace the deleted ExchangesWith, which could say neither.
        expect(interconnect!.relationshipTypes).toEqual(
            expect.arrayContaining(['flow', 'bind', 'Composes'])
        );
        expect(interconnect!.diagramType).toBe('ibd');
    });

    it('KK-4: ships an Action Flow view selecting the infusion delivery actions', async () => {
        const diagrams = await deriveGpcaViews();
        const actionFlow = diagrams.find(d => d.name === 'GPCA_InfusionDeliveryActionFlowView');
        expect(actionFlow).toBeDefined();
        expect(actionFlow!.viewKind).toBe('actionflow');
        expect(actionFlow!.diagramType).toBe('afd');
    });

    it('KK-8: ships a Browser view over the functions layer (declared kind, no legacy diagramType)', async () => {
        const diagrams = await deriveGpcaViews();
        const browser = diagrams.find(d => d.name === 'GPCA_FunctionBrowserView');
        expect(browser).toBeDefined();
        expect(browser!.viewKind).toBe('browser');
    });
});

// ─── KK-1: validator flags unmapped diagram types ───────────────────────────

describe('KK-1: view validation', () => {
    it('flags unmapped diagramType with a warning (VW-001)', () => {
        const violations = validateViews(modelOf(
            el('legacyView', 'DiagramView', { name: 'Legacy View', diagramType: 'flowchart', viewpointDefinition: 'testViewpoint' })));

        const vw001 = violations.filter(v => v.ruleId === 'VW-001');
        expect(vw001).toHaveLength(1);
        expect(vw001[0].severity).toBe('warning');
        expect(vw001[0].description).toContain('flowchart');
    });

    it('flags off-taxonomy viewKind on diagram views (VW-002)', () => {
        const violations = validateViews(modelOf(
            el('oddView', 'DiagramView', {
                name: 'Odd View', viewKind: 'DiagramViewKind::freeform', diagramType: 'bdd', viewpointDefinition: 'testViewpoint',
            })));

        const vw002 = violations.filter(v => v.ruleId === 'VW-002');
        expect(vw002).toHaveLength(1);
        expect(vw002[0].severity).toBe('warning');
    });

    it('accepts all mapped diagram types without warnings', () => {
        expect(validateViews(modelOf(
            el('okView', 'DiagramView', {
                name: 'OK View', viewKind: 'DiagramViewKind::interconnection', diagramType: 'ibd', viewpointDefinition: 'testViewpoint',
            })))).toHaveLength(0);
    });

    it('requires every view to conform to at least one viewpoint (VW-003)', () => {
        const violations = validateViews(modelOf(
            el('orphanView', 'DiagramView', { name: 'Orphan View', diagramType: 'bdd' })));
        const vw003 = violations.filter(v => v.ruleId === 'VW-003');
        expect(vw003).toHaveLength(1);
        expect(vw003[0].severity).toBe('error');
    });
});
