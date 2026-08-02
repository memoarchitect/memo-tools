// ─── Effective Methodology and Effective Rule Resolution ──────────────────────
//
// What a project's methodology actually amounts to, and which rules are live.
//
// Both resolvers are deterministic: the same source produces the same result in
// the same order, and every entry says where it came from. There is no
// "last duplicate wins" anywhere — a duplicate rule ID is an error, and a rule
// is replaced only through an explicit `RulePolicy`.
//
// Under the section 4.1 Option P verdict this layer governs rule *identity and
// disposition*: which rules are in the effective set, at what severity, under
// whose authority. Whether a rule's predicate fires is a separate question that
// `predicateExpression` still answers, and nothing here should be reported as
// evidence that a model was validated.
//
// Design reference: sections 9.1-9.3, 10.1-10.4.
// ─────────────────────────────────────────────────────────────────────────────

import type {
    NativeMethodBinding,
    NativeMethodology,
    NativeRulePolicy,
    ScopeMode,
} from './native-project.js';
import type { CompiledConstraint } from '../validator/constraint-eval.js';

/** Severity as the ontology and policies spell it. */
export type RuleSeverity = 'error' | 'warning' | 'info';

/** How far a rule may be tailored, from the rule's own `tailoring` attribute. */
export type RuleTailoring = 'invariant' | 'assurance' | 'methodology';

/** One step in the chain that produced a rule's effective disposition. */
export interface PolicyChainEntry {
    /** Methodology usage name, or the binding's usage name for a project policy. */
    source: string;
    /** 'methodology' or 'project' — which authority applied it. */
    level: 'methodology' | 'project';
    policy: NativeRulePolicy;
}

/** A rule and everything that happened to it. */
export interface EffectiveRule {
    /** The rule as originally defined. */
    sourceRuleId: string;
    sourceRuleType: string;
    /** The rule that actually evaluates; differs from the source when replaced. */
    activeRuleId: string;
    activeRuleType: string;
    disposition: 'enabled' | 'disabled' | 'replaced';
    /** Severity after any override. */
    effectiveSeverity: RuleSeverity;
    /** Severity as the ontology authored it. */
    declaredSeverity: RuleSeverity;
    tailoring: RuleTailoring;
    /** Every policy that touched this rule, base-first. */
    policyChain: PolicyChainEntry[];
    /** Rationale and authority from the last policy that changed the rule. */
    rationaleText?: string;
    authority?: string;
    approvalReference?: string;
    /** Where the rule is declared. */
    sourceFile?: string;
}

export interface RuleResolutionDiagnostic {
    code:
        | 'missing-target'
        | 'missing-replacement'
        | 'duplicate-rule-id'
        | 'invariant-protected'
        | 'replacement-without-target'
        | 'missing-rationale'
        | 'ambiguous-target';
    message: string;
    ruleId?: string;
    policy?: string;
    file?: string;
}

export interface MethodologyDiagnostic {
    code: 'missing-base' | 'inheritance-cycle' | 'unavailable-module' | 'scope-mode-conflict';
    message: string;
    methodology?: string;
}

/** The methodology chain plus its merged selection. */
export interface EffectiveMethodology {
    /** Base first, selected methodology last. */
    chain: NativeMethodology[];
    scopeMode: ScopeMode;
    includedLayers: string[];
    includedModules: string[];
    includedStandards: string[];
    includedArtifactKinds: string[];
    includedViewpoints: string[];
    /** Policies in application order: base methodology first, project binding last. */
    policyChain: PolicyChainEntry[];
    diagnostics: MethodologyDiagnostic[];
}

/**
 * Walk the methodology inheritance chain and merge its selection.
 *
 * Exactly one base per methodology, so the chain is a list. The resolver walks
 * base-first and then applies the child, which is also the order policies are
 * applied in: a child methodology may tailor what its base decided, and the
 * project binding gets the last word.
 */
