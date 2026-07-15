import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { EmptyFileSystem, type LangiumDocument } from 'langium';
import { parseHelper } from 'langium/test';
import { createMemoSysMLServices } from '../language/memo-sysml-module.js';
import type { Model } from '../language/generated/ast.js';
import type { MEMOConfig } from '../model/config.js';
import { buildMemoModel, type BuilderRegistries } from '../model/builder.js';
import { KindRegistry } from '../model/kind-registry.js';
import { RelationshipRegistry } from '../model/relationship-registry.js';
import { validateModel } from '../validator/rule-engine.js';
import { computeCompleteness } from '../completeness/tracker.js';
import type { ParsedDocument } from '../model/parser-utils.js';
import { loadConfig, resolveConfig } from '../model/config-loader.js';

const services = createMemoSysMLServices({ ...EmptyFileSystem }).MemoSysML;
const parse = parseHelper<Model>(services);

// ─── Helpers ────────────────────────────────────────────────────────────────

async function parseDoc(source: string, filePath: string = 'test.sysml'): Promise<ParsedDocument> {
    const doc = await parse(source);
    return { document: doc, filePath };
}

/** Minimal config for testing */
const testConfig: MEMOConfig = {
    projectName: 'test',
    projectType: 'device',
    kinds: {
        Hazard: { label: 'Hazard', layer: 'risk', sysmlConstruct: 'requirement def' },
        RiskControl: { label: 'Risk Control', layer: 'risk', sysmlConstruct: 'requirement def' },
        SystemRequirement: { label: 'System Req', layer: 'requirements', sysmlConstruct: 'requirement def' },
        SoftwareRequirement: { label: 'Software Req', layer: 'requirements', sysmlConstruct: 'requirement def' },
        Software: { label: 'Software', layer: 'software', sysmlConstruct: 'part def' },
        Actor: { label: 'Actor', layer: 'business', sysmlConstruct: 'part def' },
    },
    relationshipTypes: [
        { name: 'mitigates', label: 'Mitigates', layer: 'risk', color: '#E74C3C' },
        { name: 'traceTo', label: 'Trace To', layer: 'requirements', color: '#4A90D9' },
    ],
    architectureLayers: [
        { id: 'risk', label: 'Risk', color: '#E74C3C' },
        { id: 'requirements', label: 'Requirements', color: '#4A90D9' },
        { id: 'software', label: 'Software', color: '#F39C12' },
        { id: 'business', label: 'Business', color: '#8E44AD' },
    ],
};

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('buildMemoModel', () => {
    it('extracts elements from part usages', async () => {
        const doc = await parseDoc(`
            package TestPkg {
                part clinician : Actor {
                    attribute redefines name = "Clinician";
                }
            }
        `);
        const model = buildMemoModel([doc], testConfig);

        expect(model.elements.size).toBe(1);
        const el = model.elements.get('clinician')!;
        expect(el).toBeDefined();
        expect(el.kind).toBe('Actor');
        expect(el.construct).toBe('part');
        expect(el.layer).toBe('business');
        expect(el.name).toBe('Clinician');
        expect(el.attributes['name']).toBe('Clinician');
    });

    it('extracts elements from requirement usages', async () => {
        const doc = await parseDoc(`
            package TestPkg {
                requirement hazOverInfusion : Hazard {
                    attribute redefines hazardId = "HAZ-001";
                    attribute redefines title = "Over-Infusion";
                    doc /* A hazard description. */
                }
            }
        `);
        const model = buildMemoModel([doc], testConfig);

        expect(model.elements.size).toBe(1);
        const el = model.elements.get('hazOverInfusion')!;
        expect(el.kind).toBe('Hazard');
        expect(el.construct).toBe('requirement');
        expect(el.layer).toBe('risk');
        expect(el.name).toBe('Over-Infusion');
        expect(el.attributes['hazardId']).toBe('HAZ-001');
        expect(el.doc).toContain('hazard description');
    });

    it('extracts connection usages as relationships', async () => {
        const doc = await parseDoc(`
            package TestPkg {
                requirement rc1 : RiskControl {
                    attribute redefines title = "Control 1";
                }
                requirement haz1 : Hazard {
                    attribute redefines title = "Hazard 1";
                }
                connection : Mitigates connect control ::> rc1 to hazard ::> haz1;
            }
        `);
        const model = buildMemoModel([doc], testConfig);

        expect(model.elements.size).toBe(2);
        expect(model.relationships).toHaveLength(1);

        const rel = model.relationships[0];
        expect(rel.type).toBe('mitigates');
        expect(rel.sourceId).toBe('rc1');
        expect(rel.sourceEnd).toBe('control');
        expect(rel.targetId).toBe('haz1');
        expect(rel.targetEnd).toBe('hazard');
    });

    it('builds element indexes by kind and layer', async () => {
        const doc = await parseDoc(`
            package TestPkg {
                requirement h1 : Hazard { attribute redefines title = "H1"; }
                requirement h2 : Hazard { attribute redefines title = "H2"; }
                requirement sr1 : SystemRequirement { attribute redefines title = "SR1"; }
            }
        `);
        const model = buildMemoModel([doc], testConfig);

        expect(model.elementsByKind.get('Hazard')?.length).toBe(2);
        expect(model.elementsByKind.get('SystemRequirement')?.length).toBe(1);
        expect(model.elementsByLayer.get('risk')?.length).toBe(2);
        expect(model.elementsByLayer.get('requirements')?.length).toBe(1);
    });

    it('builds relationship indexes (outgoing, incoming, byType)', async () => {
        const doc = await parseDoc(`
            package TestPkg {
                requirement rc1 : RiskControl { attribute redefines title = "RC1"; }
                requirement h1 : Hazard { attribute redefines title = "H1"; }
                connection : Mitigates connect control ::> rc1 to hazard ::> h1;
            }
        `);
        const model = buildMemoModel([doc], testConfig);

        expect(model.outgoing.get('rc1')?.length).toBe(1);
        expect(model.incoming.get('h1')?.length).toBe(1);
        expect(model.relationshipsByType.get('mitigates')?.length).toBe(1);
    });

    it('parses real (float) literal attribute values', async () => {
        const doc = await parseDoc(`
            package TestPkg {
                part sw1 : Software {
                    attribute redefines name = "SW1";
                    attribute periodMs = 20.0;
                }
            }
        `);
        const model = buildMemoModel([doc], testConfig);
        expect(model.errors).toHaveLength(0);
        expect(model.elements.get('sw1')?.attributes['periodMs']).toBe('20.0');
    });
});

