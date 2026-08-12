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
    isAllocationDefinition,
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
    /**
     * The construct the relation is declared with — `connection def` or
     * `allocation def`. Both produce links and both live in this registry, but
     * they are not interchangeable to a reader: an allocation def carries the
     * standard's allocation semantics and serializes with `allocate`. The
     * keyword-collision lint also needs it, since a name that agrees with its
     * own construct is not a reinvention of the keyword.
     */
    sysmlConstruct?: string;
    /**
     * The SysML v2 keyword that writes this relation natively, when the language
     * already provides one — `satisfy`, `verify`, `allocate`. A relation with a
     * keyword is a *usage*, not a `connection def` instance: it must never be
     * serialized as `connection : X connect a to b`, whatever the ontology
     * happens to still declare alongside it.
     */
    nativeKeyword?: string;
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
 * The relations SysML v2 already writes with a keyword, and the MEMO trace edge
 * each one produces.
 *
 * The end names and types mirror `memo_core_relationships`' `SatisfiedBy`,
 * `VerifiedBy`, and `AllocatedTo`, because both spellings must produce the same
 * graph — a model that says `satisfy r by p;` and one that says
 * `connection : SatisfiedBy connect requiredElement ::> r to satisfyingElement
 * ::> p;` are the same statement, and nothing downstream should be able to tell
 * them apart.
 *
 * The ends that the ontology relaxed are relaxed here too, and for the same
 * reason (ARCADIA plan Track A0): a part-typed end cannot admit a port, a
 * behaviour, or an actor, and MEMO needs all three. The strictness did not move
 * into this table — it moved to CR-ONT-060..073 in the ontology's own rules,
 * where it can be stated across metaclasses. Re-tightening these ends would
 * silently re-impose the constraint A0 removed, on the day the connection defs
 * are retired and this table stops being a fallback.
 */
export const LANGUAGE_NATIVE_RELATIONS: Record<string, {
    keyword: string;
    sysmlName: string;
    layer: string;
    description: string;
    ends: RelationshipEnd[];
}> = {
    satisfiedBy: {
        keyword: 'satisfy',
        sysmlName: 'SatisfiedBy',
        layer: 'core',
        description: 'A requirement is satisfied by an architecture element. '
            + 'Written natively as `satisfy <requirement> by <element>;`.',
        ends: [
            { name: 'requiredElement', type: 'MemoRequirementElement' },
            { name: 'satisfyingElement' },
        ],
    },
    verifiedBy: {
        keyword: 'verify',
        sysmlName: 'VerifiedBy',
        layer: 'core',
        description: 'An element is verified by a verification case. '
            + 'Written natively as `verify <requirement>;` inside the case.',
        ends: [
            { name: 'verificationTarget' },
            { name: 'verificationCase', type: 'MemoVerificationCase' },
        ],
    },
    allocatedTo: {
        keyword: 'allocate',
        sysmlName: 'AllocatedTo',
        layer: 'core',
        description: 'A function is allocated to an architecture element. '
            + 'Written natively as `allocate <source> to <target>;`.',
        ends: [
            { name: 'function' },
            { name: 'allocatedElement' },
        ],
    },

    // ── The ARCADIA mechanisms (plan §8, Track B) ──
    //
    // Same contract as the three above: the keyword and the connection def are
    // two spellings of one statement, and the builder must make them
    // indistinguishable downstream. What differs from `satisfy` is WHICH end is
    // written: `perform`, `include`, `exhibit` and `frame` all name their
    // TARGET and take their source from the owner, which is the `verify` shape
    // with the ends swapped.
    performs: {
        keyword: 'perform',
        sysmlName: 'Performs',
        layer: 'core',
        description: 'An entity performs an activity or function (ARCADIA operational analysis). '
            + 'Written natively as `perform <action>;` inside the performer. '
            + 'Distinct from `allocatedTo`: `performs` says WHO does it, `allocatedTo` says WHERE it runs.',
        ends: [
            { name: 'performer' },
            { name: 'performed', type: 'MemoAction' },
        ],
    },
    includesStep: {
        keyword: 'include',
        sysmlName: 'IncludesStep',
        layer: 'functional',
        description: 'A flow or case includes a step or sub-case. '
            + 'Written natively as `include <step>;` inside the including element.',
        ends: [
            { name: 'functionalFlow', type: 'FunctionalFlow' },
            { name: 'step', type: 'FunctionalFlowStep' },
        ],
    },
    exhibitsMode: {
        keyword: 'exhibit',
        sysmlName: 'ExhibitsMode',
        layer: 'logical',
        description: 'A component exhibits a mode or state. '
            + 'Written natively as `exhibit <state>;` inside the component.',
        ends: [
            { name: 'component', type: 'LogicalComponent' },
            { name: 'mode', type: 'MemoState' },
        ],
    },
    framesConcern: {
        keyword: 'frame',
        sysmlName: 'FramesConcern',
        layer: 'operational',
        description: 'A viewpoint frames a stakeholder concern (ISO 42010). '
            + 'Written natively as `frame <concern>;` inside the viewpoint.',
        ends: [
            // Mirrors the ontology exactly. `MemoPart` is right here and stays
            // right: MEMO's Viewpoint is a `part def` by a recorded decision
            // (ISO 42010 viewpoints carry allowedElementKinds and governing
            // concerns, which the SysML `viewpoint` usage does not), so this is
            // not one of the part-typed ends A0 had to relax.
            { name: 'framingViewpoint', type: 'MemoPart' },
            { name: 'framedConcern', type: 'MemoPart' },
        ],
    },
    // The one row whose native spelling is NOT a connection. A refinement is a
    // `Dependency` — n clients, n suppliers, no ends to redefine, annotated by
    // a PREFIX metadata rather than by a `metadata def` on a connection def. So
    // `nativeKeyword` here does not mean "write this as a connection usage with
    // a keyword"; it means "do not write this as a connection at all".
    realizes: {
        keyword: 'dependency',
        sysmlName: 'Realizes',
        layer: 'core',
        description: 'A concrete element realizes a more abstract one. '
            + 'Written natively as `#refinement dependency <realizing> to <realized>;`, '
            + 'which is a Dependency and not a connection — see ModelingMetadata::Refinement.',
        ends: [
            { name: 'realizing' },
            { name: 'realized' },
        ],
    },
};

