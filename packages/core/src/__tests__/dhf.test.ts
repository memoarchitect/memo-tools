import { describe, it, expect } from 'vitest';
import {
    DHF_DOCUMENT_TYPES, getDocumentType, getDocumentsByGroup, getAllDocumentIds,
    resolveDocumentType,
    compileDocument, createQueryContext,
    text, xref, heading, paragraph, table, badge, metric, metricGroup, progress, divider,
    createSnapshot, diffSnapshots, generateRedlineDocument,
    loadDhfConfig, isDocumentEnabled,
    getPlugin, getAvailableFormats,
} from '../index.js';
import type { MemoModel, MemoElement, MemoRelationship } from '../model/semantic.js';
import type { ValidationResult, CompletenessReport } from '../validator/types.js';
import type { MEMOConfig } from '../model/config.js';

// ─── Test Helpers ────────────────────────────────────────────────────────────

function makeElement(overrides: Partial<MemoElement> = {}): MemoElement {
    return {
        id: 'el-1', name: 'TestElement', kind: 'Hazard', construct: 'part',
        layer: 'risk', file: 'test.sysml', attributes: {}, ...overrides,
    };
}

function makeModel(elements: MemoElement[] = [], relationships: MemoRelationship[] = []): MemoModel {
    const elementMap = new Map(elements.map(e => [e.id, e]));
    const elementsByKind = new Map<string, MemoElement[]>();
    const elementsByLayer = new Map<string, MemoElement[]>();
    for (const el of elements) {
        if (!elementsByKind.has(el.kind)) elementsByKind.set(el.kind, []);
        elementsByKind.get(el.kind)!.push(el);
        if (!elementsByLayer.has(el.layer)) elementsByLayer.set(el.layer, []);
        elementsByLayer.get(el.layer)!.push(el);
    }
    const relationshipsByType = new Map<string, MemoRelationship[]>();
    const outgoing = new Map<string, MemoRelationship[]>();
    const incoming = new Map<string, MemoRelationship[]>();
    for (const rel of relationships) {
        if (!relationshipsByType.has(rel.type)) relationshipsByType.set(rel.type, []);
        relationshipsByType.get(rel.type)!.push(rel);
        if (!outgoing.has(rel.sourceId)) outgoing.set(rel.sourceId, []);
        outgoing.get(rel.sourceId)!.push(rel);
        if (!incoming.has(rel.targetId)) incoming.set(rel.targetId, []);
        incoming.get(rel.targetId)!.push(rel);
    }
    return { elements: elementMap, relationships, errors: [], elementsByKind, elementsByLayer, relationshipsByType, outgoing, incoming };
}

function makeValidation(violations: any[] = []): ValidationResult {
    return { violations, rulesEvaluated: 10, rulesPassed: 10 - violations.length, timestamp: Date.now() };
}

function makeCompleteness(): CompletenessReport {
    return { layers: [], overall: 75, totalElements: 10, completeElements: 7, elementStatus: {} };
}

function makeConfig(): MEMOConfig {
    return { projectName: 'Test Project', projectType: 'device' as any, architectureLayers: [], viewpoints: [], workflows: [] };
}

// ─── Document Registry Tests ─────────────────────────────────────────────────

describe('DHF Document Registry', () => {
    it('registers 18 document types', () => {
        expect(DHF_DOCUMENT_TYPES).toHaveLength(18);
    });

    it('each doc has required fields', () => {
        for (const doc of DHF_DOCUMENT_TYPES) {
            expect(doc.id).toBeTruthy();
            expect(doc.title).toBeTruthy();
            expect(doc.standards.length).toBeGreaterThan(0);
            expect(doc.sections.length).toBeGreaterThan(0);
            expect(doc.group).toBeTruthy();
        }
    });

    it('getDocumentType finds by ID', () => {
        expect(getDocumentType('rmp')?.title).toBe('Risk Management Plan');
        expect(getDocumentType('nonexistent')).toBeUndefined();
    });

    it('getDocumentsByGroup filters correctly', () => {
        const risk = getDocumentsByGroup('risk');
        expect(risk.length).toBeGreaterThanOrEqual(3); // rmp, har, fmea + all-group docs
        for (const doc of risk) {
            expect(doc.group === 'risk' || doc.group === 'all').toBe(true);
        }
    });

    it('getAllDocumentIds returns 18 IDs', () => {
        const ids = getAllDocumentIds();
        expect(ids).toHaveLength(18);
        expect(ids).toContain('rmp');
        expect(ids).toContain('dhf-index');
    });

    it('document IDs are unique', () => {
        const ids = getAllDocumentIds();
        expect(new Set(ids).size).toBe(ids.length);
    });
});

