// ─── Which rules enforce which clauses ───────────────────────────────────────
//
// A rule names the clauses it enforces (`ref enforces`), and the compiler has
// checked that each exists. This reads the clauses a model carries from the
// stage 1 handoff and answers the two questions an assurance reader asks:
// what does this rule enforce, and what enforces this clause
// (plans/memo-rules-domain-trace-and-editor.md).
//
// The coverage is a REPORT. A clause with no rule is the normal state of a
// library that carries more clauses than MEMO has rules; it is not a defect.
// ─────────────────────────────────────────────────────────────────────────────

import type { ApiModel } from '../stage2/api-model.js';
import { apiDefinitionFacts } from '../stage2/build-from-api.js';
import type { EffectiveRule } from '../model/methodology-resolver.js';

/** One clause of a standard or guidance, as the model carries it. */
export interface ClauseFact {
    qualifiedName: string;
    /** The standard's designation (`IEC 62304:2006+AMD1:2015`). */
    standard: string;
    clauseNumber: string;
    /** A MEMO-authored scope phrase, not the standard's wording. */
    title?: string;
}

/** The clauses the model declares, with the standard each belongs to. */
export function readClauseFacts(api: ApiModel): ClauseFact[] {
    const typedBy = (id: string, suffix: string): boolean =>
        api.types(id).some(type => api.qualifiedName(type['@id'])?.endsWith(`::${suffix}`));
    const standardOf = (id: string): string | undefined => {
        for (let owner = api.owner(id); owner; owner = api.owner(owner['@id'])) {
            if (owner['@type'] === 'PartUsage' && typedBy(owner['@id'], 'RegulatoryStandard')) {
                return apiDefinitionFacts(api, owner).attributes['designation'];
            }
        }
        return undefined;
    };
    const facts: ClauseFact[] = [];
    for (const usage of api.ofType('PartUsage')) {
        if (!typedBy(usage['@id'], 'StandardClause')) continue;
        const qualifiedName = api.qualifiedName(usage['@id']);
        if (!qualifiedName) continue;
        const attributes = apiDefinitionFacts(api, usage).attributes;
        const standard = standardOf(usage['@id']);
        if (!standard || !attributes['clauseNumber']) continue;
        facts.push({
            qualifiedName, standard, clauseNumber: attributes['clauseNumber'],
            ...(attributes['title'] ? { title: attributes['title'] } : {}),
        });
    }
    return facts;
}

/** `IEC 62304:2006+AMD1:2015 §5.2`, or the qualified name when the clause is unknown. */
export function clauseLabel(facts: readonly ClauseFact[], qualifiedName: string): string {
    const fact = facts.find(f => f.qualifiedName === qualifiedName);
    return fact ? `${fact.standard} §${fact.clauseNumber}` : qualifiedName;
}

export interface RuleClauseCoverage {
    standards: { designation: string; clauses: number; enforced: number }[];
    /** Every clause some enabled rule enforces, with the rules that do. */
    enforcedClauses: (ClauseFact & { rules: string[] })[];
    /** Medical-device rules that enforce no clause: traced to nothing yet. */
    untracedMedicalRules: { id: string; typeName: string }[];
    /** A rule that enforces a clause the model does not carry, which should not happen. */
    unknownClauses: { ruleId: string; clause: string }[];
    byDomain: Record<string, number>;
}

/**
 * Coverage of the clauses by the rules. Only a rule that is enabled counts as
 * enforcing: one a user disabled or replaced no longer checks anything.
 */
export function computeRuleClauseCoverage(
    clauses: readonly ClauseFact[],
    rules: readonly Pick<EffectiveRule, 'sourceRuleId' | 'sourceRuleType' | 'disposition' | 'domain' | 'enforces'>[],
): RuleClauseCoverage {
    const byClause = new Map<string, string[]>();
    const known = new Set(clauses.map(c => c.qualifiedName));
    const unknownClauses: RuleClauseCoverage['unknownClauses'] = [];
    const byDomain: Record<string, number> = {};
    const untracedMedicalRules: RuleClauseCoverage['untracedMedicalRules'] = [];

    for (const rule of rules) {
        byDomain[rule.domain ?? 'unstated'] = (byDomain[rule.domain ?? 'unstated'] ?? 0) + 1;
        const enforced = rule.enforces ?? [];
        if (rule.domain === 'medicalDevice' && enforced.length === 0) {
            untracedMedicalRules.push({ id: rule.sourceRuleId, typeName: rule.sourceRuleType });
        }
        for (const clause of enforced) {
            if (!known.has(clause)) {
                unknownClauses.push({ ruleId: rule.sourceRuleId, clause });
                continue;
            }
            if (rule.disposition !== 'enabled') continue;
            byClause.set(clause, [...(byClause.get(clause) ?? []), rule.sourceRuleId]);
        }
    }

    const enforcedClauses = clauses
        .filter(c => byClause.has(c.qualifiedName))
        .map(c => ({ ...c, rules: [...new Set(byClause.get(c.qualifiedName))].sort() }));
    const standards = [...new Set(clauses.map(c => c.standard))].sort().map(designation => ({
        designation,
        clauses: clauses.filter(c => c.standard === designation).length,
        enforced: enforcedClauses.filter(c => c.standard === designation).length,
    }));
    return { standards, enforcedClauses, untracedMedicalRules, unknownClauses, byDomain };
}