describe('computeCompleteness', () => {
    it('computes per-layer completeness', async () => {
        const doc = await parseDoc(`
            package TestPkg {
                requirement h1 : Hazard { attribute redefines title = "H1"; }
                requirement rc1 : RiskControl { attribute redefines title = "RC1"; }
                part sw1 : Software { attribute redefines safetyClassification = "C"; }
                connection : Mitigates connect control ::> rc1 to hazard ::> h1;
            }
        `);
        const model = buildMemoModel([doc], testConfig);
        const validation = validateModel(model);
        const report = computeCompleteness(model, validation, testConfig);

        expect(report.totalElements).toBe(3);
        // h1 passes (has mitigates), rc1 has no rules, sw1 passes (has attribute)
        expect(report.overall).toBeGreaterThanOrEqual(50);
        expect(report.layers.length).toBe(4); // risk, requirements, software, business
    });
});

// ─── Cross-file import resolution tests ─────────────────────────────────────

describe('Cross-file import resolution', () => {
    it('tracks package names on elements', async () => {
        const doc = await parseDoc(`
            package DeviceModel {
                part clinician : Actor {
                    attribute redefines name = "Clinician";
                }
            }
        `);
        const model = buildMemoModel([doc], testConfig);
        const el = model.elements.get('clinician')!;
        expect(el.package).toBe('DeviceModel');
    });

    it('resolves connections across two files via wildcard import', async () => {
        const riskFile = await parseDoc(`
            package RiskPkg {
                requirement haz1 : Hazard {
                    attribute redefines title = "Over-Infusion";
                }
            }
        `, 'model/risk.sysml');

        const controlFile = await parseDoc(`
            package ControlPkg {
                import RiskPkg::*;
                requirement rc1 : RiskControl {
                    attribute redefines title = "Flow Limiter";
                }
                connection : Mitigates connect control ::> rc1 to hazard ::> haz1;
            }
        `, 'model/controls.sysml');

        const model = buildMemoModel([riskFile, controlFile], testConfig);

        expect(model.elements.size).toBe(2);
        expect(model.elements.get('haz1')?.package).toBe('RiskPkg');
        expect(model.elements.get('rc1')?.package).toBe('ControlPkg');

        expect(model.relationships).toHaveLength(1);
        expect(model.relationships[0].sourceId).toBe('rc1');
        expect(model.relationships[0].targetId).toBe('haz1');
    });

    it('resolves connections across files via named import', async () => {
        const riskFile = await parseDoc(`
            package RiskPkg {
                requirement haz1 : Hazard {
                    attribute redefines title = "Over-Infusion";
                }
                requirement haz2 : Hazard {
                    attribute redefines title = "Under-Infusion";
                }
            }
        `, 'model/risk.sysml');

        const controlFile = await parseDoc(`
            package ControlPkg {
                import RiskPkg::haz1;
                requirement rc1 : RiskControl {
                    attribute redefines title = "Flow Limiter";
                }
                connection : Mitigates connect control ::> rc1 to hazard ::> haz1;
            }
        `, 'model/controls.sysml');

        const model = buildMemoModel([riskFile, controlFile], testConfig);

        expect(model.relationships).toHaveLength(1);
        expect(model.relationships[0].targetId).toBe('haz1');
    });

    it('resolves qualified name references in connections', async () => {
        const riskFile = await parseDoc(`
            package RiskPkg {
                requirement haz1 : Hazard {
                    attribute redefines title = "Over-Infusion";
                }
            }
        `, 'model/risk.sysml');

        const controlFile = await parseDoc(`
            package ControlPkg {
                requirement rc1 : RiskControl {
                    attribute redefines title = "Flow Limiter";
                }
                connection : Mitigates connect control ::> rc1 to hazard ::> RiskPkg::haz1;
            }
        `, 'model/controls.sysml');

        const model = buildMemoModel([riskFile, controlFile], testConfig);

        expect(model.relationships).toHaveLength(1);
        expect(model.relationships[0].targetId).toBe('haz1');
    });

    it('handles nested packages', async () => {
        const doc = await parseDoc(`
            package DeviceModel {
                package Risk {
                    requirement haz1 : Hazard {
                        attribute redefines title = "H1";
                    }
                }
                package Controls {
                    import DeviceModel::Risk::*;
                    requirement rc1 : RiskControl {
                        attribute redefines title = "RC1";
                    }
                    connection : Mitigates connect control ::> rc1 to hazard ::> haz1;
                }
            }
        `);
        const model = buildMemoModel([doc], testConfig);

        expect(model.elements.get('haz1')?.package).toBe('DeviceModel::Risk');
        expect(model.elements.get('rc1')?.package).toBe('DeviceModel::Controls');
        expect(model.relationships).toHaveLength(1);
    });

    it('resolves qualified type names for kinds', async () => {
        const doc = await parseDoc(`
            package TestPkg {
                requirement h1 : RiskPkg::Hazard {
                    attribute redefines title = "H1";
                }
            }
        `);
        const model = buildMemoModel([doc], testConfig);
        const el = model.elements.get('h1')!;
        // Should resolve RiskPkg::Hazard to just "Hazard" for kind lookup
        expect(el.kind).toBe('Hazard');
        expect(el.layer).toBe('risk');
    });
});

