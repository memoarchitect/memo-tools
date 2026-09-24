import { describe, it, expect } from 'vitest';
import { EmptyFileSystem, type LangiumDocument } from 'langium';
import { parseHelper } from 'langium/test';
import { createMemoSysMLServices } from '../language/memo-sysml-module.js';
import type { Model } from '../language/generated/ast.js';
import type { MEMOConfig } from '../model/config.js';
import { buildMemoModel, UNRESOLVED_INTERFACE_END } from '../model/builder.js';
import { KindRegistry } from '../model/kind-registry.js';
import type { ParsedDocument } from '../model/parser-utils.js';
import { relationshipSubjects } from '../model/relationship-subjects.js';
import { evaluateNativeConstraint } from '../validator/constraint-eval.js';

// ─── `interface x : T connect a to b` as an edge ─────────────────────────────
//
// The toolchain half of the architecture plan's §6.2, done before the shipped
// `ComponentExchange` changes, as §11 step 3 requires. It is the interface
// counterpart of native-flow-definition.test.ts.
//
// Before this, a typed interface usage with `connect` was extracted as an
// ELEMENT: its name and body survived, and both of its ends were dropped with
// no diagnostic. An interface between two ports that records neither port is
// the exact silent loss §9.1 forbids.
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
 * Two components with directed ports, one nested a level down as gpca-pump's
 * are (`gpcaDevice.gpcaSoftware.tlm.portTlmTlmModeOut`), a typed named
 * interface between them, and a functional exchange allocated to it — the
 * §6.3 mapping. The spelling is the one measured clean with
 * `syside check --diagnose all` on 2026-09-24: an interface def with no part
 * root, specializing an interface foundation that declares the two ends.
 */
const SOURCE = `
package P {
    port def CmdPort;
    part def Motor { in port pIn : CmdPort; }
    part def Device;
    abstract interface def Foundation { end source; end target; }
    interface def ComponentExchange specializes Foundation {
        attribute timingSemantics : String;
    }
    part sw { out port pOut : CmdPort; }
    part device : Device { part motor : Motor { in port pIn : CmdPort; } }
    interface exFlowCommand : ComponentExchange connect sw.pOut to device.motor.pIn {
        attribute :>> timingSemantics = "immediate";
    }
    action lfFlowCommand;
    allocate lfFlowCommand to exFlowCommand;
}
`;

function registryWith(name: string) {
    const registry = new KindRegistry();
    registry.register({ name, label: name, layer: 'logical', sysmlConstruct: 'interface def' });
    return registry;
}

