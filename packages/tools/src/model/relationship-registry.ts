// ─── Relationship Registry ──────────────────────────────────────────────────
//
// Discovers relationship types from SysML AST ConnectionDefinition nodes,
// replacing config.relationshipTypes. Walks ConnectionDefinition nodes and
// derives layer from the file's directory path (Apollo-11 convention).
// Normalizes PascalCase SysML names to camelCase for matching.
//
// Usage:
//   const registry = new RelationshipRegistry();
//   registry.populateFromDocuments(parsedDocs);
//   const rel = registry.getRelType("mitigates");
// ─────────────────────────────────────────────────────────────────────────────

import type {
    AttributeValue, BooleanValue, Multiplicity, PackageDeclaration,
} from '../language/generated/ast.js';
import {
    isAttributeMember,
    isConnectionDefinition,
    isDocComment,
    isEndDeclaration,
    isPackageDeclaration,
} from '../language/generated/ast.js';
/**
 * A typed relationship as the registry reports it.
 *
 * Derived from the ontology's `connection def` declarations. The YAML
 * `relationshipTypes:` block that used to declare these is gone.
 */
export interface RelationshipType {
    /** Relationship identifier, e.g. "mitigates" */
    name: string;
    /** Human-readable label, e.g. "Mitigates" */
    label: string;
    /** Architecture layer this relationship belongs to */
    layer: string;
    /** Hex colour for relationship visualization */
    color: string;
}
import type { ParsedDocument } from './parser-utils.js';
import { resolveLayerFromPath } from './layer-resolver.js';
import type {
    MultiplicityDTO,
    RelationshipDefinitionDTO,
    RelationshipEndDTO,
} from './relationship-legality.js';

/** One `end` declaration on a connection definition */
export interface RelationshipEnd {
    name: string;
    type?: string;
    /** Declared multiplicity, e.g. `end owner : Requirement [0..1];` */
    multiplicity?: MultiplicityDTO;
}

/** Entry in the RelationshipRegistry */
export interface RelationshipRegistryEntry {
    /** Relationship name in PascalCase as defined in SysML (e.g. "Mitigates") */
    sysmlName: string;
    /** Normalized camelCase name for matching (e.g. "mitigates") */
    name: string;
    /** Human-readable label */
    label: string;
    /** Architecture layer derived from directory path */
    layer: string;
    /** Doc comment on the connection definition */
    description?: string;
    /** Abstract definitions (e.g. MemoRelationship) are not instantiable */
    isAbstract?: boolean;
    /**
     * Whether an element may be related to itself by this relation, from the
     * `isReflexive` attribute. Undefined when the ontology does not say.
     */
    isReflexive?: boolean;
    /**
     * Whether the same ordered pair may be linked more than once, from the
     * `isUnique` attribute. Undefined when the ontology does not say.
     */
    isUnique?: boolean;
    /** Supertype connection definition, when the relationship specializes one */
    superType?: string;
    /** End names from the connection definition */
    ends: RelationshipEnd[];
    /**
     * Attribute names declared on the connection definition, e.g.
     * `sectionReference` on `TracesToDocument`. Inherited attributes are not
     * folded in — walk `superType` for those. Absent on a manually registered
     * entry, which is not the same as "declares none".
     */
    attributes?: string[];
}

/**
 * Convert PascalCase to camelCase.
 * "Mitigates" → "mitigates", "TraceTo" → "traceTo", "HasSubProcedure" → "hasSubProcedure"
 */
export function pascalToCamelCase(name: string): string {
    if (!name) return name;
    return name[0].toLowerCase() + name.slice(1);
}

/**
 * Convert PascalCase to a human-readable label.
 * "TraceTo" → "Trace To", "HasSubProcedure" → "Has Sub Procedure"
 */
function pascalToLabel(name: string): string {
    return name.replace(/([a-z])([A-Z])/g, '$1 $2');
}

