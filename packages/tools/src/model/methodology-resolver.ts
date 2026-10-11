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
import type { CompiledConstraint, RuleDomain, RuleObligation } from '../validator/constraint-eval.js';

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
    /** Why the rule exists, as the rule states it. */
    domain?: RuleDomain;
    /** How firmly the rule's source asks for what it checks. */
    obligation?: RuleObligation;
    /** The clauses the rule enforces (qualified names). */
    enforces?: readonly string[];
    /** The package that declares the rule's subject kind: its layer, for a policy that selects by category. */
    subjectPackage?: string;
}

export interface RuleResolutionDiagnostic {
    code:
        | 'missing-target'
        | 'missing-replacement'
        | 'duplicate-rule-id'
        | 'invariant-protected'
        | 'replacement-without-target'
        | 'missing-rationale'
        | 'ambiguous-target'
        /** A policy names more than one of a rule, a standard and a category. */
        | 'multiple-targets'
        /** A policy that selects several rules cannot replace them. */
        | 'bulk-replacement'
        /** Resolution itself threw. Reported so the UI shows why the set is empty. */
        | 'resolution-failed';
    message: string;
    ruleId?: string;
    policy?: string;
    file?: string;
}

export interface MethodologyDiagnostic {
    code:
        | 'missing-base'
        | 'missing-extension'
        | 'inheritance-cycle'
        | 'unavailable-module'
        | 'unavailable-layer'
        | 'scope-mode-conflict';
    message: string;
    methodology?: string;
}

/**
 * Does `packageName` sit inside the layer namespace `layer`?
 *
 * A layer entry names a namespace, not a package — `memo_core.sysml` says so:
 * "Layer entries normally name a public MEMO layer namespace; module entries may
 * name any qualified package available to the project." The architecture layers
 * decompose one level down, so `memo_architecture_logical` is a namespace over
 * `memo_architecture_logical_interfaces` and `memo_architecture_logical_structure`
 * and is not itself a package anywhere in the tree.
 *
 * Matching those two by string equality is why every layer entry selected
 * nothing, and why 25 rules whose subject kind lives in an architecture package
 * were dropped from the effective rule set without a word. This is the one place
 * that knows a layer is a prefix, so the scope test and the availability
 * diagnostic cannot drift apart and disagree about what a layer covers.
 *
 * The separator is part of the test, not decoration: a bare `startsWith` would
 * let `memo_architecture_logical` swallow a sibling named
 * `memo_architecture_logical_extra_thing` only by intent, but also anything
 * merely beginning with those letters. Both spellings are accepted because a
 * module entry may name an externally qualified package, and a layer entry has
 * no reason to be stricter about its own punctuation than the tree it indexes.
 */
export function isWithinLayerNamespace(layer: string, packageName: string): boolean {
    if (packageName === layer) return true;
    return packageName.startsWith(`${layer}_`) || packageName.startsWith(`${layer}::`);
}

/**
 * Every package reachable from the seeds' PUBLIC imports, transitively, in the
 * order first reached. The seeds themselves are not included: a methodology's
 * package declares the methodology, and what it selects is what it re-exports.
 *
 * Only public imports are followed because only they re-export: a package's
 * private imports are its own business (`memo_extension_ros` privately imports
 * the architecture packages it specializes), and following them would select
 * everything a selected package happens to use.
 */
export function publicImportClosure(
    seeds: Iterable<string>,
    publicImports: ReadonlyMap<string, ReadonlySet<string>>,
): string[] {
    const out: string[] = [];
    const seen = new Set<string>();
    const pending = [...seeds].flatMap(seed => [...(publicImports.get(seed) ?? [])]);
    while (pending.length > 0) {
        const name = pending.shift()!;
        if (seen.has(name)) continue;
        seen.add(name);
        out.push(name);
        for (const next of publicImports.get(name) ?? []) pending.push(next);
    }
    return out;
}