// ─── Artifact Kind → DHF Document Lookup (E-3) ─────────────────────────────

describe('resolveDocumentType — artifact kind lookup', () => {
    it('resolves RiskManagementPlan artifact kind to rmp document', () => {
        const doc = resolveDocumentType('RiskManagementPlan');
        expect(doc).toBeDefined();
        expect(doc!.id).toBe('rmp');
        expect(doc!.title).toBe('Risk Management Plan');
    });

    it('falls back to built-in document ID when no artifact kind matches', () => {
        const doc = resolveDocumentType('har');
        expect(doc).toBeDefined();
        expect(doc!.id).toBe('har');
    });

    it('returns undefined for unknown artifact kind and unknown doc ID', () => {
        expect(resolveDocumentType('NonExistentArtifact')).toBeUndefined();
    });
});

// ─── Document IR Tests ───────────────────────────────────────────────────────

describe('Document IR Helpers', () => {
    it('text creates a DhfText node', () => {
        const t = text('hello', { bold: true });
        expect(t).toEqual({ type: 'text', value: 'hello', bold: true });
    });

    it('xref creates a cross-reference', () => {
        const x = xref('el-1', 'MyElement', 'Hazard');
        expect(x).toEqual({ type: 'xref', elementId: 'el-1', label: 'MyElement', kind: 'Hazard' });
    });

    it('heading creates heading block', () => {
        const h = heading(2, 'Section Title', 'sec-1');
        expect(h).toEqual({ type: 'heading', level: 2, text: 'Section Title', id: 'sec-1' });
    });

    it('table creates table block', () => {
        const t = table(['A', 'B'], [[[text('1')], [text('2')]]]);
        expect(t.type).toBe('table');
        expect(t.headers).toHaveLength(2);
        expect(t.rows).toHaveLength(1);
    });

    it('badge creates inline badge', () => {
        const b = badge('OK', 'success');
        expect(b).toEqual({ type: 'badge', label: 'OK', variant: 'success' });
    });

    it('metricGroup wraps metrics', () => {
        const mg = metricGroup(metric('Count', 42), metric('Rate', '95%'));
        expect(mg.type).toBe('metric-group');
        expect(mg.metrics).toHaveLength(2);
    });
});

// ─── Query Engine Tests ──────────────────────────────────────────────────────

describe('Query Engine', () => {
    const hazard1 = makeElement({ id: 'h1', name: 'Overheating', kind: 'Hazard' });
    const hazard2 = makeElement({ id: 'h2', name: 'Leaking', kind: 'Hazard' });
    const control = makeElement({ id: 'c1', name: 'TempSensor', kind: 'RiskControl', layer: 'risk' });
    const req = makeElement({ id: 'r1', name: 'REQ-001', kind: 'SystemRequirement', layer: 'requirements' });

    const mitigatesRel: MemoRelationship = {
        id: 'rel-1', type: 'mitigates', sourceId: 'c1', sourceEnd: 'control',
        targetId: 'h1', targetEnd: 'hazard', file: 'test.sysml',
    };

    const model = makeModel([hazard1, hazard2, control, req], [mitigatesRel]);
    const validation = makeValidation([{
        ruleId: 'CR-MED-001', description: 'Missing mitigation', severity: 'error',
        elementId: 'h2', elementKind: 'Hazard', elementName: 'Leaking', layer: 'risk',
    }]);
    const completeness = makeCompleteness();
    const config = makeConfig();

    const ctx = createQueryContext(model, validation, completeness, config);

    it('elementsByKind returns matching elements', () => {
        expect(ctx.elementsByKind('Hazard')).toHaveLength(2);
        expect(ctx.elementsByKind('NonExistent')).toHaveLength(0);
    });

    it('elementsByKinds returns elements matching any kind', () => {
        expect(ctx.elementsByKinds(['Hazard', 'RiskControl'])).toHaveLength(3);
    });

    it('related returns filtered relationships', () => {
        const mitigations = ctx.related('h1', 'mitigates', 'incoming');
        expect(mitigations).toHaveLength(1);
        expect(mitigations[0].sourceId).toBe('c1');
    });

    it('unmitigatedCount identifies hazards without controls', () => {
        expect(ctx.unmitigatedCount()).toBe(1); // h2 has no mitigation
    });

    it('errorCount returns validation error count', () => {
        expect(ctx.errorCount()).toBe(1);
    });

    it('totalElements returns model size', () => {
        expect(ctx.totalElements()).toBe(4);
    });

    it('elementName returns name or falls back to ID', () => {
        expect(ctx.elementName('h1')).toBe('Overheating');
        expect(ctx.elementName('nonexistent')).toBe('nonexistent');
    });

    it('traceChain follows outgoing relationships', () => {
        const chain = ctx.traceChain('c1');
        expect(chain).toHaveLength(1);
        expect(chain[0].element.id).toBe('h1');
    });
});

