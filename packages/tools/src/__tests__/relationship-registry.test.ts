import { describe, it, expect, beforeAll } from 'vitest';
import { resolve, join } from 'node:path';
import { readdirSync, readFileSync } from 'node:fs';
import { resolveContentPackageRoot } from '../model/paths.js';
import { RelationshipRegistry, pascalToCamelCase } from '../model/relationship-registry.js';
import { parseFiles, parseText } from '../model/parser-utils.js';

function getSysmlFiles(dir: string): string[] {
    const files: string[] = [];
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (entry.isDirectory()) {
            files.push(...getSysmlFiles(join(dir, entry.name)));
        } else if (entry.name.endsWith('.sysml') && entry.name !== 'index.sysml') {
            files.push(join(dir, entry.name));
        }
    }
    return files;
}

// ─── PascalCase → camelCase Tests ───────────────────────────────────────────

describe('pascalToCamelCase', () => {
    it('converts PascalCase to camelCase', () => {
        expect(pascalToCamelCase('Mitigates')).toBe('mitigates');
        expect(pascalToCamelCase('TraceTo')).toBe('traceTo');
        expect(pascalToCamelCase('HasSubProcedure')).toBe('hasSubProcedure');
        expect(pascalToCamelCase('Aggregation')).toBe('aggregation');
    });

    it('handles single character', () => {
        expect(pascalToCamelCase('A')).toBe('a');
    });

    it('handles empty string', () => {
        expect(pascalToCamelCase('')).toBe('');
    });

    it('handles already camelCase', () => {
        expect(pascalToCamelCase('mitigates')).toBe('mitigates');
    });
});

// ─── RelationshipRegistry Unit Tests ────────────────────────────────────────

describe('RelationshipRegistry', () => {
    it('registers and retrieves relationship types', () => {
        const registry = new RelationshipRegistry();
        registry.register({
            sysmlName: 'Mitigates',
            name: 'mitigates',
            label: 'Mitigates',
            layer: 'crosscutting',
            ends: [
                { name: 'mitigation', type: 'Mitigation' },
                { name: 'risk', type: 'Risk' },
            ],
        });

        expect(registry.has('mitigates')).toBe(true);
        expect(registry.size).toBe(1);

        const rel = registry.getRelType('mitigates');
        expect(rel).toBeDefined();
        expect(rel!.sysmlName).toBe('Mitigates');
        expect(rel!.layer).toBe('crosscutting');
        expect(rel!.ends).toHaveLength(2);
    });

    it('returns undefined for unknown relationship types', () => {
        const registry = new RelationshipRegistry();
        expect(registry.getRelType('nonExistent')).toBeUndefined();
        expect(registry.has('nonExistent')).toBe(false);
    });

    it('converts to RelationshipType for backward compat', () => {
        const registry = new RelationshipRegistry();
        registry.register({
            sysmlName: 'Mitigates',
            name: 'mitigates',
            label: 'Mitigates',
            layer: 'crosscutting',
            ends: [],
        });

        const relType = registry.toRelationshipType('mitigates');
        expect(relType).toEqual({
            name: 'mitigates',
            label: 'Mitigates',
            layer: 'crosscutting',
            color: '',
        });
    });

    it('converts to relationship types array', () => {
        const registry = new RelationshipRegistry();
        registry.register({ sysmlName: 'A', name: 'a', label: 'A', layer: 'l1', ends: [] });
        registry.register({ sysmlName: 'B', name: 'b', label: 'B', layer: 'l2', ends: [] });

        const arr = registry.toRelationshipTypesArray();
        expect(arr).toHaveLength(2);
        expect(arr[0].name).toBe('a');
        expect(arr[1].name).toBe('b');
    });

    it('lists relationship type names', () => {
        const registry = new RelationshipRegistry();
        registry.register({ sysmlName: 'X', name: 'x', label: 'X', layer: 'l', ends: [] });
        registry.register({ sysmlName: 'Y', name: 'y', label: 'Y', layer: 'l', ends: [] });

        expect(registry.relTypeNames()).toContain('x');
        expect(registry.relTypeNames()).toContain('y');
    });
});

// ─── Structural properties read from ontology source ────────────────────────
//
// isReflexive / isUnique are ontology facts, not engine policy: these confirm
// they survive the parse, inherit down the specialization chain, and stay
// undefined when the ontology declares a slot without stating a value.

