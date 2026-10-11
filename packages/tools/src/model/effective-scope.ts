// ─── Effective Scope ──────────────────────────────────────────────────────────
//
// What the project's methodology actually selects, and the single place that
// answers "is this in scope?" for model visibility, rule activation,
// completeness, palettes, and allowed creation kinds.
//
// The behaviour this replaces is the reason the module exists. `dimension-filter`
// treated an empty inclusion list as "the methodology does not restrict", so a
// methodology that selected nothing and a methodology that selected everything
// produced identical results, and nobody could tell which one had been authored.
// Scope is now explicit: `scopeMode` says which it is, and under `explicit` a
// methodology whose package publicly imports nothing selects nothing.
//
// Design reference: sections 9.2 and 18.3 deliverable 3.
// ─────────────────────────────────────────────────────────────────────────────

import type { EffectiveMethodology, RuleCandidate } from './methodology-resolver.js';
import { ruleCandidatesFromConstraints, resolveEffectiveRules } from './methodology-resolver.js';
import type { CompiledConstraint } from '../validator/constraint-eval.js';
import type { MemoModel } from './semantic.js';

export type ScopeDimension = 'standard' | 'artifactKind' | 'viewpoint';

/** The resolved answer to "what is in scope", ready to be asked questions. */
export interface EffectiveScope {
    mode: 'allAvailable' | 'explicit';
    /** The packages the selection imports (`EffectiveMethodology.selectedPackages`). */
    packages: ReadonlySet<string>;
    standards: ReadonlySet<string>;
    artifactKinds: ReadonlySet<string>;
    viewpoints: ReadonlySet<string>;
}

export function buildEffectiveScope(methodology: EffectiveMethodology): EffectiveScope {
    return {
        mode: methodology.scopeMode,
        packages: new Set(methodology.selectedPackages),
        standards: new Set(methodology.includedStandards),
        artifactKinds: new Set(methodology.includedArtifactKinds),
        viewpoints: new Set(methodology.includedViewpoints),
    };
}

/** A scope that selects everything — the shape callers get before a binding resolves. */
export const UNRESTRICTED_SCOPE: EffectiveScope = {
    mode: 'allAvailable',
    packages: new Set(),
    standards: new Set(),
    artifactKinds: new Set(),
    viewpoints: new Set(),
};

function setFor(scope: EffectiveScope, dimension: ScopeDimension): ReadonlySet<string> {
    switch (dimension) {
        case 'standard': return scope.standards;
        case 'artifactKind': return scope.artifactKinds;
        case 'viewpoint': return scope.viewpoints;
    }
}

/**
 * Is one value in scope for a dimension?
 *
 * Under `allAvailable` everything the project resolved is in scope, and the
 * lists are required to be empty. Under `explicit` only what is listed is in
 * scope — including when the list is empty, which selects nothing.
 */
export function isInScope(scope: EffectiveScope, dimension: ScopeDimension, value: string | undefined): boolean {
    if (scope.mode === 'allAvailable') return true;
    if (value === undefined) return false;
    return setFor(scope, dimension).has(value);
}

/**
 * Is a package in scope?
 *
 * Under `explicit`, a package is in scope when the selection imports it: the
 * methodology's package, or the binding's, publicly imports it, directly or
 * through packages it publicly imports (`publicImportClosure`). A layer is
 * selected through its layer package and an extension through its facade, so
 * there is no second, name-matching test here.
 */
export function isPackageInScope(scope: EffectiveScope, packageName: string): boolean {
    if (scope.mode === 'allAvailable') return true;
    return scope.packages.has(packageName);
}

/**
 * Is a rule active under this scope?
 *
 * A rule is scoped by the package that declares it. Disposition is a separate
 * question answered by `resolveEffectiveRules`: a rule can be in scope and
 * disabled, and the audit needs to show both facts rather than one.
 */
export function isRulePackageInScope(scope: EffectiveScope, declaringPackage: string | undefined): boolean {
    if (scope.mode === 'allAvailable') return true;
    if (!declaringPackage) return false;
    return isPackageInScope(scope, declaringPackage);
}


// ─── Rule activation ─────────────────────────────────────────────────────────

/**
 * The rules a project's methodology actually activates.
 *
 * A rule is active when BOTH its declaring package and its subject kind are in
 * scope — unless it is classified `invariant`, which is active in every scope. A rule whose subject the methodology never selected can only report on
 * content the project did not agree to model — which is how the GPCA prototype
 * used to accumulate cybersecurity violations for a discipline it had excluded.
 *
 * This lives here, shared, because `memo validate` and `memo validate --rules` are
 * two views of one answer. They computed it separately, and inevitably
 * disagreed: `validate` scope-filtered and `rules list` did not, so the same
 * project reported 20 rules and 38 rules depending on which command you asked.
 * A number that changes with the question is not an audit.
 */
