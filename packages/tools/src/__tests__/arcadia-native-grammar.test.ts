import { describe, it, expect } from 'vitest';
import { EmptyFileSystem, type LangiumDocument } from 'langium';
import { parseHelper } from 'langium/test';
import { createMemoSysMLServices } from '../language/memo-sysml-module.js';
import type { Model } from '../language/generated/ast.js';
import type { MEMOConfig } from '../model/config.js';
import { buildMemoModel } from '../model/builder.js';
import type { ParsedDocument } from '../model/parser-utils.js';
import type { MemoRelationship } from '../model/semantic.js';

// ─── The fourteen ARCADIA-mechanism productions (plan §8, Track B) ───────────
//
// Every mechanism ARCADIA names and SysML v2 already spells with a keyword, and
// which MEMO had no production for. Each case below is written the way the
// normative BNF and the vendored training files write it, so a passing test is
// evidence the grammar accepts the LANGUAGE's spelling and not a MEMO dialect
// of it. `syside check` remains the compiler of record; this only proves MEMO
// stops rejecting source SysIDE accepts.
// ─────────────────────────────────────────────────────────────────────────────

const services = createMemoSysMLServices({ ...EmptyFileSystem }).MemoSysML;
const parse = parseHelper<Model>(services);

const config: MEMOConfig = { projectName: 'test' } as MEMOConfig;

async function parseDoc(source: string): Promise<ParsedDocument> {
    return { document: await parses(source), filePath: 'test.sysml' };
}

/** The facts a trace edge is: type, ends, direction. Ids are positional. */
function edge(rel: MemoRelationship) {
    return {
        type: rel.type,
        sourceId: rel.sourceId,
        sourceEnd: rel.sourceEnd,
        targetId: rel.targetId,
        targetEnd: rel.targetEnd,
    };
}

async function edgesOf(source: string) {
    return buildMemoModel([await parseDoc(source)], config).relationships.map(edge);
}

async function elementsOf(source: string) {
    const elements = [...buildMemoModel([await parseDoc(source)], config).elements.values()];
    return elements.map(({ id, kind, name, construct, attributes }) => ({ id, kind, name, construct, attributes }));
}

async function parses(source: string): Promise<LangiumDocument<Model>> {
    const doc = await parse(source);
    const errors = [
        ...doc.parseResult.lexerErrors.map(e => e.message),
        ...doc.parseResult.parserErrors.map(e => e.message),
    ];
    expect(errors, `failed to parse:\n${source}`).toEqual([]);
    return doc;
}