/** The methodology chain plus its merged selection. */
export interface EffectiveMethodology {
    /** Base first, selected methodology last. */
    chain: NativeMethodology[];
    /**
     * The extensions `includedExtension` reached from the chain and the binding,
     * transitively, in the order first reached. Each contributes its own
     * inclusion lists; none contributes its base chain or its policies.
     */
    extensions: NativeMethodology[];
    scopeMode: ScopeMode;
    /**
     * The packages the selection imports: the public-import closure of the
     * packages declaring the chain's methodologies and the project binding.
     */
    selectedPackages: string[];
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
    publicImports: ReadonlyMap<string, ReadonlySet<string>> = new Map(),
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

    // Extensions. An extension is named by its methodology, and what including
    // one adds is that methodology's OWN selection, plus the extensions it
    // includes in turn — never its base chain. Following the base would let an
    // extension whose base is the default methodology widen a narrower selected
    // methodology to everything the default selects. Its rule policies are not
    // applied either: tailoring belongs to the selected chain and the project.
    // A methodology reached twice (or already in the chain) contributes once,
    // so a cycle of inclusions is a union and needs no special case.
    const extensions: NativeMethodology[] = [];
    const reached = new Set(chain.map(m => m.usageName));
    const pending: { name: string; from: string }[] = [
        ...chain.flatMap(m => m.includedExtensions.map(name => ({ name, from: m.usageName }))),
        ...(binding?.includedExtensions ?? []).map(name => ({ name, from: binding!.usageName })),
    ];
    while (pending.length > 0) {
        const { name, from } = pending.shift()!;
        if (reached.has(name)) continue;
        reached.add(name);
        const extension = methodologies.get(name);
        if (!extension) {
            diagnostics.push({
                code: 'missing-extension',
                message:
                    `"${from}" includes the extension "${name}", which no resolved package declares as a `
                    + `MethodologyDefinition. Import the extension's methodology package; an extension that `
                    + `does not resolve selects nothing.`,
                methodology: from,
            });
            continue;
        }
        extensions.push(extension);
        for (const next of extension.includedExtensions) pending.push({ name: next, from: extension.usageName });
    }

