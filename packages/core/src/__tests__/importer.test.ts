// ─── Importer Tests ──────────────────────────────────────────────────────────
//
// Tests for EA, Cameo, SysAnd, and OWL/JSON-LD importers.
// ─────────────────────────────────────────────────────────────────────────────

import { describe, it, expect } from 'vitest';
import {
    importEaJson,
    eaResultToSysml,
    importCameoXml,
    importCameoJson,
    cameoResultToSysml,
    importOwlTurtle,
    importJsonLd,
    owlResultToSysml,
    owlResultToPackage,
} from '../importer/index.js';
import { KindRegistry } from '../model/kind-registry.js';
import { RelationshipRegistry } from '../model/relationship-registry.js';

// ─── EA Importer Tests ──────────────────────────────────────────────────────

describe('EA Importer', () => {
    it('maps EA elements to MEMO kinds via stereotypes', () => {
        const result = importEaJson({
            elements: [
                { id: 1, name: 'Overheating', type: 'Class', stereotype: 'Hazard', notes: 'Thermal hazard' },
                { id: 2, name: 'Temperature Sensor', type: 'Component', notes: 'Monitors temp' },
                { id: 3, name: 'Alert System', type: 'Class', stereotype: 'RiskControl' },
            ],
            connectors: [
                { id: 1, sourceId: 3, targetId: 1, type: 'Dependency', stereotype: 'mitigates' },
            ],
        });

        expect(result.stats.totalElements).toBe(3);
        expect(result.stats.mappedElements).toBe(3);
        expect(result.elements[0].memoKind).toBe('Hazard');
        expect(result.elements[1].memoKind).toBe('LogicalComponent');
        expect(result.elements[2].memoKind).toBe('RiskControl');
        expect(result.stats.mappedRelationships).toBe(1);
        expect(result.relationships[0].memoRelType).toBe('mitigates');
    });

    it('reports unmapped elements as warnings', () => {
        const result = importEaJson({
            elements: [
                { id: 1, name: 'Something', type: 'UnknownType', stereotype: 'UnknownStereotype' },
            ],
        });

        expect(result.stats.unmappedElements).toBe(1);
        expect(result.warnings.length).toBeGreaterThan(0);
        expect(result.elements[0].memoKind).toBeUndefined();
    });

    it('uses KindRegistry for mapping when available', () => {
        const registry = new KindRegistry();
        registry.register({
            name: 'CustomHazard',
            label: 'Custom Hazard',
            layer: 'risk',
            sysmlConstruct: 'part def',
        });

        const result = importEaJson({
            elements: [
                { id: 1, name: 'My Hazard', type: 'Class', stereotype: 'CustomHazard' },
            ],
        }, registry);

        expect(result.elements[0].memoKind).toBe('CustomHazard');
        expect(result.stats.mappedElements).toBe(1);
    });

    it('generates valid SysML from EA import', () => {
        const result = importEaJson({
            elements: [
                { id: 1, name: 'Overheating', type: 'Class', stereotype: 'Hazard', notes: 'Thermal hazard' },
                { id: 2, name: 'Temp Monitor', type: 'Class', stereotype: 'RiskControl' },
            ],
            connectors: [
                { id: 1, sourceId: 2, targetId: 1, type: 'Dependency', stereotype: 'mitigates' },
            ],
        });

        const sysml = eaResultToSysml(result, 'ea_import');
        expect(sysml).toContain('package ea_import {');
        expect(sysml).toContain('Overheating : Hazard');
        expect(sysml).toContain('Temp_Monitor : RiskControl');
        expect(sysml).toContain('connection : Mitigates');
        expect(sysml).toContain('doc /* Thermal hazard */');
    });

    it('handles empty input gracefully', () => {
        const result = importEaJson({});
        expect(result.stats.totalElements).toBe(0);
        expect(result.stats.totalRelationships).toBe(0);
        expect(result.errors).toHaveLength(0);
    });

    it('maps EA connector types to MEMO relationships', () => {
        const result = importEaJson({
            elements: [
                { id: 1, name: 'A', type: 'Requirement' },
                { id: 2, name: 'B', type: 'Requirement' },
            ],
            connectors: [
                { id: 1, sourceId: 1, targetId: 2, type: 'Trace' },
                { id: 2, sourceId: 1, targetId: 2, type: 'Derive' },
                { id: 3, sourceId: 1, targetId: 2, type: 'Satisfy' },
            ],
        });

        expect(result.relationships[0].memoRelType).toBe('traceTo');
        expect(result.relationships[1].memoRelType).toBe('derives');
        expect(result.relationships[2].memoRelType).toBe('satisfy');
    });
});

// ─── Cameo Importer Tests ───────────────────────────────────────────────────

