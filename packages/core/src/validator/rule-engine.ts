// ─── Constraint Validation ─────────────────────────────────────────────────────
//
// Evaluates native SysML v2 / KerML constraints against the built model.
// Rules are authored as `constraint def` / `requirement def` bodies in the
// ontology (compiled by collectNativeConstraints) and evaluated by the KerML
// expression evaluator (constraint-eval.ts). Structural behavior checks run
// alongside. The proprietary ClosureRule path was removed in Epic EE-4.
// ─────────────────────────────────────────────────────────────────────────────

import type { MemoModel } from '../model/semantic.js';
import type { Violation, ValidationResult } from './types.js';
import type { CompiledConstraint } from './constraint-eval.js';
import { evaluateConstraintNode } from './constraint-eval.js';
import { validateBehavior } from './behavior-validator.js';
import { validateViews } from './view-validator.js';

/**
 * Full model validation: native constraints + structural checks.
 * Preferred entry point — combines all validation passes.
 *
 * @param nativeConstraints constraints compiled from ontology `constraint def` bodies
 *                          (see collectNativeConstraints). Evaluated as native KerML
 *                          expressions over each constraint's subject kind.
 */
export function validateModel(
    model: MemoModel,
    nativeConstraints: CompiledConstraint[] = []
): ValidationResult {
    const behaviorViolations = validateBehavior(model);
    const viewViolations = validateViews(model);

    const nativeViolations: Violation[] = [];
    let nativePassed = 0;
    for (const constraint of nativeConstraints) {
        const violations = evaluateConstraintNode(constraint, constraint.ast, model);
        if (violations.length === 0) nativePassed++;
        nativeViolations.push(...violations);
    }

    return {
        violations: [...behaviorViolations, ...viewViolations, ...nativeViolations],
        rulesEvaluated: 5 + nativeConstraints.length,
        rulesPassed: nativePassed,
        timestamp: Date.now(),
    };
}