export function resolveEffectiveMethodology(
    binding: NativeMethodBinding | undefined,
    methodologies: Map<string, NativeMethodology>,
    availablePackages: ReadonlySet<string>,
): EffectiveMethodology {
    const diagnostics: MethodologyDiagnostic[] = [];
    const chain: NativeMethodology[] = [];

    let current = binding?.selectedMethodologyName
        ? methodologies.get(binding.selectedMethodologyName)
        : undefined;
    const seen = new Set<string>();
    while (current) {
        if (seen.has(current.usageName)) {
            diagnostics.push({
                code: 'inheritance-cycle',
                message:
                    `Methodology inheritance cycles back to "${current.usageName}". A methodology chain must `
                    + `terminate; a cycle has no base to resolve first.`,
                methodology: current.usageName,
            });
            break;
        }
        seen.add(current.usageName);
        chain.unshift(current);
        if (!current.baseMethodologyName) break;
        const base = methodologies.get(current.baseMethodologyName);
        if (!base) {
            diagnostics.push({
                code: 'missing-base',
                message:
                    `Methodology "${current.usageName}" specializes "${current.baseMethodologyName}", which no `
                    + `resolved package declares.`,
                methodology: current.usageName,
            });
            break;
        }
        current = base;
    }

    // The selected methodology decides the mode; a base cannot widen a child.
    const selected = chain[chain.length - 1];
    const scopeMode: ScopeMode = binding?.scopeMode === 'allAvailable'
        ? 'allAvailable'
        : selected?.scopeMode ?? 'explicit';

    const merge = (pick: (m: NativeMethodology) => string[]): string[] => {
        const out: string[] = [];
        for (const m of chain) for (const v of pick(m)) if (!out.includes(v)) out.push(v);
        return out;
    };

    const includedModules = merge(m => m.includedModules);
    for (const extra of binding?.includedModules ?? []) {
        if (!includedModules.includes(extra)) includedModules.push(extra);
    }

    // A module the methodology names but the import graph never resolved is a
    // hard diagnostic: a string naming an unavailable package is not a selection.
    for (const m of includedModules) {
        if (!availablePackages.has(m)) {
            diagnostics.push({
                code: 'unavailable-module',
                message:
                    `Module "${m}" is selected but is not in the project's import closure. Import the package, `
                    + `or remove it from the selection — a name alone does not make a module available.`,
            });
        }
    }

    for (const m of chain) {
        if (m.scopeMode === 'allAvailable') {
            const listed = [
                ...m.includedLayers, ...m.includedModules, ...m.includedStandards,
                ...m.includedArtifactKinds, ...m.includedViewpoints,
            ];
            if (listed.length > 0) {
                diagnostics.push({
                    code: 'scope-mode-conflict',
                    message:
                        `Methodology "${m.usageName}" sets scopeMode = allAvailable but also authors inclusion `
                        + `entries. Under allAvailable the lists must be empty; otherwise the methodology states `
                        + `its scope twice and the resolver has to pick.`,
                    methodology: m.usageName,
                });
            }
        }
    }

    const policyChain: PolicyChainEntry[] = [];
    for (const m of chain) {
        for (const p of m.rulePolicies) {
            policyChain.push({ source: m.usageName, level: 'methodology', policy: p });
        }
    }
    for (const p of binding?.rulePolicies ?? []) {
        policyChain.push({ source: binding!.usageName, level: 'project', policy: p });
    }

    return {
        chain,
        scopeMode,
        includedLayers: merge(m => m.includedLayers),
        includedModules,
        includedStandards: merge(m => m.includedStandards),
        includedArtifactKinds: merge(m => m.includedArtifactKinds),
        includedViewpoints: merge(m => m.includedViewpoints),
        policyChain,
        diagnostics,
    };
}

/** A rule as the constraint loader found it, plus the metadata policies need. */
export interface RuleCandidate {
    /** Stable rule ID, e.g. "CR-MED-040". Durable identity for audit records. */
    id: string;
    /** The `constraint def` name, which is what a policy references. */
    typeName: string;
    severity: RuleSeverity;
    tailoring: RuleTailoring;
    file?: string;
    constraint?: CompiledConstraint;
}

export interface EffectiveRuleSet {
    rules: EffectiveRule[];
    diagnostics: RuleResolutionDiagnostic[];
    /** The constraints that should actually be evaluated, in rule-ID order. */
    activeConstraints: CompiledConstraint[];
}

/**
 * Produce the effective rule set.
 *
 * Steps 1-3 of section 10.3 (collecting rules from ontology, extension, and
 * methodology packages) happen upstream: `collectNativeConstraints` walks the
 * resolved closure, which is exactly the set of packages those steps describe.
 * This function is steps 4-9 — apply policies base-first, validate, and emit.
 */
