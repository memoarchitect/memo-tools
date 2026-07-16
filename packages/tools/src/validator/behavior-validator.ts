// ─── Behavior Validator ──────────────────────────────────────────────────────
//
// Built-in structural checks for behavior elements (actions, flows, successions).
// These complement the config-driven closure rules with checks that require
// deeper structural analysis of the model.
// ─────────────────────────────────────────────────────────────────────────────

import type { MemoModel, MemoElement, ActionParameter } from '../model/semantic.js';
import type { Violation } from './types.js';

/**
 * Run behavior-specific structural validation.
 *
 * Checks:
 * 1. Unallocated ActionUsage — warning if an action usage has no allocateTo
 * 2. Orphan ActionUsage — warning if an action has no flow or succession edges
 * 3. Incompatible flow types — error if flow source/target params don't match flow item
 */
export function validateBehavior(model: MemoModel): Violation[] {
    const violations: Violation[] = [];

    const actionUsages = model.elementsByKind.get('ActionUsage') || [];

    // Build a lookup: action definition ID/name → parameters
    const defParams = new Map<string, ActionParameter[]>();
    const actionDefs = model.elementsByKind.get('ActionDefinition') || [];
    for (const def of actionDefs) {
        if (def.parameters && def.parameters.length > 0) {
            defParams.set(def.id, def.parameters);
            defParams.set(def.name, def.parameters);
        }
    }

    // Composite actions (those with nested action steps) are allocated and
    // connected through their children — exempt from BV-001/BV-002
    const compositeIds = new Set<string>();
    for (const el of model.elements.values()) {
        if (el.parentAction) compositeIds.add(el.parentAction);
    }

    for (const action of actionUsages) {
        if (compositeIds.has(action.id)) continue;

        // 1. Unallocated action usage
        if (!action.allocatedTo) {
            violations.push({
                ruleId: 'BV-001',
                description: `Action "${action.name}" is not allocated to any structural element`,
                severity: 'warning',
                elementId: action.id,
                elementKind: action.kind,
                elementName: action.name,
                layer: action.layer,
            });
        }

        // 2. Orphan action — no flow or succession edges
        const outgoing = model.outgoing.get(action.id) || [];
        const incoming = model.incoming.get(action.id) || [];
        const allRels = [...outgoing, ...incoming];
        const hasFlowOrSuccession = allRels.some(
            r => r.type === 'flow' || r.type === 'succession'
        );

        if (!hasFlowOrSuccession) {
            violations.push({
                ruleId: 'BV-002',
                description: `Action "${action.name}" is not connected by any flow or succession`,
                severity: 'warning',
                elementId: action.id,
                elementKind: action.kind,
                elementName: action.name,
                layer: action.layer,
            });
        }
    }

    // 3. Incompatible flow types — check that flow item matches parameter types
    // Flow endpoints are action usages. Resolve each to its definition via the
    // actionType attribute stored during build.
    for (const rel of model.relationships) {
        if (rel.type !== 'flow' || !rel.flowItem) continue;

        const source = model.elements.get(rel.sourceId);
        const target = model.elements.get(rel.targetId);
        if (!source || !target) continue;

        // Resolve parameters: use element's own or look up via actionType → definition
        const sourceParams = getParams(source, defParams);
        const targetParams = getParams(target, defParams);

        // Check source has an output param of the flow item type
        if (sourceParams && sourceParams.length > 0) {
            const sourceParam = sourceParams.find(
                p => (p.direction === 'out' || p.direction === 'inout') && p.type === rel.flowItem
            );
            if (!sourceParam) {
                violations.push({
                    ruleId: 'BV-003',
                    description: `Flow of "${rel.flowItem}" — source "${source.name}" has no matching output parameter`,
                    severity: 'error',
                    elementId: source.id,
                    elementKind: source.kind,
                    elementName: source.name,
                    layer: source.layer,
                });
            }
        }

        // Check target has an input param of the flow item type
        if (targetParams && targetParams.length > 0) {
            const targetParam = targetParams.find(
                p => (p.direction === 'in' || p.direction === 'inout') && p.type === rel.flowItem
            );
            if (!targetParam) {
                violations.push({
                    ruleId: 'BV-003',
                    description: `Flow of "${rel.flowItem}" — target "${target.name}" has no matching input parameter`,
                    severity: 'error',
                    elementId: target.id,
                    elementKind: target.kind,
                    elementName: target.name,
                    layer: target.layer,
                });
            }
        }
    }

    return violations;
}

/** Resolve parameters for an element — direct or via actionType → definition lookup */
function getParams(
    element: MemoElement,
    defParams: Map<string, ActionParameter[]>
): ActionParameter[] | undefined {
    if (element.parameters && element.parameters.length > 0) {
        return element.parameters;
    }
    // ActionUsage: look up by actionType attribute
    const actionType = element.attributes['actionType'];
    if (actionType) {
        return defParams.get(actionType);
    }
    return undefined;
}