// ─── Library package tests ──────────────────────────────────────────────────

describe('SysML v2 library keyword', () => {
    it('parses library package declaration', async () => {
        const doc = await parseDoc(`
            library package MEMO_Types {
                part def Hazard;
                part def RiskControl;
            }
        `);
        const model = buildMemoModel([doc], testConfig);
        // Library packages contain definitions, not usages — no elements extracted
        expect(model.elements.size).toBe(0);
    });

    it('library package is tracked in registry', async () => {
        const { PackageRegistry } = await import('../model/package-registry.js');
        const registry = new PackageRegistry();

        const doc = await parseDoc(`
            library package MEMO_Types {
                part def Hazard;
            }
            package DeviceModel {
                import MEMO_Types::*;
                requirement h1 : Hazard {
                    attribute redefines title = "H1";
                }
            }
        `);

        registry.buildFromDocuments([doc]);
        expect(registry.isLibraryPackage('MEMO_Types')).toBe(true);
        expect(registry.isLibraryPackage('DeviceModel')).toBe(false);
    });

    it('library and non-library packages coexist', async () => {
        const libFile = await parseDoc(`
            library package OntologyLib {
                part def Hazard;
                part def Actor;
            }
        `, 'lib/ontology.sysml');

        const modelFile = await parseDoc(`
            package InfusionPump {
                import OntologyLib::*;
                part clinician : Actor {
                    attribute redefines name = "Clinician";
                }
                requirement h1 : Hazard {
                    attribute redefines title = "H1";
                }
            }
        `, 'model/pump.sysml');

        const model = buildMemoModel([libFile, modelFile], testConfig);
        // Only model elements (not definitions from library)
        expect(model.elements.size).toBe(2);
        expect(model.elements.get('clinician')?.package).toBe('InfusionPump');
        expect(model.elements.get('h1')?.package).toBe('InfusionPump');
    });
});

