import { describe, it, expect } from 'vitest';
import { EmptyFileSystem, type LangiumDocument } from 'langium';
import { parseHelper } from 'langium/test';
import { createMemoSysMLServices } from '../language/memo-sysml-module.js';
import type { Model } from '../language/generated/ast.js';
import type { MEMOConfig } from '../model/config.js';
import { buildMemoModel } from '../model/builder.js';
import { KindRegistry } from '../model/kind-registry.js';
import type { ParsedDocument } from '../model/parser-utils.js';
import { shortNameOf } from '../model/element-index.js';
import { relationshipSubjects, withRelationshipSubjects } from '../model/relationship-subjects.js';
import { evaluateNativeConstraint } from '../validator/constraint-eval.js';

// ─── `flow def` and the typed flow usage ─────────────────────────────────────
//
// The ingestion and targeting half of the architecture plan's §6.1: a transfer
// declares its own contract as a `flow def`, and a named usage names it —
// `flow lfDose : FunctionalExchange from a.out to b.in`. Both spellings are
// the standard's (SysML-textual-bnf.kebnf:806 for the definition, :829/:837
// for the usage, whose FlowDeclaration opens with the same UsageDeclaration
// every other usage does, `: Type` and all).
//
// What this has to prove, beyond parsing, is that the edge is REACHABLE as a
// rule subject without becoming a part. A flow-def kind that rules cannot
// select on would leave every `appliesTo` scoped to it silently empty, which
// reports as a clean pass — the failure mode §9.1 of the plan is written
// against.
// ─────────────────────────────────────────────────────────────────────────────

const services = createMemoSysMLServices({ ...EmptyFileSystem }).MemoSysML;
const parse = parseHelper<Model>(services);
const config: MEMOConfig = { projectName: 'test' } as MEMOConfig;

async function parses(source: string): Promise<LangiumDocument<Model>> {
    const doc = await parse(source);
    const errors = [
        ...doc.parseResult.lexerErrors.map(e => e.message),
        ...doc.parseResult.parserErrors.map(e => e.message),
    ];
    expect(errors, `failed to parse:\n${source}`).toEqual([]);
    return doc;
}

async function parseDoc(source: string): Promise<ParsedDocument> {
    return { document: await parses(source), filePath: 'test.sysml' };
}

/**
 * One package holding a flow definition, two actions with directed
 * parameters, and a named typed flow between them.
 *
 * The ends are PARAMETERS, not the actions themselves — §6.1 asks for
 * "directed typed parameters, not source/target function names stored as
 * strings", and it is also what the compiler of record requires: a flow's
 * source must be an output.
 */
const SOURCE = `
package P {
    item def Dose;
    flow def FunctionalExchange {
        attribute latencyBudgetMs : Real;
        attribute integrityLevel : String;
    }
    action fnManageInfusion { out doseOut : Dose; }
    action fnCommandPump { in doseIn : Dose; }
    flow lfFlowCommand : FunctionalExchange of Dose
        from fnManageInfusion.doseOut to fnCommandPump.doseIn {
        attribute :>> latencyBudgetMs = 20.0;
        attribute :>> integrityLevel = "class C command path";
    }
}
`;

function registryWith(name: string) {
    const registry = new KindRegistry();
    registry.register({ name, label: name, layer: 'functional', sysmlConstruct: 'flow def' });
    return registry;
}

describe('flow def — grammar', () => {
    it('parses a flow definition with a body of attributes', async () => {
        await parses(`
            package P {
                flow def FunctionalExchange {
                    attribute latencyBudgetMs : Real;
                }
            }
        `);
    });

    it('parses a flow definition with a specialization and a short form', async () => {
        await parses(`
            package P {
                flow def Transfer;
                abstract flow def BaseTransfer;
                flow def Measurement specializes Transfer;
            }
        `);
    });

    // The two shapes the compiler of record accepts, measured 2026-09-21. A
    // CONCRETE flow def with no ends is `association-related-types` from
    // `syside check --diagnose all`, because a flow definition implicitly
    // specializes the association `Flows::MessageAction`. MEMO's own target
    // (§6.1) is the abstract one; the concrete one is here so the body rule
    // stays wide enough for the language, not only for MEMO's usage of it.
    it('parses a concrete flow definition declaring its two ends', async () => {
        await parses(`
            package P {
                item def Dose;
                flow def FunctionalExchange {
                    attribute latencyBudgetMs : Real;
                    end source : Dose;
                    end target : Dose;
                }
            }
        `);
    });

    // §6.4's payload contract. A typed flow says what it carries on its
    // DEFINITION, by redefining the inherited `payload`, and not with `of` on
    // the usage — see the grammar comment for the diagnostic that settles it.
    it('parses a flow definition redefining the inherited payload', async () => {
        await parses(`
            package P {
                item def Dose;
                abstract flow def FunctionalExchange {
                    ref :>> payload : Dose;
                    attribute latencyBudgetMs : Real;
                }
            }
        `);
    });

    it('parses a typed flow usage, with and without a payload', async () => {
        await parses(`
            package P {
                item def Dose;
                flow def FunctionalExchange;
                action a { out o : Dose; }
                action b { in i : Dose; }
                flow typedAndCarried : FunctionalExchange of Dose from a.o to b.i;
                flow typedOnly : FunctionalExchange from a.o to b.i;
                flow carriedOnly of Dose from a.o to b.i;
                flow from a.o to b.i;
            }
        `);
    });
});

