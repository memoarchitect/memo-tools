// ─── DHF Model Query Engine ──────────────────────────────────────────────────
//
// Bridge between DHF templates and MemoModel. Provides query helpers for
// filtering elements, following relationships, computing coverage & gaps.
// ─────────────────────────────────────────────────────────────────────────────

import type { WorkspaceScope } from '../model/workspace-membership.js';
import type { MemoModel, MemoElement, MemoRelationship } from '../model/semantic.js';
import type { ValidationResult, CompletenessReport, Violation } from '../validator/types.js';
import type { MEMOConfig } from '../model/config.js';
import type { StandardsReport } from './standards-report.js';

/** Query context — the interface templates use to access model data */
export interface QueryContext {
    // ─── Element queries ─────────────────────────────────────────────────
    /** All elements */
    allElements(): MemoElement[];
    /** Elements of a specific kind */
    elementsByKind(kind: string): MemoElement[];
    /** Elements matching any of the given kinds */
    elementsByKinds(kinds: string[]): MemoElement[];
    /** Elements in a specific layer */
    elementsByLayer(layer: string): MemoElement[];
    /** Get element by ID */
    element(id: string): MemoElement | undefined;
    /** Get element name by ID (returns ID if not found) */
    elementName(id: string): string;

    // ─── Relationship queries ────────────────────────────────────────────
    /** All relationships */
    allRelationships(): MemoRelationship[];
    /** Relationships of a specific type */
    relationshipsByType(type: string): MemoRelationship[];
    /** Get related elements via a relationship type */
    related(elementId: string, relType: string, direction: 'outgoing' | 'incoming'): MemoRelationship[];
    /** Get all outgoing relationships for an element */
    outgoing(elementId: string): MemoRelationship[];
    /** Get all incoming relationships for an element */
    incoming(elementId: string): MemoRelationship[];

    // ─── Gap & coverage queries ──────────────────────────────────────────
    /** Violations for a specific element */
    violationsFor(elementId: string): Violation[];
    /** All violations of a specific severity */
    violationsBySeverity(severity: 'error' | 'warning' | 'info'): Violation[];
    /** Number of unmitigated hazards (hazards without incoming mitigates) */
    unmitigatedCount(): number;
    /** Requirements without traces */
    untracedRequirements(): MemoElement[];
    /** Number of validation errors */
    errorCount(): number;
    /** Number of warnings */
    warningCount(): number;

    // ─── Summary queries ─────────────────────────────────────────────────
    modelName: string;
    totalElements(): number;
    totalRelationships(): number;
    layerCount(): number;
    overallCompleteness(): number;
    layerSummary(): Array<{ id: string; label: string; count: number; completeness: number; color: string }>;
    /** Cross-reference: get trace chains from an element */
    traceChain(elementId: string, maxDepth?: number): Array<{ element: MemoElement; relationship: MemoRelationship; depth: number }>;

    // ─── Standards conformance ───────────────────────────────────────────
    /**
     * The clause coverage report, when the caller computed one.
     *
     * It is not derivable from the model alone: `required(project)` needs the
     * clause library and the declared regimes, and the clauses a project has
     * not claimed are not in its model by definition. Callers that can supply
     * it do; a ```memo-standards``` block rendered without it says so rather
     * than rendering an empty table.
     */
    standardsReport?: StandardsReport;
}