describe('ARCADIA native mechanisms — grammar', () => {
    it('perform: an owner performs a referenced action', async () => {
        await parses(`
            package P {
                part actorPrescriber {
                    perform oaPrescribe;
                    perform action takePhoto references takePicture;
                }
            }
        `);
    });

    it('include: a use case includes a sub-case', async () => {
        await parses(`
            package P {
                use case provideTransportation {
                    include addFuel;
                    include use case enterVehicle : EnterVehicle { subject vehicle; }
                }
            }
        `);
    });

    it('exhibit: a component exhibits a state', async () => {
        await parses(`
            package P {
                part vehicle {
                    exhibit vehicleStates;
                    exhibit state degraded : ModeState;
                }
            }
        `);
    });

    it('allocation def and the typed allocation usage', async () => {
        const doc = await parses(`
            package P {
                allocation def LogicalToPhysical :> Allocations::Allocation {
                    end logicalElement :>> source;
                    end physicalElement :>> target;
                }
                allocation torqueGenAlloc : LogicalToPhysical allocate torqueGenerator to powerTrain;
                allocate bare to alsoStillWorks;
            }
        `);
        const pkg: any = doc.parseResult.value.members[0];
        expect(pkg.members[0].$type).toBe('AllocationDefinition');
        expect(pkg.members[1].$type).toBe('AllocateUsage');
        expect(pkg.members[1].name).toBe('torqueGenAlloc');
        // The bare form keeps parsing: session 1's `allocate a to b;` is the
        // same statement without a name, and both must stay writable.
        expect(pkg.members[2].name).toBeUndefined();
    });

    it('subject and objective: the standard verification shape', async () => {
        // Verbatim from the normative "34. Verification" training file, which
        // is the file the plan says these two productions are what makes parse.
        await parses(`
            package P {
                verification def VehicleMassTest {
                    subject testVehicle : Vehicle;
                    objective vehicleMassVerificationObjective {
                        verify vehicleMassRequirement;
                    }
                }
                verification vehicleMassTest : VehicleMassTest {
                    subject testVehicle :> vehicleTestConfig;
                }
            }
        `);
    });

    it('actor, stakeholder, concern, frame', async () => {
        await parses(`
            package P {
                concern def Maintainability;
                use case def ProvideTransportation {
                    subject vehicle : Vehicle;
                    actor driver : Person;
                    actor passengers : Person[0..4];
                }
                viewpoint def LogicalViewpoint {
                    stakeholder architect : Stakeholder;
                    frame maintainability;
                    frame concern safety : Maintainability;
                }
            }
        `);
    });

    it('dependency, with and without a #refinement prefix', async () => {
        const doc = await parses(`
            package P {
                dependency from computerSubsystem to softwareDesign;
                dependency Schemata from storageSubsystem to messageSchema, dataSchema;
                dependency plain to alsoValid;
                #refinement dependency fnAcquire to utMonitorPatient;
            }
        `);
        const pkg: any = doc.parseResult.value.members[0];
        expect(pkg.members.map((m: any) => m.$type))
            .toEqual(['Dependency', 'Dependency', 'Dependency', 'Dependency']);
        expect(pkg.members[1].name).toBe('Schemata');
        expect(pkg.members[1].suppliers).toEqual(['messageSchema', 'dataSchema']);
        expect(pkg.members[3].prefixMetadata[0].type).toBe('refinement');
    });

    it('transition: named and unnamed, with trigger, guard and effect', async () => {
        const doc = await parses(`
            package P {
                state def VehicleStates {
                    transition initial then off;
                    transition offToStarting
                        first off
                        accept VehicleStartSignal
                        if brakePedalDepressed
                        do sendControllerStart
                        then starting;
                }
            }
        `);
        const sdef: any = (doc.parseResult.value.members[0] as any).members[0];
        expect(sdef.body[0].name).toBeUndefined();
        expect(sdef.body[0].source).toBe('initial');
        expect(sdef.body[0].target).toBe('off');
        expect(sdef.body[1].name).toBe('offToStarting');
        expect(sdef.body[1].trigger).toBe('VehicleStartSignal');
        expect(sdef.body[1].effect).toBe('sendControllerStart');
    });

    it('variation and variant: a choice point and its alternatives', async () => {
        const doc = await parses(`
            package P {
                variation part def EngineChoices :> Engine {
                    variant fourCylEngine;
                    variant sixCylEngine;
                }
                variation attribute def DiameterChoices :> Diameter {
                    variant attribute diameterSmall = 70;
                }
                part vehicleFamily : Vehicle {
                    variation part transmission : Transmission[1] {
                        variant part manual : ManualTransmission;
                        variant automatic;
                    }
                }
            }
        `);
        const pkg: any = doc.parseResult.value.members[0];
        expect(pkg.members[0].isVariation).toBe(true);
        expect(pkg.members[0].body[0].$type).toBe('VariantMember');
        expect(pkg.members[0].body[0].name).toBe('fourCylEngine');
        expect(pkg.members[2].body[0].isVariation).toBe(true);
    });

    it('leaves the words free where they are not keywords', async () => {
        // A keyword that swallowed these words as identifiers would break
        // existing content silently. `state`/`action`/`part` are already
        // handled this way; the fourteen must not regress it.
        await parses(`
            package P {
                part def Thing {
                    attribute performCount : Integer;
                    attribute actorName : String;
                }
            }
        `);
    });
});

// ─── Builder: both spellings produce the same trace edge ────────────────────
//
// The property that makes the migration reversible one file at a time. A test
// that only proved "the native syntax parses" would let the two spellings drift
// into two different graphs — which is precisely the failure the byte-identical
// DHF acceptance gate is meant to catch, and which it would catch far too late.