    const contributors = [...chain, ...extensions];
    const merge = (pick: (m: NativeMethodology) => string[]): string[] => {
        const out: string[] = [];
        for (const m of contributors) for (const v of pick(m)) if (!out.includes(v)) out.push(v);
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

    // A layer that covers no resolved package is the same defect as an
    // unavailable module, and it went unreported for as long as it did only
    // because the module check above existed and this one did not. It is the
    // half that matters most: whichever way the matching goes, a selection that
    // selects nothing has to say so, or the next divergence is silent too. A
    // narrower rule set reports fewer violations, which reads exactly like a
    // cleaner model.
    for (const l of merge(m => m.includedLayers)) {
        let covers = false;
        for (const pkg of availablePackages) {
            if (isWithinLayerNamespace(l, pkg)) { covers = true; break; }
        }
        if (!covers) {
            diagnostics.push({
                code: 'unavailable-layer',
                message:
                    `Layer "${l}" is selected but covers no package in the project's import closure. A layer `
                    + `entry names a namespace, so it selects every resolved package within it — selecting `
                    + `none means the name matches nothing, and every rule and kind placed in that layer is `
                    + `silently out of scope.`,
            });
        }
    }

    for (const m of chain) {
        if (m.scopeMode === 'allAvailable') {
            const listed = [
                ...m.includedLayers, ...m.includedModules, ...m.includedStandards,
                ...m.includedArtifactKinds, ...m.includedViewpoints, ...m.includedExtensions,
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

    // The selection stated the SysML way: what the methodology's package, and
    // the project's entrypoint package, publicly import.
    const seeds = [
        ...chain.map(m => m.packageQualifiedName),
        binding?.packageQualifiedName,
    ].filter((name): name is string => Boolean(name));
    const selectedPackages = publicImportClosure(seeds, publicImports);

    return {
        chain,
        extensions,
        scopeMode,
        selectedPackages,
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
    /** The package that declares the rule's subject kind, when it has one. */
    subjectPackage?: string;
}

/**
 * Map compiled native constraints onto rule candidates.
 *
 * One place, because both `memo rules` and the dev server need it and they got
 * the field names wrong independently — `collectNativeConstraints` returns
 * `id`/`typeName`/`sourceFile`, not `ruleId`/`ruleType`/`file`. A rule whose
 * identity does not survive this mapping resolves as `undefined` and is
 * unauditable, which is the opposite of what section 10.4 asks for.
 *
 * A constraint with no `typeName` is skipped: a policy references a rule by its
 * `constraint def` name, so a rule without one cannot be tailored and does not
 * belong in a set whose purpose is recording tailoring decisions.
 */
export function ruleCandidatesFromConstraints(
    constraints: readonly CompiledConstraint[],
    subjectPackage: (constraint: CompiledConstraint) => string | undefined = () => undefined,
): RuleCandidate[] {
    const candidates: RuleCandidate[] = [];
    for (const constraint of constraints) {
        if (!constraint.typeName) continue;
        candidates.push({
            id: constraint.id,
            typeName: constraint.typeName,
            severity: constraint.severity,
            tailoring: constraint.tailoring ?? 'assurance',
            file: constraint.sourceFile,
            constraint,
            ...(subjectPackage(constraint) ? { subjectPackage: subjectPackage(constraint) } : {}),
        });
    }
    return candidates;
}

/** Whether a clause (a qualified name) belongs to a standard named as written: qualified, or by its usage name. */
export function clauseInStandard(clause: string, standard: string): boolean {
    if (standard.includes('::')) return clause === standard || clause.startsWith(`${standard}::`);
    return clause.split('::').includes(standard);
}

/** The rules a policy's standard or category selects (none when it states neither). */
export function rulesSelectedBy<T extends Pick<EffectiveRule, 'enforces' | 'subjectPackage'>>(
    rules: readonly T[],
    selector: { targetStandard?: string; targetCategory?: string },
): T[] {
    if (selector.targetStandard) {
        const standard = selector.targetStandard;
        return rules.filter(rule => (rule.enforces ?? []).some(clause => clauseInStandard(clause, standard)));
    }
    if (selector.targetCategory) {
        const category = selector.targetCategory;
        return rules.filter(rule => rule.subjectPackage !== undefined && isWithinLayerNamespace(category, rule.subjectPackage));
    }
    return [];
}

/** The layer namespaces that have rules: the values `targetCategory` can take, spelled as a methodology's `includedLayer`. */
export function layersWithRules(rules: readonly Pick<EffectiveRule, 'subjectPackage'>[]): string[] {
    const packages = [...new Set(rules.map(rule => rule.subjectPackage).filter((p): p is string => Boolean(p)))].sort();
    // The layer is the namespace the packages share: `memo_assurance_safety_risk`, not a sub-package of it.
    return packages.filter(name => !packages.some(other => other !== name && name.startsWith(`${other}_`)));
}

/** The standards some rule enforces a clause of: what `targetStandard` can name, by qualified name and designation. */
export function standardsWithRules(
    rules: readonly Pick<EffectiveRule, 'enforces'>[],
    clauses: readonly { qualifiedName: string; standard: string; standardName: string }[],
): { standardName: string; standard: string }[] {
    const enforced = new Set(rules.flatMap(rule => rule.enforces ?? []));
    const found = new Map<string, string>();
    for (const clause of clauses) if (enforced.has(clause.qualifiedName)) found.set(clause.standardName, clause.standard);
    return [...found].map(([standardName, standard]) => ({ standardName, standard })).sort((a, b) => a.standard.localeCompare(b.standard));
}

/**
 * Apply a policy that selects by standard or by category.
 *
 * It expands to the rules it matches and applies one decision to each, so the
 * tailoring record shows one policy with every rule it reached, and a rule
 * added later that matches is covered. A selection that reaches nothing, or
 * only invariants, is reported: a bulk policy that changes nothing must say so.
 */
function applyBulkPolicy(
    entry: PolicyChainEntry,
    rules: EffectiveRule[],
    diagnostics: RuleResolutionDiagnostic[],
): void {
    const { policy } = entry;
    const disposition = policy.disposition ?? 'enabled';
    const selection = policy.targetStandard
        ? `the standard "${policy.targetStandard}"`
        : `the category "${policy.targetCategory}"`;
    if (disposition === 'replaced') {
        diagnostics.push({
            code: 'bulk-replacement',
            message:
                `Policy "${policy.usageName}" replaces the rules of ${selection}. A replacement answers one rule; `
                + `a selection of several can be disabled or have its severity changed, not replaced.`,
            policy: policy.usageName,
            file: policy.sourceFile,
        });
        return;
    }
    if (disposition !== 'enabled' && !policy.rationaleText) {
        diagnostics.push({
            code: 'missing-rationale',
            message:
                `Policy "${policy.usageName}" ${disposition}s the rules of ${selection} without a rationale. `
                + `A tailoring decision that records no reason cannot be audited.`,
            policy: policy.usageName,
            file: policy.sourceFile,
        });
    }

    const matched = rulesSelectedBy(rules, policy);
    if (matched.length === 0) {
        diagnostics.push({
            code: 'missing-target',
            message:
                `Policy "${policy.usageName}" selects ${selection}, which matches no rule in the resolved rule set. `
                + (policy.targetStandard
                    ? `A rule is selected by the clauses it enforces, which only a compiler that builds the model can read; `
                      + `check the standard's name and that its package is in the project.`
                    : `A category is a layer namespace as a methodology's \`includedLayer\` spells it, and selects the rules `
                      + `whose subject kind is declared in it.`),
            policy: policy.usageName,
            file: policy.sourceFile,
        });
        return;
    }

    const protectedIds: string[] = [];
    for (const rule of matched) {
        if (rule.tailoring === 'invariant' && disposition !== 'enabled') {
            protectedIds.push(rule.sourceRuleId);
            continue;
        }
        rule.disposition = disposition;
        if (policy.severityOverride) rule.effectiveSeverity = policy.severityOverride;
        rule.policyChain.push(entry);
        if (policy.rationaleText) rule.rationaleText = policy.rationaleText;
        if (policy.authority) rule.authority = policy.authority;
        if (policy.approvalReference) rule.approvalReference = policy.approvalReference;
    }
    if (protectedIds.length > 0) {
        diagnostics.push({
            code: 'invariant-protected',
            message:
                `Policy "${policy.usageName}" selects ${protectedIds.length} invariant rule(s) of ${selection} `
                + `(${protectedIds.join(', ')}); they keep running. Invariant rules hold the ontology's internal `
                + `consistency and can only change in an ontology release.`,
            policy: policy.usageName,
            file: policy.sourceFile,
        });
    }
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
            ...(c.constraint?.domain ? { domain: c.constraint.domain } : {}),
            ...(c.constraint?.obligation ? { obligation: c.constraint.obligation } : {}),
            ...(c.constraint?.enforces ? { enforces: c.constraint.enforces } : {}),
            ...(c.subjectPackage ? { subjectPackage: c.subjectPackage } : {}),
        });
    }

    for (const entry of policyChain) {
        const { policy } = entry;
        const selectors = [policy.targetRuleType, policy.targetStandard, policy.targetCategory].filter(Boolean);
        if (selectors.length > 1) {
            diagnostics.push({
                code: 'multiple-targets',
                message:
                    `Policy "${policy.usageName}" names more than one of a rule, a standard and a category. A policy `
                    + `selects what it governs in exactly one way; state one decision per selection.`,
                policy: policy.usageName,
                file: policy.sourceFile,
            });
            continue;
        }
        if (policy.targetStandard || policy.targetCategory) {
            applyBulkPolicy(entry, [...state.values()], diagnostics);
            continue;
        }
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