/** Create a QueryContext from model data */
export function createQueryContext(
    model: MemoModel,
    validation: ValidationResult,
    completeness: CompletenessReport,
    config: MEMOConfig,
    standardsReport?: StandardsReport,
    /**
     * One workspace (`--workspace`): the element queries list only its members, and a trace edge that
     * touches another system's element is not followed. The graph itself stays whole, as in
     * validation (`WorkspaceScope`); `validation` and `completeness` are the caller's, scoped the same way.
     */
    workspace?: Pick<WorkspaceScope, 'subjects' | 'foreign'>,
): QueryContext {
    const member = (e: MemoElement) => !workspace || workspace.subjects.has(e.id);
    const kept = (rel: MemoRelationship) => !workspace || (!workspace.foreign.has(rel.sourceId) && !workspace.foreign.has(rel.targetId));
    const extent = (kind: string) => (model.elementsByKind.get(kind) || []).filter(member);
    const edgesFrom = (id: string) => (model.outgoing.get(id) || []).filter(kept);
    const edgesTo = (id: string) => (model.incoming.get(id) || []).filter(kept);
    // Pre-index violations by element
    const violationsByElement = new Map<string, Violation[]>();
    for (const v of validation.violations) {
        if (!violationsByElement.has(v.elementId)) violationsByElement.set(v.elementId, []);
        violationsByElement.get(v.elementId)!.push(v);
    }

    // Cache for unmitigated count
    let _unmitigatedCount: number | null = null;

    return {
        // ─── Element queries ─────────────────────────────────────────────
        allElements: () => Array.from(model.elements.values()).filter(member),
        elementsByKind: (kind: string) => extent(kind),
        elementsByKinds: (kinds: string[]) => {
            const result: MemoElement[] = [];
            for (const kind of kinds) {
                result.push(...extent(kind));
            }
            return result;
        },
        elementsByLayer: (layer: string) => (model.elementsByLayer.get(layer) || []).filter(member),
        element: (id: string) => model.elements.get(id),
        elementName: (id: string) => model.elements.get(id)?.name || id,

        // ─── Relationship queries ────────────────────────────────────────
        allRelationships: () => workspace ? model.relationships.filter(rel => kept(rel) && (workspace.subjects.has(rel.sourceId) || workspace.subjects.has(rel.targetId))) : model.relationships,
        relationshipsByType: (type: string) => model.relationshipsByType.get(type) || [],
        related: (elementId: string, relType: string, direction: 'outgoing' | 'incoming') => {
            const rels = direction === 'outgoing' ? edgesFrom(elementId) : edgesTo(elementId);
            return rels.filter(r => r.type === relType);
        },
        outgoing: (elementId: string) => edgesFrom(elementId),
        incoming: (elementId: string) => edgesTo(elementId),

        // ─── Gap & coverage queries ──────────────────────────────────────
        violationsFor: (elementId: string) => violationsByElement.get(elementId) || [],
        violationsBySeverity: (severity) => validation.violations.filter(v => v.severity === severity),
        unmitigatedCount: () => {
            if (_unmitigatedCount === null) {
                const hazards = extent('Hazard');
                _unmitigatedCount = hazards.filter(h => {
                    const mitigations = edgesTo(h.id).filter(r => r.type === 'mitigates');
                    return mitigations.length === 0;
                }).length;
            }
            return _unmitigatedCount;
        },
        untracedRequirements: () => {
            const reqs = [...extent('Requirement'), ...extent('Requirement')];
            return reqs.filter(r => {
                const out = edgesFrom(r.id);
                const inc = edgesTo(r.id);
                const hasTrace = out.some(rel => ['traceTo', 'satisfies'].includes(rel.type))
                    || inc.some(rel => ['satisfies', 'derivedFrom'].includes(rel.type));
                return !hasTrace;
            });
        },
        errorCount: () => validation.violations.filter(v => v.severity === 'error').length,
        warningCount: () => validation.violations.filter(v => v.severity === 'warning').length,

        // ─── Summary queries ─────────────────────────────────────────────
        modelName: config.modelName || 'MEMO Project',
        totalElements: () => workspace ? workspace.subjects.size : model.elements.size,
        totalRelationships: () => workspace ? model.relationships.filter(rel => kept(rel) && (workspace.subjects.has(rel.sourceId) || workspace.subjects.has(rel.targetId))).length : model.relationships.length,
        layerCount: () => model.elementsByLayer.size,
        overallCompleteness: () => completeness.overall,
        layerSummary: () => completeness.layers
            .filter(l => l.totalElements > 0)
            .map(l => ({
                id: l.layerId,
                label: l.layerLabel,
                count: l.totalElements,
                completeness: l.percentage,
                color: l.layerColor,
            })),
        traceChain: (elementId: string, maxDepth = 5) => {
            const result: Array<{ element: MemoElement; relationship: MemoRelationship; depth: number }> = [];
            const visited = new Set<string>();
            const queue: Array<{ id: string; depth: number }> = [{ id: elementId, depth: 0 }];

            while (queue.length > 0) {
                const { id, depth } = queue.shift()!;
                if (visited.has(id) || depth >= maxDepth) continue;
                visited.add(id);

                const rels = edgesFrom(id);
                for (const rel of rels) {
                    const target = model.elements.get(rel.targetId);
                    if (target && !visited.has(target.id)) {
                        result.push({ element: target, relationship: rel, depth: depth + 1 });
                        queue.push({ id: target.id, depth: depth + 1 });
                    }
                }
            }
            return result;
        },

        standardsReport,
    };
}
