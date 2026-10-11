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
import { buildEffectiveScope, isInScope, isPackageInScope } from '../model/effective-scope.js';

// ─── Fixtures ────────────────────────────────────────────────────────────────

function methodology(over: Partial<NativeMethodology> & { usageName: string }): NativeMethodology {
    return {
        includedStandards: [], includedArtifactKinds: [], includedViewpoints: [], rulePolicies: [],
        sourceFile: `${over.usageName}.sysml`,
        ...over,
    };
}

function binding(over: Partial<NativeMethodBinding> & { usageName: string }): NativeMethodBinding {
    return {
        rulePolicies: [], sourceFile: 'project.sysml',
        ...over,
    };
}

function policy(over: Partial<NativeRulePolicy> & { usageName: string }): NativeRulePolicy {
    return { sourceFile: 'methodology.sysml', ...over };
}

function rule(over: Partial<RuleCandidate> & { id: string; typeName: string }): RuleCandidate {
    return { severity: 'error', tailoring: 'assurance', ...over };
}

// What each package publicly imports. A methodology's package is named for it
// (`<usage>_pkg`), and its public imports are its selection.
const IMPORTS = new Map<string, ReadonlySet<string>>([
    ['base_pkg', new Set(['pkg_a'])],
    ['child_pkg', new Set(['pkg_b'])],
    ['pkg_a', new Set()],
    ['pkg_b', new Set()],
]);

// ─── Methodology chain ───────────────────────────────────────────────────────

describe('resolveEffectiveMethodology', () => {
    it('walks the inheritance chain base-first, and selects what each package publicly imports', () => {
        const base = methodology({ usageName: 'base', scopeMode: 'explicit', packageQualifiedName: 'base_pkg' });
        const child = methodology({
            usageName: 'child', baseMethodologyName: 'base',
            scopeMode: 'explicit', packageQualifiedName: 'child_pkg',
        });
        const effective = resolveEffectiveMethodology(
            binding({ usageName: 'b', selectedMethodologyName: 'child' }),
            new Map([['base', base], ['child', child]]),
            IMPORTS,
        );
        expect(effective.chain.map(m => m.usageName)).toEqual(['base', 'child']);
        expect(effective.selectedPackages).toEqual(['pkg_a', 'pkg_b']);
        expect(effective.diagnostics).toEqual([]);
    });

    it('reports a base methodology no resolved package declares', () => {
        const child = methodology({ usageName: 'child', baseMethodologyName: 'ghost' });
        const effective = resolveEffectiveMethodology(
            binding({ usageName: 'b', selectedMethodologyName: 'child' }),
            new Map([['child', child]]),
            IMPORTS,
        );
        expect(effective.diagnostics.map(d => d.code)).toEqual(['missing-base']);
    });

    it('terminates on an inheritance cycle rather than looping', () => {
        const a = methodology({ usageName: 'a', baseMethodologyName: 'b' });
        const b = methodology({ usageName: 'b', baseMethodologyName: 'a' });
        const effective = resolveEffectiveMethodology(
            binding({ usageName: 'bind', selectedMethodologyName: 'a' }),
            new Map([['a', a], ['b', b]]),
            IMPORTS,
        );
        expect(effective.diagnostics.map(d => d.code)).toContain('inheritance-cycle');
    });

    it('rejects allAvailable on a methodology whose package also publicly imports', () => {
        const m = methodology({ usageName: 'm', scopeMode: 'allAvailable', packageQualifiedName: 'base_pkg' });
        const effective = resolveEffectiveMethodology(
            binding({ usageName: 'b', selectedMethodologyName: 'm' }),
            new Map([['m', m]]),
            IMPORTS,
        );
        expect(effective.diagnostics.map(d => d.code)).toContain('scope-mode-conflict');
    });

    it('rejects allAvailable authored alongside typed inclusion entries', () => {
        const m = methodology({ usageName: 'm', scopeMode: 'allAvailable', includedStandards: ['iso14971'] });
        const effective = resolveEffectiveMethodology(
            binding({ usageName: 'b', selectedMethodologyName: 'm' }),
            new Map([['m', m]]),
            IMPORTS,
        );
        expect(effective.diagnostics.map(d => d.code)).toContain('scope-mode-conflict');
    });

    // The package is the selection, so two methodologies in one package would
    // select the same packages whatever either of them says.
    it('rejects a methodology that shares its package with another', () => {
        const m = methodology({ usageName: 'm', scopeMode: 'explicit', packageQualifiedName: 'base_pkg' });
        const other = methodology({ usageName: 'other', scopeMode: 'explicit', packageQualifiedName: 'base_pkg' });
        const effective = resolveEffectiveMethodology(
            binding({ usageName: 'b', selectedMethodologyName: 'm' }),
            new Map([['m', m], ['other', other]]),
            IMPORTS,
        );
        expect(effective.diagnostics.map(d => d.code)).toEqual(['shared-methodology-package']);
    });
});

