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
        includedLayers: [], includedModules: [], includedExtensions: [], includedStandards: [],
        includedArtifactKinds: [], includedViewpoints: [], rulePolicies: [],
        sourceFile: `${over.usageName}.sysml`,
        ...over,
    };
}

function binding(over: Partial<NativeMethodBinding> & { usageName: string }): NativeMethodBinding {
    return {
        includedModules: [], includedExtensions: [], rulePolicies: [], sourceFile: 'project.sysml',
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

// ─── Extensions ──────────────────────────────────────────────────────────────
//
// A project names an extension by its methodology; the extension's methodology
// lists every package it ships and the extensions it builds on. These mirror
// memo/extensions: ros includes messaging and container, aadl ships a facade
// over two content packages.

describe('includedExtension', () => {
    const defaults = methodology({ usageName: 'mdDefault', scopeMode: 'explicit', includedModules: ['memo_everything'] });
    const narrow = methodology({ usageName: 'narrow', scopeMode: 'explicit', includedModules: ['pkg_a'] });
    const messaging = methodology({
        usageName: 'messagingExtensionMethod', baseMethodologyName: 'mdDefault', scopeMode: 'explicit',
        includedModules: ['memo_extension_messaging'],
    });
    const container = methodology({
        usageName: 'containerExtensionMethod', baseMethodologyName: 'mdDefault', scopeMode: 'explicit',
        includedModules: ['memo_extension_container'],
    });
    const ros = methodology({
        usageName: 'rosExtensionMethod', baseMethodologyName: 'mdDefault', scopeMode: 'explicit',
        includedModules: ['memo_extension_ros'],
        includedExtensions: ['messagingExtensionMethod', 'containerExtensionMethod'],
        rulePolicies: [policy({ usageName: 'extensionPolicy', disposition: 'disabled' })],
    });
    const all = new Map([defaults, narrow, messaging, container, ros].map(m => [m.usageName, m]));
    const available = new Set([
        'memo_everything', 'pkg_a', 'memo_extension_messaging', 'memo_extension_container', 'memo_extension_ros',
    ]);

    it('selects an extension and, transitively, the extensions it includes', () => {
        const effective = resolveEffectiveMethodology(
            binding({ usageName: 'b', selectedMethodologyName: 'narrow', includedExtensions: ['rosExtensionMethod'] }),
            all, available,
        );
        expect(effective.extensions.map(m => m.usageName))
            .toEqual(['rosExtensionMethod', 'messagingExtensionMethod', 'containerExtensionMethod']);
        expect(effective.includedModules).toEqual(
            ['pkg_a', 'memo_extension_ros', 'memo_extension_messaging', 'memo_extension_container']);
        expect(effective.diagnostics).toEqual([]);
    });

    it("does not follow an extension's base chain or apply its policies", () => {
        // ros's base is the default methodology. Following it would widen the
        // narrow methodology to everything the default selects.
        const effective = resolveEffectiveMethodology(
            binding({ usageName: 'b', selectedMethodologyName: 'narrow', includedExtensions: ['rosExtensionMethod'] }),
            all, available,
        );
        expect(effective.chain.map(m => m.usageName)).toEqual(['narrow']);
        expect(effective.includedModules).not.toContain('memo_everything');
        expect(effective.policyChain).toEqual([]);
    });

    it('is honoured on a methodology as well as a binding', () => {
        const child = methodology({
            usageName: 'child', baseMethodologyName: 'narrow', scopeMode: 'explicit',
            includedExtensions: ['messagingExtensionMethod'],
        });
        const effective = resolveEffectiveMethodology(
            binding({ usageName: 'b', selectedMethodologyName: 'child' }),
            new Map([...all, ['child', child]]), available,
        );
        expect(effective.includedModules).toEqual(['pkg_a', 'memo_extension_messaging']);
    });

    it('reports an extension that names no resolved methodology', () => {
        const effective = resolveEffectiveMethodology(
            binding({ usageName: 'b', selectedMethodologyName: 'narrow', includedExtensions: ['ghostExtensionMethod'] }),
            all, available,
        );
        expect(effective.diagnostics.map(d => d.code)).toEqual(['missing-extension']);
    });

    it('terminates when extensions include each other', () => {
        const a = methodology({ usageName: 'a', scopeMode: 'explicit', includedModules: ['pkg_a'], includedExtensions: ['b'] });
        const b = methodology({ usageName: 'b', scopeMode: 'explicit', includedModules: ['pkg_b'], includedExtensions: ['a'] });
        const effective = resolveEffectiveMethodology(
            binding({ usageName: 'bind', selectedMethodologyName: 'narrow', includedExtensions: ['a'] }),
            new Map([...all, ['a', a], ['b', b]]), ALL,
        );
        expect(effective.includedModules).toEqual(['pkg_a', 'pkg_b']);
        expect(effective.diagnostics).toEqual([]);
    });

    it('selects every package an extension lists, and only those: matching stays exact', () => {
        // The aadl facade re-exports its content packages, but a facade entry
        // does not select them. The extension's methodology has to list them.
        const facadeOnly = buildEffectiveScope(resolveEffectiveMethodology(
            binding({ usageName: 'b', selectedMethodologyName: 'narrow', includedModules: ['memo_extension_aadl'] }),
            all, new Set(['pkg_a', 'memo_extension_aadl', 'memo_extension_aadl_runtime']),
        ));
        expect(isPackageInScope(facadeOnly, 'memo_extension_aadl_runtime')).toBe(false);

        const aadl = methodology({
            usageName: 'aadlExtensionMethod', scopeMode: 'explicit',
            includedModules: ['memo_extension_aadl', 'memo_extension_aadl_runtime'],
        });
        const whole = buildEffectiveScope(resolveEffectiveMethodology(
            binding({ usageName: 'b', selectedMethodologyName: 'narrow', includedExtensions: ['aadlExtensionMethod'] }),
            new Map([...all, ['aadlExtensionMethod', aadl]]),
            new Set(['pkg_a', 'memo_extension_aadl', 'memo_extension_aadl_runtime']),
        ));
        expect(isPackageInScope(whole, 'memo_extension_aadl_runtime')).toBe(true);
        expect(isPackageInScope(whole, 'memo_extension_aadl_methodology')).toBe(false);
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

    // A layer entry names a NAMESPACE, not a package. `memo_core.sysml` says so:
    // "Layer entries normally name a public MEMO layer namespace; module entries
    // may name any qualified package available to the project."
    //
    // Matching the two alike is what made all five of gpca-pump's layer entries
    // select nothing, which silently dropped 25 rules — every rule whose subject
    // kind is declared in an architecture package, CR-ONT-076 among them. The
    // example reported `0 violations` throughout, because a rule that never runs
    // cannot fail.
    it('places a package inside a selected layer namespace', () => {
        const scope = buildEffectiveScope(resolveEffectiveMethodology(
            binding({ usageName: 'b', selectedMethodologyName: 'm' }),
            new Map([['m', methodology({
                usageName: 'm', scopeMode: 'explicit',
                includedLayers: ['memo_architecture_logical'],
            })]]),
            new Set(['memo_architecture_logical_interfaces']),
        ));
        // The namespace itself is not a package anywhere in the tree; the leaves
        // below it are what the resolver actually has to place.
        expect(isPackageInScope(scope, 'memo_architecture_logical_interfaces')).toBe(true);
        expect(isPackageInScope(scope, 'memo_architecture_logical_structure')).toBe(true);
        expect(isPackageInScope(scope, 'memo_architecture_logical')).toBe(true);
    });

    it('stops a layer namespace at a separator', () => {
        const scope = buildEffectiveScope(resolveEffectiveMethodology(
            binding({ usageName: 'b', selectedMethodologyName: 'm' }),
            new Map([['m', methodology({
                usageName: 'm', scopeMode: 'explicit',
                includedLayers: ['memo_architecture_logical'],
            })]]),
            new Set(['memo_architecture_logical_interfaces']),
        ));
        // A bare prefix test would capture this: it shares every letter of the
        // layer name and is a different namespace.
        expect(isPackageInScope(scope, 'memo_architecture_logicalxx')).toBe(false);
    });

    it('keeps module matching exact', () => {
        // A module entry may name a package outside MEMO, where prefix matching
        // would quietly capture a neighbour that shares an opening segment.
        const scope = buildEffectiveScope(resolveEffectiveMethodology(
            binding({ usageName: 'b', selectedMethodologyName: 'm' }),
            new Map([['m', methodology({
                usageName: 'm', scopeMode: 'explicit',
                includedModules: ['vendor_pkg'],
            })]]),
            new Set(['vendor_pkg']),
        ));
        expect(isPackageInScope(scope, 'vendor_pkg')).toBe(true);
        expect(isPackageInScope(scope, 'vendor_pkg_internal')).toBe(false);
    });

    it('reports a layer that covers no resolved package', () => {
        // The counterpart of `unavailable-module`, which existed while this did
        // not. That asymmetry is the whole reason the defect was invisible: a
        // selection matching nothing just narrows the rule set, and a narrower
        // rule set reports fewer violations, which reads like a cleaner model.
        const effective = resolveEffectiveMethodology(
            binding({ usageName: 'b', selectedMethodologyName: 'm' }),
            new Map([['m', methodology({
                usageName: 'm', scopeMode: 'explicit',
                includedLayers: ['memo_architecture_logical', 'context'],
            })]]),
            new Set(['memo_architecture_logical_interfaces']),
        );
        // The first layer covers a package; `context` — the archetype spelling —
        // covers none, and is the one that has to be named.
        expect(effective.diagnostics.map(d => d.code)).toEqual(['unavailable-layer']);
        expect(effective.diagnostics[0].message).toContain('context');
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