// ─── Multi-file model splitting tests ───────────────────────────────────────

describe('Multi-file model splitting', () => {
    it('builds model from split files with cross-package connections', async () => {
        const riskFile = await parseDoc(`
            package DeviceRisk {
                requirement haz1 : Hazard {
                    attribute redefines title = "Over-Infusion";
                }
                requirement rc1 : RiskControl {
                    attribute redefines title = "Flow Limiter";
                }
                connection : Mitigates connect control ::> rc1 to hazard ::> haz1;
            }
        `, 'model/risk/risk.sysml');

        const reqFile = await parseDoc(`
            package DeviceRequirements {
                import DeviceRisk::*;
                requirement sr1 : SystemRequirement {
                    attribute redefines title = "Flow Accuracy";
                }
                connection : TraceTo connect source ::> sr1 to target ::> rc1;
            }
        `, 'model/requirements/requirements.sysml');

        const archFile = await parseDoc(`
            package DeviceArchitecture {
                import DeviceRequirements::*;
                part pump : Actor {
                    attribute redefines name = "Pump Mechanism";
                }
            }
        `, 'model/architecture/architecture.sysml');

        const model = buildMemoModel([riskFile, reqFile, archFile], testConfig);

        // All elements from all files
        expect(model.elements.size).toBe(4);
        expect(model.elements.get('haz1')?.package).toBe('DeviceRisk');
        expect(model.elements.get('sr1')?.package).toBe('DeviceRequirements');
        expect(model.elements.get('pump')?.package).toBe('DeviceArchitecture');

        // Cross-file connections
        expect(model.relationships.length).toBe(2);

        // Mitigates: rc1 → haz1 (within risk file)
        const mitigates = model.relationships.find(r => r.type === 'mitigates');
        expect(mitigates?.sourceId).toBe('rc1');
        expect(mitigates?.targetId).toBe('haz1');

        // TraceTo: sr1 → rc1 (cross-file: requirements → risk)
        const traceTo = model.relationships.find(r => r.type === 'traceTo');
        expect(traceTo?.sourceId).toBe('sr1');
        expect(traceTo?.targetId).toBe('rc1');
    });

    it('resolves three-level cross-file chains', async () => {
        const riskFile = await parseDoc(`
            package Risk {
                requirement haz1 : Hazard {
                    attribute redefines title = "H1";
                }
            }
        `, 'risk.sysml');

        const reqFile = await parseDoc(`
            package Requirements {
                import Risk::*;
                requirement sr1 : SystemRequirement {
                    attribute redefines title = "SR1";
                }
                connection : TraceTo connect source ::> sr1 to target ::> haz1;
            }
        `, 'requirements.sysml');

        const swFile = await parseDoc(`
            package Software {
                import Requirements::*;
                requirement swr1 : SoftwareRequirement {
                    attribute redefines title = "SWR1";
                }
                connection : TraceTo connect source ::> swr1 to target ::> sr1;
            }
        `, 'software.sysml');

        const model = buildMemoModel([riskFile, reqFile, swFile], testConfig);

        expect(model.elements.size).toBe(3);
        expect(model.relationships.length).toBe(2);

        // sr1 → haz1 (req → risk)
        const r1 = model.relationships.find(r => r.sourceId === 'sr1');
        expect(r1?.targetId).toBe('haz1');

        // swr1 → sr1 (software → requirements)
        const r2 = model.relationships.find(r => r.sourceId === 'swr1');
        expect(r2?.targetId).toBe('sr1');
    });
});