// ─── Selection by public import ──────────────────────────────────────────────

// A methodology selects packages the way SysML says one package passes another
// on: its declaring package imports them publicly. A project adds to that the
// same way, from its entrypoint package. A private import is a package's own
// business and selects nothing. The shapes mirror memo: a layer package over
// its packages, an extension facade over its own packages and the extension it
// builds on.
describe('selection by public import', () => {
    const imports = new Map<string, ReadonlySet<string>>([
        ['meth_pkg', new Set(['layer_facade', 'pkg_rules'])],
        ['layer_facade', new Set(['layer_a', 'layer_b'])],
        ['layer_a', new Set()],
        ['project_pkg', new Set(['ext_facade'])],
        ['ext_facade', new Set(['ext_runtime', 'ext_dep'])],
        // A cycle of public imports is a union, not a loop.
        ['ext_dep', new Set(['ext_facade'])],
    ]);
    const m = methodology({ usageName: 'm', scopeMode: 'explicit', packageQualifiedName: 'meth_pkg' });

    it("selects the public-import closure of the methodology's package, not the package itself", () => {
        const effective = resolveEffectiveMethodology(
            binding({ usageName: 'b', selectedMethodologyName: 'm' }), new Map([['m', m]]), imports);
        expect(effective.selectedPackages).toEqual(['layer_facade', 'pkg_rules', 'layer_a', 'layer_b']);
        const scope = buildEffectiveScope(effective);
        expect(isPackageInScope(scope, 'layer_b')).toBe(true);
        expect(isPackageInScope(scope, 'meth_pkg')).toBe(false);
        expect(isPackageInScope(scope, 'ext_runtime')).toBe(false);
    });

    it("adds what the project's entrypoint package publicly imports, transitively", () => {
        const effective = resolveEffectiveMethodology(
            binding({ usageName: 'b', selectedMethodologyName: 'm', packageQualifiedName: 'project_pkg' }),
            new Map([['m', m]]), imports);
        const scope = buildEffectiveScope(effective);
        for (const name of ['ext_facade', 'ext_runtime', 'ext_dep', 'layer_a']) {
            expect(isPackageInScope(scope, name)).toBe(true);
        }
    });

    it('follows no import that is not public', () => {
        const effective = resolveEffectiveMethodology(
            binding({ usageName: 'b', selectedMethodologyName: 'm' }),
            new Map([['m', methodology({ usageName: 'm', scopeMode: 'explicit', packageQualifiedName: 'private_only' })]]),
            new Map([['private_only', new Set<string>()]]));
        expect(effective.selectedPackages).toEqual([]);
        expect(isPackageInScope(buildEffectiveScope(effective), 'pkg_a')).toBe(false);
    });

    it('matches a selected package by name and nothing beside it', () => {
        const scope = buildEffectiveScope(resolveEffectiveMethodology(
            binding({ usageName: 'b', selectedMethodologyName: 'm' }), new Map([['m', m]]), imports));
        expect(isPackageInScope(scope, 'layer_a')).toBe(true);
        expect(isPackageInScope(scope, 'layer_a_sibling')).toBe(false);
        expect(isPackageInScope(scope, 'layer')).toBe(false);
    });
});

