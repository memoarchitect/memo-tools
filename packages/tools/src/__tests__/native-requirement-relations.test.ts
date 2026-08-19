// ─── Language-native requirement relations ───────────────────────────────────
//
// SysML v2 already spells requirement traceability: `satisfy`, `verify`,
// `allocate`. MEMO spells the same three as `connection def`s. Until the
// migration finishes both are authored, and the property under test is that
// nothing downstream can tell them apart — same relationship type, same ends,
// same direction. A test that only checked "native syntax parses" would let the
// two spellings drift into two different graphs, which is the failure that
// makes a migration unreviewable.
// ─────────────────────────────────────────────────────────────────────────────

import { describe, it, expect } from 'vitest';
import { EmptyFileSystem } from 'langium';
import { parseHelper } from 'langium/test';
import { createMemoSysMLServices } from '../language/memo-sysml-module.js';
import type { Model } from '../language/generated/ast.js';
import type { MEMOConfig } from '../model/config.js';
import { buildMemoModel } from '../model/builder.js';
import { RelationshipRegistry } from '../model/relationship-registry.js';
import type { ParsedDocument } from '../model/parser-utils.js';
import type { MemoRelationship } from '../model/semantic.js';

const services = createMemoSysMLServices({ ...EmptyFileSystem }).MemoSysML;
const parse = parseHelper<Model>(services);

const config: MEMOConfig = { projectName: 'test' } as MEMOConfig;

async function parseDoc(source: string): Promise<ParsedDocument> {
    const doc = await parse(source);
    const errors = [...doc.parseResult.lexerErrors, ...doc.parseResult.parserErrors];
    expect(errors.map(error => error.message)).toEqual([]);
    return { document: doc, filePath: 'test.sysml' };
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
    const model = buildMemoModel([await parseDoc(source)], config);
    return model.relationships.map(edge);
}

describe('grammar: the native spellings parse', () => {
    it('accepts a satisfy in a design-context part, as the training files write it', async () => {
        // "32. Requirements/Requirement Satisfaction.sysml", reduced.
        await parseDoc(`
            package Test {
                part vehicleDesignContext {
                    ref vehicleDesign : Vehicle;
                    satisfy vehicleSpecification by vehicleDesign;
                    satisfy engineSpecification by vehicleDesign.engine;
                }
            }
        `);
    });

    it('accepts a satisfy as a package member', async () => {
        await parseDoc(`package Test { satisfy req by comp; }`);
    });

    it('accepts the assertion prefix, negated or not', async () => {
        await parseDoc(`
            package Test {
                assert satisfy reqA by compA;
                assert not satisfy reqB by compB;
            }
        `);
    });

    it('accepts a verify in a verification case body', async () => {
        await parseDoc(`
            package Test {
                verification def MassTest { verify massRequirement; }
                verification massTest : MassTest { verify massRequirement; }
            }
        `);
    });

    it('reserves satisfy and verify, as the normative BNF does', async () => {
        // RESERVED_KEYWORD (SysML-textual-bnf.kebnf:13) lists both. A model that
        // named an action `verify` was never conforming; it only parsed because
        // MEMO had no production for the keyword.
        const doc = await parse(`package Test { action verify : SomeAction; }`);
        expect(doc.parseResult.parserErrors.length).toBeGreaterThan(0);
    });
});