describe('ARCADIA native mechanisms — builder projection', () => {
    it('perform matches the Performs connection', async () => {
        const native = await edgesOf(`
            package Test {
                action oaPrescribe : OperationalActivity;
                part actorPrescriber : User { perform oaPrescribe; }
            }
        `);
        const connection = await edgesOf(`
            package Test {
                action oaPrescribe : OperationalActivity;
                part actorPrescriber : User;
                connection : Performs connect performer ::> actorPrescriber to performed ::> oaPrescribe;
            }
        `);
        expect(native).toEqual(connection);
        expect(native).toEqual([{
            type: 'performs',
            sourceId: 'actorPrescriber', sourceEnd: 'performer',
            targetId: 'oaPrescribe', targetEnd: 'performed',
        }]);
    });

    it('include matches the IncludesStep connection', async () => {
        const native = await edgesOf(`
            package Test {
                action fcsBolusSense : FunctionalFlowStep;
                action fcPatientBolus : FunctionalFlow { include fcsBolusSense; }
            }
        `);
        const connection = await edgesOf(`
            package Test {
                action fcsBolusSense : FunctionalFlowStep;
                action fcPatientBolus : FunctionalFlow;
                connection : IncludesStep connect functionalFlow ::> fcPatientBolus to step ::> fcsBolusSense;
            }
        `);
        expect(native).toEqual(connection);
    });

    it('exhibit matches the ExhibitsMode connection', async () => {
        const native = await edgesOf(`
            package Test {
                part lmDegraded : LogicalMode;
                part lcPump : LogicalComponent { exhibit lmDegraded; }
            }
        `);
        const connection = await edgesOf(`
            package Test {
                part lmDegraded : LogicalMode;
                part lcPump : LogicalComponent;
                connection : ExhibitsMode connect component ::> lcPump to mode ::> lmDegraded;
            }
        `);
        expect(native).toEqual(connection);
    });

    it('frame matches the FramesConcern connection', async () => {
        const native = await edgesOf(`
            package Test {
                concern cnSafety : Concern;
                view vpLogical : Viewpoint { frame cnSafety; }
            }
        `);
        const connection = await edgesOf(`
            package Test {
                concern cnSafety : Concern;
                view vpLogical : Viewpoint;
                connection : FramesConcern connect framingViewpoint ::> vpLogical to framedConcern ::> cnSafety;
            }
        `);
        expect(native).toEqual(connection);
    });

    it('a case subject matches the VerifiedBy connection', async () => {
        // The remodel memo-native-requirement-relations decision 1 needs: 61 of
        // 99 VerifiedBy links target something native `verify` cannot take, and
        // the standard's answer is to make it the case's subject instead.
        const native = await edgesOf(`
            package Test {
                action fnComputeRate : SystemFunction;
                verification vcRate : VerificationCase { subject verified :> fnComputeRate; }
            }
        `);
        const connection = await edgesOf(`
            package Test {
                action fnComputeRate : SystemFunction;
                verification vcRate : VerificationCase;
                connection : VerifiedBy connect verificationTarget ::> fnComputeRate to verificationCase ::> vcRate;
            }
        `);
        expect(native).toEqual(connection);
    });

    it('an objective does not capture the verifying case', async () => {
        // `objective` is a membership, not an element. If it captured ownership
        // the `verify` inside would bind to a wrapper that is not an extracted
        // element and the edge would vanish — silently, and for the whole model.
        const wrapped = await edgesOf(`
            package Test {
                requirement reqMass : SystemRequirement;
                verification massTest : MassTest {
                    objective massObjective { verify reqMass; }
                }
            }
        `);
        expect(wrapped).toEqual([{
            type: 'verifiedBy',
            sourceId: 'reqMass', sourceEnd: 'verificationTarget',
            targetId: 'massTest', targetEnd: 'verificationCase',
        }]);
    });

    it('#refinement dependency matches the Realizes connection', async () => {
        const native = await edgesOf(`
            package Test {
                part swModule : SoftwareModule;
                part lcPump : LogicalComponent;
                #refinement dependency swModule to lcPump;
            }
        `);
        const connection = await edgesOf(`
            package Test {
                part swModule : SoftwareModule;
                part lcPump : LogicalComponent;
                connection : Realizes connect realizing ::> swModule to realized ::> lcPump;
            }
        `);
        expect(native).toEqual(connection);
    });

    it('a bare dependency claims no realization', async () => {
        // A dependency without #refinement means strictly less than Realizes.
        // Inferring one would put a claim in the traceability matrix that the
        // model never made.
        expect(await edgesOf(`
            package Test {
                part a : SoftwareModule;
                part b : LogicalComponent;
                dependency from a to b;
            }
        `)).toEqual([]);
    });

    it('one dependency with several suppliers lowers to several edges', async () => {
        const edges = await edgesOf(`
            package Test {
                part a : SoftwareModule;
                part b : LogicalComponent;
                part c : LogicalComponent;
                #refinement dependency Schemata from a to b, c;
            }
        `);
        expect(edges.map(e => [e.sourceId, e.targetId])).toEqual([['a', 'b'], ['a', 'c']]);
    });

    it('actor, stakeholder and concern declare the same elements part does', async () => {
        const native = await elementsOf(`
            package Test {
                actor usrClinician : User { attribute :>> name = "Clinician"; }
                stakeholder shRegulator : Stakeholder;
                concern cnUsability : Concern;
            }
        `);
        const parts = await elementsOf(`
            package Test {
                part usrClinician : User { attribute :>> name = "Clinician"; }
                part shRegulator : Stakeholder;
                part cnUsability : Concern;
            }
        `);
        // Only the CONSTRUCT differs — which is the whole content of the
        // change. Id, kind, name and attributes must all survive it.
        expect(native.map(({ construct, ...rest }) => rest))
            .toEqual(parts.map(({ construct, ...rest }) => rest));
        expect(native.map(e => e.construct)).toEqual(['actor', 'stakeholder', 'concern']);
    });

    it('a native transition resolves the states its part def could only name', async () => {
        const model = buildMemoModel([await parseDoc(`
            package Test {
                state idle : ModeState;
                state infusing : ModeState;
                state pumpModes : StateMachine {
                    transition tStart : Transition first idle accept startInfusion then infusing;
                }
            }
        `)], config);
        const transition = [...model.elements.values()].find(e => e.id === 'tStart')!;
        expect(transition.construct).toBe('transition');
        expect(transition.kind).toBe('Transition');
        // The part def spells these as Strings holding DISPLAY names, so
        // nothing can follow them. Here they are the ids of real states.
        expect(transition.attributes.sourceState).toBe('idle');
        expect(transition.attributes.targetState).toBe('infusing');
        expect(transition.attributes.trigger).toBe('startInfusion');
    });

    it('an anonymous transition declares no element', async () => {
        const model = buildMemoModel([await parseDoc(`
            package Test {
                state pumpModes : StateMachine { transition idle then infusing; }
            }
        `)], config);
        expect([...model.elements.values()].map(e => e.id)).toEqual(['pumpModes']);
    });
});