export function activeRuleCandidates(
    constraints: readonly CompiledConstraint[],
    scope: EffectiveScope,
    filePackages: ReadonlyMap<string, string>,
    kindSourceFile: (kindName: string) => string | undefined,
    /** A rule in one of the project's own files is its authors': its package is always in scope. */
    isOwnFile: (file: string) => boolean = () => false,
): RuleCandidate[] {
    const packageOf = (file: string | undefined) =>
        file ? filePackages.get(file) : undefined;

    const subjectInScope = (appliesTo: string | undefined): boolean => {
        if (scope.mode === 'allAvailable') return true;
        // A model-level rule has no single subject kind to place.
        if (!appliesTo || appliesTo === 'Model') return true;
        const kindName = appliesTo.split('[')[0];
        // A methodology selects packages, so a kind is placed by
        // the package that declares it — not by the `layer` string, which is a
        // display grouping in a different namespace.
        return isRulePackageInScope(scope, packageOf(kindSourceFile(kindName)));
    };

    // An invariant is exempt from both. A RulePolicy cannot disable one
    // (`invariant-protected`), and leaving its package or its subject kind out
    // of the selection disabled it just the same, with no policy and no
    // diagnostic to show for it. An invariant over a kind the project never
    // uses runs on nothing and reports as vacuous, which is the honest answer.
    //
    // A rule the project wrote itself is not filtered by package: a methodology
    // selects the ontology's packages, and a project's own rule belongs to the
    // project. Its subject kind is still checked.
    return ruleCandidatesFromConstraints(
        constraints.filter(c => c.tailoring === 'invariant'
            || (((c.sourceFile !== undefined && isOwnFile(c.sourceFile))
                || isRulePackageInScope(scope, packageOf(c.sourceFile)))
                && subjectInScope(c.appliesToKind))),
        constraint => subjectPackageOf(constraint, filePackages, kindSourceFile),
    );
}

/** The package that declares a rule's subject kind: its layer, for a policy that selects by category. */
function subjectPackageOf(
    constraint: CompiledConstraint,
    filePackages: ReadonlyMap<string, string>,
    kindSourceFile: (kindName: string) => string | undefined,
): string | undefined {
    const appliesTo = constraint.appliesToKind;
    // A model-level rule has no single subject kind to place.
    if (!appliesTo || appliesTo === 'Model') return undefined;
    const file = kindSourceFile(appliesTo.split('[')[0]);
    return file ? filePackages.get(file) : undefined;
}

export interface InactiveRule {
    id: string;
    typeName?: string;
    file?: string;
    reason: 'package-not-selected' | 'subject-not-selected';
    detail: string;
}

/**
 * The rules a methodology does not activate, and why. A rule that does not run
 * must say so: one that is silently absent reads as one that passed.
 */
export function inactiveRules(
    constraints: readonly CompiledConstraint[],
    scope: EffectiveScope,
    filePackages: ReadonlyMap<string, string>,
    kindSourceFile: (kindName: string) => string | undefined,
    isOwnFile: (file: string) => boolean = () => false,
): InactiveRule[] {
    const active = new Set(activeRuleCandidates(constraints, scope, filePackages, kindSourceFile, isOwnFile).map(c => c.id));
    return constraints.filter(c => !active.has(c.id)).map(c => {
        const own = c.sourceFile !== undefined && isOwnFile(c.sourceFile);
        const packageIn = own || isRulePackageInScope(scope, c.sourceFile ? filePackages.get(c.sourceFile) : undefined);
        const kind = (c.appliesToKind ?? '').split('[')[0];
        return packageIn
            ? {
                id: c.id, typeName: c.typeName, file: c.sourceFile, reason: 'subject-not-selected' as const,
                detail: `it applies to ${kind}, which the project's methodology does not select`,
            }
            : {
                id: c.id, typeName: c.typeName, file: c.sourceFile, reason: 'package-not-selected' as const,
                detail: 'the package that declares it is not one the project\'s methodology selects',
            };
    });
}

/**
 * The project's effective rule set: the rules its methodology activates, with
 * its policies applied. One answer, asked by `memo validate`, `memo validate --rules`
 * and the Architect's dev server, so they report one rule set.
 */
export function resolveProjectRules(input: {
    constraints: readonly CompiledConstraint[];
    effective: EffectiveMethodology | undefined;
    filePackages: ReadonlyMap<string, string>;
    kindSourceFile: (kindName: string) => string | undefined;
    isOwnFile?: (file: string) => boolean;
}): { rules: ReturnType<typeof resolveEffectiveRules>; scope: EffectiveScope | undefined } {
    const scope = input.effective ? buildEffectiveScope(input.effective) : undefined;
    const candidates = scope
        ? activeRuleCandidates(input.constraints, scope, input.filePackages, input.kindSourceFile, input.isOwnFile)
        : ruleCandidatesFromConstraints(
            input.constraints,
            constraint => subjectPackageOf(constraint, input.filePackages, input.kindSourceFile));
    return { rules: resolveEffectiveRules(candidates, input.effective?.policyChain ?? []), scope };
}

/**
 * The ids rules may run ON under a methodology scope: every element whose kind
 * the scope selects, and every named, typed edge whose declared kind it
 * selects.
 *
 * The edges matter because a named `flow` or `interface` typed by a domain
 * definition is a rule subject of that kind under the RELATIONSHIP's id
 * (relationship-subjects.ts). A set built from elements alone dropped every
 * such subject under any explicit scope, so a rule scoped to
 * `FunctionalExchange` or `ComponentExchange` ran on nothing and reported a
 * clean pass.
 */
export function scopedSubjectIds(model: MemoModel, selectsKind: (kind: string) => boolean): Set<string> {
    const ids = new Set<string>();
    for (const [id, element] of model.elements) {
        if (selectsKind(element.kind)) ids.add(id);
    }
    for (const relationship of model.relationships) {
        if (relationship.named && relationship.kind && selectsKind(relationship.kind)) ids.add(relationship.id);
    }
    return ids;
}
