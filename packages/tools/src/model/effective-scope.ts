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
// Scope is now explicit: `scopeMode` says which it is, and under `explicit` an
// empty list selects nothing.
//
// Design reference: sections 9.2 and 18.3 deliverable 3.
// ─────────────────────────────────────────────────────────────────────────────

import type { EffectiveMethodology, RuleCandidate } from './methodology-resolver.js';
import { ruleCandidatesFromConstraints } from './methodology-resolver.js';
import type { CompiledConstraint } from '../validator/constraint-eval.js';

/**
 * The part of a kind this module needs.
 *
 * `layer` is optional here even though the registry always fills it: a caller
 * may be asking about a kind that did not resolve, and "unplaced" has to be a
 * representable answer rather than a cast.
 */
export interface ScopedKind {
    layer?: string;
}

export type ScopeDimension = 'layer' | 'module' | 'standard' | 'artifactKind' | 'viewpoint';

/** The resolved answer to "what is in scope", ready to be asked questions. */
export interface EffectiveScope {
    mode: 'allAvailable' | 'explicit';
    layers: ReadonlySet<string>;
    modules: ReadonlySet<string>;
    standards: ReadonlySet<string>;
    artifactKinds: ReadonlySet<string>;
    viewpoints: ReadonlySet<string>;
}

export function buildEffectiveScope(methodology: EffectiveMethodology): EffectiveScope {
    return {
        mode: methodology.scopeMode,
        layers: new Set(methodology.includedLayers),
        modules: new Set(methodology.includedModules),
        standards: new Set(methodology.includedStandards),
        artifactKinds: new Set(methodology.includedArtifactKinds),
        viewpoints: new Set(methodology.includedViewpoints),
    };
}

/** A scope that selects everything — the shape callers get before a binding resolves. */
export const UNRESTRICTED_SCOPE: EffectiveScope = {
    mode: 'allAvailable',
    layers: new Set(),
    modules: new Set(),
    standards: new Set(),
    artifactKinds: new Set(),
    viewpoints: new Set(),
};

function setFor(scope: EffectiveScope, dimension: ScopeDimension): ReadonlySet<string> {
    switch (dimension) {
        case 'layer': return scope.layers;
        case 'module': return scope.modules;
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
 * Is a kind in scope?
 *
 * A kind belongs to exactly one axis position, so it is in scope when its layer
 * is selected. A kind with no layer is only in scope under `allAvailable`: an
 * unplaced kind cannot be shown to satisfy an explicit selection.
 */
export function isKindInScope(scope: EffectiveScope, kind: ScopedKind): boolean {
    return isInScope(scope, 'layer', kind.layer);
}

/** Filter kinds to those in scope. Used by palettes and creation dialogs alike. */
export function filterKindsInScope<T extends ScopedKind>(
    kinds: readonly T[],
    scope: EffectiveScope,
): T[] {
    if (scope.mode === 'allAvailable') return [...kinds];
    return kinds.filter(kind => isKindInScope(scope, kind));
}

/**
 * Is a package in scope?
 *
 * `includedLayer` and `includedModule` both name packages; a methodology splits
 * them for readability, not because the resolver treats them differently.
 */
export function isPackageInScope(scope: EffectiveScope, packageName: string): boolean {
    if (scope.mode === 'allAvailable') return true;
    return scope.layers.has(packageName) || scope.modules.has(packageName);
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
 * scope. A rule whose subject the methodology never selected can only report on
 * content the project did not agree to model — which is how the GPCA prototype
 * used to accumulate cybersecurity violations for a discipline it had excluded.
 *
 * This lives here, shared, because `memo validate` and `memo rules list` are
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
): RuleCandidate[] {
    const packageOf = (file: string | undefined) =>
        file ? filePackages.get(file) : undefined;

    const subjectInScope = (appliesTo: string | undefined): boolean => {
        if (scope.mode === 'allAvailable') return true;
        // A model-level rule has no single subject kind to place.
        if (!appliesTo || appliesTo === 'Model') return true;
        const kindName = appliesTo.split('[')[0];
        // A methodology's inclusion lists name packages, so a kind is placed by
        // the package that declares it — not by the `layer` string, which is a
        // display grouping in a different namespace.
        return isRulePackageInScope(scope, packageOf(kindSourceFile(kindName)));
    };

    return ruleCandidatesFromConstraints(
        constraints
            .filter(c => isRulePackageInScope(scope, packageOf(c.sourceFile)))
            .filter(c => subjectInScope(c.appliesToKind)),
    );
}
