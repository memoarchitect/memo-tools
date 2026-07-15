// ─── Kind Registry ───────────────────────────────────────────────────────────
//
// Discovers kinds from SysML AST Definition nodes, replacing config.kinds.
// Walks PartDefinition, RequirementDefinition, ActionDefinition, ItemDefinition,
// PortDefinition, InterfaceDefinition, AttributeDefinition, and EnumDefinition
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
import { resolveLayerFromPath, resolveStandardFromPath } from './layer-resolver.js';

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
}

/** AST $type → SysMLConstruct mapping */
const AST_TYPE_TO_CONSTRUCT: Record<string, SysMLConstruct> = {
    PartDefinition: 'part def',
    RequirementDefinition: 'requirement def',
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

            for (const member of model.members) {
                if (isPackageDeclaration(member)) {
                    this.walkPackage(member, layer, standard);
                }
            }
        }
    }

    /** Walk a package declaration and register all Definition nodes */
    private walkPackage(pkg: PackageDeclaration, layer: string, standard?: string): void {
        for (const member of pkg.members) {
            if (isPackageDeclaration(member)) {
                this.walkPackage(member, layer, standard);
                continue;
            }

            // Check each definition type
            if (
                isPartDefinition(member) ||
                isRequirementDefinition(member) ||
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
                });
            }
        }
    }
}
