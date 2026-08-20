// ─── Built-in rules ───────────────────────────────────────────────────────────
//
// The rules implemented in TypeScript rather than declared as `constraint def`.
//
// They exist because their predicates are not expressible in the KerML subset
// the constraint grammar accepts — which is the section 4.1 Option P boundary,
// not a shortcut. What they are NOT is invisible: a rule that evaluates against
// a user's model and can raise a violation has to be nameable, countable, and
// reportable next to every other rule.
//
// This list is the single source of that truth. `rulesEvaluated` was
// `6 + nativeConstraints.length` — a literal with no way to stay correct — and
// `memo rules list` did not know these rules existed at all, so the two
// commands reported different totals for the same project.
//
// Built-in rules are NOT tailorable. A `RulePolicy` references a rule by its
// `constraint def` name and these have none, so they cannot be disabled,
// replaced, or severity-overridden by a methodology. That is a real limitation,
// reported rather than hidden: see `tailorable: false` below.
//
// AR-IBD-001 is deliberately NOT here. It is declared as a `constraint def` in
// the ontology and carries `evaluator = "architecture"`, so a TypeScript
// function computes its predicate while the rule itself remains a first-class,
// tailorable member of the native set. "Evaluated by a built-in function" and
// "has no declaration to tailor" are different properties, and only the second
// puts a rule on this list. Conflating them double-counted it.
// ─────────────────────────────────────────────────────────────────────────────

import type { RuleSeverity } from '../model/methodology-resolver.js';

export interface BuiltinRule {
    id: string;
    /** What the rule is called, for parity with a `constraint def` name. */
    name: string;
    description: string;
    severity: RuleSeverity;
    /** Which built-in validator implements it. */
    validator: 'behavior' | 'architecture' | 'views';
    /** Always false: a policy cannot reference a rule that has no def name. */
    tailorable: false;
}

export const BUILTIN_RULES: readonly BuiltinRule[] = [
    // BV-001 (an action is allocated) and BV-002 (an action is sequenced) were
    // here and are not rules a validator should be inventing: both are
    // methodology claims, and the ontology declares those — CR-MED-022 and
    // CR-ONT-074 for the allocation, CR-MED-023 for the connection. Declared
    // there they carry a subject set, a rationale, and the tailorability this
    // list exists to admit these rules lack.
    {
        id: 'BV-003', name: 'FlowPayloadMatchesParametersRule', validator: 'behavior', severity: 'error',
        tailorable: false,
        // What it actually checks. The old description said it verified that a
        // flow references an action that exists, which is neither what the code
        // does nor something that can fail: an unresolvable end never becomes a
        // relationship in the first place.
        description: 'A flow\u2019s payload matches an output parameter at its source and an input parameter at its target.',
    },
    {
        id: 'VW-001', name: 'ViewExposesContentRule', validator: 'views', severity: 'warning',
        tailorable: false,
        description: 'A view exposes at least one model element.',
    },
    {
        id: 'VW-002', name: 'ViewRenderableRule', validator: 'views', severity: 'warning',
        tailorable: false,
        description: 'A view declares enough presentation metadata to render.',
    },
    {
        id: 'VW-003', name: 'ViewConformsToViewpointRule', validator: 'views', severity: 'error',
        tailorable: false,
        description: 'A view conforms to at least one viewpoint through viewpointDefinition.',
    },
];

/** Rule IDs the built-in validators can raise. */
export const BUILTIN_RULE_IDS: readonly string[] = BUILTIN_RULES.map(rule => rule.id);
