// ─── Kind Registry ───────────────────────────────────────────────────────────
//
// Discovers kinds from SysML AST Definition nodes, replacing config.kinds.
// Walks PartDefinition, RequirementDefinition, VerificationDefinition,
// StateDefinition, UseCaseDeclaration definitions, ActionDefinition,
// ItemDefinition, PortDefinition, InterfaceDefinition, AttributeDefinition, and EnumDefinition
// nodes. Derives layer from the file's directory path (Apollo-11 convention).
//
// Usage:
//   const registry = new KindRegistry();
//   registry.populateFromDocuments(parsedDocs);
//   const kind = registry.getKind("Hazard");
// ─────────────────────────────────────────────────────────────────────────────

import type { PackageDeclaration } from '../language/generated/ast.js';
import {
    isPartDefinition,
    isRequirementDefinition,
    isVerificationDefinition,
    isStateDefinition,
    isUseCaseDeclaration,
    isActionDefinition,
    isItemDefinition,
    isPortDefinition,
    isInterfaceDefinition,
    isAttributeDefinition,
    isEnumDefinition,
    isPackageDeclaration,
} from '../language/generated/ast.js';
import type { SysMLConstruct } from './config.js';

/**
 * A kind as the registry reports it.
 *
 * This shape used to live in `config.ts`, where a YAML `kinds:` block could
 * declare one. Kinds come from the ontology's own `part def` / `item def`
 * declarations now, so the shape belongs to the registry that derives it.
 */
export interface KindDefinition {
    /** Human-readable label */
    label: string;
    /** Architecture layer this kind belongs to */
    layer?: string;
    /** SysML v2 construct this kind maps to */
    sysmlConstruct: SysMLConstruct;
    /** Icon identifier for the palette/diagram */
    icon?: string;
    /** Template file for new instances */
    template?: string;
    /** Default attributes for new instances */
    defaultAttributes?: Record<string, string>;
}
import type { ParsedDocument } from './parser-utils.js';
import { resolveLayerFromPath, resolveNamespaceFromPath, resolveStandardFromPath } from './layer-resolver.js';
import type { KindDefinitionDTO } from './relationship-legality.js';

/** Entry in the KindRegistry, matching KindDefinition shape */
export interface KindRegistryEntry {
    /** Kind name (e.g. "Hazard") */
    name: string;
    /** Human-readable label */
    label: string;
    /** Architecture layer derived from directory path */
    layer: string;
    /** SysML v2 construct type */
    sysmlConstruct: SysMLConstruct;
    /** Supertype name if the definition specializes another */
    superType?: string;
    /** Description extracted from SysML doc comment */
    description?: string;
    /** Kinds that specialize this kind (reverse of superType) */
    derivedBy?: string[];
    /** Compliance standard (e.g. "iso-14971"), set for kinds under compliance/<standard>/ */
    standard?: string;
    /** Standard clause reference (e.g. "4.5"), extracted from SysML attribute if present */
    clause?: string;
    /** Abstract definitions (e.g. MemoPart) classify but are never instantiated */
    isAbstract?: boolean;
    /** Namespace segments mirrored by the ontology source folders. */
    namespace?: string[];
    /**
     * Fully qualified name, e.g. `memo::ontology::assurance::safety_risk::Hazard`.
     *
     * This is the registry's real identity. `name` is a short index into it,
     * which resolves only while it is unambiguous — see `getCollisions`.
     */
    qualifiedName?: string;
    /** Source file this definition was declared in. */
    sourceFile?: string;
}

/**
 * Two definitions sharing a short name.
 *
 * Previously the second silently replaced the first in a `Map` keyed by short
 * name, so which one survived depended on file iteration order and the loss was
 * invisible. Collisions are now recorded and surfaced as load diagnostics.
 */
export interface KindNameCollision {
    shortName: string;
    /** Qualified names competing for the short name, in discovery order. */
    qualifiedNames: string[];
    /** Files declaring them, aligned with `qualifiedNames`. */
    sourceFiles: string[];
}

