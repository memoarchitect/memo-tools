// ─── Rule policy writer ───────────────────────────────────────────────────────
//
// Turn a tailoring decision made in Architect into `RulePolicy` SysML.
//
// The editor names a rule and a decision; this renders the SysML. That split is
// the point of "writing SysML through the command boundary" (section 18.4
// deliverable 8): the browser never composes model source, so a policy authored
// in the UI is the same construct, in the same file, subject to the same
// precondition checks, as one typed in SysIDE.
//
// The refusals below are section 10.2's, enforced here rather than in the UI —
// a check that lives in a React component is a suggestion, because the message
// can arrive from anywhere.
//
// Design reference: sections 10.1-10.3.
// ─────────────────────────────────────────────────────────────────────────────

import type { EffectiveRule } from '../model/methodology-resolver.js';

export interface RulePolicyRequest {
    targetRuleType: string;
    disposition: 'enabled' | 'disabled' | 'replaced';
    severityOverride?: 'error' | 'warning' | 'info';
    replacementRuleType?: string;
    rationaleText: string;
    authority?: string;
    approvalReference?: string;
}

export interface RulePolicyRefusal {
    code:
        | 'unknown-rule'
        | 'invariant-not-tailorable'
        | 'missing-rationale'
        | 'missing-replacement'
        | 'replacement-not-resolvable';
    message: string;
}

/**
 * Check a tailoring decision against the rule it targets.
 *
 * Returns the refusal rather than throwing, so the caller can send it back to
 * the editor as a diagnostic the user can act on.
 */
export function checkRulePolicy(
    request: RulePolicyRequest,
    effectiveRules: readonly EffectiveRule[],
): RulePolicyRefusal | undefined {
    const target = effectiveRules.find(rule => rule.sourceRuleType === request.targetRuleType);
    if (!target) {
        return {
            code: 'unknown-rule',
            message: `No rule named ${request.targetRuleType} is in the effective rule set. `
                + 'A policy may only target a rule the project actually resolves.',
        };
    }

    // An invariant is the ontology's own floor. It can be changed in an
    // ontology release, never by a downstream methodology — otherwise the
    // guarantee it represents is not a guarantee.
    if (target.tailoring === 'invariant' && request.disposition !== 'enabled') {
        return {
            code: 'invariant-not-tailorable',
            message: `${request.targetRuleType} is an invariant. Invariants cannot be disabled or `
                + 'replaced by a methodology; changing one requires an ontology release.',
        };
    }

    // A tailoring decision without a rationale is an unattributable change to
    // what the model is checked against. Section 10.2 refuses it.
    if (request.disposition !== 'enabled' && !request.rationaleText.trim()) {
        return {
            code: 'missing-rationale',
            message: 'A rule may not be disabled or replaced without a written rationale.',
        };
    }

    if (request.disposition === 'replaced') {
        if (!request.replacementRuleType?.trim()) {
            return {
                code: 'missing-replacement',
                message: 'A `replaced` disposition must name the rule that replaces it.',
            };
        }
        if (request.replacementRuleType === request.targetRuleType) {
            return {
                code: 'replacement-not-resolvable',
                message: 'A rule cannot replace itself.',
            };
        }
    }

    return undefined;
}

/**
 * Render the `RulePolicy` usage.
 *
 * The target is named by narrowing the reference's TYPE — `ref :>> targetRule :
 * X` — not by binding a value. Session 3 established that binding a value to a
 * `constraint def` is not portable: SysIDE rejects it, because a value must be
 * a feature and a definition is not.
 */
export function renderRulePolicy(request: RulePolicyRequest, indent = '        '): string {
    const usageName = `policy${request.targetRuleType.charAt(0).toUpperCase()}${request.targetRuleType.slice(1)}`;
    const lines = [
        `${indent}part ${usageName} : RulePolicy :> rulePolicy {`,
        `${indent}    ref :>> targetRule : ${request.targetRuleType};`,
        `${indent}    attribute :>> disposition = RuleDispositionKind::${request.disposition};`,
    ];
    if (request.disposition === 'replaced' && request.replacementRuleType) {
        lines.push(`${indent}    ref :>> replacementRule : ${request.replacementRuleType};`);
    }
    if (request.severityOverride) {
        lines.push(`${indent}    attribute :>> severityOverride = RuleSeverityKind::${request.severityOverride};`);
    }
    lines.push(`${indent}    attribute :>> rationaleText = ${quote(request.rationaleText)};`);
    if (request.authority) {
        lines.push(`${indent}    attribute :>> authority = ${quote(request.authority)};`);
    }
    if (request.approvalReference) {
        lines.push(`${indent}    attribute :>> approvalReference = ${quote(request.approvalReference)};`);
    }
    lines.push(`${indent}}`);
    return lines.join('\n');
}

/**
 * Insert the rendered policy into a methodology definition's body.
 *
 * Appends inside the `MethodologyDefinition` usage the file declares, before
 * its closing brace. Returns undefined when no such usage is found, so the
 * caller reports a diagnostic instead of writing a policy into open space where
 * it would parse but never apply.
 */
export function insertRulePolicy(source: string, policy: string): string | undefined {
    const lines = source.split('\n');
    const start = lines.findIndex(line => /part\s+\w+\s*:\s*MethodologyDefinition\s*\{/.test(line));
    if (start < 0) return undefined;

    let depth = 0;
    for (let i = start; i < lines.length; i++) {
        depth += (lines[i].match(/\{/g) ?? []).length;
        depth -= (lines[i].match(/\}/g) ?? []).length;
        if (depth === 0) {
            lines.splice(i, 0, policy);
            return lines.join('\n');
        }
    }
    return undefined;
}

function quote(value: string): string {
    return JSON.stringify(value);
}