// ─── Dotted feature-chain endpoint resolution ─────────────────────────────
// Elements are registered under their leaf name, so relationship endpoints
// written as feature chains (`sampleActionFlow.receive`) must resolve to the
// leaf element id — this is how the gpca-pump AFD sample includes nested
// actions in its view and allocates them to lanes.

describe('Dotted feature-chain endpoints', () => {
    const source = `
        package TestPkg {
            part laneA : Software { attribute name = "Lane A"; }
            action wrapper {
                action receive;
                action process {
                    action stepA;
                }
            }
            allocate wrapper.receive to laneA;
            allocate wrapper.process.stepA to laneA;
            connection : TraceTo connect source ::> wrapper.receive to target ::> laneA;
        }
    `;

    it('resolves dotted allocate endpoints to leaf element ids', async () => {
        const model = buildMemoModel([await parseDoc(source)], testConfig);
        const allocations = model.relationships.filter(r => r.type === 'allocateTo');
        expect(allocations.map(r => r.sourceId).sort()).toEqual(['receive', 'stepA']);
        expect(model.elements.get('receive')?.allocatedTo).toBe('laneA');
        expect(model.elements.get('stepA')?.allocatedTo).toBe('laneA');
    });

    it('resolves dotted connection endpoints to leaf element ids', async () => {
        const model = buildMemoModel([await parseDoc(source)], testConfig);
        const trace = model.relationships.find(r => r.type === 'traceTo');
        expect(trace?.sourceId).toBe('receive');
        expect(trace?.targetId).toBe('laneA');
    });
});

// ─── M-2: Port wiring tests ───────────────────────────────────────────────