/** AST $type → SysMLConstruct mapping */
/**
 * Literal attribute values declared in a definition body. Only literals are
 * read: an inherited presentation hint is always a literal, and anything else
 * belongs to the usage.
 */
function extractBoundAttributes(body: any[] | undefined): Record<string, string> {
    const out: Record<string, string> = {};
    for (const member of body ?? []) {
        if (member?.$type !== 'AttributeMember' || !member.value || !member.name) continue;
        const v = member.value;
        switch (v.$type) {
            case 'StringValue': out[member.name] = String(v.value).replace(/^"|"$/g, ''); break;
            case 'IntValue':
            case 'RealValue': out[member.name] = String(v.value); break;
            case 'BooleanValue': out[member.name] = String(v.value); break;
            case 'EnumValue': out[member.name] = String(v.enumRef ?? ''); break;
            default: break;
        }
    }
    return out;
}

const AST_TYPE_TO_CONSTRUCT: Record<string, SysMLConstruct> = {
    PartDefinition: 'part def',
    RequirementDefinition: 'requirement def',
    VerificationDefinition: 'verification def',
    StateDefinition: 'state def',
    UseCaseDeclaration: 'use case def',
    ActionDefinition: 'action def',
    ItemDefinition: 'item def',
    PortDefinition: 'port def',
    InterfaceDefinition: 'interface def',
    AttributeDefinition: 'attribute def',
    EnumDefinition: 'enum def',
};

/**
 * Registry that discovers kinds from SysML AST Definition nodes.
 * Replaces config.kinds lookups in the builder.
 */
export class KindRegistry {
    private readonly kinds = new Map<string, KindRegistryEntry>();
    /**
     * Attribute values bound by a `view def`, keyed by definition name, with the
     * definition's own supertype chain already merged in.
     *
     * A view usage inherits these — `view mainScreenLayout : MemoScreenLayoutView`
     * gets that definition's `viewKind` without restating it, and SysIDE in fact
     * REJECTS restating it ("Cannot override a binding feature value"). So the
     * definition is the only place the value can live, and consumers resolve a
     * usage's presentation by falling back here.
     *
     * View definitions are not registered as kinds: they classify views, not
     * model elements, and adding them to the kind extent would put them in the
     * Explorer and in kind counts where they do not belong.
     */
    private readonly viewDefaults = new Map<string, Record<string, string>>();
    private readonly viewSuperTypes = new Map<string, string>();
    /** short name → the qualified name it currently resolves to. */
    private readonly byQualifiedName = new Map<string, string>();
    /** qualified name → declaring file, for collision diagnostics. */
    private readonly sourceFiles = new Map<string, string>();
    private readonly collisions = new Map<string, KindNameCollision>();

    /** Number of registered kinds */
    get size(): number {
        return this.kinds.size;
    }

    /**
     * Look up a kind by name.
     * Returns undefined if the kind is not registered.
     */
    getKind(name: string): KindRegistryEntry | undefined {
        return this.kinds.get(name);
    }

    /**
     * Attribute values a view usage inherits from its `view def`, resolved up
     * the definition's specialization chain (nearest declaration wins).
     */
    getViewDefaults(viewDefName: string | undefined): Record<string, string> | undefined {
        if (!viewDefName) return undefined;
        const merged: Record<string, string> = {};
        const seen = new Set<string>();
        let name: string | undefined = viewDefName;
        while (name && !seen.has(name)) {
            seen.add(name);
            for (const [k, v] of Object.entries(this.viewDefaults.get(name) ?? {})) {
                if (!(k in merged)) merged[k] = v;   // nearest declaration wins
            }
            name = this.viewSuperTypes.get(name);
        }
        return Object.keys(merged).length > 0 ? merged : undefined;
    }

    /**
     * Convert a registry entry to a KindDefinition (for backward compat with builder).
     */
    toKindDefinition(name: string): KindDefinition | undefined {
        const entry = this.kinds.get(name);
        if (!entry) return undefined;
        return {
            label: entry.label,
            layer: entry.layer,
            sysmlConstruct: entry.sysmlConstruct,
        };
    }