describe('flow def — ingestion', () => {
    it('registers the definition as a kind declared `flow def`', async () => {
        const doc = await parses(SOURCE);
        const registry = new KindRegistry();
        registry.populateFromDocuments([{ document: doc, filePath: 'test.sysml' }]);

        const kind = registry.getKind('FunctionalExchange');
        expect(kind?.sysmlConstruct).toBe('flow def');
    });

    it('carries the declared type on the edge, keeping the edge a flow', async () => {
        const model = buildMemoModel([await parseDoc(SOURCE)], config);
        const flows = model.relationships.filter(r => r.type === 'flow');
        expect(flows).toHaveLength(1);
        expect(flows[0]).toMatchObject({
            type: 'flow',
            kind: 'FunctionalExchange',
            shortName: 'lfFlowCommand',
            named: true,
            flowItem: 'Dose',
        });
        expect(shortNameOf(flows[0].sourceId)).toBe('fnManageInfusion');
        expect(flows[0].sourceEnd).toBe('doseOut');
        expect(shortNameOf(flows[0].targetId)).toBe('fnCommandPump');
        expect(flows[0].targetEnd).toBe('doseIn');
    });

    it('keeps the body attributes on the edge', async () => {
        const model = buildMemoModel([await parseDoc(SOURCE)], config);
        const flow = model.relationships.find(r => r.type === 'flow')!;
        expect(flow.attributes).toMatchObject({
            latencyBudgetMs: '20.0',
            integrityLevel: 'class C command path',
        });
    });

    // A normative FlowEnd may open with a qualified name
    // (SysML-textual-bnf.kebnf:867). gpca-pump's LF-004 starts at the
    // clinician's activity in the operational package, and a dotted-only end
    // made that a parse error here while `syside check` accepted it.
    it('resolves a flow end qualified by another package', async () => {
        const model = buildMemoModel([
            await parseDoc(`
                package Ops {
                    item def Rx;
                    action oaProgram { out rxOut : Rx; }
                }
            `),
            await parseDoc(`
                package Fn {
                    private import Ops::*;
                    abstract flow def FunctionalExchange;
                    action fnValidate { in rxIn : Rx; }
                    flow lfEntry : FunctionalExchange
                        from Ops::oaProgram.rxOut to fnValidate.rxIn;
                }
            `),
        ], config);
        const flow = model.relationships.find(r => r.type === 'flow');
        expect(flow).toMatchObject({ shortName: 'lfEntry', sourceEnd: 'rxOut', targetEnd: 'rxIn' });
        expect(flow!.sourceId).toBe('Ops::oaProgram');
        expect(shortNameOf(flow!.targetId)).toBe('fnValidate');
    });

    it('does NOT put the flow in the elements map', async () => {
        const model = buildMemoModel([await parseDoc(SOURCE)], config);
        const usages = [...model.elements.values()].filter(e => !e.isDefinition);
        expect(usages.map(e => shortNameOf(e.id))).not.toContain('lfFlowCommand');
        expect(model.elementsByKind.get('FunctionalExchange') ?? []).toEqual([]);
    });
});

