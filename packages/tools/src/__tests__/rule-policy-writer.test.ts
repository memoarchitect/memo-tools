// Rule tailoring through the command boundary (design sections 10.1-10.3,
// 18.4 deliverable 8).
//
// The editor names a rule and a decision; Tools renders the SysML. These tests
// cover the two halves that matter: the refusals section 10.2 requires, and the
// portable spelling of the reference session 3 settled on.

import { describe, it, expect } from 'vitest';
import {
    checkRulePolicy,
    insertRulePolicy,
    renderRulePolicy,
    type RulePolicyRequest,
} from '../server/rule-policy-writer.js';
import type { EffectiveRule } from '../model/methodology-resolver.js';

function rule(type: string, tailoring: EffectiveRule['tailoring']): EffectiveRule {
    return {
        sourceRuleId: `CR-${type}`, sourceRuleType: type,
        activeRuleId: `CR-${type}`, activeRuleType: type,
        disposition: 'enabled',
        effectiveSeverity: 'error', declaredSeverity: 'error',
        tailoring, policyChain: [],
    } as EffectiveRule;
}

const rules = [
    rule('ThreatMitigationRule', 'assurance'),
    rule('IdentityUniquenessRule', 'invariant'),
    rule('WorkflowGateRule', 'methodology'),
];

const base: RulePolicyRequest = {
    targetRuleType: 'ThreatMitigationRule',
    disposition: 'disabled',
    rationaleText: 'the prototype has no network interface',
    authority: 'GPCA Systems Engineering Lead',
};

describe('checkRulePolicy', () => {
    it('accepts a tailorable rule disabled with a rationale', () => {
        expect(checkRulePolicy(base, rules)).toBeUndefined();
    });

    it('refuses a rule the project does not resolve', () => {
        expect(checkRulePolicy({ ...base, targetRuleType: 'NoSuchRule' }, rules)?.code)
            .toBe('unknown-rule');
    });

    it('refuses to disable an invariant', () => {
        // An invariant is the ontology's floor. A methodology that could switch
        // it off would make the guarantee meaningless.
        const refusal = checkRulePolicy({ ...base, targetRuleType: 'IdentityUniquenessRule' }, rules);
        expect(refusal?.code).toBe('invariant-not-tailorable');
        expect(refusal?.message).toContain('ontology release');
    });

    it('allows an invariant to be explicitly re-enabled', () => {
        expect(checkRulePolicy(
            { ...base, targetRuleType: 'IdentityUniquenessRule', disposition: 'enabled' }, rules,
        )).toBeUndefined();
    });

    it('refuses a tailoring decision with no rationale', () => {
        expect(checkRulePolicy({ ...base, rationaleText: '   ' }, rules)?.code)
            .toBe('missing-rationale');
    });

    it('refuses a replacement that names nothing', () => {
        expect(checkRulePolicy({ ...base, disposition: 'replaced' }, rules)?.code)
            .toBe('missing-replacement');
    });

    it('refuses a rule that replaces itself', () => {
        expect(checkRulePolicy({
            ...base, disposition: 'replaced', replacementRuleType: 'ThreatMitigationRule',
        }, rules)?.code).toBe('replacement-not-resolvable');
    });
});

describe('renderRulePolicy', () => {
    it('names the rule by narrowing the reference type, not by binding a value', () => {
        // Binding a value to a `constraint def` is not portable — SysIDE
        // rejects it, because a value must be a feature and a definition is
        // not. Narrowing the type is what session 1 verified across all three
        // tools.
        const sysml = renderRulePolicy(base);
        expect(sysml).toContain('ref :>> targetRule : ThreatMitigationRule;');
        expect(sysml).not.toContain('targetRule = ');
    });

    it('writes the disposition, rationale, and authority', () => {
        const sysml = renderRulePolicy(base);
        expect(sysml).toContain('attribute :>> disposition = RuleDispositionKind::disabled;');
        expect(sysml).toContain('"the prototype has no network interface"');
        expect(sysml).toContain('"GPCA Systems Engineering Lead"');
    });

    it('escapes a rationale containing quotes', () => {
        const sysml = renderRulePolicy({ ...base, rationaleText: 'the "prototype" variant' });
        expect(sysml).toContain('"the \\"prototype\\" variant"');
    });

    it('emits the replacement reference for a replaced disposition', () => {
        const sysml = renderRulePolicy({
            ...base, disposition: 'replaced', replacementRuleType: 'ProjectThreatRule',
        });
        expect(sysml).toContain('ref :>> replacementRule : ProjectThreatRule;');
    });

    it('omits severityOverride when none was chosen', () => {
        expect(renderRulePolicy(base)).not.toContain('severityOverride');
        expect(renderRulePolicy({ ...base, severityOverride: 'warning' }))
            .toContain('attribute :>> severityOverride = RuleSeverityKind::warning;');
    });
});

describe('insertRulePolicy', () => {
    const methodology = [
        'package proj_methodology {',
        '    part projMethod : MethodologyDefinition {',
        '        attribute :>> id = "METH-001";',
        '        attribute :>> scopeMode = ScopeModeKind::explicit;',
        '    }',
        '}',
    ].join('\n');

    it('inserts inside the methodology definition body', () => {
        const out = insertRulePolicy(methodology, renderRulePolicy(base))!;
        const lines = out.split('\n');
        const policyLine = lines.findIndex(l => l.includes('part policyThreatMitigationRule'));
        const methodClose = lines.findIndex(l => l.trim() === '}' && lines.indexOf(l) > policyLine);
        expect(policyLine).toBeGreaterThan(1);
        expect(methodClose).toBeGreaterThan(policyLine);
    });

    it('refuses a file with no methodology definition to attach to', () => {
        // A policy written into open space parses and never applies, which is
        // worse than a diagnostic.
        expect(insertRulePolicy('package empty { }', renderRulePolicy(base))).toBeUndefined();
    });

    it('produces a body that still balances its braces', () => {
        const out = insertRulePolicy(methodology, renderRulePolicy(base))!;
        expect((out.match(/\{/g) ?? []).length).toBe((out.match(/\}/g) ?? []).length);
    });
});