describe('Cameo Importer', () => {
    it('parses XMI/XML and maps elements', () => {
        const xml = `<?xml version="1.0" encoding="UTF-8"?>
<xmi:XMI xmlns:xmi="http://www.omg.org/spec/XMI/20131001" xmlns:uml="http://www.omg.org/spec/UML/20131001">
  <uml:Model>
    <packagedElement xmi:type="uml:Class" xmi:id="id1" name="ThermalHazard">
      <ownedComment><body>A thermal hazard</body></ownedComment>
    </packagedElement>
    <packagedElement xmi:type="uml:Class" xmi:id="id2" name="CoolingSystem"/>
    <packagedElement xmi:type="uml:Dependency" xmi:id="rel1" client="id2" supplier="id1"/>
  </uml:Model>
</xmi:XMI>`;

        const result = importCameoXml(xml);
        expect(result.elements.length).toBe(2);
        expect(result.elements[0].name).toBe('ThermalHazard');
        expect(result.elements[0].memoKind).toBe('LogicalComponent'); // no stereotype, mapped by type
        expect(result.relationships.length).toBe(1);
        expect(result.relationships[0].memoRelType).toBe('dependency');
    });

    it('imports from Cameo JSON format', () => {
        const result = importCameoJson({
            elements: [
                { id: 'e1', name: 'Shock Hazard', type: 'uml:Class', stereotypes: ['Hazard'], documentation: 'Electric shock' },
                { id: 'e2', name: 'Insulation', type: 'uml:Class', stereotypes: ['RiskControl'] },
            ],
            relationships: [
                { id: 'r1', sourceId: 'e2', targetId: 'e1', type: 'sysml:Satisfy' },
            ],
        });

        expect(result.stats.mappedElements).toBe(2);
        expect(result.elements[0].memoKind).toBe('Hazard');
        expect(result.elements[1].memoKind).toBe('RiskControl');
        expect(result.relationships[0].memoRelType).toBe('satisfy');
    });

    it('generates valid SysML from Cameo import', () => {
        const result = importCameoJson({
            elements: [
                { id: 'e1', name: 'My Hazard', type: 'uml:Class', stereotypes: ['Hazard'] },
            ],
        });

        const sysml = cameoResultToSysml(result, 'cameo_import');
        expect(sysml).toContain('package cameo_import {');
        expect(sysml).toContain('My_Hazard : Hazard');
    });

    it('uses KindRegistry for stereotype mapping', () => {
        const registry = new KindRegistry();
        registry.register({
            name: 'SpecialBlock',
            label: 'Special Block',
            layer: 'logical',
            sysmlConstruct: 'part def',
        });

        const result = importCameoJson({
            elements: [
                { id: 'e1', name: 'Widget', type: 'uml:Class', stereotypes: ['SpecialBlock'] },
            ],
        }, registry);

        expect(result.elements[0].memoKind).toBe('SpecialBlock');
    });

    it('handles XMI with sysml:Requirement type', () => {
        const xml = `<?xml version="1.0"?>
<xmi:XMI xmlns:xmi="http://www.omg.org/spec/XMI/20131001">
  <packagedElement xmi:type="sysml:Requirement" xmi:id="req1" name="SafetyReq"/>
</xmi:XMI>`;

        const result = importCameoXml(xml);
        expect(result.elements[0].memoKind).toBe('Requirement');
    });
});

// ─── OWL/Turtle Importer Tests ──────────────────────────────────────────────