describe('Port wiring (M-2)', () => {
    it('populates portSpec on port usage elements', async () => {
        const doc = await parseDoc(`
            package TestPkg {
                in port ~sensorIn : SensorPort;
                out port controlOut : ControlPort;
                port plain : GenericPort;
            }
        `);
        const model = buildMemoModel([doc], testConfig);

        const sensor = model.elements.get('sensorIn')!;
        expect(sensor).toBeDefined();
        expect(sensor.construct).toBe('port');
        expect(sensor.portSpec).toBeDefined();
        expect(sensor.portSpec!.type).toBe('SensorPort');
        expect(sensor.portSpec!.direction).toBe('in');
        expect(sensor.portSpec!.isConjugated).toBe(true);

        const control = model.elements.get('controlOut')!;
        expect(control.portSpec!.direction).toBe('out');
        expect(control.portSpec!.isConjugated).toBe(false);

        const plain = model.elements.get('plain')!;
        expect(plain.portSpec!.direction).toBeUndefined();
        expect(plain.portSpec!.isConjugated).toBe(false);
    });

    it('sets owner and ownedPorts for ports inside part def', async () => {
        const doc = await parseDoc(`
            package TestPkg {
                part def PumpController {
                    in port sensorIn : SensorPort;
                    out port controlOut : ControlPort;
                }
            }
        `);
        const model = buildMemoModel([doc], testConfig);

        // Ports extracted as elements
        expect(model.elements.size).toBe(2);

        const sensor = model.elements.get('sensorIn')!;
        expect(sensor).toBeDefined();
        expect(sensor.owner).toBe('PumpController');
        expect(sensor.portSpec!.direction).toBe('in');

        const control = model.elements.get('controlOut')!;
        expect(control.owner).toBe('PumpController');
        expect(control.portSpec!.direction).toBe('out');
    });

    it('tags port IDs on connection endpoints', async () => {
        const doc = await parseDoc(`
            package TestPkg {
                port sensorOut : SensorPort;
                port sensorIn : SensorPort;
                connection : DataLink connect source ::> sensorOut to target ::> sensorIn;
            }
        `);
        const config = {
            ...testConfig,
            relationshipTypes: [
                ...(testConfig.relationshipTypes ?? []),
                { name: 'dataLink', label: 'Data Link', layer: 'interfaces', color: '#3498DB' },
            ],
        };
        const model = buildMemoModel([doc], config);

        expect(model.relationships).toHaveLength(1);
        const rel = model.relationships[0];
        expect(rel.sourcePortId).toBe('sensorOut');
        expect(rel.targetPortId).toBe('sensorIn');
    });

    it('does not set port IDs when endpoints are not ports', async () => {
        const doc = await parseDoc(`
            package TestPkg {
                requirement rc1 : RiskControl { attribute redefines title = "RC1"; }
                requirement h1 : Hazard { attribute redefines title = "H1"; }
                connection : Mitigates connect control ::> rc1 to hazard ::> h1;
            }
        `);
        const model = buildMemoModel([doc], testConfig);

        const rel = model.relationships[0];
        expect(rel.sourcePortId).toBeUndefined();
        expect(rel.targetPortId).toBeUndefined();
    });
});

// ─── Helper: resolve extends chain for tests ────────────────────────────────

