// ─── System boundaries (plan O16) ────────────────────────────────────────────
//
// A system is a boundary: its workspace never reaches another system or the system of systems, and
// the closure drops such a link without saying so. This turns what it dropped into findings. The
// references are computed with the membership (`WorkspaceMembership.boundaryReferences`); this only
// states them, on the element that makes each one. Which rule it is, at what severity and whether it
// is tailored, is the ontology's (`evaluator = "workspace"`), as for AR-IBD-001.
// ─────────────────────────────────────────────────────────────────────────────

import type { MemoModel } from '../model/semantic.js';
import type { WorkspaceMembership } from '../model/workspace-membership.js';
import type { Violation } from './types.js';

export interface WorkspaceBoundaryRule {
    id: string;
    severity: Violation['severity'];
}

export function validateWorkspaceBoundaries(
    model: MemoModel,
    membership: WorkspaceMembership,
    rule: WorkspaceBoundaryRule,
): Violation[] {
    const nameOf = (id: string) => model.elements.get(id)?.name ?? id;
    return membership.boundaryReferences.flatMap(reference => {
        const element = model.elements.get(reference.elementId);
        if (!element) return [];
        const how = reference.via === 'typing' ? 'is typed by' : `has a ${reference.via} to`;
        return [{
            ruleId: rule.id,
            severity: rule.severity,
            elementId: element.id,
            elementName: element.name,
            elementKind: element.kind,
            layer: element.layer,
            file: element.file,
            description: `"${element.name}" in system "${nameOf(reference.workspace)}" ${how} "${nameOf(reference.target)}", another system or the system of systems; a system does not reference across its boundary`,
        }];
    });
}
