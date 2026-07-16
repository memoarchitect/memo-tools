// ─── Rule Registry ───────────────────────────────────────────────────────────
//
// Discovery index for ConsistencyRule instances in parsed SysML documents.
// Surfaces rule metadata (id, category, severity, standard) for the `memo rules`
// catalog and coverage reporting. Rule EVALUATION is handled by the native
// constraint evaluator (constraint-eval.ts); the proprietary ClosureRule
// conversion was removed in Epic EE-4.
//
// Usage:
//   const registry = new RuleRegistry();
//   registry.populateFromDocuments(parsedDocs);
//   const rules = registry.entries();
// ─────────────────────────────────────────────────────────────────────────────

import type { ParsedDocument } from '../model/parser-utils.js';

/** A consistency rule extracted from SysML ontology */
export interface RuleRegistryEntry {
    /** Rule ID from SysML attribute */
    id: string;
    /** Human-readable name */
    name: string;
    /** Description */
    description: string;
    /** Entity kind this rule applies to */
    appliesTo: string;
    /** Predicate kind (requireRelationship, requireAttribute, etc.) */
    predicate: string;
    /** Rule strength (optional, recommended, required, forbidden) */
    strength: string;
    /** Severity (error, warning, info) */
    severity: string;
    /** Rationale text */
    rationaleText: string;
    /** Rule category (closure, coverage, lifecycle, crossLayer, quantitative) */
    category: string;
    /** All raw attributes from the SysML instance */
    attributes: Record<string, string>;
    /** Source file path */
    file: string;
    /** Supertype chain (e.g. RelationshipConsistencyRule, ConsistencyRule) */
    superType?: string;
}

/**
 * Registry that discovers ConsistencyRule instances from SysML AST.
 * Walks part usages whose type specializes ConsistencyRule.
 */
export class RuleRegistry {
    private readonly rules = new Map<string, RuleRegistryEntry>();

    /** Known ConsistencyRule type hierarchy */
    private static readonly RULE_TYPES = new Set([
        'ConsistencyRule',
        'RelationshipConsistencyRule',
        'AttributeConsistencyRule',
        'ConditionalConsistencyRule',
        'CoverageConsistencyRule',
        // Methodology-level types that extend ConsistencyRule
        'ElementUsageRule',
        'RelationUsageRule',
    ]);

    /** Number of registered rules */
    get size(): number {
        return this.rules.size;
    }

    /** Get a rule by ID */
    getRule(id: string): RuleRegistryEntry | undefined {
        return this.rules.get(id);
    }

    /** Get all rules */
    entries(): RuleRegistryEntry[] {
        return Array.from(this.rules.values());
    }

    /** Get rules filtered by category */
    byCategory(category: string): RuleRegistryEntry[] {
        return this.entries().filter(r => r.category === category);
    }

    /** Get rules filtered by standard (for coverage rules) */
    byStandard(standard: string): RuleRegistryEntry[] {
        return this.entries().filter(r => r.attributes['standard'] === standard);
    }

    /** Check if a rule is registered */
    has(id: string): boolean {
        return this.rules.has(id);
    }

    /** Register a rule manually (for testing) */
    register(entry: RuleRegistryEntry): void {
        this.rules.set(entry.id, entry);
    }

    /**
     * Populate registry from parsed SysML documents.
     * Looks for part usages whose type is a known ConsistencyRule subtype.
     */
    populateFromDocuments(docs: ParsedDocument[]): void {
        for (const doc of docs) {
            const model = doc.document.parseResult?.value;
            if (!model) continue;

            for (const member of (model as any).members ?? []) {
                if (member.$type === 'PackageDeclaration') {
                    this.walkPackage(member, doc.filePath);
                }
            }
        }
    }

    private walkPackage(pkg: any, filePath: string): void {
        for (const member of pkg.members ?? []) {
            if (member.$type === 'PackageDeclaration') {
                this.walkPackage(member, filePath);
            } else if (member.$type === 'PartUsage') {
                this.tryExtractRule(member, filePath);
            }
        }
    }

    private tryExtractRule(usage: any, filePath: string): void {
        const typeName = usage.type;
        if (!typeName || !RuleRegistry.RULE_TYPES.has(typeName)) return;

        const attrs = this.extractAttributes(usage.body);
        const id = attrs['id'];
        if (!id) return; // Rules must have an ID

        const entry: RuleRegistryEntry = {
            id,
            name: attrs['name'] ?? usage.name ?? id,
            description: attrs['description'] ?? '',
            appliesTo: attrs['appliesTo'] ?? '',
            predicate: attrs['predicate'] ?? '',
            strength: attrs['strength'] ?? 'recommended',
            severity: attrs['severity'] ?? 'warning',
            rationaleText: attrs['rationaleText'] ?? '',
            category: attrs['category'] ?? 'closure',
            attributes: attrs,
            file: filePath,
            superType: typeName,
        };

        this.rules.set(id, entry);
    }

    private extractAttributes(body: any[] | undefined): Record<string, string> {
        if (!body) return {};
        const attrs: Record<string, string> = {};
        for (const member of body) {
            if (member.$type === 'AttributeMember' && member.value) {
                attrs[member.name] = this.extractValue(member.value);
            }
        }
        return attrs;
    }

    private extractValue(value: any): string {
        if (!value) return '';
        switch (value.$type) {
            case 'StringValue':
                return value.value?.replace(/^"|"$/g, '') ?? '';
            case 'IntValue':
            case 'RealValue':
                return String(value.value);
            case 'BooleanValue':
                return value.value;
            case 'EnumValue': {
                // Strip enum type prefix: "RuleStrengthKind::required" → "required"
                const ref: string = value.enumRef ?? '';
                const colonIdx = ref.lastIndexOf('::');
                return colonIdx >= 0 ? ref.slice(colonIdx + 2) : ref;
            }
            default:
                return String(value);
        }
    }
}
