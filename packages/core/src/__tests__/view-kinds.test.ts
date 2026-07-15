import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { EmptyFileSystem } from 'langium';
import { parseHelper } from 'langium/test';
import { createMemoSysMLServices } from '../language/memo-sysml-module.js';
import type { Model } from '../language/generated/ast.js';
import type { MEMOConfig } from '../model/config.js';
import { buildMemoModel } from '../model/builder.js';
import { deriveModelViews } from '../model/view-deriver.js';
import { validateViews } from '../validator/view-validator.js';
import {
    VIEW_KINDS,
    DIAGRAM_TYPE_TO_VIEW_KIND,
    isViewKind,
    normalizeViewKind,
    resolveViewKind,
} from '../model/view-kinds.js';
import type { ParsedDocument } from '../model/parser-utils.js';

const services = createMemoSysMLServices({ ...EmptyFileSystem }).MemoSysML;
const parse = parseHelper<Model>(services);

async function parseDoc(source: string, filePath: string = 'test.sysml'): Promise<ParsedDocument> {
    const doc = await parse(source);
    return { document: doc, filePath };
}

/** Minimal config exposing the ontology view kinds */
const viewConfig: MEMOConfig = {
    projectName: 'test-views',
    projectType: 'device',
    kinds: {
        DiagramView: { label: 'Diagram View', layer: 'viewpoints', sysmlConstruct: 'part def' },
        DocumentView: { label: 'Document View', layer: 'viewpoints', sysmlConstruct: 'part def' },
    },
    relationshipTypes: [],
};

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
            'bdd', 'ibd', 'req', 'ucd', 'act', 'afd', 'pkg', 'par', 'risk',
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
        // The renderer is deferred; no legacy diagramType may silently map to
        // geometry. Adding such a mapping must be a deliberate ADR revisit.
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
    it('every derived view resolves to exactly one spec view kind', async () => {
        const doc = await parseDoc(`
            package TestViews {
                part fmeaView : DiagramView {
                    attribute name = "FMEA View";
                    attribute viewKind = DiagramViewKind::grid;
                    attribute diagramType = "fmea";
                }
                part modeView : DiagramView {
                    attribute name = "Mode View";
                    attribute diagramType = "stm";
                }
                part dhfView : DocumentView {
                    attribute name = "DHF Index";
                    attribute viewKind = DocumentViewKind::DHF;
                }
            }
        `);
        const model = buildMemoModel([doc], viewConfig);
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
});

// ─── KK-1 acceptance: every GPCA view resolves to one of the 8 kinds ────────

const GPCA_VIEWS_DIR = resolve(
    __dirname,
    '../../../../memo/src/examples/gpca-pump/model/views'
);

/** Config covering the view kinds the GPCA views instantiate */
const gpcaViewConfig: MEMOConfig = {
    projectName: 'gpca-views',
    projectType: 'device',
    kinds: {
        DiagramView: { label: 'Diagram View', layer: 'viewpoints', sysmlConstruct: 'part def' },
        DocumentView: { label: 'Document View', layer: 'viewpoints', sysmlConstruct: 'part def' },
        CybersecurityAssessmentView: { label: 'Cybersecurity Assessment View', layer: 'viewpoints', sysmlConstruct: 'part def' },
        CybersecurityThreatModelView: { label: 'Threat Model View', layer: 'viewpoints', sysmlConstruct: 'part def' },
        UsabilityEngineeringView: { label: 'Usability Engineering View', layer: 'viewpoints', sysmlConstruct: 'part def' },
    },
    relationshipTypes: [],
};

describe('KK-1 acceptance: GPCA views', () => {
    it('all 26 GPCA views resolve to exactly one of the 8 spec view kinds, with no validation warnings', async () => {
        const files = readdirSync(GPCA_VIEWS_DIR).filter(f => f.endsWith('.sysml'));
        expect(files).toHaveLength(26);

        const docs: ParsedDocument[] = [];
        for (const f of files) {
            docs.push(await parseDoc(readFileSync(join(GPCA_VIEWS_DIR, f), 'utf-8'), f));
        }
        const model = buildMemoModel(docs, gpcaViewConfig);
        const { diagrams } = deriveModelViews(model);

        expect(diagrams).toHaveLength(26);
        for (const d of diagrams) {
            expect(d.viewKind, `GPCA view "${d.name}" must resolve to a spec view kind`).toBeDefined();
            expect(isViewKind(d.viewKind!), `"${d.viewKind}" is not a spec view kind`).toBe(true);
        }
        expect(validateViews(model)).toHaveLength(0);

        // Kind distribution locks the template consolidation: every diagram
        // view maps explicitly onto a KK-2..KK-8 template kind (tabular and
        // matrix views on grid), and the 9 document-backed views resolve to
        // browser alongside the declared Function Browser view
        const counts: Record<string, number> = {};
        for (const d of diagrams) counts[d.viewKind!] = (counts[d.viewKind!] ?? 0) + 1;
        expect(counts).toEqual({
            general: 6,
            interconnection: 2,
            actionflow: 1,
            statetransition: 1,
            sequence: 1,
            grid: 5,
            browser: 10,
        });
    });
});

