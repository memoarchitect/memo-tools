import { describe, it, expect } from 'vitest';
import { EmptyFileSystem } from 'langium';
import { parseHelper } from 'langium/test';
import { createMemoSysMLServices } from '../language/memo-sysml-module.js';
import type { Model } from '../language/generated/ast.js';
import type { MEMOConfig } from '../model/config.js';
import { buildMemoModel } from '../model/builder.js';
import { validateBehavior } from '../validator/behavior-validator.js';
import type { ParsedDocument } from '../model/parser-utils.js';

const services = createMemoSysMLServices({ ...EmptyFileSystem }).MemoSysML;
const parse = parseHelper<Model>(services);

async function parseDoc(source: string, filePath: string = 'test.sysml'): Promise<ParsedDocument> {
    const doc = await parse(source);
    return { document: doc, filePath };
}

/** Minimal config for behavior testing */
const behaviorConfig: MEMOConfig = {
    projectName: 'test-behavior',
    projectType: 'device',
    kinds: {
        Subsystem: { label: 'Subsystem', layer: 'logical', sysmlConstruct: 'part def' },
        SystemFunction: { label: 'System Function', layer: 'functional', sysmlConstruct: 'action def' },
    },
    relationshipTypes: [
        { name: 'allocateTo', label: 'Allocate To', layer: 'functional', color: '#E67E22' },
        { name: 'flow', label: 'Flow', layer: 'behavior', color: '#3498DB' },
        { name: 'succession', label: 'Succession', layer: 'behavior', color: '#95A5A6' },
    ],
};

// ─── Grammar Parsing Tests ─────────────────────────────────────────────────

describe('Behavior grammar: item def', () => {
    it('parses item def with empty body', async () => {
        const doc = await parse(`
            package Test {
                item def PrescriptionData;
            }
        `);
        expect(doc.parseResult.lexerErrors).toHaveLength(0);
        expect(doc.parseResult.parserErrors).toHaveLength(0);
    });

    it('parses item def with body', async () => {
        const doc = await parse(`
            package Test {
                item def WaterFlowRate {
                    attribute rate : Real;
                }
            }
        `);
        expect(doc.parseResult.parserErrors).toHaveLength(0);
    });
});

describe('Behavior grammar: action def with parameters', () => {
    it('accepts operator and function behavior keywords', async () => {
        const doc = await parse(`
            package Behaviors {
                operator def PreparePatient;
                function def RegulateFlow;
                operator preparePatient : PreparePatient;
                function regulateFlow : RegulateFlow;
            }
        `);
        expect(doc.parseResult.parserErrors).toHaveLength(0);
        const model = buildMemoModel([{ document: doc, filePath: 'behaviors.sysml' }], behaviorConfig);
        expect(model.elements.get('preparePatient')?.kind).toBe('OperatorUsage');
        expect(model.elements.get('regulateFlow')?.kind).toBe('FunctionUsage');
    });

    it('parses action def with out parameter', async () => {
        const doc = await parse(`
            package Test {
                action def ReceivePrescription {
                    out prescription : PrescriptionData;
                }
            }
        `);
        expect(doc.parseResult.parserErrors).toHaveLength(0);
    });

    it('parses action def with in and out parameters', async () => {
        const doc = await parse(`
            package Test {
                action def ValidatePrescription {
                    in prescription : PrescriptionData;
                    out validatedOrder : InfusionOrder;
                    out validationError : ErrorCode;
                }
            }
        `);
        expect(doc.parseResult.parserErrors).toHaveLength(0);
    });

    it('parses action def with inout parameter', async () => {
        const doc = await parse(`
            package Test {
                action def ProcessData {
                    inout buffer : DataBuffer;
                }
            }
        `);
        expect(doc.parseResult.parserErrors).toHaveLength(0);
    });

    it('parses empty action def', async () => {
        const doc = await parse(`
            package Test {
                action def SimpleAction;
            }
        `);
        expect(doc.parseResult.parserErrors).toHaveLength(0);
    });
});

describe('Behavior grammar: composite action usage', () => {
    it('parses action usage without type (composite action)', async () => {
        const doc = await parse(`
            package Test {
                action performInfusion {
                    action receive : ReceivePrescription;
                    action validate : ValidatePrescription;
                }
            }
        `);
        expect(doc.parseResult.parserErrors).toHaveLength(0);
    });

    it('parses typed action usage (existing syntax)', async () => {
        const doc = await parse(`
            package Test {
                action myFunc : SystemFunction;
            }
        `);
        expect(doc.parseResult.parserErrors).toHaveLength(0);
    });
});