/** Strip the `doc /* … *​/` wrapper and per-line asterisks from a doc comment. */
function cleanDocComment(content: string): string | undefined {
    const text = content
        .replace(/^doc\s+\/\*\s*/, '')
        .replace(/\s*\*\/$/, '')
        .replace(/\n\s*\*\s?/g, ' ')
        .trim();
    return text || undefined;
}

/** Convert a parsed Multiplicity node into its serializable bounds. */
function toMultiplicityDTO(multiplicity: Multiplicity | undefined): MultiplicityDTO | undefined {
    if (!multiplicity) return undefined;
    // `[3]` — an exact bound pins both ends.
    if (multiplicity.exact !== undefined) {
        const exact = Number(multiplicity.exact);
        return { lower: exact, upper: exact };
    }
    // `[*]` — no lower bound was written, so it stays 0.
    if (multiplicity.lower === undefined) {
        return { lower: 0, upper: multiplicity.unbounded ? null : null };
    }
    // `[0..1]` / `[1..*]`
    return {
        lower: Number(multiplicity.lower),
        upper: multiplicity.unbounded || multiplicity.upper === undefined
            ? null
            : Number(multiplicity.upper),
    };
}

/**
 * Read a Boolean attribute value, or undefined when the attribute declares a
 * type rather than stating a value. Undefined is meaningful: it means the
 * ontology is silent, and the caller applies the documented default.
 */
function booleanAttributeValue(value: AttributeValue | undefined): boolean | undefined {
    if (!value || value.$type !== 'BooleanValue') return undefined;
    return (value as BooleanValue).value === 'true';
}

/** Project one registry end (possibly absent) into its DTO. */
function toEndDTO(end: RelationshipEnd | undefined, fallbackName: string): RelationshipEndDTO {
    if (!end) return { name: fallbackName };
    return { name: end.name || fallbackName, type: end.type, multiplicity: end.multiplicity };
}

/**
 * Registry that discovers relationship types from SysML AST ConnectionDefinition nodes.
 * Replaces config.relationshipTypes lookups in the builder.
 */
export class RelationshipRegistry {
    private readonly relTypes = new Map<string, RelationshipRegistryEntry>();

    /** Number of registered relationship types */
    get size(): number {
        return this.relTypes.size;
    }

    /**
     * Look up a relationship type by camelCase name.
     * Returns undefined if not registered.
     */
    getRelType(name: string): RelationshipRegistryEntry | undefined {
        return this.relTypes.get(name);
    }

    /**
     * Convert a registry entry to a RelationshipType (for backward compat).
     * Uses empty string for color since SysML doesn't define colors —
     * colors come from memo.rendering.yaml.
     */
    toRelationshipType(name: string): RelationshipType | undefined {
        const entry = this.relTypes.get(name);
        if (!entry) return undefined;
        return {
            name: entry.name,
            label: entry.label,
            layer: entry.layer,
            color: '',
        };
    }

    /**
     * Get all registered relationship types as RelationshipType[],
     * matching the shape of config.relationshipTypes for backward compatibility.
     */
    toRelationshipTypesArray(): RelationshipType[] {
        return Array.from(this.relTypes.values()).map(entry => ({
            name: entry.name,
            label: entry.label,
            layer: entry.layer,
            color: '',
        }));
    }

    /** Check if a relationship type is registered */
    has(name: string): boolean {
        return this.relTypes.has(name);
    }

    /** Get all relationship type names (camelCase) */
    relTypeNames(): string[] {
        return Array.from(this.relTypes.keys());
    }

    /** Get all entries */
    entries(): RelationshipRegistryEntry[] {
        return Array.from(this.relTypes.values());
    }

