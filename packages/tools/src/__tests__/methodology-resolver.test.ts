// The effective methodology and effective rule resolvers (design sections 9-10).
//
// These cover the governance layer the section 4.1 Option P verdict scopes:
// which rules are in the effective set, at what severity, under whose
// authority, and which policies are refused. They deliberately assert nothing
// about whether a rule's predicate fires — that is a separate question the
// verdict left to a follow-on, and asserting it here would let a green suite
// read as evidence that a model was validated.

import { describe, it, expect } from 'vitest';
import {
    resolveEffectiveMethodology,
    resolveEffectiveRules,
    type RuleCandidate,
    type PolicyChainEntry,
} from '../model/methodology-resolver.js';
import type { NativeMethodBinding, NativeMethodology, NativeRulePolicy } from '../model/native-project.js';
import { buildEffectiveScope, isInScope, isPackageInScope, filterKindsInScope } from '../model/effective-scope.js';

// ─── Fixtures ────────────────────────────────────────────────────────────────

function methodology(over: Partial<NativeMethodology> & { usageName: string }): NativeMethodology {
    return {
        includedLayers: [], includedModules: [], includedStandards: [],
        includedArtifactKinds: [], includedViewpoints: [], rulePolicies: [],
        sourceFile: `${over.usageName}.sysml`,
        ...over,
    };
}

function binding(over: Partial<NativeMethodBinding> & { usageName: string }): NativeMethodBinding {
    return {
        includedModules: [], rulePolicies: [], sourceFile: 'project.sysml',
        ...over,
    };
}

function policy(over: Partial<NativeRulePolicy> & { usageName: string }): NativeRulePolicy {
    return { sourceFile: 'methodology.sysml', ...over };
}

function rule(over: Partial<RuleCandidate> & { id: string; typeName: string }): RuleCandidate {
    return { severity: 'error', tailoring: 'assurance', ...over };
}

const ALL = new Set(['pkg_a', 'pkg_b', 'memo_rules_closure']);

// ─── Methodology chain ───────────────────────────────────────────────────────

describe('resolveEffectiveMethodology', () => {
    it('walks the inheritance chain base-first', () => {
        const base = methodology({ usageName: 'base', scopeMode: 'explicit', includedModules: ['pkg_a'] });
        const child = methodology({
            usageName: 'child', baseMethodologyName: 'base',
            scopeMode: 'explicit', includedModules: ['pkg_b'],
        });
        const effective = resolveEffectiveMethodology(
            binding({ usageName: 'b', selectedMethodologyName: 'child' }),
            new Map([['base', base], ['child', child]]),
            ALL,
        );
        expect(effective.chain.map(m => m.usageName)).toEqual(['base', 'child']);
        expect(effective.includedModules).toEqual(['pkg_a', 'pkg_b']);
        expect(effective.diagnostics).toEqual([]);
    });

    it('reports a base methodology no resolved package declares', () => {
        const child = methodology({ usageName: 'child', baseMethodologyName: 'ghost' });
        const effective = resolveEffectiveMethodology(
            binding({ usageName: 'b', selectedMethodologyName: 'child' }),
            new Map([['child', child]]),
            ALL,
        );
        expect(effective.diagnostics.map(d => d.code)).toEqual(['missing-base']);
    });

    it('terminates on an inheritance cycle rather than looping', () => {
        const a = methodology({ usageName: 'a', baseMethodologyName: 'b' });
        const b = methodology({ usageName: 'b', baseMethodologyName: 'a' });
        const effective = resolveEffectiveMethodology(
            binding({ usageName: 'bind', selectedMethodologyName: 'a' }),
            new Map([['a', a], ['b', b]]),
            ALL,
        );
        expect(effective.diagnostics.map(d => d.code)).toContain('inheritance-cycle');
    });

    it('rejects a module name no resolved package supplies', () => {
        const m = methodology({ usageName: 'm', scopeMode: 'explicit', includedModules: ['pkg_ghost'] });
        const effective = resolveEffectiveMethodology(
            binding({ usageName: 'b', selectedMethodologyName: 'm' }),
            new Map([['m', m]]),
            ALL,
        );
        expect(effective.diagnostics.map(d => d.code)).toEqual(['unavailable-module']);
    });

    it('rejects allAvailable authored alongside inclusion entries', () => {
        const m = methodology({
            usageName: 'm', scopeMode: 'allAvailable', includedModules: ['pkg_a'],
        });
        const effective = resolveEffectiveMethodology(
            binding({ usageName: 'b', selectedMethodologyName: 'm' }),
            new Map([['m', m]]),
            ALL,
        );
        expect(effective.diagnostics.map(d => d.code)).toContain('scope-mode-conflict');
    });

    it('applies project additions on top of the methodology selection', () => {
        const m = methodology({ usageName: 'm', scopeMode: 'explicit', includedModules: ['pkg_a'] });
        const effective = resolveEffectiveMethodology(
            binding({ usageName: 'b', selectedMethodologyName: 'm', includedModules: ['pkg_b'] }),
            new Map([['m', m]]),
            ALL,
        );
        expect(effective.includedModules).toEqual(['pkg_a', 'pkg_b']);
    });
});