// ─── Template Engine Tests ───────────────────────────────────────────────────

describe('Template Engine', () => {
    const hazard = makeElement({ id: 'h1', name: 'Overheating', kind: 'Hazard', doc: 'Device may overheat' });
    const control = makeElement({ id: 'c1', name: 'TempSensor', kind: 'RiskControl' });
    const model = makeModel([hazard, control], [{
        id: 'rel-1', type: 'mitigates', sourceId: 'c1', sourceEnd: 'control',
        targetId: 'h1', targetEnd: 'hazard', file: 'test.sysml',
    }]);
    const validation = makeValidation();
    const completeness = makeCompleteness();
    const config = makeConfig();

    it('compiles a risk management plan', () => {
        const rmpType = getDocumentType('rmp')!;
        const doc = compileDocument({ model, validation, completeness, config, documentType: rmpType });
        expect(doc.frontmatter.documentId).toBe('rmp');
        expect(doc.frontmatter.title).toBe('Risk Management Plan');
        expect(doc.sections.length).toBeGreaterThan(0);
        expect(doc.status).toBeDefined();
    });

    it('compiles a hazard analysis report with elements', () => {
        const harType = getDocumentType('har')!;
        const doc = compileDocument({ model, validation, completeness, config, documentType: harType });
        expect(doc.totalElements).toBeGreaterThan(0);
    });

    it('compiles DHF index with all document types', () => {
        const indexType = getDocumentType('dhf-index')!;
        const doc = compileDocument({ model, validation, completeness, config, documentType: indexType });
        expect(doc.sections.length).toBeGreaterThan(0);
    });

    it('compiles RTM with coverage summary', () => {
        const reqEl = makeElement({ id: 'r1', name: 'REQ-001', kind: 'SystemRequirement', layer: 'requirements' });
        const modelWithReq = makeModel([reqEl], []);
        const doc = compileDocument({
            model: modelWithReq, validation, completeness, config,
            documentType: getDocumentType('rtm')!,
        });
        expect(doc.sections.some(s => s.id === 'requirements-list')).toBe(true);
    });

    it('empty model produces empty status', () => {
        const emptyModel = makeModel([], []);
        const doc = compileDocument({
            model: emptyModel, validation, completeness, config,
            documentType: getDocumentType('rmp')!,
        });
        // Most sections should be empty
        expect(doc.sections.some(s => s.status === 'empty')).toBe(true);
    });
});

// ─── Export Plugin Tests ─────────────────────────────────────────────────────

