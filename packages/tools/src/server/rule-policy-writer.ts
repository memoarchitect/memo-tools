// ─── Rule policy writer ───────────────────────────────────────────────────────
//
// Turn a tailoring decision made in Architect into `RulePolicy` SysML.
//
// The editor names a rule and a decision; this renders the SysML. That split is
// the point of "writing SysML through the command boundary" (section 18.4
// deliverable 8): the browser never composes model source, so a policy authored
// in the UI is the same construct, in the same file, subject to the same
// precondition checks, as one typed in a text editor.
//
// The refusals below are section 10.2's, enforced here rather than in the UI —
// a check that lives in a React component is a suggestion, because the message
// can arrive from anywhere.
//
// Design reference: sections 10.1-10.3.
// ─────────────────────────────────────────────────────────────────────────────

import type { EffectiveRule } from '../model/methodology-resolver.js';
import { layersWithRules, rulesSelectedBy } from '../model/methodology-resolver.js';
import type { ClauseFact } from '../validator/rule-clauses.js';
import { METHOD_BINDING_KINDS } from '../model/native-project.js';

export interface RulePolicyRequest {
    /**
     * What the policy governs: exactly one of a rule (a `constraint def` name), a
     * standard (its qualified name), or a category (a layer namespace).
     */
    targetRuleType?: string;
    targetStandard?: string;
    targetCategory?: string;
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
        | 'multiple-targets'
        | 'no-target'
        | 'selects-no-rule'
        | 'bulk-replacement'
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
    const selectors = [request.targetRuleType, request.targetStandard, request.targetCategory].filter(Boolean);
    if (selectors.length === 0) {
        return { code: 'no-target', message: 'A policy must name a rule, a standard or a category.' };
    }
    if (selectors.length > 1) {
        return {
            code: 'multiple-targets',
            message: 'A policy selects what it governs in exactly one way: a rule, a standard or a category.',
        };
    }
    if (!request.targetRuleType) return checkBulkPolicy(request, effectiveRules);

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
 * A policy that selects several rules: it must reach at least one the decision
 * can change, and may not replace them. Invariants in the selection are left
 * running, as the resolver does; they are not a refusal unless nothing else is.
 */
function checkBulkPolicy(
    request: RulePolicyRequest,
    effectiveRules: readonly EffectiveRule[],
): RulePolicyRefusal | undefined {
    const selection = request.targetStandard ? `the standard ${request.targetStandard}` : `the category ${request.targetCategory}`;
    const matched = rulesSelectedBy(effectiveRules, request);
    if (matched.length === 0) {
        return {
            code: 'selects-no-rule',
            message: `${selection} matches no rule in the effective rule set. A policy may only select rules the project resolves.`
                + (request.targetCategory ? ` Layers with rules: ${layersWithRules(effectiveRules).join(', ')}.` : ''),
        };
    }
    if (request.disposition === 'replaced') {
        return {
            code: 'bulk-replacement',
            message: 'A policy that selects several rules can disable them or change their severity, not replace them.',
        };
    }
    if (request.disposition === 'disabled' && matched.every(rule => rule.tailoring === 'invariant')) {
        return {
            code: 'invariant-not-tailorable',
            message: `Every rule of ${selection} is an invariant, and invariants cannot be disabled by a methodology.`,
        };
    }
    if (request.disposition !== 'enabled' && !request.rationaleText.trim()) {
        return { code: 'missing-rationale', message: 'A rule may not be disabled or replaced without a written rationale.' };
    }
    return undefined;
}

/**
 * The standard a person means: its qualified name, or its designation or part
 * of it ("ISO 14971", "62304"). Undefined unless exactly one standard matches,
 * so a loose word never selects the wrong set of rules.
 */
export function resolveStandardReference(clauses: readonly ClauseFact[], text: string): string | undefined {
    const wanted = text.trim().toLowerCase();
    const standards = new Map<string, string>();
    for (const clause of clauses) standards.set(clause.standardName, clause.standard);
    if (standards.has(text.trim())) return text.trim();
    const found = [...standards].filter(([, designation]) => designation.toLowerCase().includes(wanted));
    return found.length === 1 ? found[0][0] : undefined;
}

/** The usage name a policy is written under. */
function policyUsageName(request: RulePolicyRequest): string {
    const raw = request.targetRuleType
        ?? (request.targetStandard ? request.targetStandard.split('::').pop()! : request.targetCategory!);
    const camel = raw.replace(/[^A-Za-z0-9]+(.)?/g, (_, c: string | undefined) => (c ?? '').toUpperCase());
    return `policy${camel.charAt(0).toUpperCase()}${camel.slice(1)}`;
}

/**
 * Render the `RulePolicy` usage.
 *
 * The target is named by narrowing the reference's TYPE — `ref :>> targetRule :
 * X` — not by binding a value. Session 3 established that binding a value to a
 * `constraint def` is not portable: a SysML v2 compiler rejects it, because a value must be
 * a feature and a definition is not.
 */
export function renderRulePolicy(request: RulePolicyRequest, indent = '        '): string {
    const target = request.targetRuleType
        ? `ref :>> targetRule : ${request.targetRuleType};`
        : request.targetStandard
            // A standard is a usage, not a definition: the reference is valued, not typed.
            ? `ref :>> targetStandard = ${request.targetStandard};`
            : `attribute :>> targetCategory = ${quote(request.targetCategory!)};`;
    const lines = [
        `${indent}part ${policyUsageName(request)} : RulePolicy :> rulePolicy {`,
        `${indent}    ${target}`,
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
 * Appends inside the `ModelMethodBinding` (or deprecated `ProjectMethodBinding`) or `MethodologyDefinition` usage the file declares, before
 * its closing brace. Returns undefined when no such usage is found, so the
 * caller reports a diagnostic instead of writing a policy into open space where
 * it would parse but never apply.
 */
export function insertRulePolicy(source: string, policy: string): string | undefined {
    // Two policies cannot share a usage name in one methodology. A later policy
    // with the same target takes the next free number rather than a compile error.
    const taken = new Set([...source.matchAll(/part\s+(\w+)\s*:\s*RulePolicy\b/g)].map(match => match[1]));
    const name = /part\s+(\w+)\s*:\s*RulePolicy\b/.exec(policy)?.[1];
    if (name && taken.has(name)) {
        let n = 2;
        while (taken.has(`${name}${n}`)) n++;
        policy = policy.replace(`part ${name} :`, `part ${name}${n} :`);
    }
    const lines = source.split('\n');
    // A model states its own decisions in its binding; a reusable methodology states its own.
    const owners = ['MethodologyDefinition', ...METHOD_BINDING_KINDS].join('|');
    const start = lines.findIndex(line => new RegExp(`part\\s+\\w+\\s*:\\s*(${owners})\\s*\\{`).test(line));
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
