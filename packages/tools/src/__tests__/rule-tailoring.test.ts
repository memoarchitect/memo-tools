// ─── The tailoring record ────────────────────────────────────────────────────
//
// A user may tailor any rule. The record says what was changed, by whom and
// why, and where it is thin (plans/memo-rules-domain-trace-and-editor.md).
// ─────────────────────────────────────────────────────────────────────────────

import { describe, expect, it } from 'vitest';
import type { EffectiveRule } from '../model/methodology-resolver.js';
import { tailoringRecord } from '../validator/rule-tailoring.js';

const policy = (over: Record<string, unknown> = {}) => ({
    source: 'project', level: 'project' as const,
    policy: { usageName: 'p1', sourceFile: 'policies.sysml', disposition: 'disabled' as const, ...over },
});
const rule = (over: Partial<EffectiveRule> = {}): EffectiveRule => ({
    sourceRuleId: 'CR-MED-040', sourceRuleType: 'ThreatMitigationRule', activeRuleId: 'CR-MED-040', activeRuleType: 'ThreatMitigationRule',
    disposition: 'enabled', effectiveSeverity: 'error', declaredSeverity: 'error', tailoring: 'assurance', policyChain: [], ...over,
});

describe('tailoringRecord', () => {
    it('leaves an untouched rule out', () => {
        expect(tailoringRecord([rule()])).toEqual([]);
    });

    it('records a disabled rule with who decided and why', () => {
        const [entry] = tailoringRecord([rule({
            disposition: 'disabled', domain: 'medicalDevice',
            policyChain: [policy({ rationaleText: 'no network interface', authority: 'Lead', approvalReference: 'CR-7' })],
        })]);
        expect(entry.ruleId).toBe('CR-MED-040');
        expect(entry.changes[0]).toMatchObject({ rationaleText: 'no network interface', authority: 'Lead', approvalReference: 'CR-7', file: 'policies.sysml' });
        expect(entry.gaps).toEqual([]);
    });

    it('asks more of a medical-device rule\'s record than of a modelling rule\'s', () => {
        const thin = policy({ rationaleText: 'because' });
        const medical = tailoringRecord([rule({ disposition: 'disabled', domain: 'medicalDevice', policyChain: [thin] })])[0];
        const modelling = tailoringRecord([rule({ disposition: 'disabled', domain: 'modelling', policyChain: [thin] })])[0];
        expect(medical.gaps).toEqual(['no authority', 'no approval reference']);
        expect(modelling.gaps).toEqual([]);
    });

    it('records a downgrade and a replacement', () => {
        const entries = tailoringRecord([
            rule({ sourceRuleId: 'A', effectiveSeverity: 'warning', policyChain: [policy({ disposition: 'enabled', severityOverride: 'warning', rationaleText: 'r' })] }),
            rule({ sourceRuleId: 'B', disposition: 'replaced', activeRuleId: 'ORG-1', policyChain: [policy({ disposition: 'replaced', replacementRuleType: 'OurRule', rationaleText: 'r' })] }),
        ]);
        expect(entries.map(e => [e.ruleId, e.effectiveSeverity, e.activeRuleId])).toEqual([['A', 'warning', undefined], ['B', 'error', 'ORG-1']]);
    });
});