    /**
     * Get all registered kinds as a Record<string, KindDefinition>,
     * matching the shape of config.kinds for backward compatibility.
     */
    toKindsRecord(): Record<string, KindDefinition> {
        const result: Record<string, KindDefinition> = {};
        for (const [name, entry] of this.kinds) {
            result[name] = {
                label: entry.label,
                layer: entry.layer,
                sysmlConstruct: entry.sysmlConstruct,
            };
        }
        return result;
    }

    /** Check if a kind is registered */
    has(name: string): boolean {
        return this.kinds.has(name);
    }

    /** Get all kind names */
    kindNames(): string[] {
        return Array.from(this.kinds.keys());
    }

    /** Get all entries */
    entries(): KindRegistryEntry[] {
        return Array.from(this.kinds.values());
    }

    /**
     * Return a registry augmented with project-local definitions. Definitions
     * that derive from a registered ontology kind inherit that kind's
     * placement. Other valid SysML definitions remain available under the
     * standard SysML area instead of being reported as undefined. The
     * ontology registry itself remains unchanged (it is frozen for the
     * lifetime of an Architect session).
     *
     * Local extension kinds inherit their ontology parent's placement while
     * retaining their own name and construct. This lets a project declare,
     * for example, `FirmwareComponent specializes SoftwareComponent` and use
     * FirmwareComponent everywhere the ontology accepts SoftwareComponent.
     */
    withProjectExtensions(documents: ParsedDocument[]): KindRegistry {
        const result = new KindRegistry();
        for (const entry of this.kinds.values()) {
            result.register({
                ...entry,
                namespace: entry.namespace ? [...entry.namespace] : undefined,
                derivedBy: entry.derivedBy ? [...entry.derivedBy] : undefined,
            });
        }
        for (const [name, defaults] of this.viewDefaults) {
            result.viewDefaults.set(name, { ...defaults });
        }
        for (const [name, superType] of this.viewSuperTypes) {
            result.viewSuperTypes.set(name, superType);
        }

        const discovered = new KindRegistry();
        discovered.populateFromDocuments(documents);
        let pending = discovered.entries().filter(entry => !result.has(entry.name));

        // Resolve repeatedly so chains of local extensions work regardless of
        // source-file order (e.g. DeviceFirmware -> FirmwareComponent ->
        // SoftwareComponent).
        while (pending.length > 0) {
            let added = 0;
            const unresolved: KindRegistryEntry[] = [];
            for (const entry of pending) {
                const declaredSuperType = entry.superType;
                const superType = declaredSuperType?.split('::').pop();
                const parent = superType ? result.getKind(superType) : undefined;
                if (!parent || parent.layer === 'unknown') {
                    unresolved.push(entry);
                    continue;
                }
                result.register({
                    ...entry,
                    superType,
                    layer: parent.layer,
                    namespace: parent.namespace ? [...parent.namespace] : undefined,
                    standard: entry.standard ?? parent.standard,
                });
                added++;
            }
            if (added === 0) break;
            pending = unresolved;
        }

        // A definition does not have to extend MEMO to be valid SysML. Keep
        // independent project types visible and usable, but do not pretend
        // they conform to a MEMO ontology kind.
        for (const entry of pending) {
            result.register({
                ...entry,
                superType: entry.superType?.split('::').pop(),
                layer: 'sysml',
                namespace: ['sysml'],
            });
        }

        result.computeDerivedBy();
        return result;
    }

    /**
     * Project the registry into serializable definitions for the web client.
     * Only the fields relationship legality needs — chiefly superType, which
     * carries the specialization chain that conformance walks.
     */
    toDefinitionDTOs(): KindDefinitionDTO[] {
        return Array.from(this.kinds.values()).map(entry => ({
            name: entry.name,
            label: entry.label,
            layer: entry.layer,
            construct: entry.sysmlConstruct,
            superType: entry.superType,
            isAbstract: entry.isAbstract,
            namespace: entry.namespace,
        }));
    }