describe('Behavior grammar: flow connection usage', () => {
    it('parses flow of item between action ports', async () => {
        const doc = await parse(`
            package Test {
                action performInfusion {
                    action receive : ReceivePrescription;
                    action validate : ValidatePrescription;
                    flow of PrescriptionData from receive.prescription to validate.prescription;
                }
            }
        `);
        expect(doc.parseResult.parserErrors).toHaveLength(0);
    });

    it('parses multiple flows', async () => {
        const doc = await parse(`
            package Test {
                action cycle {
                    action sense : SenseMoisture;
                    action evaluate : EvaluateNeed;
                    action activate : ActivatePump;
                    flow of MoistureReading from sense.moistureLevel to evaluate.moistureLevel;
                    flow of IrrigationCommand from evaluate.decision to activate.command;
                }
            }
        `);
        expect(doc.parseResult.parserErrors).toHaveLength(0);
    });
});

describe('Behavior grammar: succession usage', () => {
    it('parses succession with start and done', async () => {
        const doc = await parse(`
            package Test {
                action performInfusion {
                    action receive : ReceivePrescription;
                    action validate : ValidatePrescription;
                    first start then receive then validate then done;
                }
            }
        `);
        expect(doc.parseResult.parserErrors).toHaveLength(0);
    });

    it('parses multiple succession chains', async () => {
        const doc = await parse(`
            package Test {
                action cycle {
                    action sense : SenseMoisture;
                    action fetch : FetchWeather;
                    action evaluate : EvaluateNeed;
                    first start then sense;
                    first start then fetch;
                    first sense then evaluate;
                    first fetch then evaluate;
                }
            }
        `);
        expect(doc.parseResult.parserErrors).toHaveLength(0);
    });
});

describe('Behavior grammar: allocate usage', () => {
    it('parses allocate statement', async () => {
        const doc = await parse(`
            package Test {
                action validate : ValidateAction;
                part sw : Subsystem;
                allocate validate to sw;
            }
        `);
        expect(doc.parseResult.parserErrors).toHaveLength(0);
    });

    it('parses multiple allocate statements', async () => {
        const doc = await parse(`
            package Test {
                action validate : ValidateAction;
                action deliver : DeliverAction;
                part sw : Subsystem;
                part hw : Subsystem;
                allocate validate to sw;
                allocate deliver to hw;
            }
        `);
        expect(doc.parseResult.parserErrors).toHaveLength(0);
    });
});

describe('Behavior grammar: fork/join control nodes', () => {
    it('parses fork and join inside an action, wired by successions', async () => {
        const doc = await parse(`
            package Test {
                action prepare {
                    action verify : VerifyAction;
                    fork splitPrep;
                    action primePump : PrimeAction;
                    action selfTest : TestAction;
                    join syncPrep;
                    action program : ProgramAction;

                    first start then verify;
                    first verify then splitPrep;
                    first splitPrep then primePump;
                    first splitPrep then selfTest;
                    first primePump then syncPrep;
                    first selfTest then syncPrep;
                    first syncPrep then program;
                    first program then done;
                }
            }
        `);
        expect(doc.parseResult.lexerErrors).toHaveLength(0);
        expect(doc.parseResult.parserErrors).toHaveLength(0);
    });
});

// ─── Full Example Parsing ──────────────────────────────────────────────────