describe('builder: both spellings produce the same trace edge', () => {
    it('satisfy matches the SatisfiedBy connection', async () => {
        const native = await edgesOf(`
            package Test {
                requirement reqRate : SystemRequirement;
                part fnRate : Software;
                satisfy reqRate by fnRate;
            }
        `);
        const connection = await edgesOf(`
            package Test {
                requirement reqRate : SystemRequirement;
                part fnRate : Software;
                connection : SatisfiedBy connect requiredElement ::> reqRate to satisfyingElement ::> fnRate;
            }
        `);

        expect(native).toEqual(connection);
        expect(native).toEqual([{
            type: 'satisfiedBy',
            sourceId: 'reqRate', sourceEnd: 'requiredElement',
            targetId: 'fnRate', targetEnd: 'satisfyingElement',
        }]);
    });

    it('allocate matches the AllocatedTo connection', async () => {
        const native = await edgesOf(`
            package Test {
                action deliver : DeliverAction;
                part pump : Software;
                allocate deliver to pump;
            }
        `);
        const connection = await edgesOf(`
            package Test {
                action deliver : DeliverAction;
                part pump : Software;
                connection : AllocatedTo connect function ::> deliver to allocatedElement ::> pump;
            }
        `);

        expect(native).toEqual(connection);
        expect(native).toEqual([{
            type: 'allocatedTo',
            sourceId: 'deliver', sourceEnd: 'function',
            targetId: 'pump', targetEnd: 'allocatedElement',
        }]);
    });

    it('verify takes its case from the owner, matching the VerifiedBy connection', async () => {
        const native = await edgesOf(`
            package Test {
                requirement reqMass : SystemRequirement;
                verification massTest : MassTest { verify reqMass; }
            }
        `);
        const connection = await edgesOf(`
            package Test {
                requirement reqMass : SystemRequirement;
                verification massTest : MassTest;
                connection : VerifiedBy connect verificationTarget ::> reqMass to verificationCase ::> massTest;
            }
        `);

        expect(native).toEqual(connection);
        expect(native).toEqual([{
            type: 'verifiedBy',
            sourceId: 'reqMass', sourceEnd: 'verificationTarget',
            targetId: 'massTest', targetEnd: 'verificationCase',
        }]);
    });

    it('resolves a satisfy written inside a design-context part body', async () => {
        // The satisfies are not package members here — they are members of the
        // context part, which is where the standard puts them.
        expect(await edgesOf(`
            package Test {
                requirement reqRate : SystemRequirement;
                part fnRate : Software;
                part designContext {
                    satisfy reqRate by fnRate;
                }
            }
        `)).toEqual([{
            type: 'satisfiedBy',
            sourceId: 'reqRate', sourceEnd: 'requiredElement',
            targetId: 'fnRate', targetEnd: 'satisfyingElement',
        }]);
    });

    it('does not read a negated satisfy as coverage', async () => {
        // `assert not satisfy` is a design review's rejection. Emitting a
        // satisfiedBy edge for it would put the rejection in the traceability
        // matrix as a satisfied requirement.
        expect(await edgesOf(`
            package Test {
                requirement reqRate : SystemRequirement;
                part fnRate : Software;
                assert not satisfy reqRate by fnRate;
            }
        `)).toEqual([]);
    });

    it('treats an unresolved end exactly as the connection path does', async () => {
        // Both spellings keep the written reference when nothing in the model
        // answers to it. Whether that is the right policy is a separate
        // question — what matters here is that it is one policy, not two.
        expect(await edgesOf(`package Test { satisfy nobody by nothing; }`))
            .toEqual(await edgesOf(
                `package Test { connection : SatisfiedBy connect requiredElement ::> nobody to satisfyingElement ::> nothing; }`));
    });
});

describe('registry: the natives are registered as usages, not connection defs', () => {
    async function registryFrom(source: string): Promise<RelationshipRegistry> {
        const registry = new RelationshipRegistry();
        registry.populateFromDocuments([await parseDoc(source)]);
        return registry;
    }

    it('registers all three even when the ontology declares no connection def', async () => {
        const registry = await registryFrom(`package Empty { }`);
        for (const name of ['satisfiedBy', 'verifiedBy', 'allocatedTo']) {
            const entry = registry.getRelType(name);
            expect(entry, name).toBeDefined();
            expect(entry!.ends).toHaveLength(2);
        }
        expect(registry.getRelType('satisfiedBy')!.nativeKeyword).toBe('satisfy');
        expect(registry.getRelType('verifiedBy')!.nativeKeyword).toBe('verify');
        expect(registry.getRelType('allocatedTo')!.nativeKeyword).toBe('allocate');
    });

    it('keeps the ontology definition and only stamps it with its keyword', async () => {
        const registry = await registryFrom(`
            package memo_core_relationships {
                connection def SatisfiedBy {
                    doc /* The ontology's own wording. */
                    end requiredElement : MemoRequirementElement;
                    end satisfyingElement : MemoPart;
                }
            }
        `);

        const entry = registry.getRelType('satisfiedBy')!;
        expect(entry.description).toBe("The ontology's own wording.");
        expect(entry.nativeKeyword).toBe('satisfy');
        expect(entry.ends.map(end => end.type))
            .toEqual(['MemoRequirementElement', 'MemoPart']);
    });

    it('carries the keyword through to the client DTO', async () => {
        const registry = await registryFrom(`package Empty { }`);
        const dtos = registry.toDefinitionDTOs();
        const native = dtos.filter(dto => dto.nativeKeyword);
        // Session 1 registered three; the ARCADIA plan's Track B added five
        // more (`perform`, `include`, `exhibit`, `frame`, and the refinement
        // `dependency`); R10-S6 added `actor` (`participatesIn`) collapsing
        // `ParticipatesIn`/`Initiates`, and the generic `dependency` edge
        // collapsing `ModuleUses`/`MonitorsChannel` (a bare `dependency` built
        // to nothing before this — the same silent-drop shape `expose` had).
        // The assertion is the whole set rather than a containment check, so
        // a keyword added without a builder projection — which would
        // serialize as a connection and silently diverge — fails here rather
        // than in a traceability matrix months later.
        expect(native.map(dto => dto.name).sort())
            .toEqual([
                // `composes` joined this set when R10-S7 deleted the
                // connection def: its native spelling is nesting, and the
                // builder synthesizes the edge from every nested part and item.
                'allocatedTo', 'composes', 'dependency', 'exhibitsMode',
                'framesConcern', 'includesStep', 'participatesIn', 'performs',
                'realizes', 'satisfiedBy', 'verifiedBy',
            ]);
    });
});