    /** Get compliance standard groups discovered from the ontology tree. */
    getComplianceGroups(): { standard: string; kinds: KindRegistryEntry[] }[] {
        const groups = new Map<string, KindRegistryEntry[]>();
        for (const entry of this.kinds.values()) {
            if (entry.standard) {
                let list = groups.get(entry.standard);
                if (!list) { list = []; groups.set(entry.standard, list); }
                list.push(entry);
            }
        }
        return Array.from(groups.entries())
            .map(([standard, kinds]) => ({ standard, kinds }))
            .sort((a, b) => a.standard.localeCompare(b.standard));
    }

    /** Register a kind manually (for testing or config fallback) */
    register(entry: KindRegistryEntry): void {
        this.recordIdentity(entry);
        this.kinds.set(entry.name, entry);
    }

    /**
     * Track qualified identity alongside the short-name map.
     *
     * Short-name lookup is kept as-is so every existing caller keeps working;
     * what changes is that a shadowed definition is no longer lost silently.
     * A re-registration of the SAME qualified name is not a collision — that
     * happens legitimately when a registry is copied in `withProjectExtensions`.
     */
    private recordIdentity(entry: KindRegistryEntry): void {
        const qualified = entry.qualifiedName ?? entry.name;
        const existing = this.byQualifiedName.get(entry.name);
        if (existing && existing !== qualified) {
            const collision = this.collisions.get(entry.name) ?? {
                shortName: entry.name,
                qualifiedNames: [existing],
                sourceFiles: [this.sourceFiles.get(existing) ?? '(unknown)'],
            };
            if (!collision.qualifiedNames.includes(qualified)) {
                collision.qualifiedNames.push(qualified);
                collision.sourceFiles.push(entry.sourceFile ?? '(unknown)');
            }
            this.collisions.set(entry.name, collision);
        }
        this.byQualifiedName.set(entry.name, qualified);
        if (entry.sourceFile) this.sourceFiles.set(qualified, entry.sourceFile);
    }

    /**
     * Short names claimed by more than one qualified definition.
     *
     * Callers surface these as load diagnostics: a reference to an ambiguous
     * short name cannot be resolved by load order and needs qualifying.
     */
    getCollisions(): KindNameCollision[] {
        return [...this.collisions.values()]
            .sort((a, b) => a.shortName.localeCompare(b.shortName));
    }

    /** Qualified name a short name currently resolves to. */
    getQualifiedName(shortName: string): string | undefined {
        return this.byQualifiedName.get(shortName);
    }

    /**
     * Give a kind the placement of the kind it specializes, wherever its own
     * declaring path could not supply one.
     *
     * Layer, namespace and standard are derived from the declaring file's path
     * under `src/<layer>/`. An EXTENSION declares its types in
     * `extensions/<name>/src/`, which matches no layer — so `RosNode`,
     * `CloudService` and `AadlThread` all landed in `unknown` and a project
     * that included one showed most of its model as unplaced.
     *
     * The placement is read from the specialization, not from any list of
     * names: `RosNode : SoftwareComponent` is implementation because
     * `SoftwareComponent` is. Resolution repeats so a chain works regardless
     * of source-file order (`RosContainerImage -> ContainerImage ->
     * DeploymentUnit`), and a kind that specializes nothing placed stays
     * `unknown`, which is the honest answer.
     *
     * Must be called after populateFromDocuments() is complete.
     */
    inheritPlacementFromSuperTypes(): void {
        let progressed = true;
        while (progressed) {
            progressed = false;
            for (const entry of this.kinds.values()) {
                if (entry.layer !== 'unknown' || !entry.superType) continue;
                const parent = this.kinds.get(entry.superType.split('::').pop() ?? '');
                if (!parent || parent === entry || parent.layer === 'unknown') continue;
                entry.layer = parent.layer;
                if (!entry.namespace?.length && parent.namespace) entry.namespace = [...parent.namespace];
                if (!entry.standard && parent.standard) entry.standard = parent.standard;
                progressed = true;
            }
        }
    }

    /**
     * Compute the derivedBy reverse-lookup for all kinds.
     * Must be called after populateFromDocuments() is complete.
     */
    computeDerivedBy(): void {
        // Clear existing
        for (const entry of this.kinds.values()) {
            entry.derivedBy = [];
        }
        // Build reverse map
        for (const entry of this.kinds.values()) {
            if (entry.superType) {
                const parent = this.kinds.get(entry.superType);
                if (parent) {
                    if (!parent.derivedBy) parent.derivedBy = [];
                    parent.derivedBy.push(entry.name);
                }
            }
        }
    }