describe('Behavior grammar: full infusion pump example', () => {
    it('parses the complete infusion pump behavior model', async () => {
        const doc = await parse(`
            package InfusionPump_Behavior {
                import InfusionPump::*;

                action def ReceivePrescription {
                    out prescription : PrescriptionData;
                }

                action def ValidatePrescription {
                    in prescription : PrescriptionData;
                    out validatedOrder : InfusionOrder;
                    out validationError : ErrorCode;
                }

                action def PreparePump {
                    in order : InfusionOrder;
                    out pumpReady : ReadySignal;
                }

                action def DeliverInfusion {
                    in pumpReady : ReadySignal;
                    in order : InfusionOrder;
                    out infusionStatus : StatusReport;
                }

                action def MonitorPatient {
                    in infusionStatus : StatusReport;
                    out vitalSigns : PatientVitals;
                    out alarm : AlarmSignal;
                }

                action def HandleAlarm {
                    in alarm : AlarmSignal;
                    out response : ClinicalResponse;
                }

                action performInfusion {
                    action receive : ReceivePrescription;
                    action validate : ValidatePrescription;
                    action prepare : PreparePump;
                    action deliver : DeliverInfusion;
                    action monitor : MonitorPatient;
                    action handleAlarm : HandleAlarm;

                    flow of PrescriptionData from receive.prescription to validate.prescription;
                    flow of InfusionOrder from validate.validatedOrder to prepare.order;
                    flow of InfusionOrder from validate.validatedOrder to deliver.order;
                    flow of ReadySignal from prepare.pumpReady to deliver.pumpReady;
                    flow of StatusReport from deliver.infusionStatus to monitor.infusionStatus;
                    flow of AlarmSignal from monitor.alarm to handleAlarm.alarm;

                    first start then receive then validate then prepare then deliver then done;
                    first deliver then monitor;
                    first monitor then handleAlarm;
                }

                allocate validate to SoftwareSubsystem;
                allocate prepare to PumpMechanism;
                allocate deliver to PumpMechanism;
                allocate monitor to SensorSubsystem;
                allocate handleAlarm to SoftwareSubsystem;
            }
        `);
        expect(doc.parseResult.lexerErrors).toHaveLength(0);
        expect(doc.parseResult.parserErrors).toHaveLength(0);
    });
});

// ─── Model Building Tests ──────────────────────────────────────────────────

describe('Behavior builder: action definitions', () => {
    it('extracts action definition as MemoElement with parameters', async () => {
        const doc = await parseDoc(`
            package Test {
                action def ValidatePrescription {
                    in prescription : PrescriptionData;
                    out validatedOrder : InfusionOrder;
                    out validationError : ErrorCode;
                }
            }
        `);
        const model = buildMemoModel([doc], behaviorConfig);
        const el = model.elements.get('ValidatePrescription');
        expect(el).toBeDefined();
        expect(el!.kind).toBe('ActionDefinition');
        expect(el!.construct).toBe('action');
        expect(el!.layer).toBe('behavior');
        expect(el!.parameters).toHaveLength(3);
        expect(el!.parameters![0]).toEqual({ name: 'prescription', direction: 'in', type: 'PrescriptionData' });
        expect(el!.parameters![1]).toEqual({ name: 'validatedOrder', direction: 'out', type: 'InfusionOrder' });
        expect(el!.parameters![2]).toEqual({ name: 'validationError', direction: 'out', type: 'ErrorCode' });
    });

    it('extracts action def without parameters', async () => {
        const doc = await parseDoc(`
            package Test {
                action def SimpleAction;
            }
        `);
        const model = buildMemoModel([doc], behaviorConfig);
        const el = model.elements.get('SimpleAction');
        expect(el).toBeDefined();
        expect(el!.kind).toBe('ActionDefinition');
        expect(el!.parameters).toBeUndefined();
    });
});

describe('Behavior builder: item definitions', () => {
    it('extracts item definition as MemoElement', async () => {
        const doc = await parseDoc(`
            package Test {
                item def PrescriptionData;
                item def InfusionOrder;
            }
        `);
        const model = buildMemoModel([doc], behaviorConfig);
        expect(model.elements.get('PrescriptionData')).toBeDefined();
        expect(model.elements.get('PrescriptionData')!.kind).toBe('ItemDefinition');
        expect(model.elements.get('PrescriptionData')!.construct).toBe('item');
        expect(model.elements.get('PrescriptionData')!.layer).toBe('behavior');
        expect(model.elements.get('InfusionOrder')).toBeDefined();
    });
});

describe('Behavior builder: composite action usage', () => {
    it('extracts composite action and nested actions', async () => {
        const doc = await parseDoc(`
            package Test {
                action def ReceivePrescription {
                    out prescription : PrescriptionData;
                }
                action def ValidatePrescription {
                    in prescription : PrescriptionData;
                    out validatedOrder : InfusionOrder;
                }
                action performInfusion {
                    action receive : ReceivePrescription;
                    action validate : ValidatePrescription;
                }
            }
        `);
        const model = buildMemoModel([doc], behaviorConfig);

        // Composite action
        const composite = model.elements.get('performInfusion');
        expect(composite).toBeDefined();
        expect(composite!.kind).toBe('ActionUsage');
        expect(composite!.construct).toBe('action');

        // Nested actions
        const receive = model.elements.get('receive');
        expect(receive).toBeDefined();
        expect(receive!.parentAction).toBe('performInfusion');

        const validate = model.elements.get('validate');
        expect(validate).toBeDefined();
        expect(validate!.parentAction).toBe('performInfusion');
    });

    it('extracts typed action usage with config kind', async () => {
        const doc = await parseDoc(`
            package Test {
                action myFunc : SystemFunction;
            }
        `);
        const model = buildMemoModel([doc], behaviorConfig);
        const el = model.elements.get('myFunc');
        expect(el).toBeDefined();
        expect(el!.kind).toBe('SystemFunction');
        expect(el!.layer).toBe('functional');
    });
});