function loadResolvedConfig(configPath: string): MEMOConfig {
    const config = loadConfig(configPath);
    return resolveConfig(config, (packageName: string) => {
        // Map @memo package names to workspace package configs
        const shortName = packageName.replace(/^@memo\//, '');
        const parentPath = resolve('/Users/someshkashyap/sandbox/memo/packages', shortName, 'memo.package.yaml');
        try {
            return loadConfig(parentPath);
        } catch {
            return undefined;
        }
    });
}

// ─── Integration test with real infusion-pump file ──────────────────────────

// SKIP: examples/infusion-pump/ removed in c22b2e3 (single-example branch decision).
// Restore fixture or repoint to gpca-pump when builder work resumes.
describe.skip('Infusion pump integration', () => {
    const PUMP_FILE = resolve('/Users/someshkashyap/sandbox/memo/examples/infusion-pump/model/infusion-pump.sysml');
    const CONFIG_FILE = resolve('/Users/someshkashyap/sandbox/memo/packages/medical-modeling-profile/memo.package.yaml');

    it('builds model from infusion-pump.sysml', async () => {
        const source = readFileSync(PUMP_FILE, 'utf-8');
        const doc = await parse(source);
        const config = loadResolvedConfig(CONFIG_FILE);

        const model = buildMemoModel(
            [{ document: doc, filePath: 'model/infusion-pump.sysml' }],
            config
        );

        // Should have many elements (actors, requirements, hazards, components, etc.)
        expect(model.elements.size).toBeGreaterThan(50);

        // Should have relationships across risk, derivation, allocation, satisfaction, and verification.
        expect(model.relationships.length).toBeGreaterThan(30);

        // Check specific elements
        expect(model.elements.get('clinician')).toBeDefined();
        expect(model.elements.get('clinician')?.kind).toBe('Actor');

        expect(model.elements.get('hazOverInfusion')).toBeDefined();
        expect(model.elements.get('hazOverInfusion')?.kind).toBe('Hazard');

        // Check relationships
        const mitigates = model.relationshipsByType.get('mitigates') || [];
        expect(mitigates.length).toBe(3); // 3 risk controls

        const traceTo = model.relationshipsByType.get('traceTo') || [];
        expect(traceTo.length).toBe(0);

        const derives = model.relationshipsByType.get('derives') || [];
        const refines = model.relationshipsByType.get('refines') || [];
        expect(derives.length).toBeGreaterThanOrEqual(6);
        expect(refines.length).toBeGreaterThanOrEqual(5);

        // Verify relationship indexes
        const hazOverOutgoing = model.outgoing.get('hazOverInfusion') || [];
        const hazOverIncoming = model.incoming.get('hazOverInfusion') || [];
        expect(hazOverOutgoing.length + hazOverIncoming.length).toBeGreaterThan(0);
    });

    it('validates infusion-pump model', async () => {
        const source = readFileSync(PUMP_FILE, 'utf-8');
        const doc = await parse(source);
        const config = loadResolvedConfig(CONFIG_FILE);

        const model = buildMemoModel(
            [{ document: doc, filePath: 'model/infusion-pump.sysml' }],
            config
        );

        const result = validateModel(model);
        // Some rules should pass, some may have violations
        expect(result.violations.length).toBeGreaterThanOrEqual(0);

        const completeness = computeCompleteness(model, result, config);
        expect(completeness.totalElements).toBeGreaterThan(50);
        expect(completeness.layers.length).toBeGreaterThanOrEqual(2);
    });
});

// ─── Dual-mode builder: registry-first resolution (M41) ─────────────────────

describe('Dual-mode builder with registries', () => {
    /** Create a KindRegistry with a few test kinds */
    function createTestKindRegistry(): KindRegistry {
        const kr = new KindRegistry();
        kr.register({ name: 'Hazard', label: 'Hazard', layer: 'risk', sysmlConstruct: 'requirement def' });
        kr.register({ name: 'RiskControl', label: 'Risk Control', layer: 'risk', sysmlConstruct: 'requirement def' });
        kr.register({ name: 'SystemRequirement', label: 'System Req', layer: 'requirements', sysmlConstruct: 'requirement def' });
        kr.register({ name: 'Actor', label: 'Actor', layer: 'purpose', sysmlConstruct: 'part def' });
        kr.register({ name: 'Software', label: 'Software', layer: 'software', sysmlConstruct: 'part def' });
        return kr;
    }

    /** Create a RelationshipRegistry with a few test relationship types */
    function createTestRelRegistry(): RelationshipRegistry {
        const rr = new RelationshipRegistry();
        rr.register({ sysmlName: 'Mitigates', name: 'mitigates', label: 'Mitigates', layer: 'crosscutting', ends: [] });
        rr.register({ sysmlName: 'TraceTo', name: 'traceTo', label: 'Trace To', layer: 'crosscutting', ends: [] });
        return rr;
    }

    it('resolves kinds from registry when provided', async () => {
        const registries: BuilderRegistries = {
            kindRegistry: createTestKindRegistry(),
            relationshipRegistry: createTestRelRegistry(),
        };

        const doc = await parseDoc(`
            package TestPkg {
                part clinician : Actor {
                    attribute redefines name = "Clinician";
                }
            }
        `);

        // Use empty config kinds — registry should provide the resolution
        const emptyKindsConfig: MEMOConfig = { ...testConfig, kinds: {} };
        const model = buildMemoModel([doc], emptyKindsConfig, [], registries);

        const el = model.elements.get('clinician')!;
        expect(el).toBeDefined();
        expect(el.kind).toBe('Actor');
        // Registry provides 'purpose' layer instead of config's 'business'
        expect(el.layer).toBe('purpose');
    });

    it('falls back to config when registry does not have the kind', async () => {
        const registries: BuilderRegistries = {
            kindRegistry: new KindRegistry(), // empty registry
        };

        const doc = await parseDoc(`
            package TestPkg {
                part clinician : Actor {
                    attribute redefines name = "Clinician";
                }
            }
        `);

        const model = buildMemoModel([doc], testConfig, [], registries);

        const el = model.elements.get('clinician')!;
        expect(el).toBeDefined();
        expect(el.kind).toBe('Actor');
        expect(el.layer).toBe('business'); // from config fallback
    });

    it('registry takes precedence over config for same kind', async () => {
        const kr = new KindRegistry();
        // Register Hazard with a different layer than config
        kr.register({ name: 'Hazard', label: 'Hazard', layer: 'safety', sysmlConstruct: 'requirement def' });

        const registries: BuilderRegistries = { kindRegistry: kr };

        const doc = await parseDoc(`
            package TestPkg {
                requirement h1 : Hazard {
                    attribute redefines title = "H1";
                }
            }
        `);

        const model = buildMemoModel([doc], testConfig, [], registries);

        const el = model.elements.get('h1')!;
        expect(el.kind).toBe('Hazard');
        // Registry's 'safety' takes precedence over config's 'risk'
        expect(el.layer).toBe('safety');
    });

    it('resolves qualified type names through registry', async () => {
        const registries: BuilderRegistries = {
            kindRegistry: createTestKindRegistry(),
        };

        const doc = await parseDoc(`
            package TestPkg {
                requirement h1 : RiskPkg::Hazard {
                    attribute redefines title = "H1";
                }
            }
        `);

        const emptyKindsConfig: MEMOConfig = { ...testConfig, kinds: {} };
        const model = buildMemoModel([doc], emptyKindsConfig, [], registries);

        const el = model.elements.get('h1')!;
        expect(el.kind).toBe('Hazard');
        expect(el.layer).toBe('risk');
    });

    it('resolves action usage kinds from registry', async () => {
        const kr = new KindRegistry();
        kr.register({ name: 'OperationalActivity', label: 'Op Activity', layer: 'operational', sysmlConstruct: 'action def' });

        const registries: BuilderRegistries = { kindRegistry: kr };

        const doc = await parseDoc(`
            package TestPkg {
                action doSomething : OperationalActivity;
            }
        `);

        const emptyKindsConfig: MEMOConfig = { ...testConfig, kinds: {} };
        const model = buildMemoModel([doc], emptyKindsConfig, [], registries);

        const el = model.elements.get('doSomething')!;
        expect(el.kind).toBe('OperationalActivity');
        expect(el.layer).toBe('operational');
    });

    it('produces identical output without registries (backward compat)', async () => {
        const doc = await parseDoc(`
            package TestPkg {
                requirement rc1 : RiskControl {
                    attribute redefines title = "Control 1";
                }
                requirement haz1 : Hazard {
                    attribute redefines title = "Hazard 1";
                }
                connection : Mitigates connect control ::> rc1 to hazard ::> haz1;
            }
        `);

        const modelWithout = buildMemoModel([doc], testConfig);
        const modelWith = buildMemoModel([doc], testConfig, [], undefined);

        expect(modelWith.elements.size).toBe(modelWithout.elements.size);
        expect(modelWith.relationships.length).toBe(modelWithout.relationships.length);
        expect(modelWith.elements.get('haz1')?.layer).toBe(modelWithout.elements.get('haz1')?.layer);
    });
});