describe('OWL Importer', () => {
    const sampleTurtle = `
@prefix memo: <https://sysand.dev/ontology/memo/test#> .
@prefix owl: <http://www.w3.org/2002/07/owl#> .
@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .
@prefix dcterms: <http://purl.org/dc/terms/> .

<https://sysand.dev/ontology/memo/test> a owl:Ontology ;
    dcterms:title "Test Ontology" ;
    owl:versionInfo "1.0.0" ;
    .

memo:Hazard a owl:Class ;
    rdfs:label "Hazard" ;
    memo:layer "risk" ;
    memo:sysmlConstruct "part def" ;
    .

memo:RiskControl a owl:Class ;
    rdfs:label "Risk Control" ;
    memo:layer "risk" ;
    memo:sysmlConstruct "part def" ;
    .

memo:Requirement a owl:Class ;
    rdfs:label "Requirement" ;
    memo:layer "requirements" ;
    memo:sysmlConstruct "requirement def" ;
    .

memo:mitigates a owl:ObjectProperty ;
    rdfs:label "mitigates" ;
    memo:layer "risk" ;
    rdfs:domain memo:RiskControl ;
    rdfs:range memo:Hazard ;
    .
`;

    it('parses OWL/Turtle classes and properties', () => {
        const result = importOwlTurtle(sampleTurtle);

        expect(result.ontologyIri).toBe('https://sysand.dev/ontology/memo/test');
        expect(result.title).toBe('Test Ontology');
        expect(result.version).toBe('1.0.0');
        expect(result.classes.length).toBe(3);
        expect(result.properties.length).toBe(1);
    });

    it('extracts class metadata correctly', () => {
        const result = importOwlTurtle(sampleTurtle);

        const hazard = result.classes.find(c => c.name === 'Hazard');
        expect(hazard).toBeDefined();
        expect(hazard!.label).toBe('Hazard');
        expect(hazard!.layer).toBe('risk');
        expect(hazard!.construct).toBe('part def');
    });

    it('extracts property domain and range', () => {
        const result = importOwlTurtle(sampleTurtle);

        const mitigates = result.properties.find(p => p.name === 'mitigates');
        expect(mitigates).toBeDefined();
        expect(mitigates!.domain).toBe('RiskControl');
        expect(mitigates!.range).toBe('Hazard');
    });

    it('generates valid SysML from OWL import', () => {
        const result = importOwlTurtle(sampleTurtle);
        const sysml = owlResultToSysml(result, 'owl_import');

        expect(sysml).toContain('package owl_import {');
        expect(sysml).toContain('part def Hazard');
        expect(sysml).toContain('part def RiskControl');
        expect(sysml).toContain('requirement def Requirement');
        expect(sysml).toContain('connection def Mitigates');
    });

    it('generates ontology package from OWL import', () => {
        const result = importOwlTurtle(sampleTurtle);
        const pkgFiles = owlResultToPackage(result, 'test_ontology');

        expect(pkgFiles.has('memo.package.yaml')).toBe(true);
        expect(pkgFiles.has('.project.json')).toBe(true);
        expect(pkgFiles.has('sysml/index.sysml')).toBe(true);
        expect(pkgFiles.has('sysml/risk/risk.sysml')).toBe(true);
        expect(pkgFiles.has('sysml/requirements/requirements.sysml')).toBe(true);
        expect(pkgFiles.has('sysml/relationships/relationships.sysml')).toBe(true);

        const riskSysml = pkgFiles.get('sysml/risk/risk.sysml')!;
        expect(riskSysml).toContain('part def Hazard');
        expect(riskSysml).toContain('part def RiskControl');
    });

    it('skips Layer_ classes from OWL import', () => {
        const turtle = `
@prefix memo: <https://example.org/memo#> .
@prefix owl: <http://www.w3.org/2002/07/owl#> .
@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .

memo:Layer_Risk a owl:Class ;
    rdfs:label "Risk Layer" ;
    .

memo:Hazard a owl:Class ;
    rdfs:label "Hazard" ;
    rdfs:subClassOf memo:Layer_Risk ;
    .
`;

        const result = importOwlTurtle(turtle);
        expect(result.classes.length).toBe(1);
        expect(result.classes[0].name).toBe('Hazard');
        // superClass should not be Layer_Risk
        expect(result.classes[0].superClass).toBeUndefined();
    });

    it('derives layer from class name heuristics', () => {
        const turtle = `
@prefix memo: <https://example.org/memo#> .
@prefix owl: <http://www.w3.org/2002/07/owl#> .
@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .

memo:SoftwareUnit a owl:Class ;
    rdfs:label "Software Unit" ;
    .

memo:TestCase a owl:Class ;
    rdfs:label "Test Case" ;
    .

memo:Stakeholder a owl:Class ;
    rdfs:label "Stakeholder" ;
    .
`;

        const result = importOwlTurtle(turtle);
        expect(result.classes.find(c => c.name === 'SoftwareUnit')!.layer).toBe('software');
        expect(result.classes.find(c => c.name === 'TestCase')!.layer).toBe('verification');
        expect(result.classes.find(c => c.name === 'Stakeholder')!.layer).toBe('purpose');
    });
});

// ─── JSON-LD Importer Tests ─────────────────────────────────────────────────

describe('JSON-LD Importer', () => {
    it('parses JSON-LD with @graph', () => {
        const jsonLd = JSON.stringify({
            '@context': {},
            '@graph': [
                {
                    '@id': 'https://example.org/onto',
                    '@type': 'owl:Ontology',
                    'owl:versionInfo': '2.0.0',
                    'dcterms:title': 'Example Ontology',
                },
                {
                    '@id': 'https://example.org/Hazard',
                    '@type': 'owl:Class',
                    'rdfs:label': 'Hazard',
                    'memo:layer': 'risk',
                    'memo:sysmlConstruct': 'part def',
                },
                {
                    '@id': 'https://example.org/mitigates',
                    '@type': 'owl:ObjectProperty',
                    'rdfs:label': 'mitigates',
                    'rdfs:domain': { '@id': 'https://example.org/RiskControl' },
                    'rdfs:range': { '@id': 'https://example.org/Hazard' },
                },
            ],
        });

        const result = importJsonLd(jsonLd);
        expect(result.ontologyIri).toBe('https://example.org/onto');
        expect(result.version).toBe('2.0.0');
        expect(result.title).toBe('Example Ontology');
        expect(result.classes.length).toBe(1);
        expect(result.classes[0].name).toBe('Hazard');
        expect(result.properties.length).toBe(1);
        expect(result.properties[0].domain).toBe('RiskControl');
        expect(result.properties[0].range).toBe('Hazard');
    });

    it('handles invalid JSON gracefully', () => {
        const result = importJsonLd('not valid json');
        expect(result.errors.length).toBeGreaterThan(0);
        expect(result.classes).toHaveLength(0);
    });
});
