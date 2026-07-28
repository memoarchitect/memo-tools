// ─── View Validator ──────────────────────────────────────────────────────────
//
// Structural checks for view elements (Epic KK-1). Every diagram view must
// resolve to exactly one of the eight SysML v2 spec view kinds — an unmapped
// legacy `diagramType` key or an off-taxonomy `viewKind` declaration cannot,
// so both are flagged as warnings.
// ─────────────────────────────────────────────────────────────────────────────

import type { MemoModel } from '../model/semantic.js';
import type { Violation } from './types.js';
import { DIAGRAM_TYPE_TO_VIEW_KIND, VIEW_KINDS, normalizeViewKind } from '../model/view-kinds.js';

/**
 * Run view-specific structural validation.
 *
 * Checks:
 * 1. VW-001 — diagramType key has no view-kind mapping
 * 2. VW-002 — declared viewKind on a diagram view is not a spec view kind
 * 3. VW-003 — a view has no viewpoint conformance binding
 */
export function validateViews(model: MemoModel): Violation[] {
    const violations: Violation[] = [];

    for (const el of model.elements.values()) {
        const diagramType = el.attributes['diagramType'];
        const declared = el.attributes['viewKind'];
        if (!diagramType && !declared) continue;

        const viewpointBinding = el.attributes['viewpointDefinition'] || el.attributes['viewpoint'];
        if (!viewpointBinding) {
            violations.push({
                ruleId: 'VW-003',
                description: `View "${el.name}" must conform to at least one viewpoint through viewpointDefinition`,
                severity: 'error',
                elementId: el.id,
                elementKind: el.kind,
                elementName: el.name,
                layer: el.layer,
            });
        }

        if (diagramType && !DIAGRAM_TYPE_TO_VIEW_KIND[diagramType]) {
            violations.push({
                ruleId: 'VW-001',
                description: `View "${el.name}" has unmapped diagramType "${diagramType}" — it does not resolve to a SysML v2 view kind`,
                severity: 'warning',
                elementId: el.id,
                elementKind: el.kind,
                elementName: el.name,
                layer: el.layer,
            });
        }

        // Document-backed views use DocumentViewKind on the same attribute;
        // only diagram views must use the eight diagram view kinds.
        if (diagramType && declared && !normalizeViewKind(declared)) {
            violations.push({
                ruleId: 'VW-002',
                description: `View "${el.name}" declares viewKind "${declared}" which is not one of the SysML v2 view kinds (${VIEW_KINDS.join(', ')})`,
                severity: 'warning',
                elementId: el.id,
                elementKind: el.kind,
                elementName: el.name,
                layer: el.layer,
            });
        }
    }

    return violations;
}
