// ─── Constraint Validation ─────────────────────────────────────────────────────
//
// Evaluates native SysML v2 / KerML constraints against the built model.
// Rules are authored as `constraint def` / `requirement def` bodies in the
// ontology (compiled by collectNativeConstraints) and evaluated by the KerML
// expression evaluator (constraint-eval.ts). Structural behavior checks run
// alongside. The proprietary ClosureRule path was removed in Epic EE-4.
// ─────────────────────────────────────────────────────────────────────────────

import type { MemoModel } from '../model/semantic.js';
import type { Violation, ValidationResult, ViolationRuleProvenance } from './types.js';
import type { EffectiveRule } from '../model/methodology-resolver.js';
import type { CompiledConstraint } from './constraint-eval.js';
import { evaluateConstraintNode } from './constraint-eval.js';
import { validateBehavior } from './behavior-validator.js';
import { validateArchitecture } from './architecture-validator.js';
import { validateViews } from './view-validator.js';
import type { KindRegistry } from '../model/kind-registry.js';

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
    nativeConstraints: CompiledConstraint[] = [],
    kindRegistry?: KindRegistry,
    effectiveRules?: EffectiveRule[],
): ValidationResult {
    // Section 10.4: a violation reports the rule's provenance, not just its ID.
    // Keyed by active rule ID, because that is what the violation carries.
    const provenanceByRuleId = new Map<string, ViolationRuleProvenance>();
    for (const rule of effectiveRules ?? []) {
        provenanceByRuleId.set(rule.activeRuleId, {
            activeRuleType: rule.activeRuleType,
            baseRuleId: rule.disposition === 'replaced' ? rule.sourceRuleId : undefined,
            declaredSeverity: rule.declaredSeverity,
            tailoring: rule.tailoring,
            policyChain: rule.policyChain.map(entry => ({
                source: entry.source,
                level: entry.level,
                disposition: entry.policy.disposition ?? 'enabled',
            })),
            rationaleText: rule.rationaleText,
            authority: rule.authority,
            approvalReference: rule.approvalReference,
            sourceFile: rule.sourceFile,
        });
    }

    const behaviorViolations = validateBehavior(model);
    // AR-IBD-001's subject scope comes from the ontology's own `appliesTo`,
    // so the rule's reach is declared where the rule is declared.
    const ibdScope = nativeConstraints.find(c => c.evaluator === 'architecture')?.appliesToKind;
    const architectureViolations = validateArchitecture(model, ibdScope, kindRegistry);
    const viewViolations = validateViews(model);

    const nativeViolations: Violation[] = [];
    let nativePassed = 0;
    for (const constraint of nativeConstraints) {
        if (constraint.evaluator && constraint.evaluator !== 'native') continue;
        const violations = evaluateConstraintNode(constraint, constraint.ast, model, kindRegistry);
        if (violations.length === 0) nativePassed++;
        nativeViolations.push(...violations);
    }

    const violations = [...behaviorViolations, ...architectureViolations, ...viewViolations, ...nativeViolations]
        .map(violation => ({
            ...violation,
            provenance: model.elements.get(violation.elementId)?.provenance,
            ruleProvenance: provenanceByRuleId.get(violation.ruleId),
        }));
    return {
        violations,
        rulesEvaluated: 6 + nativeConstraints.length,
        rulesPassed: nativePassed,
        timestamp: Date.now(),
    };
}