describe('Behavior builder: fork/join control nodes', () => {
    it('extracts fork/join as behavior-layer elements and wires successions through them', async () => {
        const doc = await parseDoc(`
            package Test {
                action prepare {
                    action verify : VerifyAction;
                    fork splitPrep;
                    action primePump : PrimeAction;
                    action selfTest : TestAction;
                    join syncPrep;

                    first verify then splitPrep;
                    first splitPrep then primePump;
                    first splitPrep then selfTest;
                    first primePump then syncPrep;
                    first selfTest then syncPrep;
                }
            }
        `);
        const model = buildMemoModel([doc], behaviorConfig);

        // Control nodes become behavior-layer action-construct elements
        const fork = model.elements.get('splitPrep');
        expect(fork).toBeDefined();
        expect(fork!.kind).toBe('ForkNode');
        expect(fork!.construct).toBe('action');
        expect(fork!.layer).toBe('behavior');
        expect(fork!.attributes['controlKind']).toBe('fork');
        expect(fork!.parentAction).toBe('prepare');

        const join = model.elements.get('syncPrep');
        expect(join).toBeDefined();
        expect(join!.kind).toBe('JoinNode');
        expect(join!.attributes['controlKind']).toBe('join');

        // Successions reference the control nodes by id
        const succ = model.relationships.filter(r => r.type === 'succession');
        expect(succ).toContainEqual(expect.objectContaining({ sourceId: 'splitPrep', targetId: 'primePump' }));
        expect(succ).toContainEqual(expect.objectContaining({ sourceId: 'splitPrep', targetId: 'selfTest' }));
        expect(succ).toContainEqual(expect.objectContaining({ sourceId: 'primePump', targetId: 'syncPrep' }));
        expect(succ).toContainEqual(expect.objectContaining({ sourceId: 'selfTest', targetId: 'syncPrep' }));
    });
});

describe('Behavior builder: flow connections', () => {
    it('creates flow relationships between nested actions', async () => {
        const doc = await parseDoc(`
            package Test {
                action def ReceivePrescription {
                    out prescription : PrescriptionData;
                }
                action def ValidatePrescription {
                    in prescription : PrescriptionData;
                    out validatedOrder : InfusionOrder;
                }
                action performInfusion {
                    action receive : ReceivePrescription;
                    action validate : ValidatePrescription;
                    flow of PrescriptionData from receive.prescription to validate.prescription;
                }
            }
        `);
        const model = buildMemoModel([doc], behaviorConfig);

        const flowRels = model.relationships.filter(r => r.type === 'flow');
        expect(flowRels).toHaveLength(1);
        expect(flowRels[0].sourceId).toBe('receive');
        expect(flowRels[0].sourceEnd).toBe('prescription');
        expect(flowRels[0].targetId).toBe('validate');
        expect(flowRels[0].targetEnd).toBe('prescription');
        expect(flowRels[0].flowItem).toBe('PrescriptionData');
    });

    it('creates multiple flow relationships', async () => {
        const doc = await parseDoc(`
            package Test {
                action def A { out x : TypeX; }
                action def B { in x : TypeX; out y : TypeY; }
                action def C { in y : TypeY; }
                action process {
                    action a : A;
                    action b : B;
                    action c : C;
                    flow of TypeX from a.x to b.x;
                    flow of TypeY from b.y to c.y;
                }
            }
        `);
        const model = buildMemoModel([doc], behaviorConfig);
        const flowRels = model.relationships.filter(r => r.type === 'flow');
        expect(flowRels).toHaveLength(2);
    });
});

