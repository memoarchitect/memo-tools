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

import type { PackageDeclaration } from '../language/generated/ast.js';
import {
    isConnectionDefinition,
    isEndDeclaration,
    isPackageDeclaration,
} from '../language/generated/ast.js';
import type { RelationshipType } from './config.js';
import type { ParsedDocument } from './parser-utils.js';
import { resolveLayerFromPath } from './layer-resolver.js';

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
    /** End names from the connection definition */
    ends: Array<{ name: string; type?: string }>;
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
                const ends: Array<{ name: string; type?: string }> = [];
                for (const bodyMember of member.body) {
                    if (isEndDeclaration(bodyMember)) {
                        ends.push({
                            name: bodyMember.name || '',
                            type: bodyMember.type || undefined,
                        });
                    }
                }

                this.relTypes.set(name, {
                    sysmlName,
                    name,
                    label,
                    layer,
                    ends,
                });
            }
        }
    }
}