describe('action-flow sample subtypes', () => {
    it('derives the three explicitly declared diagram types without collapsing them', async () => {
        const samplesDir = resolve(GPCA_VIEWS_DIR, '../samples');
        const files = ['action_flow_view.sysml', 'functional_flow_view.sysml', 'operational_behaviour_view.sysml'];
        const docs: ParsedDocument[] = [];
        for (const file of files) {
            docs.push(await parseDoc(readFileSync(join(samplesDir, file), 'utf-8'), file));
        }
        const model = buildMemoModel(docs, gpcaViewConfig);
        const { diagrams } = deriveModelViews(model);
        const byId = new Map(diagrams.map(diagram => [diagram.id, diagram]));

        expect(byId.get('diag-sample-sampleActionFlowView')?.diagramType).toBe('afd');
        expect(byId.get('diag-sample-fxDeliveryView')?.diagramType).toBe('ffd');
        expect(byId.get('diag-sample-opSetupView')?.diagramType).toBe('ofd');
        expect(diagrams.every(diagram => diagram.viewKind === 'actionflow')).toBe(true);
    });
});

// ─── KK-2/KK-3 acceptance: template views ship with the GPCA example ─────────

describe('KK-2/KK-3 acceptance: GPCA template views', () => {
    async function deriveGpcaViews() {
        const files = readdirSync(GPCA_VIEWS_DIR).filter(f => f.endsWith('.sysml'));
        const docs: ParsedDocument[] = [];
        for (const f of files) {
            docs.push(await parseDoc(readFileSync(join(GPCA_VIEWS_DIR, f), 'utf-8'), f));
        }
        const model = buildMemoModel(docs, gpcaViewConfig);
        return deriveModelViews(model).diagrams;
    }

    it('KK-2: ships a General view whose layoutHint drives the template mode', async () => {
        const diagrams = await deriveGpcaViews();
        const decomp = diagrams.find(d => d.name === 'GPCA System Decomposition View');
        expect(decomp).toBeDefined();
        expect(decomp!.viewKind).toBe('general');
        // The renderer honors this presentation hint as the initial mode
        expect(decomp!.properties?.layoutHint).toBe('containment');
        expect(decomp!.relationshipTypes).toContain('Composes');
    });

    it('KK-3: ships an Interconnection view with parts, ports, and typed connectors declared', async () => {
        const diagrams = await deriveGpcaViews();
        const interconnect = diagrams.find(d => d.name === 'GPCA Device Interconnect View');
        expect(interconnect).toBeDefined();
        expect(interconnect!.viewKind).toBe('interconnection');
        expect(interconnect!.relationshipTypes).toEqual(
            expect.arrayContaining(['ExchangesWith', 'Composes'])
        );
        expect(interconnect!.diagramType).toBe('ibd');
    });

    it('KK-4: ships an Action Flow view selecting the infusion delivery actions', async () => {
        const diagrams = await deriveGpcaViews();
        const actionFlow = diagrams.find(d => d.name === 'GPCA Infusion Delivery Action Flow');
        expect(actionFlow).toBeDefined();
        expect(actionFlow!.viewKind).toBe('actionflow');
        expect(actionFlow!.diagramType).toBe('afd');
    });

    it('KK-8: ships a Browser view over the functions layer (declared kind, no legacy diagramType)', async () => {
        const diagrams = await deriveGpcaViews();
        const browser = diagrams.find(d => d.name === 'GPCA Function Browser');
        expect(browser).toBeDefined();
        expect(browser!.viewKind).toBe('browser');
    });
});

// ─── KK-1: validator flags unmapped diagram types ───────────────────────────

describe('KK-1: view validation', () => {
    it('flags unmapped diagramType with a warning (VW-001)', async () => {
        const doc = await parseDoc(`
            package TestViews {
                part legacyView : DiagramView {
                    attribute name = "Legacy View";
                    attribute diagramType = "flowchart";
                }
            }
        `);
        const model = buildMemoModel([doc], viewConfig);
        const violations = validateViews(model);

        const vw001 = violations.filter(v => v.ruleId === 'VW-001');
        expect(vw001).toHaveLength(1);
        expect(vw001[0].severity).toBe('warning');
        expect(vw001[0].description).toContain('flowchart');
    });

    it('flags off-taxonomy viewKind on diagram views (VW-002)', async () => {
        const doc = await parseDoc(`
            package TestViews {
                part oddView : DiagramView {
                    attribute name = "Odd View";
                    attribute viewKind = DiagramViewKind::freeform;
                    attribute diagramType = "bdd";
                }
            }
        `);
        const model = buildMemoModel([doc], viewConfig);
        const violations = validateViews(model);

        const vw002 = violations.filter(v => v.ruleId === 'VW-002');
        expect(vw002).toHaveLength(1);
        expect(vw002[0].severity).toBe('warning');
    });

    it('accepts all mapped diagram types without warnings', async () => {
        const doc = await parseDoc(`
            package TestViews {
                part okView : DiagramView {
                    attribute name = "OK View";
                    attribute viewKind = DiagramViewKind::interconnection;
                    attribute diagramType = "ibd";
                }
            }
        `);
        const model = buildMemoModel([doc], viewConfig);
        expect(validateViews(model)).toHaveLength(0);
    });
});
