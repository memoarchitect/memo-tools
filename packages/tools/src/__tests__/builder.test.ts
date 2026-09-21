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
import { shortNameOf } from '../model/element-index.js';

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
        const element = model.elements.lookup('clinician')!;
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
        const el = model.elements.lookup('clinician')!;
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

        expect(model.elements.lookup('scenario')?.attributes['parentWorkflow']).toBe('workflow');
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
        const el = model.elements.lookup('hazOverInfusion')!;
        expect(el.kind).toBe('Hazard');
        expect(el.construct).toBe('requirement');
        expect(el.layer).toBe('risk');
        expect(el.name).toBe('Over-Infusion');
        expect(el.attributes['hazardId']).toBe('HAZ-001');
        expect(el.doc).toContain('hazard description');
    });

    it('extracts item and use-case usages, and the use-case definition they name', async () => {
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

        // The definition is an element too — a project defines ClinicalGoal
        // here, and a view that cannot select it cannot draw it. The untyped
        // definition's definition kind propagates to its usage.
        expect(model.elements.size).toBe(3);
        expect(model.elements.lookup('ClinicalGoal')).toMatchObject({
            construct: 'use case', isDefinition: true,
        });
        expect(model.elements.lookup('ucMonitor')).toMatchObject({
            kind: 'Use caseDefinition', construct: 'use case', name: 'Monitor patient',
        });
        expect(model.elements.lookup('ucMonitor')?.isDefinition).toBeUndefined();
        expect(model.elements.lookup('alarmSignal')).toMatchObject({
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
        expect(shortNameOf(rel.sourceId)).toBe('rc1');
        expect(rel.sourceEnd).toBe('control');
        expect(shortNameOf(rel.targetId)).toBe('haz1');
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

        expect(model.outgoing.get(model.elements.lookup('rc1')!.id)?.length).toBe(1);
        expect(model.incoming.get(model.elements.lookup('h1')!.id)?.length).toBe(1);
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
        expect(model.elements.lookup('sw1')?.attributes['periodMs']).toBe('20.0');
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
        const el = model.elements.lookup('clinician')!;
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
        expect(model.elements.lookup('haz1')?.package).toBe('RiskPkg');
        expect(model.elements.lookup('rc1')?.package).toBe('ControlPkg');

        expect(model.relationships).toHaveLength(1);
        expect(shortNameOf(model.relationships[0].sourceId)).toBe('rc1');
        expect(shortNameOf(model.relationships[0].targetId)).toBe('haz1');
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
        expect(shortNameOf(model.relationships[0].targetId)).toBe('haz1');
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
        expect(shortNameOf(model.relationships[0].targetId)).toBe('haz1');
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

        expect(model.elements.lookup('haz1')?.package).toBe('DeviceModel::Risk');
        expect(model.elements.lookup('rc1')?.package).toBe('DeviceModel::Controls');
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
        const el = model.elements.lookup('h1')!;
        // Should resolve RiskPkg::Hazard to just "Hazard" for kind lookup
        expect(el.kind).toBe('Hazard');
        expect(el.layer).toBe('risk');
    });
});

// ─── Project definitions are model content ──────────────────────────────────
//
// `part def Pump :> LogicalComponent` DEFINES a Pump. It was registered as a
// kind and nothing else, so no view could select it and no BDD or IBD could
// draw it. The ontology's own definitions are a different thing entirely: they
// are read by the kind registry and never parsed into a model, and a `library
// package` is how a project writes that same ontology-style content.

