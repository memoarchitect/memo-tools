// ─── Behavior Validator ──────────────────────────────────────────────────────
//
// One check: a flow's payload against the parameters at its ends.
//
// There were three. The other two invented rules a validator has no business
// inventing — "an action is allocated" and "an action is sequenced" are claims
// about a METHODOLOGY, and MEMO declares those in the ontology, where a rule
// carries its own subject set, severity, rationale, and can be tailored by a
// project. Written here instead, they applied to every action usage in the
// model, so an operative scenario and a flow step were reported as defects for
// not being wired like a function. CR-MED-022 and CR-ONT-074 already required
// the allocation, properly scoped; CR-MED-023 now requires the connection.
//
// This one stays because it is neither: it is a TYPE check, and it is not the
// ontology's to make. SysIDE — the compiler of record — accepts a flow whose
// payload matches neither end's parameters (measured, not assumed), and the
// constraint grammar cannot compare a flow's item type against the direction
// and type of a parameter on the action at each end.
// ─────────────────────────────────────────────────────────────────────────────

import type { MemoModel, MemoElement, ActionParameter } from '../model/semantic.js';
import type { Violation } from './types.js';

/**
 * Check every flow's payload against the parameters at its ends.
 *
 * An error, not a warning: a flow of something the source never emits or the
 * target never accepts is not an omission, it is a contradiction.
 */
export function validateBehavior(model: MemoModel): Violation[] {
    const violations: Violation[] = [];

    // A flow endpoint resolves its parameters through its definition, so the
    // definitions are indexed by both id and name — a usage names its def in
    // `actionType`, and older content names it by display name.
    const defParams = new Map<string, ActionParameter[]>();
    for (const element of model.elements.values()) {
        if (element.construct !== 'action' || !element.isDefinition) continue;
        if (element.parameters && element.parameters.length > 0) {
            defParams.set(element.id, element.parameters);
            defParams.set(element.name, element.parameters);
        }
    }

    // Check that the flow item matches the parameter types at both ends.
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