// ─── Effective scope ─────────────────────────────────────────────────────────

describe('effective scope', () => {
    it('selects nothing for an empty list under explicit', () => {
        // This is the behaviour the flip exists to change. The old helper read
        // an empty list as "the methodology does not restrict", so a
        // methodology that selected nothing behaved identically to one that
        // selected everything.
        const scope = buildEffectiveScope(resolveEffectiveMethodology(
            binding({ usageName: 'b', selectedMethodologyName: 'm' }),
            new Map([['m', methodology({ usageName: 'm', scopeMode: 'explicit' })]]),
            ALL,
        ));
        expect(scope.mode).toBe('explicit');
        expect(isInScope(scope, 'layer', 'anything')).toBe(false);
        expect(isPackageInScope(scope, 'pkg_a')).toBe(false);
    });

    it('selects everything only when a methodology says so deliberately', () => {
        const scope = buildEffectiveScope(resolveEffectiveMethodology(
            binding({ usageName: 'b', selectedMethodologyName: 'm' }),
            new Map([['m', methodology({ usageName: 'm', scopeMode: 'allAvailable' })]]),
            ALL,
        ));
        expect(scope.mode).toBe('allAvailable');
        expect(isInScope(scope, 'layer', 'anything')).toBe(true);
        expect(isPackageInScope(scope, 'pkg_ghost')).toBe(true);
    });

    it('does not let a base methodology widen a child selection', () => {
        const base = methodology({ usageName: 'base', scopeMode: 'allAvailable' });
        const child = methodology({
            usageName: 'child', baseMethodologyName: 'base',
            scopeMode: 'explicit', includedLayers: ['pkg_a'],
        });
        const scope = buildEffectiveScope(resolveEffectiveMethodology(
            binding({ usageName: 'b', selectedMethodologyName: 'child' }),
            new Map([['base', base], ['child', child]]),
            ALL,
        ));
        expect(scope.mode).toBe('explicit');
        expect(isPackageInScope(scope, 'pkg_a')).toBe(true);
        expect(isPackageInScope(scope, 'pkg_b')).toBe(false);
    });

    it('filters palette kinds by scope', () => {
        const scope = buildEffectiveScope(resolveEffectiveMethodology(
            binding({ usageName: 'b', selectedMethodologyName: 'm' }),
            new Map([['m', methodology({ usageName: 'm', scopeMode: 'explicit', includedLayers: ['risk'] })]]),
            new Set(['risk']),
        ));
        const kinds = [{ layer: 'risk' }, { layer: 'cybersecurity' }, { layer: undefined }] as Array<{ layer?: string }>;
        expect(filterKindsInScope(kinds, scope)).toEqual([{ layer: 'risk' }]);
    });
});