describe('Behavior builder: successions', () => {
    it('creates succession relationships from chain', async () => {
        const doc = await parseDoc(`
            package Test {
                action def A { out x : TypeX; }
                action def B { in x : TypeX; }
                action process {
                    action a : A;
                    action b : B;
                    first start then a then b then done;
                }
            }
        `);
        const model = buildMemoModel([doc], behaviorConfig);

        const succRels = model.relationships.filter(r => r.type === 'succession');
        // start→a, a→b, b→done = 3 succession relationships
        expect(succRels).toHaveLength(3);

        // start→a
        expect(succRels[0].sourceId).toBe('process__start');
        expect(succRels[0].targetId).toBe('a');

        // a→b
        expect(succRels[1].sourceId).toBe('a');
        expect(succRels[1].targetId).toBe('b');

        // b→done
        expect(succRels[2].sourceId).toBe('b');
        expect(succRels[2].targetId).toBe('process__done');
    });

    it('creates successions for parallel branches', async () => {
        const doc = await parseDoc(`
            package Test {
                action def A { out x : TypeX; }
                action def B { out y : TypeY; }
                action def C { in x : TypeX; in y : TypeY; }
                action process {
                    action a : A;
                    action b : B;
                    action c : C;
                    first start then a;
                    first start then b;
                    first a then c;
                    first b then c;
                }
            }
        `);
        const model = buildMemoModel([doc], behaviorConfig);
        const succRels = model.relationships.filter(r => r.type === 'succession');
        // start→a, start→b, a→c, b→c = 4
        expect(succRels).toHaveLength(4);
    });
});

describe('Behavior builder: allocations', () => {
    it('creates allocateTo relationships', async () => {
        const doc = await parseDoc(`
            package Test {
                action validate : SystemFunction;
                part sw : Subsystem;
                allocate validate to sw;
            }
        `);
        const model = buildMemoModel([doc], behaviorConfig);

        const allocRels = model.relationships.filter(r => r.type === 'allocateTo');
        expect(allocRels).toHaveLength(1);
        expect(allocRels[0].sourceId).toBe('validate');
        expect(allocRels[0].targetId).toBe('sw');
    });

    it('sets allocatedTo on the source element', async () => {
        const doc = await parseDoc(`
            package Test {
                action validate : SystemFunction;
                part sw : Subsystem;
                allocate validate to sw;
            }
        `);
        const model = buildMemoModel([doc], behaviorConfig);
        const el = model.elements.get('validate');
        expect(el).toBeDefined();
        expect(el!.allocatedTo).toBe('sw');
    });

    it('creates multiple allocation relationships', async () => {
        const doc = await parseDoc(`
            package Test {
                action validate : SystemFunction;
                action deliver : SystemFunction;
                part sw : Subsystem;
                part hw : Subsystem;
                allocate validate to sw;
                allocate deliver to hw;
            }
        `);
        const model = buildMemoModel([doc], behaviorConfig);
        const allocRels = model.relationships.filter(r => r.type === 'allocateTo');
        expect(allocRels).toHaveLength(2);
    });
});

// ─── Index Tests ───────────────────────────────────────────────────────────

describe('Behavior builder: model indexes', () => {
    it('indexes behavior elements by kind', async () => {
        const doc = await parseDoc(`
            package Test {
                item def PrescriptionData;
                action def ReceivePrescription {
                    out prescription : PrescriptionData;
                }
                action performInfusion {
                    action receive : ReceivePrescription;
                }
            }
        `);
        const model = buildMemoModel([doc], behaviorConfig);

        expect(model.elementsByKind.get('ItemDefinition')).toHaveLength(1);
        expect(model.elementsByKind.get('ActionDefinition')).toHaveLength(1);
        expect(model.elementsByKind.get('ActionUsage')).toHaveLength(2); // performInfusion + receive
    });

    it('indexes behavior elements by layer', async () => {
        const doc = await parseDoc(`
            package Test {
                item def PrescriptionData;
                action def ReceivePrescription {
                    out prescription : PrescriptionData;
                }
                action performInfusion {
                    action receive : ReceivePrescription;
                }
            }
        `);
        const model = buildMemoModel([doc], behaviorConfig);
        const behaviorElements = model.elementsByLayer.get('behavior') || [];
        expect(behaviorElements.length).toBeGreaterThanOrEqual(3);
    });

    it('indexes flow and succession relationships by type', async () => {
        const doc = await parseDoc(`
            package Test {
                action def A { out x : TypeX; }
                action def B { in x : TypeX; }
                action process {
                    action a : A;
                    action b : B;
                    flow of TypeX from a.x to b.x;
                    first start then a then b then done;
                }
            }
        `);
        const model = buildMemoModel([doc], behaviorConfig);
        expect(model.relationshipsByType.get('flow')).toHaveLength(1);
        expect(model.relationshipsByType.get('succession')).toHaveLength(3);
    });
});