describe('Export Plugins', () => {
    const model = makeModel([makeElement()], []);
    const config = makeConfig();

    it('has html, md, docx formats available', () => {
        const formats = getAvailableFormats();
        expect(formats).toContain('html');
        expect(formats).toContain('md');
        expect(formats).toContain('docx');
    });

    it('HTML plugin renders a document', async () => {
        const rmpType = getDocumentType('rmp')!;
        const doc = compileDocument({
            model, validation: makeValidation(), completeness: makeCompleteness(),
            config, documentType: rmpType,
        });
        const plugin = getPlugin('html')!;
        const result = await plugin.render(doc);
        expect(result.format).toBe('html');
        expect(result.content).toContain('Risk Management Plan');
        expect(result.content).toContain('<!DOCTYPE html>');
    });

    it('Markdown plugin renders a document', async () => {
        const rmpType = getDocumentType('rmp')!;
        const doc = compileDocument({
            model, validation: makeValidation(), completeness: makeCompleteness(),
            config, documentType: rmpType,
        });
        const plugin = getPlugin('md')!;
        const result = await plugin.render(doc);
        expect(result.format).toBe('md');
        expect(result.content).toContain('# Risk Management Plan');
    });

    it('DOCX plugin renders a document', async () => {
        const rmpType = getDocumentType('rmp')!;
        const doc = compileDocument({
            model, validation: makeValidation(), completeness: makeCompleteness(),
            config, documentType: rmpType,
        });
        const plugin = getPlugin('docx')!;
        const result = await plugin.render(doc);
        expect(result.format).toBe('docx');
        expect(result.content).toContain('Risk Management Plan');
    });
});

// ─── Snapshot & Redline Tests ────────────────────────────────────────────────

describe('Snapshot & Redline', () => {
    const model = makeModel([
        makeElement({ id: 'h1', kind: 'Hazard' }),
        makeElement({ id: 'c1', kind: 'RiskControl' }),
    ], []);
    const config = makeConfig();
    const rmpType = getDocumentType('rmp')!;

    it('createSnapshot produces valid snapshot', () => {
        const doc = compileDocument({
            model, validation: makeValidation(), completeness: makeCompleteness(),
            config, documentType: rmpType,
        });
        const snap = createSnapshot(doc, 'test-snap');
        expect(snap.documentId).toBe('rmp');
        expect(snap.label).toBe('test-snap');
        expect(snap.sections.length).toBeGreaterThan(0);
        expect(snap.id).toMatch(/^snap-/);
    });

    it('diffSnapshots detects changes', () => {
        const doc1 = compileDocument({
            model: makeModel([makeElement({ id: 'h1', kind: 'Hazard' })], []),
            validation: makeValidation(), completeness: makeCompleteness(),
            config, documentType: rmpType,
        });
        const doc2 = compileDocument({
            model: makeModel([
                makeElement({ id: 'h1', kind: 'Hazard' }),
                makeElement({ id: 'h2', kind: 'Hazard', name: 'New Hazard' }),
            ], []),
            validation: makeValidation(), completeness: makeCompleteness(),
            config, documentType: rmpType,
        });

        const snap1 = createSnapshot(doc1, 'baseline');
        const snap2 = createSnapshot(doc2, 'current');
        const diff = diffSnapshots(snap1, snap2);

        expect(diff.baseline.label).toBe('baseline');
        expect(diff.current.label).toBe('current');
        expect(diff.changedSections.length).toBeGreaterThan(0);
    });

    it('generateRedlineDocument produces valid IR', () => {
        const doc1 = compileDocument({
            model: makeModel([], []),
            validation: makeValidation(), completeness: makeCompleteness(),
            config, documentType: rmpType,
        });
        const doc2 = compileDocument({
            model, validation: makeValidation(), completeness: makeCompleteness(),
            config, documentType: rmpType,
        });

        const snap1 = createSnapshot(doc1);
        const snap2 = createSnapshot(doc2);
        const diff = diffSnapshots(snap1, snap2);
        const redline = generateRedlineDocument(diff);

        expect(redline.frontmatter.documentId).toContain('redline');
        expect(redline.sections.length).toBeGreaterThan(0);
    });
});

// ─── DHF Config Tests ────────────────────────────────────────────────────────

describe('DHF Config', () => {
    it('isDocumentEnabled returns true by default', () => {
        expect(isDocumentEnabled('rmp')).toBe(true);
        expect(isDocumentEnabled('rmp', {})).toBe(true);
    });

    it('isDocumentEnabled respects overrides', () => {
        expect(isDocumentEnabled('rmp', { documents: { rmp: { enabled: false } } })).toBe(false);
        expect(isDocumentEnabled('har', { documents: { rmp: { enabled: false } } })).toBe(true);
    });

    it('loadDhfConfig returns undefined for missing file', () => {
        expect(loadDhfConfig('/nonexistent/path')).toBeUndefined();
    });
});