describe('interface connect — ingestion', () => {
    it('builds an edge of native type `interface`, carrying its declared kind', async () => {
        const model = buildMemoModel([await parseDoc(SOURCE)], config);
        const interfaces = model.relationships.filter(r => r.type === 'interface');

        expect(interfaces).toHaveLength(1);
        expect(interfaces[0]).toMatchObject({
            id: 'P::exFlowCommand',
            shortName: 'exFlowCommand',
            type: 'interface',
            kind: 'ComponentExchange',
            named: true,
            attributes: { timingSemantics: 'immediate' },
        });
    });

    it('resolves both ends to the PORTS, through a nested path', async () => {
        const model = buildMemoModel([await parseDoc(SOURCE)], config);
        const edge = model.relationships.find(r => r.type === 'interface')!;

        expect(edge.sourceId).toBe('P::sw::pOut');
        expect(edge.targetId).toBe('P::device::motor::pIn');
        expect(edge.sourcePortId).toBe('P::sw::pOut');
        expect(edge.targetPortId).toBe('P::device::motor::pIn');
    });

    it('does NOT put the interface in the elements map', async () => {
        const model = buildMemoModel([await parseDoc(SOURCE)], config);
        expect(model.elements.get('P::exFlowCommand')).toBeUndefined();
        expect(model.elementsByKind.get('ComponentExchange') ?? []).toEqual([]);
    });

    it('is targetable: an allocation names it by its qualified id', async () => {
        const model = buildMemoModel([await parseDoc(SOURCE)], config);
        const allocation = model.relationships.find(r => r.type === 'allocatedTo');
        expect(allocation).toMatchObject({
            sourceId: 'P::lfFlowCommand',
            targetId: 'P::exFlowCommand',
        });
    });

    it('leaves an interface usage with no `connect` an element, as before', async () => {
        const model = buildMemoModel([await parseDoc(`
            package P {
                interface def Hl7Feed;
                interface ifHl7Feed : Hl7Feed;
            }
        `)], config);
        expect(model.elements.get('P::ifHl7Feed')).toMatchObject({ construct: 'interface' });
        expect(model.relationships.filter(r => r.type === 'interface')).toEqual([]);
    });

    it('reports an end that names nothing instead of dropping the interface silently', async () => {
        const model = buildMemoModel([await parseDoc(`
            package P {
                port def CmdPort;
                interface def ComponentExchange;
                part sw { out port pOut : CmdPort; }
                interface exBroken : ComponentExchange connect sw.pOut to nowhere.pIn;
            }
        `)], config);

        expect(model.relationships.filter(r => r.type === 'interface')).toEqual([]);
        const reported = model.errors.filter(e => e.code === UNRESOLVED_INTERFACE_END);
        expect(reported).toHaveLength(1);
        expect(reported[0].message).toContain("exBroken");
        expect(reported[0].message).toContain("target 'nowhere.pIn'");
        expect(reported[0].line).toBe(6);
    });
});

describe('interface connect — a rule reaches the edge and its ends', () => {
    const rule = (expression: string) => ({
        id: 'CR-TEST-002',
        description: 'a component exchange starts at a port',
        appliesToKind: 'ComponentExchange',
        expression,
        severity: 'error' as const,
    });

    it('projects the interface as a subject carrying its ends', async () => {
        const model = buildMemoModel([await parseDoc(SOURCE)], config);
        const [subject] = relationshipSubjects(model, registryWith('ComponentExchange'));

        expect(subject).toMatchObject({
            id: 'P::exFlowCommand',
            kind: 'ComponentExchange',
            construct: 'interface',
            attributes: {
                timingSemantics: 'immediate',
                sourceId: 'P::sw::pOut',
                targetId: 'P::device::motor::pIn',
            },
        });
    });

    // CR-ONT-072's question, asked of the edge. The shipped rule reads a
    // `sourceEndpoint` ref whose dotted value the builder cuts to its first
    // segment, so on gpca-pump it has been checking the device, not the port.
    it('checks what the edge really starts at', async () => {
        const model = buildMemoModel([await parseDoc(SOURCE)], config);
        const passes = evaluateNativeConstraint(
            rule("allOfKind('CmdPort')->exists(id == subject.attributes.sourceId)"),
            model, registryWith('ComponentExchange'));
        expect(passes).toEqual([]);

        const fails = evaluateNativeConstraint(
            rule("allOfKind('Motor')->exists(id == subject.attributes.sourceId)"),
            model, registryWith('ComponentExchange'));
        expect(fails).toHaveLength(1);
        expect(fails[0]).toMatchObject({ elementName: 'exFlowCommand', elementKind: 'ComponentExchange' });
    });

    it('does not let a body attribute move an end', async () => {
        const model = buildMemoModel([await parseDoc(`
            package P {
                port def CmdPort;
                interface def ComponentExchange;
                part a { out port o : CmdPort; }
                part b { in port i : CmdPort; }
                interface ex : ComponentExchange connect a.o to b.i {
                    attribute sourceId = "somewhere else";
                }
            }
        `)], config);
        const [subject] = relationshipSubjects(model, registryWith('ComponentExchange'));
        expect(subject.attributes.sourceId).toBe('P::a::o');
    });
});