export function resolveEffectiveRules(
    candidates: RuleCandidate[],
    policyChain: PolicyChainEntry[],
): EffectiveRuleSet {
    const diagnostics: RuleResolutionDiagnostic[] = [];

    // Step 8, first half: IDs must be unique and types must be unambiguous.
    const byId = new Map<string, RuleCandidate>();
    const byType = new Map<string, RuleCandidate[]>();
    for (const c of candidates) {
        const clash = byId.get(c.id);
        if (clash && clash.typeName !== c.typeName) {
            diagnostics.push({
                code: 'duplicate-rule-id',
                message:
                    `Rule ID ${c.id} is declared by both ${clash.typeName} and ${c.typeName}. Rule IDs are audit `
                    + `identity; two rules sharing one leaves every violation ambiguous.`,
                ruleId: c.id,
                file: c.file,
            });
            continue;
        }
        byId.set(c.id, c);
        const list = byType.get(c.typeName) ?? [];
        list.push(c);
        byType.set(c.typeName, list);
    }

    const state = new Map<string, EffectiveRule>();
    for (const c of byId.values()) {
        state.set(c.typeName, {
            sourceRuleId: c.id,
            sourceRuleType: c.typeName,
            activeRuleId: c.id,
            activeRuleType: c.typeName,
            disposition: 'enabled',
            effectiveSeverity: c.severity,
            declaredSeverity: c.severity,
            tailoring: c.tailoring,
            policyChain: [],
            sourceFile: c.file,
        });
    }

    for (const entry of policyChain) {
        const { policy } = entry;
        const targetType = policy.targetRuleType;
        if (!targetType) {
            diagnostics.push({
                code: 'missing-target',
                message:
                    `Policy "${policy.usageName}" names no targetRule. A policy with no target changes nothing `
                    + `and hides that it changes nothing.`,
                policy: policy.usageName,
                file: policy.sourceFile,
            });
            continue;
        }
        const rule = state.get(targetType);
        if (!rule) {
            diagnostics.push({
                code: 'missing-target',
                message:
                    `Policy "${policy.usageName}" targets rule "${targetType}", which is not in the resolved rule `
                    + `set. Import the package declaring it, or remove the policy.`,
                policy: policy.usageName,
                file: policy.sourceFile,
            });
            continue;
        }
        const ambiguous = byType.get(targetType);
        if (ambiguous && ambiguous.length > 1) {
            diagnostics.push({
                code: 'ambiguous-target',
                message:
                    `Policy "${policy.usageName}" targets "${targetType}", which resolves to ${ambiguous.length} `
                    + `declarations. A reference must name exactly one rule.`,
                policy: policy.usageName,
                ruleId: rule.sourceRuleId,
                file: policy.sourceFile,
            });
            continue;
        }

        const disposition = policy.disposition ?? 'enabled';

        // Step 8: an invariant holds the ontology's own consistency. It changes
        // in an ontology release, not in a methodology.
        if (rule.tailoring === 'invariant' && disposition !== 'enabled') {
            diagnostics.push({
                code: 'invariant-protected',
                message:
                    `Policy "${policy.usageName}" tries to ${disposition === 'disabled' ? 'disable' : 'replace'} `
                    + `${rule.sourceRuleId} (${targetType}), which is classified invariant. Invariant rules hold `
                    + `the ontology's internal consistency and can only change in an ontology release.`,
                ruleId: rule.sourceRuleId,
                policy: policy.usageName,
                file: policy.sourceFile,
            });
            continue;
        }

        if (disposition !== 'enabled' && !policy.rationaleText) {
            diagnostics.push({
                code: 'missing-rationale',
                message:
                    `Policy "${policy.usageName}" ${disposition}s ${rule.sourceRuleId} without a rationale. `
                    + `A tailoring decision that records no reason cannot be audited.`,
                ruleId: rule.sourceRuleId,
                policy: policy.usageName,
                file: policy.sourceFile,
            });
        }

        if (disposition === 'replaced') {
            const replacementType = policy.replacementRuleType;
            if (!replacementType) {
                diagnostics.push({
                    code: 'replacement-without-target',
                    message:
                        `Policy "${policy.usageName}" sets disposition = replaced but names no replacementRule. `
                        + `A replacement must point at another native constraint.`,
                    ruleId: rule.sourceRuleId,
                    policy: policy.usageName,
                    file: policy.sourceFile,
                });
                continue;
            }
            const replacement = state.get(replacementType);
            if (!replacement) {
                diagnostics.push({
                    code: 'missing-replacement',
                    message:
                        `Policy "${policy.usageName}" replaces ${rule.sourceRuleId} with "${replacementType}", `
                        + `which is not in the resolved rule set.`,
                    ruleId: rule.sourceRuleId,
                    policy: policy.usageName,
                    file: policy.sourceFile,
                });
                continue;
            }
            rule.activeRuleType = replacementType;
            rule.activeRuleId = replacement.sourceRuleId;
        }

        rule.disposition = disposition;
        if (policy.severityOverride) rule.effectiveSeverity = policy.severityOverride;
        rule.policyChain.push(entry);
        if (policy.rationaleText) rule.rationaleText = policy.rationaleText;
        if (policy.authority) rule.authority = policy.authority;
        if (policy.approvalReference) rule.approvalReference = policy.approvalReference;
    }

    // A replaced rule's replacement should not also evaluate in its own right;
    // it is the substitute, not an addition.
    const replacementTypes = new Set(
        [...state.values()].filter(r => r.disposition === 'replaced').map(r => r.activeRuleType),
    );

    const rules = [...state.values()].sort((a, b) => a.sourceRuleId.localeCompare(b.sourceRuleId));

    const activeConstraints: CompiledConstraint[] = [];
    for (const rule of rules) {
        if (rule.disposition === 'disabled') continue;
        if (rule.disposition === 'enabled' && replacementTypes.has(rule.sourceRuleType)) continue;
        const candidate = byType.get(rule.activeRuleType)?.[0];
        if (!candidate?.constraint) continue;
        activeConstraints.push({ ...candidate.constraint, severity: rule.effectiveSeverity });
    }

    return { rules, diagnostics, activeConstraints };
}
