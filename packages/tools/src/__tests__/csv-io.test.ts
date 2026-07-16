import { describe, it, expect } from 'vitest';
import type { MEMOConfig } from '../model/config.js';
import type { MemoModel, MemoElement, MemoRelationship } from '../model/semantic.js';
import {
    parseElementsCsv,
    parseRelationshipsCsv,
    exportElementsCsv,
    exportRelationshipsCsv,
    generateElementTemplate,
    generateRelationshipTemplate,
} from '../serializer/csv-io.js';
import { generateUsage, generateConnection, generateFile, wrapPackage } from '../serializer/sysml-generator.js';

// ─── Test Config ────────────────────────────────────────────────────────────

const testConfig: MEMOConfig = {
    projectName: 'test',
    projectType: 'device',
    kinds: {
        Hazard: {
            label: 'Hazard',
            layer: 'risk',
            sysmlConstruct: 'requirement def',
            defaultAttributes: { severity: 'Serious' },
        },
        SystemRequirement: {
            label: 'System Requirement',
            layer: 'requirements',
            sysmlConstruct: 'requirement def',
        },
        Component: {
            label: 'Component',
            layer: 'logical',
            sysmlConstruct: 'part def',
        },
        SystemFunction: {
            label: 'System Function',
            layer: 'functional',
            sysmlConstruct: 'action def',
        },
    },
    relationshipTypes: [
        { name: 'mitigates', label: 'Mitigates', layer: 'risk', color: '#E74C3C' },
        { name: 'traceTo', label: 'Trace To', layer: 'requirements', color: '#4A90D9' },
        { name: 'allocateTo', label: 'Allocate To', layer: 'functional', color: '#E67E22' },
    ],
};

// ─── Element CSV Parsing ────────────────────────────────────────────────────

describe('parseElementsCsv', () => {
    it('parses valid elements CSV', () => {
        const csv = `id,name,kind,doc
haz_001,Over-Infusion,Hazard,Excess medication delivery
req_001,Flow Control,SystemRequirement,System shall control flow rate`;

        const result = parseElementsCsv(csv, testConfig);
        expect(result.errors).toHaveLength(0);
        expect(result.items).toHaveLength(2);

        expect(result.items[0]).toMatchObject({
            id: 'haz_001',
            name: 'Over-Infusion',
            kind: 'Hazard',
            construct: 'requirement',
            layer: 'risk',
            doc: 'Excess medication delivery',
        });
        // Default attributes from kind should be merged
        expect(result.items[0].attributes).toHaveProperty('severity', 'Serious');

        expect(result.items[1]).toMatchObject({
            id: 'req_001',
            kind: 'SystemRequirement',
            construct: 'requirement',
            layer: 'requirements',
        });
    });

    it('handles dynamic attribute columns', () => {
        const csv = `id,name,kind,severity,priority
haz_001,Overflow,Hazard,Critical,High`;

        const result = parseElementsCsv(csv, testConfig);
        expect(result.errors).toHaveLength(0);
        expect(result.items[0].attributes).toEqual({
            severity: 'Critical', // overrides default
            priority: 'High',
        });
    });

    it('rejects unknown kinds', () => {
        const csv = `id,name,kind
bad_001,Bad Element,UnknownKind`;

        const result = parseElementsCsv(csv, testConfig);
        expect(result.errors).toHaveLength(1);
        expect(result.errors[0]).toContain("unknown kind 'UnknownKind'");
        expect(result.items).toHaveLength(0);
    });

    it('rejects invalid ids', () => {
        const csv = `id,name,kind
123invalid,Bad Id,Hazard`;

        const result = parseElementsCsv(csv, testConfig);
        expect(result.errors).toHaveLength(1);
        expect(result.errors[0]).toContain("invalid id '123invalid'");
    });

    it('rejects duplicate ids', () => {
        const csv = `id,name,kind
haz_001,First,Hazard
haz_001,Duplicate,Hazard`;

        const result = parseElementsCsv(csv, testConfig);
        expect(result.errors).toHaveLength(1);
        expect(result.errors[0]).toContain("duplicate id 'haz_001'");
    });

    it('reports missing required columns', () => {
        const csv = `name,kind
Some Name,Hazard`;

        const result = parseElementsCsv(csv, testConfig);
        expect(result.errors).toHaveLength(1);
        expect(result.errors[0]).toContain('Missing required columns: id');
    });

    it('handles construct override', () => {
        const csv = `id,name,kind,construct
comp_001,Motor,Component,part`;

        const result = parseElementsCsv(csv, testConfig);
        expect(result.items[0].construct).toBe('part');
    });

    it('handles quoted fields with commas', () => {
        const csv = `id,name,kind,doc
haz_001,"Over-Infusion, Serious",Hazard,"Excess medication, dangerous"`;

        const result = parseElementsCsv(csv, testConfig);
        expect(result.errors).toHaveLength(0);
        expect(result.items[0].name).toBe('Over-Infusion, Serious');
        expect(result.items[0].doc).toBe('Excess medication, dangerous');
    });

    it('handles empty CSV', () => {
        const result = parseElementsCsv('', testConfig);
        expect(result.errors).toHaveLength(1);
        expect(result.errors[0]).toContain('empty');
    });
});

