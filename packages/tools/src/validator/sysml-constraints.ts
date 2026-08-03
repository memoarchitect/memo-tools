// ─── SysML well-formedness constraints (Track B B4) ──────────────────────────
//
// The native reimplementation of the language's own well-formedness rules, as
// distinct from MEMO's methodology rules. Three commitments shape it, and all
// three come from the plan rather than from taste:
//
//   1. **Syside's codes, verbatim** (§5.1.2). `syside rule list` publishes 151
//      stable kebab-case codes with descriptions. A project that suppresses
//      `association-end-types` today must have that suppression keep working
//      after the engine swap, which it only can if the code string is the same
//      string. No parallel MEMO numbering is invented.
//   2. **A specification clause per rule.** A constraint whose justification is
//      "Syside checks this" is not reviewable. Each carries the KerML/SysML
//      clause it implements, so a reader can check the rule against the source
//      of truth rather than against another tool.
//   3. **Scored, not claimed.** `memo conformance rules` reports every one of
//      the 151 codes as implemented, not-yet, or out-of-scope-with-a-reason.
//      Coverage is a number that can only go up by writing a rule.
//
// **Where this sits relative to the rest of validation.** MEMO's methodology
// rules live in the ontology and are evaluated by `validator/rule-engine.ts`;
// they answer "does this model follow MEMO's method?". These answer "is this
// well-formed SysML?", which is the `sysml` diagnostic domain (§1), and they
// are engine code by necessity — the language's rules are not MEMO's content to
// declare. That is not a hole in the ontology-drives rule; it is the boundary
// of it.
//
// **What limits coverage today, stated once.** Most of the 151 are predicates
// over *resolved* semantics — inherited features, effective types, imported
// namespaces. MEMO has no linker and no resolution core yet (B3, B5), so a rule
// needing one cannot be written honestly, only faked. Those are classified
// `blocked` with the reason, and the number of them is the real measure of how
// much B3 and B5 gate B4.
// ─────────────────────────────────────────────────────────────────────────────

import { SYSIDE_RULES, SYSIDE_VERSION, type SysideRule } from '../conformance/generated/syside-rules.js';
import type { MemoModelDTO } from '../model/semantic.js';
import { activityNodeType, isControlNode } from '../model/activity-notation.js';

export { SYSIDE_RULES, SYSIDE_VERSION };

/** One violation, in the shape a `sysml`-domain diagnostic is built from. */
export interface ConstraintViolation {
    /** Syside's code, verbatim. */
    code: string;
    message: string;
    elementId: string;
    file: string;
}

export interface SysmlConstraint {
    /** Syside's code, verbatim — never a MEMO-invented identifier. */
    code: string;
    /** Specification clause this implements, e.g. `KerML 8.3.3.1`. */
    clause: string;
    /** Metaclass or MEMO construct the rule ranges over, for reporting. */
    appliesTo: string;
    /**
     * What this implementation does *not* catch, where that is known.
     *
     * A partially-implemented rule reported as "implemented" is worse than an
     * unimplemented one: it converts a gap into false confidence. Stating the
     * limitation in the data means the scoreboard prints it, so the coverage
     * number is never read as more than it is.
     */
    limitation?: string;
    check(model: MemoModelDTO): ConstraintViolation[];
}

/** Why a published code has no implementation here. */
export type UnimplementedReason = 'blocked' | 'out-of-scope' | 'not-yet';

export interface UnimplementedConstraint {
    code: string;
    reason: UnimplementedReason;
    /** Required: an unexplained gap is indistinguishable from an oversight. */
    detail: string;
}

// ─── Implemented constraints ─────────────────────────────────────────────────
//
// Every one of these is a predicate over *declared* structure, which is the
// whole set that can be written honestly before the resolution core exists.
// They run over the canonical IR rather than over MEMO's projection, because
// the IR conserves every declaration — imports, duplicates, unmapped members —
// and the projection by design does not.

/** Namespace path of a declaration: its identity path minus the last segment. */
function namespaceOf(identityId: string): string {
    const hash = identityId.indexOf('#');
    const colon = identityId.lastIndexOf(':');
    const path = identityId.slice(hash + 1, colon);
    const slash = path.lastIndexOf('/');
    return `${identityId.slice(0, hash)}#${slash < 0 ? '' : path.slice(0, slash)}`;
}

