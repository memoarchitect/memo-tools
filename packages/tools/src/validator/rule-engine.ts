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
import { evaluateConstraintSubjects } from './constraint-eval.js';
import { validateBehavior } from './behavior-validator.js';
import { validateArchitecture } from './architecture-validator.js';
import { validateViews } from './view-validator.js';
import type { KindRegistry } from '../model/kind-registry.js';
import { BUILTIN_RULE_IDS } from './builtin-rules.js';

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
    /** Methodology scope: which elements a rule may be evaluated ON. */
    inScope?: (element: import('../model/semantic.js').MemoElement) => boolean,
    /**
     * A workspace chosen with `--workspace`. Unlike methodology scope it is a view, not tailoring, so
     * it narrows the subjects of EVERY rule, invariants included; the graph stays whole and only the
     * evidence from another system's elements stops counting (see `WorkspaceScope`).
     */
    workspace?: Pick<import('../model/workspace-membership.js').WorkspaceScope, 'subjects' | 'foreign'>,
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

    const unresolvedViolations: Violation[] = (model.unresolvedReferences ?? []).map(ref => ({
        ruleId: 'XR-001', severity: 'error', elementId: ref.elementId,
        elementName: ref.elementName, elementKind: ref.elementKind,
        layer: model.elements.get(ref.elementId)?.layer ?? 'unknown',
        description: `references "${ref.reference}", but package "${ref.packageName}" declares no "${ref.missingName}"`,
        file: ref.file,
    }));

    const behaviorViolations = validateBehavior(model);
    // AR-IBD-001's subject scope comes from the ontology's own `appliesTo`,
    // so the rule's reach is declared where the rule is declared.
    const ibdScope = nativeConstraints.find(c => c.evaluator === 'architecture')?.appliesToKind;
    const architectureViolations = validateArchitecture(model, ibdScope, kindRegistry);
    const viewViolations = validateViews(model);

    const nativeViolations: Violation[] = [];
    let nativePassed = 0;
    let nativeVacuous = 0;
    // A constraint carrying a non-native `evaluator` is a first-class rule
    // whose predicate a TypeScript function computes — AR-IBD-001 is the only
    // one today. Its violations come from the built-in validator above, so it
    // is skipped here, but it still has to be counted: skipping it silently
    // meant one rule was evaluated and reported as neither passed nor failed.
    const delegated: string[] = [];
    for (const constraint of nativeConstraints) {
        if (constraint.evaluator && constraint.evaluator !== 'native') {
            delegated.push(constraint.id);
            continue;
        }
        // An invariant runs on every subject of its kind, in scope or not. It
        // holds the ontology's own consistency, which a methodology may not
        // tailor — and leaving an element out of the rule's subjects is
        // tailoring it, just without a policy to show for it.
        const methodologyScope = constraint.tailoring === 'invariant' ? undefined : inScope;
        const subjectScope = workspace
            ? (element: import('../model/semantic.js').MemoElement) =>
                workspace.subjects.has(element.id) && (!methodologyScope || methodologyScope(element))
            : methodologyScope;
        const { violations, subjectCount } = evaluateConstraintSubjects(
            constraint, constraint.ast, model, kindRegistry, subjectScope, workspace?.foreign);
        if (subjectCount === 0) nativeVacuous++;
        else if (violations.length === 0) nativePassed++;
        nativeViolations.push(...violations);
    }

    // The built-in validators take no subject predicate, so a workspace keeps their findings by the
    // element they are about. A model-wide finding (`__model__`) belongs to no element and stays.
    const inWorkspace = (violation: Violation) =>
        !workspace || violation.elementId === '__model__' || workspace.subjects.has(violation.elementId);
    const violations = [
        ...[...unresolvedViolations, ...behaviorViolations, ...architectureViolations, ...viewViolations].filter(inWorkspace),
        ...nativeViolations,
    ]
        .map(violation => ({
            ...violation,
            provenance: model.elements.get(violation.elementId)?.provenance,
            ruleProvenance: provenanceByRuleId.get(violation.ruleId),
        }));

    // Built-in rules are counted from the enumerated list, not from a literal.
    // The literal said 6; there are 7, and it had no way to stay right. A
    // built-in rule passes when it raised no violation, which is the same
    // definition used for native constraints — previously `rulesPassed`
    // counted only native rules, so "61 evaluated, 32 passed" was reporting
    // two different denominators as though they were one.
    const raisedByBuiltinValidators = new Set([
        ...unresolvedViolations, ...behaviorViolations, ...architectureViolations, ...viewViolations,
    ].filter(inWorkspace).map(violation => violation.ruleId));
    const builtinPassed = BUILTIN_RULE_IDS.filter(id => !raisedByBuiltinValidators.has(id)).length;
    const delegatedPassed = delegated.filter(id => !raisedByBuiltinValidators.has(id)).length;

    return {
        violations,
        rulesEvaluated: BUILTIN_RULE_IDS.length + nativeConstraints.length,
        rulesPassed: builtinPassed + delegatedPassed + nativePassed,
        rulesVacuous: nativeVacuous,
        timestamp: Date.now(),
    };
}