    /**
     * Populate the registry from parsed SysML documents.
     * Walks all Definition nodes in each document's AST and registers them.
     */
    populateFromDocuments(documents: ParsedDocument[]): void {
        for (const doc of documents) {
            const model = doc.document.parseResult.value;
            const layer = resolveLayerFromPath(doc.filePath);
            const standard = resolveStandardFromPath(doc.filePath);
            const namespace = resolveNamespaceFromPath(doc.filePath);

            for (const member of model.members) {
                if (isPackageDeclaration(member)) {
                    this.walkPackage(member, layer, standard, namespace, [], doc.filePath);
                }
            }
        }
    }

    /** Walk a package declaration and register all Definition nodes */
    private walkPackage(
        pkg: PackageDeclaration,
        layer: string,
        standard?: string,
        namespace?: string[],
        packagePath: string[] = [],
        sourceFile?: string,
    ): void {
        // A declaration's qualified name is the enclosing package chain, which
        // is why nested package declarations are required: a file declaring
        // `package a::b` gives no chain to walk.
        const here = pkg.name ? [...packagePath, pkg.name] : packagePath;
        for (const member of pkg.members) {
            if (isPackageDeclaration(member)) {
                this.walkPackage(member, layer, standard, namespace, here, sourceFile);
                continue;
            }

            if (member.$type === 'ViewDefinition') {
                const viewName = (member as any).name;
                if (viewName) {
                    this.viewDefaults.set(viewName, extractBoundAttributes((member as any).body));
                    const sup = (member as any).specialization?.superType;
                    if (sup) this.viewSuperTypes.set(viewName, sup);
                }
                continue;
            }

            // Check each definition type
            if (
                isPartDefinition(member) ||
                isRequirementDefinition(member) ||
                isVerificationDefinition(member) ||
                isStateDefinition(member) ||
                (isUseCaseDeclaration(member) && member.isDefinition) ||
                isActionDefinition(member) ||
                isItemDefinition(member) ||
                isPortDefinition(member) ||
                isInterfaceDefinition(member) ||
                isAttributeDefinition(member) ||
                isEnumDefinition(member)
            ) {
                const construct = AST_TYPE_TO_CONSTRUCT[member.$type];
                if (!construct) continue;

                const name = member.name;
                if (!name) continue;

                const superType = 'specialization' in member
                    ? member.specialization?.superType
                    : undefined;

                this.register({
                    name,
                    label: name,
                    layer,
                    sysmlConstruct: construct,
                    superType: superType || undefined,
                    standard,
                    isAbstract: ('isAbstract' in member && member.isAbstract) || undefined,
                    namespace,
                    qualifiedName: [...here, name].join('::'),
                    sourceFile,
                });
            }
        }
    }
}

/**
 * The ontology facts a formatter or importer needs, derived from the registries.
 *
 * Consumers used to take a `MEMOConfig` and read `config.kinds` and
 * `config.relationshipTypes` off it, which meant a settings file could declare
 * a kind the ontology never defined. They take this instead: it can only be
 * built from what the resolved SysML declares.
 */
export interface OntologyView {
    kinds: Record<string, KindDefinition>;
    relationshipTypes: Array<{ name: string; label: string; layer: string; color: string }>;
}

/** An empty view — what a caller has before any ontology is resolved. */
export const EMPTY_ONTOLOGY_VIEW: OntologyView = { kinds: {}, relationshipTypes: [] };

/** Build a view from populated registries. */
export function ontologyViewFrom(
    kindRegistry?: { toKindsRecord(): Record<string, KindDefinition> },
    relationshipRegistry?: { toRelationshipTypesArray(): OntologyView['relationshipTypes'] },
): OntologyView {
    return {
        kinds: kindRegistry?.toKindsRecord() ?? {},
        relationshipTypes: relationshipRegistry?.toRelationshipTypesArray() ?? [],
    };
}