// ─── Relationship CSV Parsing ───────────────────────────────────────────────

describe('parseRelationshipsCsv', () => {
    it('parses valid relationships CSV', () => {
        const csv = `sourceId,targetId,type
ctrl_001,haz_001,mitigates
req_001,func_001,traceTo`;

        const result = parseRelationshipsCsv(csv, testConfig);
        expect(result.errors).toHaveLength(0);
        expect(result.items).toHaveLength(2);
        expect(result.items[0]).toMatchObject({
            sourceId: 'ctrl_001',
            targetId: 'haz_001',
            type: 'mitigates',
            sourceEnd: 'source',
            targetEnd: 'target',
        });
    });

    it('uses custom end names', () => {
        const csv = `sourceId,targetId,type,sourceEnd,targetEnd
ctrl_001,haz_001,mitigates,control,hazard`;

        const result = parseRelationshipsCsv(csv, testConfig);
        expect(result.items[0].sourceEnd).toBe('control');
        expect(result.items[0].targetEnd).toBe('hazard');
    });

    it('rejects unknown relationship types', () => {
        const csv = `sourceId,targetId,type
a,b,unknownType`;

        const result = parseRelationshipsCsv(csv, testConfig);
        expect(result.errors).toHaveLength(1);
        expect(result.errors[0]).toContain("unknown relationship type 'unknownType'");
    });

    it('validates element ids when provided', () => {
        const knownIds = new Set(['haz_001']);
        const csv = `sourceId,targetId,type
ctrl_001,haz_001,mitigates`;

        const result = parseRelationshipsCsv(csv, testConfig, knownIds);
        expect(result.errors).toHaveLength(1);
        expect(result.errors[0]).toContain("sourceId 'ctrl_001' not found");
    });

    it('warns on self-referencing relationships', () => {
        const csv = `sourceId,targetId,type
haz_001,haz_001,mitigates`;

        const result = parseRelationshipsCsv(csv, testConfig);
        expect(result.warnings).toHaveLength(1);
        expect(result.warnings[0]).toContain('self-referencing');
    });
});

// ─── Export ─────────────────────────────────────────────────────────────────

describe('exportElementsCsv', () => {
    it('exports elements with dynamic attribute columns', () => {
        const model = createTestModel([
            { id: 'haz_001', name: 'Overflow', kind: 'Hazard', construct: 'requirement', layer: 'risk', file: 'test.sysml', attributes: { severity: 'Critical' } },
            { id: 'req_001', name: 'Flow', kind: 'SystemRequirement', construct: 'requirement', layer: 'requirements', file: 'test.sysml', attributes: { priority: 'High' } },
        ]);

        const csv = exportElementsCsv(model, testConfig);
        const lines = csv.trim().split('\n');
        expect(lines[0]).toContain('id,name,kind,construct,doc');
        expect(lines[0]).toContain('priority');
        expect(lines[0]).toContain('severity');
        expect(lines).toHaveLength(3); // header + 2 rows
    });
});

describe('exportRelationshipsCsv', () => {
    it('exports relationships', () => {
        const model = createTestModel([], [
            { id: 'r1', sourceId: 'a', targetId: 'b', type: 'mitigates', sourceEnd: 'source', targetEnd: 'target', file: 'test.sysml' },
        ]);

        const csv = exportRelationshipsCsv(model);
        const lines = csv.trim().split('\n');
        expect(lines[0]).toBe('sourceId,targetId,type,sourceEnd,targetEnd');
        expect(lines[1]).toBe('a,b,mitigates,source,target');
    });
});

// ─── Templates ──────────────────────────────────────────────────────────────

describe('generateElementTemplate', () => {
    it('produces rows for each kind', () => {
        const csv = generateElementTemplate(testConfig);
        const lines = csv.trim().split('\n');
        // header + 4 kinds
        expect(lines).toHaveLength(5);
        expect(lines[0]).toContain('id,name,kind,construct,doc');
        expect(csv).toContain('Hazard');
        expect(csv).toContain('SystemRequirement');
    });
});

describe('generateRelationshipTemplate', () => {
    it('produces rows for each relationship type', () => {
        const csv = generateRelationshipTemplate(testConfig);
        const lines = csv.trim().split('\n');
        expect(lines).toHaveLength(4); // header + 3 types
        expect(csv).toContain('mitigates');
        expect(csv).toContain('traceTo');
    });
});

