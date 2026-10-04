// ─── The tailoring record ────────────────────────────────────────────────────
//
// A user may switch off, downgrade or replace any rule, a medical-device one
// included. What the project owes is the record: why, who decided, and under
// what approval. This lists every rule the project's policies changed, with the
// policies that did it, and says where a record is thin
// (plans/memo-rules-domain-trace-and-editor.md).
//
// It is governance, not evidence that the model was validated (design 10.4).
// ─────────────────────────────────────────────────────────────────────────────

import type { EffectiveRule } from '../model/methodology-resolver.js';

export interface TailoringChange {
    /** The methodology or project usage that applied the policy. */
    source: string;
    level: 'methodology' | 'project';
    policy: string;
    disposition?: string;
    severityOverride?: string;
    replacement?: string;
    rationaleText?: string;
    authority?: string;
    approvalReference?: string;
    approvedBy?: string;
    approvedOn?: string;
    file: string;
}

export interface TailoringEntry {
    ruleId: string;
    ruleType: string;
    domain?: string;
    disposition: EffectiveRule['disposition'];
    declaredSeverity: string;
    effectiveSeverity: string;
    /** The rule that evaluates in its place, when it was replaced. */
    activeRuleId?: string;
    changes: TailoringChange[];
    /** What the record lacks: a thin record is reported, never refused. */
    gaps: string[];
}

/**
 * Every rule a policy touched. A medical-device rule's record also needs an
 * authority and an approval reference, which a modelling rule's does not.
 */
export function tailoringRecord(rules: readonly EffectiveRule[]): TailoringEntry[] {
    const entries: TailoringEntry[] = [];
    for (const rule of rules) {
        if (rule.policyChain.length === 0 && rule.disposition === 'enabled' && rule.effectiveSeverity === rule.declaredSeverity) continue;
        const changes: TailoringChange[] = rule.policyChain.map(({ source, level, policy }) => ({
            source, level, policy: policy.usageName,
            ...(policy.disposition ? { disposition: policy.disposition } : {}),
            ...(policy.severityOverride ? { severityOverride: policy.severityOverride } : {}),
            ...(policy.replacementRuleType ? { replacement: policy.replacementRuleType } : {}),
            ...(policy.rationaleText ? { rationaleText: policy.rationaleText } : {}),
            ...(policy.authority ? { authority: policy.authority } : {}),
            ...(policy.approvalReference ? { approvalReference: policy.approvalReference } : {}),
            ...(policy.approvedBy ? { approvedBy: policy.approvedBy } : {}),
            ...(policy.approvedOn ? { approvedOn: policy.approvedOn } : {}),
            file: policy.sourceFile,
        }));
        const gaps: string[] = [];
        const last = changes[changes.length - 1];
        if (last && !last.rationaleText) gaps.push('no rationale');
        if (rule.domain === 'medicalDevice' && last) {
            if (!last.authority) gaps.push('no authority');
            if (!last.approvalReference) gaps.push('no approval reference');
        }
        entries.push({
            ruleId: rule.sourceRuleId,
            ruleType: rule.sourceRuleType,
            ...(rule.domain ? { domain: rule.domain } : {}),
            disposition: rule.disposition,
            declaredSeverity: rule.declaredSeverity,
            effectiveSeverity: rule.effectiveSeverity,
            ...(rule.disposition === 'replaced' ? { activeRuleId: rule.activeRuleId } : {}),
            changes,
            gaps,
        });
    }
    return entries.sort((a, b) => a.ruleId.localeCompare(b.ruleId));
}