/** True for a declaration sitting directly in a file's root namespace. */
function isTopLevel(identityId: string): boolean {
    const hash = identityId.indexOf('#');
    const colon = identityId.lastIndexOf(':');
    return !identityId.slice(hash + 1, colon).includes('/');
}

function declarations(model: MemoModelDTO) {
    return model.sysmlIr?.elements ?? [];
}

export const IMPLEMENTED_CONSTRAINTS: readonly SysmlConstraint[] = [
    {
        code: 'import-explicit-visibility',
        clause: 'KerML 8.2.3.5 — an Import declares its visibility',
        appliesTo: 'Import',
        check(model) {
            const violations: ConstraintViolation[] = [];
            for (const declaration of declarations(model)) {
                if (declaration.identity.metaclass !== 'ImportDeclaration') continue;
                if (declaration.standardProperties.visibility !== undefined) continue;
                violations.push({
                    code: 'import-explicit-visibility',
                    message: `Import of "${String(declaration.standardProperties.path ?? '?')}" has no explicit visibility; declare it \`private\` or \`public\`.`,
                    elementId: declaration.identity.id,
                    file: declaration.source.file,
                });
            }
            return violations;
        },
    },
    {
        code: 'import-top-level-visibility',
        clause: 'KerML 8.2.3.5 — a root-namespace Import is private',
        appliesTo: 'Import',
        check(model) {
            const violations: ConstraintViolation[] = [];
            for (const declaration of declarations(model)) {
                if (declaration.identity.metaclass !== 'ImportDeclaration') continue;
                if (!isTopLevel(declaration.identity.id)) continue;
                if (declaration.standardProperties.visibility === 'private') continue;
                violations.push({
                    code: 'import-top-level-visibility',
                    message: 'An import at the root of a file is private; it cannot re-export into the global namespace.',
                    elementId: declaration.identity.id,
                    file: declaration.source.file,
                });
            }
            return violations;
        },
    },
    {
        code: 'namespace-distinguishability',
        clause: 'KerML 8.2.3.3 — members of a Namespace are distinguishable by name',
        appliesTo: 'Namespace',
        check(model) {
            const seen = new Map<string, string>();
            const violations: ConstraintViolation[] = [];
            for (const declaration of declarations(model)) {
                const name = declaration.standardProperties.name;
                if (typeof name !== 'string' || !name) continue;
                const key = `${namespaceOf(declaration.identity.id)}::${name}`;
                const first = seen.get(key);
                if (first === undefined) {
                    seen.set(key, declaration.identity.id);
                    continue;
                }
                violations.push({
                    code: 'namespace-distinguishability',
                    message: `"${name}" is declared more than once in this namespace; the first is ${first}.`,
                    elementId: declaration.identity.id,
                    file: declaration.source.file,
                });
            }
            return violations;
        },
    },
    {
        code: 'global-namespace-distinguishability',
        clause: 'KerML 8.2.3.3 — root-namespace members are globally distinguishable',
        appliesTo: 'Namespace',
        // The IR records declarations, and a package is a namespace it recurses
        // *into* rather than an element it records — so two files each opening
        // `package Shared` are invisible here, which is the commonest form of
        // this collision. Closing it means recording package declarations in
        // the IR, which is an ingestion change, not a rule change.
        limitation: 'Sees root-level members other than packages; two files declaring the same top-level package are not caught.',
        check(model) {
            const seen = new Map<string, string>();
            const violations: ConstraintViolation[] = [];
            for (const declaration of declarations(model)) {
                const name = declaration.standardProperties.name;
                if (typeof name !== 'string' || !name || !isTopLevel(declaration.identity.id)) continue;
                // Across files, not within one: the global namespace is the
                // project's, so two files declaring the same root-level name
                // collide even though neither file collides with itself.
                const first = seen.get(name);
                if (first === undefined) {
                    seen.set(name, declaration.identity.id);
                    continue;
                }
                violations.push({
                    code: 'global-namespace-distinguishability',
                    message: `"${name}" is declared at the root of more than one file; the first is ${first}.`,
                    elementId: declaration.identity.id,
                    file: declaration.source.file,
                });
            }
            return violations;
        },
    },
    {
        code: 'control-node-owning-type',
        clause: 'SysML 7.12.4.4 — a ControlNode is owned by an ActionDefinition or ActionUsage',
        appliesTo: 'ControlNode',
        check(model) {
            const violations: ConstraintViolation[] = [];
            for (const element of Object.values(model.elements)) {
                // Classification comes from the notation module, which resolves
                // it against the generated metamodel — so this rule covers every
                // present and future ControlNode subtype without naming any.
                if (!isControlNode(element, model.registries)) continue;
                const owner = element.parentAction ? model.elements[element.parentAction] : undefined;
                if (owner && activityNodeType(owner, model.registries) !== undefined) continue;
                violations.push({
                    code: 'control-node-owning-type',
                    message: `Control node "${element.id}" is not owned by an action.`,
                    elementId: element.id,
                    file: element.file,
                });
            }
            return violations;
        },
    },
];