describe('a definition the project declares', () => {
    it('becomes an element carrying the ontology kind it specializes', async () => {
        const doc = await parseDoc(`
            package Plant {
                part def Pump specializes Software {
                    attribute redefines name = "Pump";
                }
                part p1 : Pump;
            }
        `);
        const model = buildMemoModel([doc], testConfig, [], testRegistries());

        // The kind is the supertype, so every view, viewpoint filter and
        // palette that admits Software admits the definition of one.
        expect(model.elements.lookup('Pump')).toMatchObject({
            kind: 'Software', construct: 'part', layer: 'software', isDefinition: true, name: 'Pump',
        });
        // A usage inherits the definition's resolved ontology kind, so every
        // view and filter that admits Software also admits this instance.
        expect(model.elements.lookup('p1')?.kind).toBe('Software');
    });

    it('says it is a definition when it specializes nothing the ontology knows', async () => {
        const doc = await parseDoc('package Plant {\n    part def Widget;\n}');
        const model = buildMemoModel([doc], testConfig, [], testRegistries());

        expect(model.elements.lookup('Widget')).toMatchObject({ kind: 'PartDefinition', isDefinition: true });
    });

    it('takes the parts declared in its body as containment', async () => {
        const doc = await parseDoc(`
            package Plant {
                part def Pump specializes Software {
                    part motor : Software;
                }
            }
        `);
        const model = buildMemoModel([doc], testConfig, [], testRegistries());

        expect(shortNameOf(model.elements.lookup('motor')?.owner)).toBe('Pump');
        // Which is what a BDD reads: containment, synthesized from the nesting.
        expect(model.relationships.some(r =>
            r.type === 'composes' && shortNameOf(r.sourceId) === 'Pump' && shortNameOf(r.targetId) === 'motor')).toBe(true);
    });

    it('stays out of the model when a library package declares it', async () => {
        const doc = await parseDoc(`
            library package Types {
                part def Pump specializes Software;
            }
        `);
        const model = buildMemoModel([doc], testConfig, [], testRegistries());

        // A library package is ontology-style content: its definitions are
        // types for other models, and remain kinds only.
        expect(model.elements.size).toBe(0);
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
        expect(model.elements.lookup('clinician')?.package).toBe('InfusionPump');
        expect(model.elements.lookup('h1')?.package).toBe('InfusionPump');
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
        expect(model.elements.lookup('haz1')?.package).toBe('DeviceRisk');
        expect(model.elements.lookup('sr1')?.package).toBe('DeviceRequirements');
        expect(model.elements.lookup('pump')?.package).toBe('DeviceArchitecture');

        // Cross-file connections
        expect(model.relationships.length).toBe(2);

        // Mitigates: rc1 → haz1 (within risk file)
        const mitigates = model.relationships.find(r => r.type === 'mitigates');
        expect(shortNameOf(mitigates?.sourceId)).toBe('rc1');
        expect(shortNameOf(mitigates?.targetId)).toBe('haz1');

        // TraceTo: sr1 → rc1 (cross-file: requirements → risk)
        const traceTo = model.relationships.find(r => r.type === 'traceTo');
        expect(shortNameOf(traceTo?.sourceId)).toBe('sr1');
        expect(shortNameOf(traceTo?.targetId)).toBe('rc1');
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
        const r1 = model.relationships.find(r => shortNameOf(r.sourceId) === 'sr1');
        expect(shortNameOf(r1?.targetId)).toBe('haz1');

        // swr1 → sr1 (software → requirements)
        const r2 = model.relationships.find(r => shortNameOf(r.sourceId) === 'swr1');
        expect(shortNameOf(r2?.targetId)).toBe('sr1');
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
        expect(allocations.map(r => shortNameOf(r.sourceId)).sort()).toEqual(['receive', 'stepA']);
        expect(shortNameOf(model.elements.lookup('receive')?.allocatedTo)).toBe('laneA');
        expect(shortNameOf(model.elements.lookup('stepA')?.allocatedTo)).toBe('laneA');
    });

    it('resolves dotted connection endpoints to leaf element ids', async () => {
        const model = buildMemoModel([await parseDoc(source)], testConfig);
        const trace = model.relationships.find(r => r.type === 'traceTo');
        expect(shortNameOf(trace?.sourceId)).toBe('receive');
        expect(shortNameOf(trace?.targetId)).toBe('laneA');
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

        const sensor = model.elements.lookup('sensorIn')!;
        expect(sensor).toBeDefined();
        expect(sensor.construct).toBe('port');
        expect(sensor.portSpec).toBeDefined();
        expect(sensor.portSpec!.type).toBe('SensorPort');
        expect(sensor.portSpec!.direction).toBe('in');
        expect(sensor.portSpec!.isConjugated).toBe(true);

        const control = model.elements.lookup('controlOut')!;
        expect(control.portSpec!.direction).toBe('out');
        expect(control.portSpec!.isConjugated).toBe(false);

        const plain = model.elements.lookup('plain')!;
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

        // The definition and its two ports. `ownedPorts` finally lands on
        // something: before the definition was an element, there was nothing
        // to write it to, which is what an IBD needs to draw the boundary.
        expect(model.elements.size).toBe(3);
        const controller = model.elements.lookup('PumpController')!;
        expect(controller).toMatchObject({ construct: 'part', isDefinition: true });
        expect(controller.ownedPorts?.map(id => shortNameOf(id)))
            .toEqual(['sensorIn', 'controlOut']);

        const sensor = model.elements.lookup('sensorIn')!;
        expect(sensor).toBeDefined();
        expect(shortNameOf(sensor.owner)).toBe('PumpController');
        expect(sensor.portSpec!.direction).toBe('in');

        const control = model.elements.lookup('controlOut')!;
        expect(shortNameOf(control.owner)).toBe('PumpController');
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

        expect(model.elements.size).toBe(4);
        expect(model.elements.lookup('PanelBoard')?.isDefinition).toBe(true);

        const cluster = model.elements.lookup('panelCluster')!;
        expect(shortNameOf(cluster.owner)).toBe('PanelBoard');
        expect(cluster.ownedPorts?.map(id => shortNameOf(id))).toEqual(['encoderA', 'encoderB']);

        const a = model.elements.lookup('encoderA')!;
        expect(a).toBeDefined();
        expect(shortNameOf(a.owner)).toBe('panelCluster');
        expect(a.construct).toBe('port');
        expect(a.portSpec!.direction).toBe('in');

        expect(shortNameOf(model.elements.lookup('encoderB')!.owner)).toBe('panelCluster');
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

        expect(model.elements.lookup('outer')!.ownedPorts?.map(id => shortNameOf(id))).toEqual(['middle']);
        expect(shortNameOf(model.elements.lookup('middle')!.owner)).toBe('outer');
        expect(model.elements.lookup('middle')!.ownedPorts?.map(id => shortNameOf(id))).toEqual(['inner']);
        expect(shortNameOf(model.elements.lookup('inner')!.owner)).toBe('middle');
    });

    // R10-S3 GUARD (written first): a view's `part :>> selectionQuery { ... }`
    // body is deliberately NOT a contained element — it redefines an inherited
    // feature, and view derivation reads it as `selectionQuery.*` attributes.
    // The nested-part extraction below must leave this case exactly as it was,
    // or every view loses its selection metadata and renders empty.
    it('flattens a view selectionQuery redefinition to attributes, not an element', async () => {
        const doc = await parseDoc(`
            package TestPkg {
                view aView : MemoDiagramView {
                    attribute :>> diagramType = "ibd";
                    part :>> selectionQuery {
                        attribute :>> includeElementKinds = ("LogicalComponent");
                        attribute :>> includeRelationshipKinds = ("flow");
                        attribute :>> includeLayers = ("logical_structure");
                    }
                    part :>> viewpointDefinition = someViewpoint;
                }
            }
        `);
        const model = buildMemoModel([doc], testConfig, [], testRegistries());

        const view = model.elements.lookup('aView')!;
        expect(view.construct).toBe('view');
        // The selectionQuery body stays flattened onto the view.
        expect(view.attributes['selectionQuery.includeElementKinds']).toBe('LogicalComponent');
        expect(view.attributes['selectionQuery.includeRelationshipKinds']).toBe('flow');
        expect(view.attributes['selectionQuery.includeLayers']).toBe('logical_structure');
        // The `:>>` viewpoint binding stays flattened too.
        expect(view.attributes['viewpointDefinition']).toBe('someViewpoint');
        // Neither the redefinition nor its members may become elements, and no
        // spurious `composes` edge may be synthesized from them.
        expect(model.elements.has('selectionQuery')).toBe(false);
        expect(model.relationships.filter(r => r.type === 'composes')).toEqual([]);
    });

    it('flattens ref viewpoint bindings onto a view', async () => {
        const doc = await parseDoc(`
            package TestPkg {
                view aView : MemoDocumentView {
                    ref vpLogical :> viewpointDefinition = logicalArchitectureViewpoint;
                    ref vpSoftware :> viewpointDefinition = softwareViewpoint;
                }
            }
        `);
        const model = buildMemoModel([doc], testConfig, [], testRegistries());

        expect(model.elements.lookup('aView')!.attributes['viewpointDefinition'])
            .toBe('logicalArchitectureViewpoint,softwareViewpoint');
    });

    // R10-S3: a natively nested part is real containment. It must become its own
    // element with `owner` set — the way a nested port already does — and the
    // builder must synthesize the `composes` edge from the nesting so consumers
    // that read containment as a relationship keep working.
    it('extracts a natively nested part as an element with owner and a composes edge', async () => {
        const doc = await parseDoc(`
            package TestPkg {
                part pump : Software {
                    part valve : Software {
                        part seal : Software;
                    }
                    part motor : Software;
                }
            }
        `);
        const model = buildMemoModel([doc], testConfig, [], testRegistries());

        // Every nested part is now a first-class element.
        const valve = model.elements.lookup('valve')!;
        expect(valve).toBeDefined();
        expect(valve.construct).toBe('part');
        expect(shortNameOf(valve.owner)).toBe('pump');

        const motor = model.elements.lookup('motor')!;
        expect(shortNameOf(motor.owner)).toBe('pump');

        // Nesting is recursive.
        const seal = model.elements.lookup('seal')!;
        expect(seal).toBeDefined();
        expect(shortNameOf(seal.owner)).toBe('valve');

        // The containment relationship is synthesized parent → child.
        const composes = model.relationships
            .filter(r => r.type === 'composes')
            .map(r => [shortNameOf(r.sourceId), shortNameOf(r.targetId)])
            .sort();
        expect(composes).toEqual([['pump', 'motor'], ['pump', 'valve'], ['valve', 'seal']].sort());
        const pumpValve = model.relationships.find(
            r => r.type === 'composes'
                && shortNameOf(r.sourceId) === 'pump' && shortNameOf(r.targetId) === 'valve');
        expect(pumpValve!.sourceEnd).toBe('parent');
        expect(pumpValve!.targetEnd).toBe('child');
    });

    it('leaves ownedPorts unset on a port that nests nothing', async () => {
        const doc = await parseDoc(`
            package TestPkg {
                port lone : SensorPort;
            }
        `);
        const model = buildMemoModel([doc], testConfig, [], testRegistries());

        expect(model.elements.lookup('lone')!.ownedPorts).toBeUndefined();
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
        expect(shortNameOf(rel.targetId)).toBe('innerIn');
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
        expect(shortNameOf(rel.targetId)).toBe('targetPort');
        expect(rel.targetEnd).toBe('payload');
    });

    // Port delegation is `bind`, not `flow`: the boundary port and the interior
    // port are the same feature, so a delegation runs `in` to `in` and SysIDE
    // rejects it as a flow. The grammar has carried BindingUsage for a while;
    // the builder had no case for it, so every `bind` parsed and then vanished
    // with no diagnostic — the same silent-drop failure the untyped flow had.
    it('builds a port delegation written as a binding', async () => {
        const doc = await parseDoc(`
            package TestPkg {
                port outerIn : SensorPort;
                port innerIn : SensorPort;
                bind outerIn = innerIn;
            }
        `);
        const model = buildMemoModel([doc], testConfig, [], testRegistries());

        expect(model.relationships).toHaveLength(1);
        const rel = model.relationships[0];
        expect(rel.type).toBe('bind');
        expect(shortNameOf(rel.sourceId)).toBe('outerIn');
        expect(shortNameOf(rel.targetId)).toBe('innerIn');
        expect(rel.flowItem).toBeUndefined();
    });

    it('resolves both binding endpoints through nested port paths', async () => {
        const doc = await parseDoc(`
            package TestPkg {
                port boundary : SensorPort {
                    port diagnostics : SensorPort;
                }
                port interior : SensorPort {
                    port statusOut : SensorPort;
                }
                bind interior.statusOut = boundary.diagnostics;
            }
        `);
        const model = buildMemoModel([doc], testConfig, [], testRegistries());

        expect(model.relationships).toHaveLength(1);
        const rel = model.relationships[0];
        expect(rel.type).toBe('bind');
        expect(shortNameOf(rel.sourceId)).toBe('statusOut');
        expect(shortNameOf(rel.targetId)).toBe('diagnostics');
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
        expect(shortNameOf(rel.sourceId)).toBe('sourcePort');
        expect(shortNameOf(rel.targetId)).toBe('targetPort');
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
        expect(shortNameOf(rel.sourceId)).toBe('sourcePort');
        expect(shortNameOf(rel.targetId)).toBe('targetPort');
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
        expect(shortNameOf(rel.sourceId)).toBe('supplierPort');
        expect(rel.sourceEnd).toBe('fuelSupply');
        expect(shortNameOf(rel.targetId)).toBe('consumerPort');
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
        // Qualified, like every other identity in the model: `fuelCommandFlow`
        // alone is a name scoped to `TestPkg`, not a key.
        expect(rel.id).toBe('TestPkg::fuelCommandFlow');
        expect(rel.shortName).toBe('fuelCommandFlow');
        expect(rel.named).toBe(true);
        expect(rel.flowItem).toBe('SensorReading');
        expect(shortNameOf(rel.sourceId)).toBe('sourcePort');
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
        expect(shortNameOf(rel.sourcePortId)).toBe('sensorOut');
        expect(shortNameOf(rel.targetPortId)).toBe('sensorIn');
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

describe('Nested state usages (state-transition composite states)', () => {
    it('extracts substates and native transitions nested inside a state usage', async () => {
        const doc = await parseDoc(`
            package TestPkg {
                state def Mode;
                state pumpModes : Mode {
                    state idle : Mode;
                    state infusing : Mode {
                        state priming : Mode;
                        state delivering : Mode;
                        transition tPrimed first priming then delivering;
                    }
                    transition tStart first idle then infusing;
                }
            }
        `);
        const model = buildMemoModel([doc], testConfig, [], testRegistries());

        // Every level of nesting became its own element — before this fix,
        // only the outermost state machine did, and idle/infusing/priming/
        // delivering/both transitions were silently dropped.
        for (const id of ['pumpModes', 'idle', 'infusing', 'priming', 'delivering', 'tStart', 'tPrimed']) {
            expect(model.elements.lookup(id), `missing element ${id}`).toBeDefined();
        }

        expect(shortNameOf(model.elements.lookup('idle')!.owner)).toBe('pumpModes');
        expect(shortNameOf(model.elements.lookup('infusing')!.owner)).toBe('pumpModes');
        expect(shortNameOf(model.elements.lookup('priming')!.owner)).toBe('infusing');
        expect(shortNameOf(model.elements.lookup('delivering')!.owner)).toBe('infusing');
        // A transition's owner is the state machine/state whose body declares
        // it, so `expose pumpModes::**` reaches it the same way it reaches a
        // substate.
        expect(shortNameOf(model.elements.lookup('tStart')!.owner)).toBe('pumpModes');
        expect(shortNameOf(model.elements.lookup('tPrimed')!.owner)).toBe('infusing');

        // The composedOf-equivalent edge the state-transition template's
        // composition tree renders nesting from — states only, not transitions.
        const composesFromInfusing = model.relationships.filter(
            r => r.type === 'composes' && shortNameOf(r.sourceId) === 'infusing');
        expect(composesFromInfusing.map(r => shortNameOf(r.targetId)).sort())
            .toEqual(['delivering', 'priming']);
    });
});

describe('View expose filters and recursive imports', () => {
    it('records a filter condition against the expose it is written on', async () => {
        const doc = await parseDoc(`
            package TestPkg {
                part def Block;
                port def Endpoint;
                part subsystem : Block {
                    part node : Block { out port nodePort : Endpoint; }
                    out port boundaryPort : Endpoint;
                }
                public import subsystem::**;
                view boundaryView {
                    expose subsystem;
                    expose subsystem::*[@SysML::PortUsage];
                }
            }
        `);
        const model = buildMemoModel([doc], testConfig, [], testRegistries());
        const view = model.elements.lookup('boundaryView');
        expect(view).toBeDefined();
        expect(view!.attributes['expose']).toBe('subsystem,subsystem::*');
        expect(view!.attributes['exposeFilter.0']).toBeUndefined();
        expect(view!.attributes['exposeFilter.1']).toBe('SysML::PortUsage');
        // The recursive import is not a model element and breaks nothing
        // around it: the nested part and its port still build.
        expect(shortNameOf(model.elements.lookup('node')!.owner)).toBe('subsystem');
        expect(shortNameOf(model.elements.lookup('boundaryPort')!.owner)).toBe('subsystem');
    });

    it('builds a model that imports a package recursively', async () => {
        const lib = await parseDoc(`
            package Outer {
                package Inner {
                    part def Deep;
                }
            }
        `, 'lib.sysml');
        const user = await parseDoc(`
            package User {
                private import Outer::**;
                part d : Deep;
            }
        `, 'user.sysml');
        const model = buildMemoModel([lib, user], testConfig, [], testRegistries());
        expect(model.elements.lookup('d')).toBeDefined();
        expect(model.errors.filter(e => /\*\*/.test(e.message ?? ''))).toEqual([]);
    });
});

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

        expect(model.elements.lookup('firmware')).toMatchObject({
            kind: 'FirmwareComponent',
            layer: 'implementation',
        });
        expect(model.elements.lookup('container')).toMatchObject({
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

        const el = model.elements.lookup('clinician')!;
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

        const el = model.elements.lookup('clinician')!;
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

        const el = model.elements.lookup('h1')!;
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

        const el = model.elements.lookup('h1')!;
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

        const el = model.elements.lookup('doSomething')!;
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
        expect(withRegistry.elements.lookup('haz1')?.layer).toBe('risk');
        expect(withoutRegistry.elements.lookup('haz1')?.layer).toBe('unknown');
    });
});

// ─── Qualified identity ─────────────────────────────────────────────────────
//
// An element's id is its qualified name. A short name is scoped to its owner,
// so it is not a key: two parts may each own a port called `scanSubscriber`,
// and keying on the short name made them one entry with the last one winning
// and nothing reported.

describe('qualified identity', () => {
    it('keeps two same-named features apart by their owners', async () => {
        const doc = await parseDoc(`
            package Robot {
                part nodeNavigation : Software { port scanSubscriber : Software; }
                part nodeSafetyMonitor : Software { port scanSubscriber : Software; }
            }
        `, 'model/robot.sysml');

        const model = buildMemoModel([doc], testConfig, [], testRegistries());

        // Two elements, not one. This is the ros-mobile-robot case: two ROS
        // nodes subscribing to the same topic name the port the same, which is
        // ordinary SysML and used to cost one of them its existence.
        expect(model.elements.has('Robot::nodeNavigation::scanSubscriber')).toBe(true);
        expect(model.elements.has('Robot::nodeSafetyMonitor::scanSubscriber')).toBe(true);

        // And each owner owns its own.
        expect(model.elements.lookup('nodeSafetyMonitor')!.ownedPorts)
            .toEqual(['Robot::nodeSafetyMonitor::scanSubscriber']);
    });

    it('resolves a dotted endpoint to the owner it names, not the first match', async () => {
        const doc = await parseDoc(`
            package Robot {
                part nodeNavigation : Software { port scanSubscriber : Software; }
                part nodeSafetyMonitor : Software { port scanSubscriber : Software; }
                connection connect nodeSafetyMonitor.scanSubscriber to nodeNavigation.scanSubscriber;
            }
        `, 'model/robot.sysml');

        const model = buildMemoModel([doc], testConfig, [], testRegistries());
        const edge = model.relationships.find(r => r.type === 'connect')!;

        // The edge the old resolver could not draw: it searched globally for
        // the leaf, found the wrong node's port, failed its own owner check
        // and stopped a segment short at the node.
        expect(edge.sourceId).toBe('Robot::nodeSafetyMonitor::scanSubscriber');
        expect(edge.targetId).toBe('Robot::nodeNavigation::scanSubscriber');
    });

    it('lets two packages declare the same name, and resolves each locally', async () => {
        const context = await parseDoc(
            `package ContextView { part clinician : Actor; part system : Software;
                                   connection connect clinician to system; }`,
            'model/context.sysml',
        );
        const sequence = await parseDoc(
            `package SequenceView { part clinician : Actor; }`,
            'model/sequence.sysml',
        );

        const model = buildMemoModel([context, sequence], testConfig, [], testRegistries());

        // Both survive — this is the sysml-diagram-samples case, where one
        // sample's actor used to delete another sample's.
        expect(model.elements.has('ContextView::clinician')).toBe(true);
        expect(model.elements.has('SequenceView::clinician')).toBe(true);

        // And a bare reference inside a package means that package's one.
        const edge = model.relationships.find(r => r.type === 'connect')!;
        expect(edge.sourceId).toBe('ContextView::clinician');
    });

    it('reports a reference no context can narrow to one element', async () => {
        const a = await parseDoc(`package A { part clinician : Actor; }`, 'model/a.sysml');
        const b = await parseDoc(`package B { part clinician : Actor; }`, 'model/b.sysml');
        const c = await parseDoc(
            `package C { part system : Software; connection connect clinician to system; }`,
            'model/c.sysml',
        );

        const model = buildMemoModel([a, b, c], testConfig, [], testRegistries());

        // Package C declares no `clinician`, so nothing decides which is meant.
        // Resolution stops rather than taking whichever was extracted first.
        const ambiguity = model.errors.find(e => e.message.includes("'clinician' names more than one"));
        expect(ambiguity).toBeTruthy();
        expect(ambiguity!.message).toContain('A::clinician');
        expect(ambiguity!.message).toContain('B::clinician');
        expect(model.relationships.some(r => r.type === 'connect')).toBe(false);
    });

    it('says nothing when one declaration reaches the index twice', async () => {
        const doc = await parseDoc(
            `package Plant { part pump : Software { part impeller : Software; } }`,
            'model/plant.sysml',
        );

        const model = buildMemoModel([doc], testConfig, [], testRegistries());

        // Nested extraction walks some declarations by more than one path.
        // Same file and same construct under the same qualified name is one
        // element arriving twice, not two competing for a key.
        expect(model.errors.filter(e => e.message.includes('Two elements are declared'))).toHaveLength(0);
    });
});

/**
 * A named flow is a referenceable identity, not only an edge.
 *
 * The architecture plan's §9.1 asks the model for "a single canonical identity
 * for a named flow/interface that can also serve as a relationship target",
 * without "a second authored proxy part". Before this, a named flow reached
 * the model as a `MemoRelationship` and nothing else: `allocate exDose to box`
 * resolved `exDose` to nothing, fell back to the bare reference, and produced
 * an allocation edge pointing at an id no element and no relationship held.
 */
describe('named relationship identity', () => {
    it('gives a named flow a qualified id and its declared short name', async () => {
        const doc = await parseDoc(`
            package Probe {
                action def Emit { out item p : Data; }
                action def Recv { in item q : Data; }
                action emit : Emit;
                action recv : Recv;
                flow exDose of Data from emit.p to recv.q;
            }
        `);
        const model = buildMemoModel([doc], testConfig, [], testRegistries());

        const flow = model.relationships.find(r => r.type === 'flow')!;
        expect(flow.id).toBe('Probe::exDose');
        expect(flow.shortName).toBe('exDose');
        // One record, not a record plus a proxy: the flow is an edge and is
        // not also an element, so nothing counting parts counts it as one.
        expect(model.elements.has('Probe::exDose')).toBe(false);
    });

    it('resolves an allocation onto a named flow to that flow', async () => {
        const doc = await parseDoc(`
            package Probe {
                action def Emit { out item p : Data; }
                action def Recv { in item q : Data; }
                part def Link;
                action emit : Emit;
                action recv : Recv;
                part linkCanBus : Link;
                flow exDose of Data from emit.p to recv.q;
                allocate exDose to linkCanBus;
            }
        `);
        const model = buildMemoModel([doc], testConfig, [], testRegistries());

        const allocation = model.relationships.find(r => r.type === 'allocatedTo')!;
        expect(allocation.sourceId).toBe('Probe::exDose');
        expect(allocation.targetId).toBe('Probe::linkCanBus');
    });

    it('keeps two identically named flows in different contexts apart', async () => {
        const doc = await parseDoc(`
            package DeviceA {
                action def Emit { out item p : Data; }
                action def Recv { in item q : Data; }
                part def Link;
                action emit : Emit;
                action recv : Recv;
                part link : Link;
                flow exDose of Data from emit.p to recv.q;
                allocate exDose to link;
            }
            package DeviceB {
                action def Emit { out item p : Data; }
                action def Recv { in item q : Data; }
                part def Link;
                action emit : Emit;
                action recv : Recv;
                part link : Link;
                flow exDose of Data from emit.p to recv.q;
                allocate exDose to link;
            }
        `);
        const model = buildMemoModel([doc], testConfig, [], testRegistries());

        const flows = model.relationships.filter(r => r.type === 'flow').map(r => r.id).sort();
        expect(flows).toEqual(['DeviceA::exDose', 'DeviceB::exDose']);

        // Each allocation stays inside the device it was written in. The bare
        // name made both of these one identity, so one of the two devices
        // allocated the other's exchange.
        const allocations = model.relationships
            .filter(r => r.type === 'allocatedTo')
            .map(r => `${r.sourceId} → ${r.targetId}`)
            .sort();
        expect(allocations).toEqual([
            'DeviceA::exDose → DeviceA::link',
            'DeviceB::exDose → DeviceB::link',
        ]);
    });

    it('lets a requirement and a connection reach an exchange', async () => {
        const doc = await parseDoc(`
            package Probe {
                action def Emit { out item p : Data; }
                action def Recv { in item q : Data; }
                action emit : Emit;
                action recv : Recv;
                requirement reqDoseAccuracy : SystemRequirement;
                part rcLimitRate : Software;
                flow exDose of Data from emit.p to recv.q;
                satisfy reqDoseAccuracy by exDose;
                connection connect rcLimitRate to exDose;
            }
        `);
        const model = buildMemoModel([doc], testConfig, [], testRegistries());

        // §12: a hazard, control or verification path that targets an exchange
        // still resolves. Every one of these runs through `resolveEndpointId`,
        // which is why one fallback there covers all of them.
        const satisfy = model.relationships.find(r => r.type === 'satisfiedBy')!;
        expect(satisfy.targetId).toBe('Probe::exDose');
        const control = model.relationships.find(r => r.type === 'connect')!;
        expect(control.targetId).toBe('Probe::exDose');
    });

    it('reports two relationships declared with one qualified name', async () => {
        const doc = await parseDoc(`
            package Probe {
                action def Emit { out item p : Data; }
                action def Recv { in item q : Data; }
                action emit : Emit;
                action recv : Recv;
                action other : Recv;
                flow exDose of Data from emit.p to recv.q;
                flow exDose of Data from emit.p to other.q;
            }
        `, 'model/probe.sysml');
        const model = buildMemoModel([doc], testConfig, [], testRegistries());

        // Both edges are facts about their endpoints and stay in the model;
        // what is contested is which one the name addresses.
        expect(model.relationships.filter(r => r.type === 'flow')).toHaveLength(2);
        const collision = model.errors.find(e => e.code === 'relationship-name-collision');
        expect(collision).toBeTruthy();
        expect(collision!.message).toContain('Probe::exDose');
    });
});