describe('RelationshipRegistry structural properties', () => {
    /** Populate a registry from SysML source text. */
    async function registryFrom(source: string): Promise<RelationshipRegistry> {
        const { document, errors } = await parseText(source);
        expect(errors).toEqual([]);
        const registry = new RelationshipRegistry();
        registry.populateFromDocuments([{ document, filePath: 'src/core/relationships/test.sysml' }]);
        return registry;
    }

    const ontology = `
package memo_core_relationships {
    abstract connection def MemoRelationship {
        attribute isReflexive : Boolean;
        attribute isUnique : Boolean;
    }
    connection def Composes :> MemoRelationship {
        end parent : MemoPart;
        end child : MemoPart;
    }
    connection def TracesTo :> MemoRelationship {
        attribute :>> isReflexive = true;
        end tracingElement : MemoPart;
        end tracedElement : MemoPart;
    }
    connection def Annotates :> MemoRelationship {
        attribute :>> isUnique = false;
        end annotating : MemoPart;
        end annotated : MemoPart;
    }
}
`;

    it('leaves a declared-but-unvalued attribute undefined', async () => {
        const registry = await registryFrom(ontology);
        // The base declares the slots; it states no values.
        expect(registry.getRelType('memoRelationship')!.isReflexive).toBeUndefined();
        expect(registry.getRelType('memoRelationship')!.isUnique).toBeUndefined();
    });

    it('reads a redefined Boolean value from the ontology', async () => {
        const registry = await registryFrom(ontology);
        expect(registry.getRelType('tracesTo')!.isReflexive).toBe(true);
        expect(registry.getRelType('annotates')!.isUnique).toBe(false);
    });

    it('carries the values into the DTO the client reasons over', async () => {
        const registry = await registryFrom(ontology);
        const dtos = registry.toDefinitionDTOs();
        expect(dtos.find(d => d.name === 'tracesTo')!.isReflexive).toBe(true);
        expect(dtos.find(d => d.name === 'annotates')!.isUnique).toBe(false);
        // A relation that says nothing stays silent — the caller applies the default.
        expect(dtos.find(d => d.name === 'composes')!.isReflexive).toBeUndefined();
        expect(dtos.find(d => d.name === 'composes')!.isUnique).toBeUndefined();
    });

    it('inherits a value stated once on the base relation', async () => {
        const registry = await registryFrom(`
package memo_core_relationships {
    abstract connection def MemoRelationship {
        attribute :>> isUnique = true;
    }
    connection def Composes :> MemoRelationship {
        end parent : MemoPart;
        end child : MemoPart;
    }
}
`);
        const composes = registry.toDefinitionDTOs().find(d => d.name === 'composes')!;
        expect(composes.isUnique).toBe(true);
    });

    it('lets a subtype override what the base declared', async () => {
        const registry = await registryFrom(`
package memo_core_relationships {
    abstract connection def MemoRelationship {
        attribute :>> isReflexive = false;
    }
    connection def TracesTo :> MemoRelationship {
        attribute :>> isReflexive = true;
        end tracingElement : MemoPart;
        end tracedElement : MemoPart;
    }
}
`);
        const dtos = registry.toDefinitionDTOs();
        expect(dtos.find(d => d.name === 'tracesTo')!.isReflexive).toBe(true);
        expect(dtos.find(d => d.name === 'memoRelationship')!.isReflexive).toBe(false);
    });

    it('terminates on a cyclic specialization chain', async () => {
        const registry = new RelationshipRegistry();
        registry.register({ sysmlName: 'A', name: 'a', label: 'A', layer: 'l', superType: 'B', ends: [] });
        registry.register({ sysmlName: 'B', name: 'b', label: 'B', layer: 'l', superType: 'A', ends: [] });
        expect(registry.toDefinitionDTOs().find(d => d.name === 'a')!.isUnique).toBeUndefined();
    });
});

// ─── The shipped ontology ───────────────────────────────────────────────────