// ─── Effective scope ─────────────────────────────────────────────────────────

describe('effective scope', () => {
    it('selects nothing under explicit when the package imports nothing publicly', () => {
        // This is the behaviour the flip exists to change. The old helper read
        // an empty list as "the methodology does not restrict", so a
        // methodology that selected nothing behaved identically to one that
        // selected everything.
        const scope = buildEffectiveScope(resolveEffectiveMethodology(
            binding({ usageName: 'b', selectedMethodologyName: 'm' }),
            new Map([['m', methodology({ usageName: 'm', scopeMode: 'explicit' })]]),
            IMPORTS,
        ));
        expect(scope.mode).toBe('explicit');
        expect(isInScope(scope, 'standard', 'anything')).toBe(false);
        expect(isPackageInScope(scope, 'pkg_a')).toBe(false);
    });

    it('selects everything only when a methodology says so deliberately', () => {
        const scope = buildEffectiveScope(resolveEffectiveMethodology(
            binding({ usageName: 'b', selectedMethodologyName: 'm' }),
            new Map([['m', methodology({ usageName: 'm', scopeMode: 'allAvailable' })]]),
            IMPORTS,
        ));
        expect(scope.mode).toBe('allAvailable');
        expect(isInScope(scope, 'standard', 'anything')).toBe(true);
        expect(isPackageInScope(scope, 'pkg_ghost')).toBe(true);
    });

    it('does not let a base methodology widen a child selection', () => {
        const base = methodology({ usageName: 'base', scopeMode: 'allAvailable' });
        const child = methodology({
            usageName: 'child', baseMethodologyName: 'base',
            scopeMode: 'explicit', packageQualifiedName: 'base_pkg',
        });
        const scope = buildEffectiveScope(resolveEffectiveMethodology(
            binding({ usageName: 'b', selectedMethodologyName: 'child' }),
            new Map([['base', base], ['child', child]]),
            IMPORTS,
        ));
        expect(scope.mode).toBe('explicit');
        expect(isPackageInScope(scope, 'pkg_a')).toBe(true);
        expect(isPackageInScope(scope, 'pkg_b')).toBe(false);
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

// ─── A policy that selects several rules ─────────────────────────────────────

describe('a policy selecting by standard or category', () => {
    const risk = 'memo_ontology_risk';
    const BULK: RuleCandidate[] = [
        rule({ id: 'CR-MED-001', typeName: 'HazardRule', subjectPackage: risk,
            constraint: { enforces: ['memo_std_14971::iso14971::clause7::clause7_1'] } as any }),
        rule({ id: 'CR-MED-002', typeName: 'RiskRule', subjectPackage: `${risk}_analysis`,
            constraint: { enforces: ['memo_std_14971::iso14971::clause5::clause5_5', 'memo_std_62304::iec62304::c5'] } as any }),
        rule({ id: 'CR-MED-011', typeName: 'SoftwareRule', subjectPackage: 'memo_ontology_software',
            constraint: { enforces: ['memo_std_62304::iec62304::c5::c5_2'] } as any }),
        rule({ id: 'ORG-001', typeName: 'OwnRule', subjectPackage: undefined }),
        rule({ id: 'CR-ONT-001', typeName: 'AcyclicRule', tailoring: 'invariant', subjectPackage: risk,
            constraint: { enforces: ['memo_std_14971::iso14971::clause7::clause7_1'] } as any }),
    ];
    const disabled = (set: ReturnType<typeof resolveEffectiveRules>) =>
        set.rules.filter(r => r.disposition === 'disabled').map(r => r.sourceRuleId);

    it('disables every rule that enforces a clause of the standard, as one recorded decision', () => {
        const p = policy({
            usageName: 'noRiskStandard', targetStandard: 'memo_std_14971::iso14971', disposition: 'disabled',
            rationaleText: 'out of scope', authority: 'QA lead',
        });
        const set = resolveEffectiveRules(BULK, chain(p));
        expect(disabled(set)).toEqual(['CR-MED-001', 'CR-MED-002']);
        for (const id of ['CR-MED-001', 'CR-MED-002']) {
            const r = set.rules.find(x => x.sourceRuleId === id)!;
            expect(r.policyChain.map(e => e.policy.usageName)).toEqual(['noRiskStandard']);
            expect(r.authority).toBe('QA lead');
        }
        // The invariant that enforces a clause of it keeps running, and the policy says so.
        expect(set.rules.find(r => r.sourceRuleId === 'CR-ONT-001')!.disposition).toBe('enabled');
        expect(set.diagnostics.map(d => d.code)).toEqual(['invariant-protected']);
    });

    it('names a standard by its usage name, as written beside the qualified form', () => {
        const set = resolveEffectiveRules(BULK, chain(policy({
            usageName: 'no62304', targetStandard: 'iec62304', disposition: 'disabled', rationaleText: 'r',
        })));
        expect(disabled(set)).toEqual(['CR-MED-002', 'CR-MED-011']);
    });

    it('selects a category by the layer namespace of the subject kind, including nested packages', () => {
        const set = resolveEffectiveRules(BULK, chain(policy({
            usageName: 'noRisk', targetCategory: risk, disposition: 'disabled', rationaleText: 'r',
        })));
        expect(disabled(set)).toEqual(['CR-MED-001', 'CR-MED-002']);
        // A rule with no subject kind is in no category.
        expect(set.rules.find(r => r.sourceRuleId === 'ORG-001')!.disposition).toBe('enabled');
    });

    it('lets a bulk policy change severity without disabling', () => {
        const set = resolveEffectiveRules(BULK, chain(policy({
            usageName: 'soften', targetCategory: risk, severityOverride: 'info',
        })));
        expect(set.rules.filter(r => r.effectiveSeverity === 'info').map(r => r.sourceRuleId))
            .toEqual(['CR-MED-001', 'CR-MED-002', 'CR-ONT-001']);
        expect(disabled(set)).toEqual([]);
    });

    it('reports a selection that reaches nothing instead of staying silent', () => {
        const set = resolveEffectiveRules(BULK, chain(policy({
            usageName: 'none', targetStandard: 'iso99999', disposition: 'disabled', rationaleText: 'r',
        })));
        expect(set.diagnostics.map(d => d.code)).toEqual(['missing-target']);
        expect(disabled(set)).toEqual([]);
    });

    it('refuses a disable with no rationale, a bulk replacement, and a policy naming two selectors', () => {
        const noReason = resolveEffectiveRules(BULK, chain(policy({
            usageName: 'a', targetCategory: risk, disposition: 'disabled',
        })));
        expect(noReason.diagnostics.map(d => d.code)).toContain('missing-rationale');
        const bulkReplace = resolveEffectiveRules(BULK, chain(policy({
            usageName: 'b', targetCategory: risk, disposition: 'replaced', replacementRuleType: 'OwnRule', rationaleText: 'r',
        })));
        expect(bulkReplace.diagnostics.map(d => d.code)).toEqual(['bulk-replacement']);
        expect(disabled(bulkReplace)).toEqual([]);
        const both = resolveEffectiveRules(BULK, chain(policy({
            usageName: 'c', targetCategory: risk, targetRuleType: 'HazardRule', disposition: 'disabled', rationaleText: 'r',
        })));
        expect(both.diagnostics.map(d => d.code)).toEqual(['multiple-targets']);
        expect(disabled(both)).toEqual([]);
    });
});