    /**
     * Project the registry into serializable definitions for the web client.
     * The first declared end becomes the source, the second the target; a
     * definition with fewer than two ends still yields a definition with the
     * missing end untyped, so it accepts any kind rather than disappearing.
     */
    toDefinitionDTOs(): RelationshipDefinitionDTO[] {
        return Array.from(this.relTypes.values()).map(entry => ({
            name: entry.name,
            sysmlName: entry.sysmlName,
            label: entry.label,
            description: entry.description,
            layer: entry.layer,
            isAbstract: entry.isAbstract,
            isReflexive: this.inherited(entry, 'isReflexive'),
            isUnique: this.inherited(entry, 'isUnique'),
            sourceEnd: toEndDTO(entry.ends[0], 'source'),
            targetEnd: toEndDTO(entry.ends[1], 'target'),
        }));
    }

    /**
     * Resolve a structural property up the specialization chain: a connection
     * def that says nothing inherits whatever its supertype declared, so a
     * value set once on MemoRelationship reaches every relation.
     */
    private inherited(
        entry: RelationshipRegistryEntry,
        property: 'isReflexive' | 'isUnique',
    ): boolean | undefined {
        let current: RelationshipRegistryEntry | undefined = entry;
        const seen = new Set<string>();
        while (current && !seen.has(current.sysmlName)) {
            if (current[property] !== undefined) return current[property];
            seen.add(current.sysmlName);
            const superName: string | undefined = current.superType;
            // Supertypes are keyed by camelCase name like every other entry.
            current = superName
                ? this.relTypes.get(pascalToCamelCase(superName))
                : undefined;
        }
        return undefined;
    }

    /** Register a relationship type manually (for testing or config fallback) */
    register(entry: RelationshipRegistryEntry): void {
        this.relTypes.set(entry.name, entry);
    }

    /**
     * Populate the registry from parsed SysML documents.
     * Walks all ConnectionDefinition nodes in each document's AST.
     */
    populateFromDocuments(documents: ParsedDocument[]): void {
        for (const doc of documents) {
            const model = doc.document.parseResult.value;
            const layer = resolveLayerFromPath(doc.filePath);

            for (const member of model.members) {
                if (isPackageDeclaration(member)) {
                    this.walkPackage(member, layer);
                }
            }
        }
    }

    /** Walk a package declaration and register all ConnectionDefinition nodes */
    private walkPackage(pkg: PackageDeclaration, layer: string): void {
        for (const member of pkg.members) {
            if (isPackageDeclaration(member)) {
                this.walkPackage(member, layer);
                continue;
            }

            if (isConnectionDefinition(member)) {
                const sysmlName = member.name;
                if (!sysmlName) continue;

                const name = pascalToCamelCase(sysmlName);
                const label = pascalToLabel(sysmlName);

                // Extract end declarations
                const ends: RelationshipEnd[] = [];
                const attributes: string[] = [];
                let description: string | undefined;
                let isReflexive: boolean | undefined;
                let isUnique: boolean | undefined;
                for (const bodyMember of member.body) {
                    if (isEndDeclaration(bodyMember)) {
                        ends.push({
                            name: bodyMember.name || '',
                            type: bodyMember.type || undefined,
                            multiplicity: toMultiplicityDTO(bodyMember.multiplicity),
                        });
                    } else if (isDocComment(bodyMember) && description === undefined) {
                        description = cleanDocComment(bodyMember.content);
                    } else if (isAttributeMember(bodyMember)) {
                        if (bodyMember.name) attributes.push(bodyMember.name);
                        // Only a valued attribute states anything — a bare
                        // `attribute isUnique : Boolean;` declares the slot.
                        if (bodyMember.name === 'isReflexive') {
                            isReflexive = booleanAttributeValue(bodyMember.value) ?? isReflexive;
                        } else if (bodyMember.name === 'isUnique') {
                            isUnique = booleanAttributeValue(bodyMember.value) ?? isUnique;
                        }
                    }
                }

                this.relTypes.set(name, {
                    sysmlName,
                    name,
                    label,
                    layer,
                    description,
                    isAbstract: member.isAbstract || undefined,
                    superType: member.specialization?.superType || undefined,
                    isReflexive,
                    isUnique,
                    ends,
                    attributes,
                });
            }
        }
    }
}
