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
import type { KindDefinition, SysMLConstruct } from './config.js';
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
}

/** AST $type → SysMLConstruct mapping */
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
        this.kinds.set(entry.name, entry);
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
                    this.walkPackage(member, layer, standard, namespace);
                }
            }
        }
    }

    /** Walk a package declaration and register all Definition nodes */
    private walkPackage(pkg: PackageDeclaration, layer: string, standard?: string, namespace?: string[]): void {
        for (const member of pkg.members) {
            if (isPackageDeclaration(member)) {
                this.walkPackage(member, layer, standard, namespace);
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

                this.kinds.set(name, {
                    name,
                    label: name,
                    layer,
                    sysmlConstruct: construct,
                    superType: superType || undefined,
                    standard,
                    isAbstract: ('isAbstract' in member && member.isAbstract) || undefined,
                    namespace,
                });
            }
        }
    }
}