// ─── Behavior Validation Tests ──────────────────────────────────────────────

describe('Behavior validation', () => {
    it('BV-001: warns on unallocated action usage', async () => {
        const doc = await parseDoc(`
            package Test {
                action def DoWork { out result : Data; }
                action process {
                    action work : DoWork;
                }
            }
        `);
        const model = buildMemoModel([doc], behaviorConfig);
        const violations = validateBehavior(model);
        const bv001 = violations.filter(v => v.ruleId === 'BV-001');
        expect(bv001.length).toBeGreaterThan(0);
        expect(bv001[0].description).toContain('not allocated');
    });

    it('BV-001: no warning when action is allocated', async () => {
        const doc = await parseDoc(`
            package Test {
                part sw : Subsystem;
                action work : SystemFunction;
                allocate work to sw;
            }
        `);
        const model = buildMemoModel([doc], behaviorConfig);
        const workEl = model.elements.get('work');
        expect(workEl?.allocatedTo).toBe('sw');
        const violations = validateBehavior(model);
        const bv001 = violations.filter(v => v.ruleId === 'BV-001' && v.elementName === 'work');
        expect(bv001).toHaveLength(0);
    });

    it('BV-001/BV-002: composite actions with nested steps are exempt', async () => {
        const doc = await parseDoc(`
            package Test {
                part sw : Subsystem;
                action def DoWork { out result : Data; }
                action process {
                    action work : DoWork;
                    first start then work then done;
                }
                allocate work to sw;
            }
        `);
        const model = buildMemoModel([doc], behaviorConfig);
        const violations = validateBehavior(model);
        // 'process' is allocated and connected through its nested step
        const wrapper = violations.filter(v => v.elementName === 'process');
        expect(wrapper).toHaveLength(0);
    });

    it('BV-002: warns on orphan action (no flow/succession)', async () => {
        const doc = await parseDoc(`
            package Test {
                action def A { out x : X; }
                action def B { in x : X; }
                action def Orphan;
                action process {
                    action a : A;
                    action b : B;
                    action orphan : Orphan;
                    flow of X from a.x to b.x;
                    first start then a then b then done;
                }
            }
        `);
        const model = buildMemoModel([doc], behaviorConfig);
        const violations = validateBehavior(model);
        const bv002 = violations.filter(v => v.ruleId === 'BV-002');
        // 'orphan' has no flow or succession connections
        const orphanViolation = bv002.find(v => v.elementName === 'orphan');
        expect(orphanViolation).toBeDefined();
    });

    it('BV-002: no warning when action has flow connections', async () => {
        const doc = await parseDoc(`
            package Test {
                action def A { out x : X; }
                action def B { in x : X; }
                action process {
                    action a : A;
                    action b : B;
                    flow of X from a.x to b.x;
                    first start then a then b then done;
                }
            }
        `);
        const model = buildMemoModel([doc], behaviorConfig);
        const violations = validateBehavior(model);
        const bv002 = violations.filter(v => v.ruleId === 'BV-002');
        // a and b both have flow connections, should not be flagged
        const aOrB = bv002.filter(v => v.elementName === 'a' || v.elementName === 'b');
        expect(aOrB).toHaveLength(0);
    });

    it('BV-003: errors on incompatible flow type', async () => {
        const doc = await parseDoc(`
            package Test {
                action def Sender { out msg : MessageType; }
                action def Receiver { in data : DifferentType; }
                action process {
                    action send : Sender;
                    action recv : Receiver;
                    flow of MessageType from send.msg to recv.data;
                    first start then send then recv then done;
                }
            }
        `);
        const model = buildMemoModel([doc], behaviorConfig);
        const violations = validateBehavior(model);
        const bv003 = violations.filter(v => v.ruleId === 'BV-003');
        // Receiver has no 'in' param of type MessageType → error
        expect(bv003.length).toBeGreaterThan(0);
        expect(bv003[0].severity).toBe('error');
    });

    it('BV-003: no error when flow types match', async () => {
        const doc = await parseDoc(`
            package Test {
                action def Sender { out msg : DataType; }
                action def Receiver { in msg : DataType; }
                action process {
                    action send : Sender;
                    action recv : Receiver;
                    flow of DataType from send.msg to recv.msg;
                }
            }
        `);
        const model = buildMemoModel([doc], behaviorConfig);
        const violations = validateBehavior(model);
        const bv003 = violations.filter(v => v.ruleId === 'BV-003');
        expect(bv003).toHaveLength(0);
    });
});