// ─── SysML Generator ───────────────────────────────────────────────────────

describe('wrapPackage (strict SysML v2 emit)', () => {
    it('emits a single-segment name as one package block', () => {
        const out = wrapPackage('imported_elements', ['    part p : T;']).join('\n');
        expect(out).toBe('package imported_elements {\n    part p : T;\n}');
    });

    it('emits a qualified name as NESTED packages, never `package a::b {`', () => {
        const out = wrapPackage('memo::imported::risk', ['    part p : T;']).join('\n');
        expect(out).not.toMatch(/package\s+\w+::/);
        expect(out).toContain('package memo {');
        expect(out).toContain('    package imported {');
        expect(out).toContain('        package risk {');
        // inner line gets the extra nesting indentation (2 wrapper levels)
        expect(out).toContain('            part p : T;');
    });

    it('generateFile never emits a qualified package declaration', () => {
        const sysml = generateFile(
            [{ id: 'h1', name: 'H', kind: 'Hazard', construct: 'requirement', layer: 'risk', doc: '', attributes: {} }],
            [],
            'memo::imported::risk'
        );
        expect(sysml).not.toMatch(/package\s+\w+::/);
        expect(sysml).toContain('package memo {');
    });
});

describe('generateUsage', () => {
    it('generates a SysML usage block', () => {
        const sysml = generateUsage({
            id: 'haz_001',
            name: 'Over-Infusion',
            kind: 'Hazard',
            construct: 'requirement',
            layer: 'risk',
            doc: 'Excess medication delivery',
            attributes: { severity: 'Serious' },
        });

        expect(sysml).toContain('requirement haz_001 : Hazard {');
        expect(sysml).toContain('doc /* Excess medication delivery */');
        expect(sysml).toContain('attribute redefines name = "Over-Infusion"');
        expect(sysml).toContain('attribute redefines severity = "Serious"');
        expect(sysml).toContain('}');
    });
});

describe('generateConnection', () => {
    it('generates a SysML connection', () => {
        const sysml = generateConnection({
            sourceId: 'ctrl_001',
            targetId: 'haz_001',
            type: 'mitigates',
            sourceEnd: 'control',
            targetEnd: 'hazard',
        });

        expect(sysml).toContain('connection : Mitigates');
        expect(sysml).toContain('control ::> ctrl_001');
        expect(sysml).toContain('hazard ::> haz_001');
    });
});

describe('generateFile', () => {
    it('generates a complete SysML file with package', () => {
        const elements = [
            { id: 'haz_001', name: 'Overflow', kind: 'Hazard', construct: 'requirement', layer: 'risk', doc: '', attributes: {} },
        ];
        const relationships = [
            { sourceId: 'ctrl_001', targetId: 'haz_001', type: 'mitigates', sourceEnd: 'source', targetEnd: 'target' },
        ];

        const sysml = generateFile(elements, relationships, 'imported');
        expect(sysml).toContain('package imported {');
        expect(sysml).toContain('requirement haz_001 : Hazard {');
        expect(sysml).toContain('connection : Mitigates');
        expect(sysml).toContain('}');
    });
});

// ─── Roundtrip ──────────────────────────────────────────────────────────────

describe('CSV roundtrip', () => {
    it('export → import produces equivalent elements', () => {
        const original = createTestModel([
            { id: 'haz_001', name: 'Overflow', kind: 'Hazard', construct: 'requirement', layer: 'risk', file: 'test.sysml', attributes: { severity: 'Critical' }, doc: 'Test doc' },
            { id: 'comp_001', name: 'Motor', kind: 'Component', construct: 'part', layer: 'logical', file: 'test.sysml', attributes: {} },
        ]);

        const csv = exportElementsCsv(original, testConfig);
        const parsed = parseElementsCsv(csv, testConfig);

        expect(parsed.errors).toHaveLength(0);
        expect(parsed.items).toHaveLength(2);
        expect(parsed.items[0].id).toBe('haz_001');
        expect(parsed.items[0].name).toBe('Overflow');
        expect(parsed.items[0].kind).toBe('Hazard');
        expect(parsed.items[0].doc).toBe('Test doc');
        expect(parsed.items[0].attributes.severity).toBe('Critical');
    });
});

// ─── Helpers ────────────────────────────────────────────────────────────────

function createTestModel(
    elements: MemoElement[],
    relationships: MemoRelationship[] = []
): MemoModel {
    const elemMap = new Map(elements.map((e) => [e.id, e]));
    return {
        elements: elemMap,
        relationships,
        errors: [],
        elementsByKind: new Map(),
        elementsByLayer: new Map(),
        relationshipsByType: new Map(),
        outgoing: new Map(),
        incoming: new Map(),
    };
}
