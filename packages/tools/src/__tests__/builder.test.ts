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
import { ProvenanceTable } from '../model/source-provenance.js';
import { RelationshipRegistry } from '../model/relationship-registry.js';
import { validateModel } from '../validator/rule-engine.js';
import { computeCompleteness } from '../completeness/tracker.js';
import type { ParsedDocument } from '../model/parser-utils.js';
import { loadConfig } from '../model/config-loader.js';

const services = createMemoSysMLServices({ ...EmptyFileSystem }).MemoSysML;
const parse = parseHelper<Model>(services);

// ─── Helpers ────────────────────────────────────────────────────────────────

async function parseDoc(source: string, filePath: string = 'test.sysml'): Promise<ParsedDocument> {
    const doc = await parse(source);
    return { document: doc, filePath };
}

/** Minimal settings for testing. Settings carry no kinds any more. */
const testConfig: MEMOConfig = {
    projectName: 'test',
};

/**
 * The kinds these tests model with.
 *
 * They used to live in `testConfig.kinds`, and the builder read them from
 * there. Kinds come from the ontology's own declarations now, so the tests
 * build the registry the resolved SysML would have produced.
 */
function testRegistries(): { kindRegistry: KindRegistry } {
    const kindRegistry = new KindRegistry();
    const kinds: Array<[string, string, string, 'part def' | 'requirement def']> = [
        ['Hazard', 'Hazard', 'risk', 'requirement def'],
        ['RiskControlMeasure', 'Risk Control', 'risk', 'requirement def'],
        ['SystemRequirement', 'System Req', 'requirements', 'requirement def'],
        ['SoftwareRequirement', 'Software Req', 'requirements', 'requirement def'],
        ['Software', 'Software', 'software', 'part def'],
        ['Actor', 'Actor', 'business', 'part def'],
    ];
    for (const [name, label, layer, sysmlConstruct] of kinds) {
        kindRegistry.register({ name, label, layer, sysmlConstruct, qualifiedName: `memo::test::${name}` });
    }
    return { kindRegistry };
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('buildMemoModel', () => {
    it('carries declaration and classifier provenance separately', async () => {
        const doc = await parseDoc(`package TestPkg { part clinician : Actor; }`, '/workspace/model/catalog.sysml');
        const kinds = new KindRegistry();
        kinds.register({
            name: 'Actor', label: 'Actor', layer: 'business', sysmlConstruct: 'part def',
            qualifiedName: 'memo::architecture::Actor',
            sourceFile: '/ontology/src/actors.sysml',
        });
        const model = buildMemoModel([doc], testConfig, [], {
            kindRegistry: kinds,
            provenance: new ProvenanceTable('/workspace', [{
                dir: '/ontology', origin: 'ontology', packageName: '@memoarchitect/ontology', importDepth: 1,
            }]),
        });
        const element = model.elements.get('clinician')!;
        expect(element.provenance?.declaration.origin).toBe('project');
        expect(element.provenance?.declaration.writable).toBe(true);
        expect(element.provenance?.classifier?.qualifiedName).toBe('memo::architecture::Actor');
        expect(element.provenance?.classifier?.provenance?.origin).toBe('ontology');
        expect(element.provenance?.classifierChain?.map(entry => entry.shortName)).toEqual(['Actor']);
    });

    it('extracts elements from part usages', async () => {
        const doc = await parseDoc(`
            package TestPkg {
                part clinician : Actor {
                    attribute redefines name = "Clinician";
                }
            }
        `);
        const model = buildMemoModel([doc], testConfig, [], testRegistries());

        expect(model.elements.size).toBe(1);
        const el = model.elements.get('clinician')!;
        expect(el).toBeDefined();
        expect(el.kind).toBe('Actor');
        expect(el.construct).toBe('part');
        expect(el.layer).toBe('business');
        expect(el.name).toBe('Clinician');
        expect(el.attributes['name']).toBe('Clinician');
    });

    it('retains authored reference bindings as element attributes', async () => {
        const doc = await parseDoc(`
            package TestPkg {
                part workflow : Software;
                part scenario : Software {
                    ref :>> parentWorkflow = workflow;
                }
            }
        `);
        const model = buildMemoModel([doc], testConfig, [], testRegistries());

        expect(model.elements.get('scenario')?.attributes['parentWorkflow']).toBe('workflow');
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
        const model = buildMemoModel([doc], testConfig, [], testRegistries());

        expect(model.elements.size).toBe(1);
        const el = model.elements.get('hazOverInfusion')!;
        expect(el.kind).toBe('Hazard');
        expect(el.construct).toBe('requirement');
        expect(el.layer).toBe('risk');
        expect(el.name).toBe('Over-Infusion');
        expect(el.attributes['hazardId']).toBe('HAZ-001');
        expect(el.doc).toContain('hazard description');
    });

    it('extracts item and use-case usages while retaining a use-case definition as a kind', async () => {
        const doc = await parseDoc(`
            package TestPkg {
                use case def ClinicalGoal;
                use case ucMonitor : ClinicalGoal {
                    attribute redefines name = "Monitor patient";
                }
                item alarmSignal : AlarmSignal {
                    attribute redefines name = "Alarm signal";
                }
            }
        `);
        const model = buildMemoModel([doc], testConfig, [], testRegistries());

        expect(model.elements.size).toBe(2);
        expect(model.elements.get('ucMonitor')).toMatchObject({
            kind: 'ClinicalGoal', construct: 'use case', name: 'Monitor patient',
        });
        expect(model.elements.get('alarmSignal')).toMatchObject({
            kind: 'AlarmSignal', construct: 'item', name: 'Alarm signal',
        });
        expect(model.errors).toHaveLength(0);
    });

    it('extracts connection usages as relationships', async () => {
        const doc = await parseDoc(`
            package TestPkg {
                requirement rc1 : RiskControlMeasure {
                    attribute redefines title = "Control 1";
                }
                requirement haz1 : Hazard {
                    attribute redefines title = "Hazard 1";
                }
                connection : Mitigates {
                    attribute interactionLabel = "Controls hazard";
                    connect control ::> rc1 to hazard ::> haz1;
                }
            }
        `);
        const model = buildMemoModel([doc], testConfig, [], testRegistries());

        expect(model.elements.size).toBe(2);
        expect(model.relationships).toHaveLength(1);

        const rel = model.relationships[0];
        expect(rel.type).toBe('mitigates');
        expect(rel.sourceId).toBe('rc1');
        expect(rel.sourceEnd).toBe('control');
        expect(rel.targetId).toBe('haz1');
        expect(rel.targetEnd).toBe('hazard');
        expect(rel.attributes?.interactionLabel).toBe('Controls hazard');
    });

    it('builds element indexes by kind and layer', async () => {
        const doc = await parseDoc(`
            package TestPkg {
                requirement h1 : Hazard { attribute redefines title = "H1"; }
                requirement h2 : Hazard { attribute redefines title = "H2"; }
                requirement sr1 : SystemRequirement { attribute redefines title = "SR1"; }
            }
        `);
        const model = buildMemoModel([doc], testConfig, [], testRegistries());

        expect(model.elementsByKind.get('Hazard')?.length).toBe(2);
        expect(model.elementsByKind.get('SystemRequirement')?.length).toBe(1);
        expect(model.elementsByLayer.get('risk')?.length).toBe(2);
        expect(model.elementsByLayer.get('requirements')?.length).toBe(1);
    });

    it('builds relationship indexes (outgoing, incoming, byType)', async () => {
        const doc = await parseDoc(`
            package TestPkg {
                requirement rc1 : RiskControlMeasure { attribute redefines title = "RC1"; }
                requirement h1 : Hazard { attribute redefines title = "H1"; }
                connection : Mitigates connect control ::> rc1 to hazard ::> h1;
            }
        `);
        const model = buildMemoModel([doc], testConfig, [], testRegistries());

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
        const model = buildMemoModel([doc], testConfig, [], testRegistries());
        expect(model.errors).toHaveLength(0);
        expect(model.elements.get('sw1')?.attributes['periodMs']).toBe('20.0');
    });
});

describe('computeCompleteness', () => {
    it('computes per-layer completeness', async () => {
        const doc = await parseDoc(`
            package TestPkg {
                requirement h1 : Hazard { attribute redefines title = "H1"; }
                requirement rc1 : RiskControlMeasure { attribute redefines title = "RC1"; }
                part sw1 : Software { attribute redefines safetyClassification = "C"; }
                connection : Mitigates connect control ::> rc1 to hazard ::> h1;
            }
        `);
        const model = buildMemoModel([doc], testConfig, [], testRegistries());
        const validation = validateModel(model);
        const report = computeCompleteness(model, validation);

        expect(report.totalElements).toBe(3);
        // h1 passes (has mitigates), rc1 has no rules, sw1 passes (has attribute)
        expect(report.overall).toBeGreaterThanOrEqual(50);
        // Layers come from the model, not from a configured list, so only the
        // layers the model actually populates are reported: risk and software.
        expect(report.layers.map(l => l.layerId).sort()).toEqual(['risk', 'software']);
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
        const model = buildMemoModel([doc], testConfig, [], testRegistries());
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
                requirement rc1 : RiskControlMeasure {
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
                requirement rc1 : RiskControlMeasure {
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
                requirement rc1 : RiskControlMeasure {
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
                    requirement rc1 : RiskControlMeasure {
                        attribute redefines title = "RC1";
                    }
                    connection : Mitigates connect control ::> rc1 to hazard ::> haz1;
                }
            }
        `);
        const model = buildMemoModel([doc], testConfig, [], testRegistries());

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
        const model = buildMemoModel([doc], testConfig, [], testRegistries());
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
                part def RiskControlMeasure;
            }
        `);
        const model = buildMemoModel([doc], testConfig, [], testRegistries());
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
                requirement rc1 : RiskControlMeasure {
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
        const allocations = model.relationships.filter(r => r.type === 'allocatedTo');
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
        const model = buildMemoModel([doc], testConfig, [], testRegistries());

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
        const model = buildMemoModel([doc], testConfig, [], testRegistries());

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

    // SysML v2 nests ports inside ports, which is how one boundary feature says
    // it carries several connectors. The builder used to walk port bodies only
    // on port DEFINITIONS, so a natively nested usage lost its children —
    // declared, resolving, and absent from the model. The only other spelling
    // is a `Composes` connection from a port to a port, which CR-ONT-065
    // forbids outright.
    it('extracts ports nested inside a port usage', async () => {
        const doc = await parseDoc(`
            package TestPkg {
                part def PanelBoard {
                    port panelCluster : SensorPort {
                        in port encoderA : SensorPort;
                        in port encoderB : SensorPort;
                    }
                }
            }
        `);
        const model = buildMemoModel([doc], testConfig, [], testRegistries());

        expect(model.elements.size).toBe(3);

        const cluster = model.elements.get('panelCluster')!;
        expect(cluster.owner).toBe('PanelBoard');
        expect(cluster.ownedPorts).toEqual(['encoderA', 'encoderB']);

        const a = model.elements.get('encoderA')!;
        expect(a).toBeDefined();
        expect(a.owner).toBe('panelCluster');
        expect(a.construct).toBe('port');
        expect(a.portSpec!.direction).toBe('in');

        expect(model.elements.get('encoderB')!.owner).toBe('panelCluster');
    });

    it('nests ports more than one level deep', async () => {
        const doc = await parseDoc(`
            package TestPkg {
                port outer : SensorPort {
                    port middle : SensorPort {
                        port inner : SensorPort;
                    }
                }
            }
        `);
        const model = buildMemoModel([doc], testConfig, [], testRegistries());

        expect(model.elements.get('outer')!.ownedPorts).toEqual(['middle']);
        expect(model.elements.get('middle')!.owner).toBe('outer');
        expect(model.elements.get('middle')!.ownedPorts).toEqual(['inner']);
        expect(model.elements.get('inner')!.owner).toBe('middle');
    });

    it('leaves ownedPorts unset on a port that nests nothing', async () => {
        const doc = await parseDoc(`
            package TestPkg {
                port lone : SensorPort;
            }
        `);
        const model = buildMemoModel([doc], testConfig, [], testRegistries());

        expect(model.elements.get('lone')!.ownedPorts).toBeUndefined();
    });

    // Nesting a port makes it unreachable by bare name, so flows to it must be
    // written `parent.child`. That is the same spelling as an action parameter
    // (`receive.prescription`), which is NOT an element — so the two have to be
    // told apart by whether the trailing segment is a real element owned by the
    // one before it. Read the wrong way, a flow silently retargets at the
    // parent and only surfaces later as a payload mismatch.
    it('resolves a flow endpoint through a nested port path', async () => {
        const doc = await parseDoc(`
            package TestPkg {
                port outer : SensorPort {
                    port innerIn : SensorPort;
                }
                port sourcePort : SensorPort;
                flow of SensorReading from sourcePort to outer.innerIn;
            }
        `);
        const model = buildMemoModel([doc], testConfig, [], testRegistries());

        expect(model.relationships).toHaveLength(1);
        const rel = model.relationships[0];
        expect(rel.targetId).toBe('innerIn');
        expect(rel.targetEnd).toBe('');
    });

    it('still reads a dotted endpoint whose tail is not an element as an end label', async () => {
        const doc = await parseDoc(`
            package TestPkg {
                port sourcePort : SensorPort;
                port targetPort : SensorPort;
                flow of SensorReading from sourcePort to targetPort.payload;
            }
        `);
        const model = buildMemoModel([doc], testConfig, [], testRegistries());

        expect(model.relationships).toHaveLength(1);
        const rel = model.relationships[0];
        expect(rel.targetId).toBe('targetPort');
        expect(rel.targetEnd).toBe('payload');
    });

    // `of <itemType>` is optional in SysML v2 and the pinned corpus writes
    // untyped flows throughout. The grammar used to require it, which did not
    // reject such a flow — it failed to match the production and vanished with
    // no diagnostic at all.
    it('builds a flow that names no item type', async () => {
        const doc = await parseDoc(`
            package TestPkg {
                port sourcePort : SensorPort;
                port targetPort : SensorPort;
                flow from sourcePort to targetPort;
            }
        `);
        const model = buildMemoModel([doc], testConfig, [], testRegistries());

        expect(model.relationships).toHaveLength(1);
        const rel = model.relationships[0];
        expect(rel.type).toBe('flow');
        expect(rel.sourceId).toBe('sourcePort');
        expect(rel.targetId).toBe('targetPort');
        expect(rel.flowItem).toBeUndefined();
    });

    // The corpus writes port-to-port wiring with neither `from` nor an item:
    // `flow supplierPort.fuelSupply to consumerPort.fuelSupply;`.
    it('builds a flow written in the two-end shorthand', async () => {
        const doc = await parseDoc(`
            package TestPkg {
                port sourcePort : SensorPort;
                port targetPort : SensorPort;
                flow sourcePort to targetPort;
            }
        `);
        const model = buildMemoModel([doc], testConfig, [], testRegistries());

        expect(model.relationships).toHaveLength(1);
        const rel = model.relationships[0];
        expect(rel.type).toBe('flow');
        expect(rel.sourceId).toBe('sourcePort');
        expect(rel.targetId).toBe('targetPort');
        expect(rel.flowItem).toBeUndefined();
        // No name was declared, so it must not have swallowed the source as one.
        expect(rel.named).toBeUndefined();
    });

    it('reads the shorthand with dotted ends', async () => {
        const doc = await parseDoc(`
            package TestPkg {
                port supplierPort : SensorPort;
                port consumerPort : SensorPort;
                flow supplierPort.fuelSupply to consumerPort.fuelSupply;
            }
        `);
        const model = buildMemoModel([doc], testConfig, [], testRegistries());

        expect(model.relationships).toHaveLength(1);
        const rel = model.relationships[0];
        expect(rel.sourceId).toBe('supplierPort');
        expect(rel.sourceEnd).toBe('fuelSupply');
        expect(rel.targetId).toBe('consumerPort');
        expect(rel.targetEnd).toBe('fuelSupply');
    });

    it('still reads a NAMED flow as a name, not as a shorthand source', async () => {
        const doc = await parseDoc(`
            package TestPkg {
                port sourcePort : SensorPort;
                port targetPort : SensorPort;
                flow fuelCommandFlow of SensorReading from sourcePort to targetPort;
            }
        `);
        const model = buildMemoModel([doc], testConfig, [], testRegistries());

        expect(model.relationships).toHaveLength(1);
        const rel = model.relationships[0];
        expect(rel.id).toBe('fuelCommandFlow');
        expect(rel.named).toBe(true);
        expect(rel.flowItem).toBe('SensorReading');
        expect(rel.sourceId).toBe('sourcePort');
    });

    it('tags port IDs on connection endpoints', async () => {
        const doc = await parseDoc(`
            package TestPkg {
                port sensorOut : SensorPort;
                port sensorIn : SensorPort;
                connection : DataLink connect source ::> sensorOut to target ::> sensorIn;
            }
        `);
        const model = buildMemoModel([doc], testConfig, [], testRegistries());

        expect(model.relationships).toHaveLength(1);
        const rel = model.relationships[0];
        expect(rel.sourcePortId).toBe('sensorOut');
        expect(rel.targetPortId).toBe('sensorIn');
    });

    it('does not set port IDs when endpoints are not ports', async () => {
        const doc = await parseDoc(`
            package TestPkg {
                requirement rc1 : RiskControlMeasure { attribute redefines title = "RC1"; }
                requirement h1 : Hazard { attribute redefines title = "H1"; }
                connection : Mitigates connect control ::> rc1 to hazard ::> h1;
            }
        `);
        const model = buildMemoModel([doc], testConfig, [], testRegistries());

        const rel = model.relationships[0];
        expect(rel.sourcePortId).toBeUndefined();
        expect(rel.targetPortId).toBeUndefined();
    });
});

// The `resolveConfig` extends-chain helper this file used to carry is gone.
// Settings no longer inherit: what a project depends on is its SysML imports,
// resolved by `resolveNativeProject`.


// ─── Integration test with real infusion-pump file ──────────────────────────

// The skipped infusion-pump integration block was removed with the settings
// `extends` resolver it depended on; its fixture had already been deleted.

describe('Dual-mode builder with registries', () => {
    /** Create a KindRegistry with a few test kinds */
    function createTestKindRegistry(): KindRegistry {
        const kr = new KindRegistry();
        kr.register({ name: 'Hazard', label: 'Hazard', layer: 'risk', sysmlConstruct: 'requirement def' });
        kr.register({ name: 'RiskControlMeasure', label: 'Risk Control', layer: 'risk', sysmlConstruct: 'requirement def' });
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

    it('recognizes MEMO-derived and standard SysML project extension kinds', async () => {
        const ontologyKinds = new KindRegistry();
        ontologyKinds.register({
            name: 'SoftwareComponent',
            label: 'Software Component',
            layer: 'implementation',
            namespace: ['architecture', 'implementation', 'software', 'runtime'],
            sysmlConstruct: 'part def',
        });

        const doc = await parseDoc(`
            package TestPkg {
                part def FirmwareComponent specializes SoftwareComponent;
                part def ProjectContainer;
                part firmware : FirmwareComponent;
                part container : ProjectContainer;
            }
        `);
        const kindRegistry = ontologyKinds.withProjectExtensions([doc]);
        const model = buildMemoModel(
            [doc],
            testConfig,
            [],
            { kindRegistry },
        );

        expect(model.elements.get('firmware')).toMatchObject({
            kind: 'FirmwareComponent',
            layer: 'implementation',
        });
        expect(model.elements.get('container')).toMatchObject({
            kind: 'ProjectContainer',
            layer: 'sysml',
        });
    });

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
        const emptyKindsConfig: MEMOConfig = testConfig;
        const model = buildMemoModel([doc], emptyKindsConfig, [], registries);

        const el = model.elements.get('clinician')!;
        expect(el).toBeDefined();
        expect(el.kind).toBe('Actor');
        // Registry provides 'purpose' layer instead of config's 'business'
        expect(el.layer).toBe('purpose');
    });

    it('reports an unknown layer when the registry does not have the kind', async () => {
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
        // There is no config fallback any more. A settings file could declare a
        // `kinds:` block, which meant it could invent a type the ontology never
        // defined; an unresolved kind is now visibly unresolved.
        expect(el.layer).toBe('unknown');
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

        const emptyKindsConfig: MEMOConfig = testConfig;
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

        const emptyKindsConfig: MEMOConfig = testConfig;
        const model = buildMemoModel([doc], emptyKindsConfig, [], registries);

        const el = model.elements.get('doSomething')!;
        expect(el.kind).toBe('OperationalActivity');
        expect(el.layer).toBe('operational');
    });

    it('resolves structure without a registry, but not kind layers', async () => {
        const doc = await parseDoc(`
            package TestPkg {
                requirement rc1 : RiskControlMeasure {
                    attribute redefines title = "Control 1";
                }
                requirement haz1 : Hazard {
                    attribute redefines title = "Hazard 1";
                }
                connection : Mitigates connect control ::> rc1 to hazard ::> haz1;
            }
        `);

        const withRegistry = buildMemoModel([doc], testConfig, [], testRegistries());
        const withoutRegistry = buildMemoModel([doc], testConfig, [], undefined);

        // Structure is registry-independent: the same elements and the same
        // relationships either way.
        expect(withoutRegistry.elements.size).toBe(withRegistry.elements.size);
        expect(withoutRegistry.relationships.length).toBe(withRegistry.relationships.length);

        // Layer is not. It used to fall back to `config.kinds`, so a settings
        // file could answer a question only the ontology can answer. Without a
        // resolved ontology the layer is honestly unknown.
        expect(withRegistry.elements.get('haz1')?.layer).toBe('risk');
        expect(withoutRegistry.elements.get('haz1')?.layer).toBe('unknown');
    });
});