describe('MEMO ontology relationship properties', () => {
    it('keeps comment, rationale, and note targets universal', async () => {
        const source = readFileSync(
            join(resolveContentPackageRoot(), 'src/core/annotations/memo_annotations.sysml'),
            'utf8');
        const { document, errors } = await parseText(source);
        expect(errors).toEqual([]);
        const registry = new RelationshipRegistry();
        registry.populateFromDocuments([{ document, filePath: 'src/core/annotations/memo_annotations.sysml' }]);

        const expected = [
            ['CommentsOn', 'ModelComment'],
            ['RationaleFor', 'ModelRationale'],
            ['NotesOn', 'ModelNote'],
        ] as const;
        for (const [name, annotationKind] of expected) {
            const relation = registry.toDefinitionDTOs().find(dto => dto.sysmlName === name)!;
            expect(relation.sourceEnd.type).toBe(annotationKind);
            expect(relation.targetEnd.type).toBeUndefined();
        }
    });

    it('declares the structural slots on MemoRelationship', async () => {
        // Resolve through the installed ontology package, as the loader does.
        const source = readFileSync(
            join(resolveContentPackageRoot(), 'src/core/relationships/memo_relationships.sysml'),
            'utf8');
        expect(source).toContain('attribute isReflexive : Boolean;');
        expect(source).toContain('attribute isUnique : Boolean;');

        // And they survive the real parse, not just a grep.
        const { document, errors } = await parseText(source);
        expect(errors).toEqual([]);
        const registry = new RelationshipRegistry();
        registry.populateFromDocuments([{ document, filePath: 'src/core/relationships/memo_relationships.sysml' }]);
        expect(registry.getRelType('memoRelationship')).toBeDefined();
        // Slots are declared, no values stated — every relation takes the default.
        expect(registry.toDefinitionDTOs().every(d => d.isReflexive === undefined)).toBe(true);
    });

    // Untyped ends make a relation cross metaclass families, so each one has to
    // earn its exemption. `memo_relationships.sysml` states the reason inline
    // above every entry here; adding a name to this list without one is a bug.
    //
    // Most of this list is Track A0 (the ARCADIA programme Track A0; its outcomes are recorded in
    // plans/reference/memo-r1-arcadia-residue.md):
    // KerML forbids a port or a behaviour from specializing a part-based type,
    // so a `MemoPart`-typed end forced every endpoint to be a part — which is
    // why ports are part defs, why a function is a part with a separate action
    // stapled to it, and why allocating a function to an actor is rejected. The
    // constraints those types carried are now CR-ONT-060..073 in
    // memo/src/rules/ontology/ontology_invariants.sysml, and
    // relation-end-strictness.test.ts is what proves they fire. An end that
    // loses its type WITHOUT a rule is the regression this exemption list
    // exists to make visible.
    //
    //   MemoLink            — the fully generic escape hatch (both ends untyped).
    //   Mitigates           — controls and hazards may be item defs.
    //   Realizes            — realization crosses structural and behavioral metaclasses.
    //   Validates           — target is a requirement or an operational behavior.
    //   DerivesFrom         — target may be a Need, which is a requirement def.
    //   SatisfiedBy         — A0: satisfied by a component, a port, a behaviour, or an actor.
    //   VerifiedBy          — A0: most verification targets are requirement defs, not parts.
    //   AllocatedTo         — A0: a function is a behaviour; an actor is not an ArchitectureElement.
    //   Composes            — A0: a component owns ports, a workflow owns action steps.
    //   Precedes            — A0: precedence orders behaviours as well as parts.
    //   Performs            — A0: the performer may be a system action, as its own doc said.
    //   Enables             — A0: an enabling function is a behaviour.
    //   BindsToInterface    — A0: the bound end is an `interface def`, which no part type can hold.
    //   CrossesTrustBoundary — A0: the boundary becomes a port def in A1.
    const UNTYPED_END_EXEMPTIONS = [
        'MemoLink', 'Mitigates', 'Realizes', 'Validates', 'DerivesFrom',
        'SatisfiedBy', 'VerifiedBy', 'AllocatedTo', 'Composes', 'Precedes',
        'Performs', 'Enables', 'BindsToInterface', 'CrossesTrustBoundary',
    ];
    // Relations with BOTH ends untyped: the ones whose two ends each cross a
    // metaclass boundary. Six of the seven joined this set in A0.
    const FULLY_UNTYPED = [
        'MemoLink', 'Realizes', 'AllocatedTo', 'Composes', 'Precedes',
        'BindsToInterface', 'CrossesTrustBoundary',
    ];

    it('keeps the universal relation identifiable among fully untyped relations', async () => {
        const source = readFileSync(
            join(resolveContentPackageRoot(), 'src/core/relationships/memo_relationships.sysml'),
            'utf8');
        const { document, errors } = await parseText(source);
        expect(errors).toEqual([]);
        const registry = new RelationshipRegistry();
        registry.populateFromDocuments([{ document, filePath: 'src/core/relationships/memo_relationships.sysml' }]);

        const bothEndsUntyped = registry.toDefinitionDTOs()
            .filter(d => !d.isAbstract && !d.sourceEnd.type && !d.targetEnd.type);
        expect(bothEndsUntyped.map(d => d.sysmlName).sort()).toEqual([...FULLY_UNTYPED].sort());

        // MemoLink is the only one of them that is universal by intent:
        // Realizes states an abstraction/concretion fact across metaclasses.
        const link = bothEndsUntyped.find(d => d.sysmlName === 'MemoLink')!;
        expect(link.sourceEnd.name).toBe('linkSource');
        expect(link.targetEnd.name).toBe('linkTarget');
        expect(link.isAbstract).toBeUndefined();
    });

    it('types both ends on every other concrete relation', async () => {
        const source = readFileSync(
            join(resolveContentPackageRoot(), 'src/core/relationships/memo_relationships.sysml'),
            'utf8');
        const { document } = await parseText(source);
        const registry = new RelationshipRegistry();
        registry.populateFromDocuments([{ document, filePath: 'src/core/relationships/memo_relationships.sysml' }]);

        const untypedEnds = registry.toDefinitionDTOs()
            .filter(d => !d.isAbstract && !UNTYPED_END_EXEMPTIONS.includes(d.sysmlName))
            .filter(d => !d.sourceEnd.type || !d.targetEnd.type);
        expect(untypedEnds.map(d => d.sysmlName)).toEqual([]);
    });
});