/**
 * The metadata that makes a `dependency` a refinement, and the keyword that
 * introduces it (`Domain Libraries/Metadata/ModelingMetadata.sysml:132`).
 *
 * A bare `dependency a to b;` is an unclassified dependency and means less than
 * `Realizes` does; only the annotated form carries realization. Naming it once
 * here keeps the builder, the serializer, and the tests reading the same word.
 */
export const REFINEMENT_METADATA = 'refinement';

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
            nativeKeyword: entry.nativeKeyword,
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
        this.registerLanguageNatives();
    }

    /**
     * Record the three relations SysML v2 spells with a keyword.
     *
     * The registry otherwise derives everything from `connection def`s, and
     * `satisfy` / `verify` / `allocate` are usages — there is no definition to
     * walk, so nothing would report them. That is not a cosmetic gap: the
     * writer decides how to serialize a relation from its registry entry, and
     * an entry that looks like every other connection def gets written as
     * `connection : SatisfiedBy connect …` even when the source said `satisfy`.
     *
     * While the ontology still declares `SatisfiedBy` / `VerifiedBy` /
     * `AllocatedTo` the derived entry is kept and only stamped with its
     * keyword — the ends, layer, and doc comment it carries are real ontology
     * facts and are better than anything invented here. When those definitions
     * are deleted the synthetic entry stands on its own, so the relation does
     * not vanish from the registry along with its retired spelling.
     */
    private registerLanguageNatives(): void {
        for (const [name, native] of Object.entries(LANGUAGE_NATIVE_RELATIONS)) {
            const existing = this.relTypes.get(name);
            if (existing) {
                existing.nativeKeyword = native.keyword;
                continue;
            }
            this.relTypes.set(name, {
                sysmlName: native.sysmlName,
                name,
                label: pascalToLabel(native.sysmlName),
                layer: native.layer,
                description: native.description,
                nativeKeyword: native.keyword,
                ends: native.ends,
            });
        }
    }

    /** Walk a package declaration and register all ConnectionDefinition nodes */
    private walkPackage(pkg: PackageDeclaration, layer: string): void {
        for (const member of pkg.members) {
            if (isPackageDeclaration(member)) {
                this.walkPackage(member, layer);
                continue;
            }

            // An `allocation def` is a relation with a different keyword, not a
            // different thing: `Allocations::Allocation :> BinaryConnection`,
            // it declares the same `end`s, and it produces the same links. The
            // registry derived relations from `connection def` alone, so an
            // allocation def would have been invisible to every tool that
            // reads the registry — the authoring picker, the writer, the DSM,
            // the legality check — while still being valid, checked ontology.
            if (isConnectionDefinition(member) || isAllocationDefinition(member)) {
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
                    sysmlConstruct: isAllocationDefinition(member) ? 'allocation def' : 'connection def',
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