describe('flow def — the read-only subject projection', () => {
    it('projects a named typed flow as a subject of its declared kind', async () => {
        const model = buildMemoModel([await parseDoc(SOURCE)], config);
        const subjects = relationshipSubjects(model, registryWith('FunctionalExchange'));

        expect(subjects).toHaveLength(1);
        expect(subjects[0]).toMatchObject({
            kind: 'FunctionalExchange',
            construct: 'flow',
            layer: 'functional',
            name: 'lfFlowCommand',
            shortName: 'lfFlowCommand',
            attributes: { latencyBudgetMs: '20.0' },
        });
        // The subject IS the edge's identity, not a copy under a new id.
        expect(subjects[0].id).toBe(model.relationships.find(r => r.type === 'flow')!.id);
    });

    it('projects nothing for an anonymous or untyped flow', async () => {
        const model = buildMemoModel([await parseDoc(`
            package P {
                item def Dose;
                flow def FunctionalExchange;
                action a { out o : Dose; }
                action b { in i : Dose; }
                flow of Dose from a.o to b.i;
                flow named of Dose from a.o to b.i;
            }
        `)], config);
        expect(relationshipSubjects(model, registryWith('FunctionalExchange'))).toEqual([]);
    });

    it('leaves the canonical elements index untouched', async () => {
        const model = buildMemoModel([await parseDoc(SOURCE)], config);
        const projected = withRelationshipSubjects(model, registryWith('FunctionalExchange'));

        expect(projected.elements).toBe(model.elements);
        expect(projected.elementsByKind.get('FunctionalExchange')).toHaveLength(1);
        expect(model.elementsByKind.get('FunctionalExchange') ?? []).toEqual([]);
    });
});

describe('flow def — a rule reaches the edge', () => {
    const rule = (expression: string) => ({
        id: 'CR-TEST-001',
        description: 'every functional exchange declares a latency budget',
        appliesToKind: 'FunctionalExchange',
        expression,
        severity: 'error' as const,
    });

    it('evaluates a kind-scoped rule against the flow and passes', async () => {
        const model = buildMemoModel([await parseDoc(SOURCE)], config);
        const violations = evaluateNativeConstraint(
            rule('latencyBudgetMs != ""'), model, registryWith('FunctionalExchange'));
        expect(violations).toEqual([]);
    });

    it('reports the flow BY NAME when the rule fails', async () => {
        const model = buildMemoModel([await parseDoc(SOURCE)], config);
        const violations = evaluateNativeConstraint(
            rule('integrityLevel == "class B"'), model, registryWith('FunctionalExchange'));

        expect(violations).toHaveLength(1);
        expect(violations[0]).toMatchObject({
            elementKind: 'FunctionalExchange',
            elementName: 'lfFlowCommand',
            layer: 'functional',
        });
    });

    it('had NO subjects at all before the projection — the silent pass', async () => {
        const model = buildMemoModel([await parseDoc(SOURCE)], config);
        // Same rule, same model, evaluated against the unprojected extent.
        expect(model.elementsByKind.get('FunctionalExchange') ?? []).toEqual([]);
    });
});

// ─── A flow between the item features two ports declare ──────────────────────
//
// `LogicalExchange` is authored this way (connected-patient-monitor): the
// payload is an item feature on each port that SUBSETS the coded measurement,
// `out item spo2 :> spo2Item;`. The grammar took only `=` on an item usage, so
// each port's body failed to parse and the port went with it. The flow still
// built, which is how it went unnoticed.
describe('flow def — ends on port item features', () => {
    const PORTS = `
        package P {
            item def Measurement;
            port def LogicalPort;
            abstract flow def LogicalExchange { attribute contentKind : String; }
            item spo2Item : Measurement;
            part lcMonitor { out port pSpo2Out : LogicalPort { out item spo2 :> spo2Item; } }
            part lcGateway { in port pSpo2In : LogicalPort { in item spo2 :> spo2Item; } }
            flow exSpo2ToGateway : LogicalExchange from lcMonitor.pSpo2Out.spo2 to lcGateway.pSpo2In.spo2 {
                attribute :>> contentKind = "measurement";
            }
        }`;

    it('parses the subsetting item and keeps both ports', async () => {
        const model = buildMemoModel([await parseDoc(PORTS)], config);
        const out = model.elements.get('P::lcMonitor::pSpo2Out');
        const inn = model.elements.get('P::lcGateway::pSpo2In');
        expect(out?.parameters).toEqual([{ name: 'spo2', direction: 'out', type: 'spo2Item' }]);
        expect(inn?.parameters).toEqual([{ name: 'spo2', direction: 'in', type: 'spo2Item' }]);
    });

    it('ends the flow on the ports, with the item feature as the end', async () => {
        const model = buildMemoModel([await parseDoc(PORTS)], config);
        const [flow] = model.relationships.filter(r => r.type === 'flow');
        expect(flow).toMatchObject({
            id: 'P::exSpo2ToGateway',
            kind: 'LogicalExchange',
            sourceId: 'P::lcMonitor::pSpo2Out',
            sourceEnd: 'spo2',
            targetId: 'P::lcGateway::pSpo2In',
            targetEnd: 'spo2',
            attributes: { contentKind: 'measurement' },
        });
    });
});