// ─── Codes deliberately not implemented here ────────────────────────────────

/**
 * The reasons, keyed by prefix rather than enumerated one by one.
 *
 * Most of the 151 fall into a handful of buckets, and a bucket with a reason is
 * more honest than 147 individual "not yet" entries that all mean the same
 * thing. `classifyConstraints` applies these to whatever is not implemented.
 */
export const UNIMPLEMENTED_REASONS: readonly { match: RegExp; reason: UnimplementedReason; detail: string }[] = [
    {
        match: /specialization|subsetting|redefinition|conjugation|-types?$|feature-typing|inherit/,
        reason: 'blocked',
        detail: 'Needs resolved types and inherited features — the B3 resolution core.',
    },
    {
        match: /import|namespace|qualified|resolve|visibility/,
        reason: 'blocked',
        detail: 'Needs name resolution across a workspace index — B5.',
    },
    {
        match: /expression|evaluat|operator|literal|argument|parameter/,
        reason: 'blocked',
        detail: 'Needs model-level expression evaluation — B3, and `Expression::evaluate` is unsized.',
    },
    {
        match: /.*/,
        reason: 'not-yet',
        detail: 'Implementable on the current model; not written yet.',
    },
];

export interface ConstraintScore {
    sysideVersion: string;
    total: number;
    implemented: SysmlConstraint[];
    unimplemented: UnimplementedConstraint[];
    /** Implemented codes Syside does not publish — a code MEMO invented. */
    unpublished: string[];
    byReason: Record<UnimplementedReason, number>;
}

/** Score the implemented set against the published checklist. */
export function classifyConstraints(
    implemented: readonly SysmlConstraint[] = IMPLEMENTED_CONSTRAINTS,
    published: readonly SysideRule[] = SYSIDE_RULES,
): ConstraintScore {
    const done = new Map(implemented.map(constraint => [constraint.code, constraint]));
    const publishedCodes = new Set(published.map(rule => rule.code));
    const unimplemented: UnimplementedConstraint[] = [];
    const byReason: Record<UnimplementedReason, number> = { blocked: 0, 'out-of-scope': 0, 'not-yet': 0 };

    for (const rule of published) {
        if (done.has(rule.code)) continue;
        const bucket = UNIMPLEMENTED_REASONS.find(candidate => candidate.match.test(rule.code))!;
        unimplemented.push({ code: rule.code, reason: bucket.reason, detail: bucket.detail });
        byReason[bucket.reason] += 1;
    }

    return {
        sysideVersion: SYSIDE_VERSION,
        total: published.length,
        implemented: [...done.values()].filter(constraint => publishedCodes.has(constraint.code)),
        unimplemented,
        unpublished: [...done.keys()].filter(code => !publishedCodes.has(code)).sort(),
        byReason,
    };
}

/** Evaluate every implemented constraint against one model. */
export function checkSysmlConstraints(
    model: MemoModelDTO,
    constraints: readonly SysmlConstraint[] = IMPLEMENTED_CONSTRAINTS,
): ConstraintViolation[] {
    return constraints.flatMap(constraint => constraint.check(model));
}
