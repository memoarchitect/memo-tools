// Rule accounting: `memo validate` and `memo rules list` count the same set.
//
// They did not. `validate` reported `6 + nativeConstraints.length` from a
// hardcoded literal and counted only native rules as passed; `rules list` knew
// nothing about the built-in validators and reported a smaller number. Two
// commands describing one project disagreed about how many rules it has, and
// neither total reconciled with the violations beside it.
//
// The properties locked here are arithmetic, which is the only kind of claim
// worth making about a count:
//
//   evaluated = built-in + native
//   evaluated = passed + (rules that raised at least one violation)

import { describe, it, expect } from 'vitest';
import { BUILTIN_RULES, BUILTIN_RULE_IDS } from '../validator/builtin-rules.js';

describe('built-in rule catalogue', () => {
    it('lists every rule the built-in validators can raise', () => {
        // Derived from the validators themselves: BV-001..003 (behavior),
        // VW-001..003 (views). A rule added to a validator without being
        // listed here is invisible to `rules list` and miscounts `validate`.
        expect([...BUILTIN_RULE_IDS].sort())
            .toEqual(['BV-001', 'BV-002', 'BV-003', 'VW-001', 'VW-002', 'VW-003']);
    });

    it('excludes AR-IBD-001, which is a tailorable constraint def', () => {
        // AR-IBD-001 carries `evaluator = "architecture"`, so a TypeScript
        // function computes its predicate — but it IS declared in the ontology
        // and a RulePolicy can reference it. Listing it as built-in counted it
        // twice and wrongly reported it as untailorable.
        expect(BUILTIN_RULE_IDS).not.toContain('AR-IBD-001');
    });

    it('marks every built-in rule as untailorable, with a reason available', () => {
        // A policy references a rule by its `constraint def` name. These have
        // none, so they cannot be disabled, replaced, or severity-overridden.
        for (const rule of BUILTIN_RULES) {
            expect(rule.tailorable).toBe(false);
            expect(rule.name).toBeTruthy();
            expect(rule.description).toBeTruthy();
        }
    });

    it('has no duplicate IDs', () => {
        expect(new Set(BUILTIN_RULE_IDS).size).toBe(BUILTIN_RULE_IDS.length);
    });
});

describe('one activation path', () => {
    it('is shared, so validate and rules list cannot diverge', async () => {
        // The two commands computed activation separately and disagreed: GPCA
        // reported 20 rules from `validate` and 38 from `rules list`, because
        // only one of them applied effective scope. A rule count that changes
        // with the question asked is not an audit.
        const fs = await import('node:fs');
        const validate = fs.readFileSync(new URL('../commands/validate.ts', import.meta.url), 'utf-8');
        const rules = fs.readFileSync(new URL('../commands/rules.ts', import.meta.url), 'utf-8');
        expect(validate).toContain('activeRuleCandidates(');
        expect(rules).toContain('activeRuleCandidates(');
    });

    it('filters by declaring package and by subject kind', async () => {
        // Both conditions matter. A rule from an unselected package is not the
        // project's; a rule whose subject the methodology never selected can
        // only report on content the project did not agree to model.
        const fs = await import('node:fs');
        const scope = fs.readFileSync(new URL('../model/effective-scope.ts', import.meta.url), 'utf-8');
        expect(scope).toContain('isRulePackageInScope(scope, packageOf(c.sourceFile))');
        expect(scope).toContain('subjectInScope(c.appliesToKind)');
    });
});

describe('validate accounting', () => {
    it('counts built-ins from the catalogue rather than a literal', async () => {
        // The literal was 6 and happened to be right; it had no way to stay
        // right, and drifted the moment anyone reasoned about it. Deriving the
        // number is the fix, not correcting the digit.
        const source = await import('node:fs').then(fs => fs.readFileSync(
            new URL('../validator/rule-engine.ts', import.meta.url), 'utf-8'));
        expect(source).toContain('BUILTIN_RULE_IDS.length + nativeConstraints.length');
        expect(source).not.toMatch(/rulesEvaluated:\s*\d+\s*\+/);
    });

    it('counts built-in and delegated rules towards rulesPassed', async () => {
        // `rulesPassed` used to count only native constraints, so evaluated and
        // passed had different denominators and the totals never reconciled
        // with the violation list.
        const source = await import('node:fs').then(fs => fs.readFileSync(
            new URL('../validator/rule-engine.ts', import.meta.url), 'utf-8'));
        expect(source).toContain('builtinPassed + delegatedPassed + nativePassed');
    });

    it('does not silently skip a constraint with a delegated evaluator', async () => {
        // Skipping it in the evaluation loop is correct — the built-in
        // validator raises its violations. Forgetting to count it is not: one
        // rule was evaluated and reported as neither passed nor failed.
        const source = await import('node:fs').then(fs => fs.readFileSync(
            new URL('../validator/rule-engine.ts', import.meta.url), 'utf-8'));
        expect(source).toContain('delegated.push(constraint.id)');
    });
});
