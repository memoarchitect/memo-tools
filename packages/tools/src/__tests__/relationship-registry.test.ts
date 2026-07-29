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
    //   MemoLink       — the fully generic escape hatch (both ends untyped).
    //   Mitigates      — controls and hazards may be item defs (both ends untyped).
    //   Validates      — target is a requirement or an operational behavior.
    //   DerivesFrom    — target may be a Need, which is a requirement def.
    //   SatisfiedBy    — source may be a Need alongside Requirement.
    const UNTYPED_END_EXEMPTIONS = ['MemoLink', 'Mitigates', 'Validates', 'DerivesFrom', 'SatisfiedBy'];
    const FULLY_UNTYPED = ['MemoLink', 'Mitigates'];

    it('ships exactly one universal relation, with both ends untyped', async () => {
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

        // MemoLink is the only one of them that is universal by intent: Mitigates
        // is still keyed to the risk chain by its mitigationKind attribute.
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