// ─── Effective rules ─────────────────────────────────────────────────────────

const CANDIDATES: RuleCandidate[] = [
    rule({ id: 'CR-001', typeName: 'HazardRule' }),
    rule({ id: 'CR-002', typeName: 'ThreatRule', severity: 'warning' }),
    rule({ id: 'CR-003', typeName: 'ReplacementRule' }),
    rule({ id: 'CR-ONT-001', typeName: 'AcyclicRule', tailoring: 'invariant' }),
];

function chain(...policies: NativeRulePolicy[]): PolicyChainEntry[] {
    return policies.map(p => ({ source: 'meth', level: 'methodology' as const, policy: p }));
}

describe('resolveEffectiveRules', () => {
    it('leaves every rule enabled when no policy applies', () => {
        const set = resolveEffectiveRules(CANDIDATES, []);
        expect(set.diagnostics).toEqual([]);
        expect(set.rules.every(r => r.disposition === 'enabled')).toBe(true);
        expect(set.rules.map(r => r.sourceRuleId)).toEqual(['CR-001', 'CR-002', 'CR-003', 'CR-ONT-001']);
    });

    it('disables a tailorable rule and records the chain, rationale, and authority', () => {
        const set = resolveEffectiveRules(CANDIDATES, chain(policy({
            usageName: 'noThreats', targetRuleType: 'ThreatRule', disposition: 'disabled',
            rationaleText: 'the prototype has no network interface',
            authority: 'Systems Lead', approvalReference: 'DHF-CR-0007',
        })));
        expect(set.diagnostics).toEqual([]);
        const threat = set.rules.find(r => r.sourceRuleId === 'CR-002')!;
        expect(threat.disposition).toBe('disabled');
        expect(threat.rationaleText).toContain('no network interface');
        expect(threat.authority).toBe('Systems Lead');
        expect(threat.approvalReference).toBe('DHF-CR-0007');
        expect(threat.policyChain.map(e => e.source)).toEqual(['meth']);
    });

    it('replaces a rule with another native constraint', () => {
        const set = resolveEffectiveRules(CANDIDATES, chain(policy({
            usageName: 'swap', targetRuleType: 'HazardRule', replacementRuleType: 'ReplacementRule',
            disposition: 'replaced', rationaleText: 'stricter local rule',
        })));
        expect(set.diagnostics).toEqual([]);
        const hazard = set.rules.find(r => r.sourceRuleId === 'CR-001')!;
        expect(hazard.disposition).toBe('replaced');
        expect(hazard.activeRuleId).toBe('CR-003');
        expect(hazard.activeRuleType).toBe('ReplacementRule');
    });

    it('overrides severity without changing what the ontology authored', () => {
        const set = resolveEffectiveRules(CANDIDATES, chain(policy({
            usageName: 'soften', targetRuleType: 'HazardRule',
            disposition: 'enabled', severityOverride: 'warning',
        })));
        const hazard = set.rules.find(r => r.sourceRuleId === 'CR-001')!;
        expect(hazard.effectiveSeverity).toBe('warning');
        expect(hazard.declaredSeverity).toBe('error');
    });

    it('refuses to disable an invariant', () => {
        const set = resolveEffectiveRules(CANDIDATES, chain(policy({
            usageName: 'noAcyclic', targetRuleType: 'AcyclicRule', disposition: 'disabled',
            rationaleText: 'inconvenient',
        })));
        expect(set.diagnostics.map(d => d.code)).toEqual(['invariant-protected']);
        expect(set.rules.find(r => r.sourceRuleId === 'CR-ONT-001')!.disposition).toBe('enabled');
    });

    it('reports a policy whose target is not in the rule set', () => {
        const set = resolveEffectiveRules(CANDIDATES, chain(policy({
            usageName: 'ghost', targetRuleType: 'NoSuchRule', disposition: 'disabled',
            rationaleText: 'x',
        })));
        expect(set.diagnostics.map(d => d.code)).toEqual(['missing-target']);
    });

    it('reports a replacement that does not exist', () => {
        const set = resolveEffectiveRules(CANDIDATES, chain(policy({
            usageName: 'swap', targetRuleType: 'HazardRule', replacementRuleType: 'Ghost',
            disposition: 'replaced', rationaleText: 'x',
        })));
        expect(set.diagnostics.map(d => d.code)).toEqual(['missing-replacement']);
    });

    it('reports a replacement disposition with no replacement named', () => {
        const set = resolveEffectiveRules(CANDIDATES, chain(policy({
            usageName: 'swap', targetRuleType: 'HazardRule', disposition: 'replaced',
            rationaleText: 'x',
        })));
        expect(set.diagnostics.map(d => d.code)).toEqual(['replacement-without-target']);
    });

    it('reports a tailoring decision with no rationale', () => {
        const set = resolveEffectiveRules(CANDIDATES, chain(policy({
            usageName: 'quiet', targetRuleType: 'ThreatRule', disposition: 'disabled',
        })));
        expect(set.diagnostics.map(d => d.code)).toEqual(['missing-rationale']);
    });

    it('rejects two rules sharing one ID rather than letting load order decide', () => {
        const set = resolveEffectiveRules(
            [...CANDIDATES, rule({ id: 'CR-001', typeName: 'DifferentRule' })],
            [],
        );
        expect(set.diagnostics.map(d => d.code)).toEqual(['duplicate-rule-id']);
    });

    it('is deterministic: the same input produces the same ordered result', () => {
        const policies = chain(
            policy({ usageName: 'a', targetRuleType: 'ThreatRule', disposition: 'disabled', rationaleText: 'r' }),
            policy({ usageName: 'b', targetRuleType: 'HazardRule', severityOverride: 'info' }),
        );
        const first = resolveEffectiveRules(CANDIDATES, policies);
        const second = resolveEffectiveRules([...CANDIDATES].reverse(), policies);
        expect(second.rules.map(r => [r.sourceRuleId, r.disposition, r.effectiveSeverity]))
            .toEqual(first.rules.map(r => [r.sourceRuleId, r.disposition, r.effectiveSeverity]));
    });

    it('applies the project binding after the methodology', () => {
        const set = resolveEffectiveRules(CANDIDATES, [
            { source: 'meth', level: 'methodology', policy: policy({
                usageName: 'methodologySoftens', targetRuleType: 'HazardRule', severityOverride: 'warning',
            }) },
            { source: 'projectBinding', level: 'project', policy: policy({
                usageName: 'projectRestores', targetRuleType: 'HazardRule', severityOverride: 'error',
            }) },
        ]);
        const hazard = set.rules.find(r => r.sourceRuleId === 'CR-001')!;
        expect(hazard.effectiveSeverity).toBe('error');
        expect(hazard.policyChain.map(e => e.level)).toEqual(['methodology', 'project']);
    });

    it('does not evaluate a disabled rule or a rule that was replaced', () => {
        const withBodies = CANDIDATES.map(c => ({
            ...c,
            constraint: { id: c.id, description: c.id, appliesToKind: 'Any', severity: c.severity, ast: {} as never },
        }));
        const set = resolveEffectiveRules(withBodies, chain(
            policy({ usageName: 'off', targetRuleType: 'ThreatRule', disposition: 'disabled', rationaleText: 'r' }),
            policy({
                usageName: 'swap', targetRuleType: 'HazardRule', replacementRuleType: 'ReplacementRule',
                disposition: 'replaced', rationaleText: 'r',
            }),
        ));
        const active = set.activeConstraints.map(c => c.id).sort();
        // CR-002 is disabled. CR-001 is replaced, so CR-003 evaluates in its
        // place and does not additionally evaluate in its own right.
        expect(active).toEqual(['CR-003', 'CR-ONT-001']);
    });
});
