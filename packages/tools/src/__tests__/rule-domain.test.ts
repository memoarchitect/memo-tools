// ─── A rule's domain and the clauses it enforces ─────────────────────────────
//
// The loader reads `domain` (an enumeration literal, `Kind::member` or the bare
// member) and `enforces` (the references the compiler resolved) off a rule, and
// the effective rule set carries both (plans/memo-rules-domain-trace-and-editor.md).
// ─────────────────────────────────────────────────────────────────────────────

import { describe, expect, it } from 'vitest';
import { resolveEffectiveRules, ruleCandidatesFromConstraints } from '../model/methodology-resolver.js';
import { compileRuleDefinition, mapDomain } from '../validator/constraint-loader.js';

describe('mapDomain', () => {
    it('reads the bare member and the qualified literal alike', () => {
        expect(mapDomain('medicalDevice')).toBe('medicalDevice');
        expect(mapDomain('RuleDomainKind::medicalDevice')).toBe('medicalDevice');
        expect(mapDomain('modelling')).toBe('modelling');
        expect(mapDomain('organisation')).toBe('organisation');
    });
    it('is undefined for anything else', () => {
        expect(mapDomain(undefined)).toBeUndefined();
        expect(mapDomain('')).toBeUndefined();
        expect(mapDomain('RuleDomainKind::elsewhere')).toBeUndefined();
    });
});

describe('a compiled rule', () => {
    const parts = (extra: Record<string, string> = {}, enforces?: string[]) => ({
        typeName: 'HazardMitigationRule',
        attrs: {
            providedId: 'CR-MED-001', appliesTo: 'Hazard', severity: 'error', tailoring: 'assurance',
            predicateExpression: 'mitigates->size() >= 1', ...extra,
        },
        body: { kind: 'bool' as const, value: true },
        enforces,
    });

    it('carries its domain and the clauses it enforces', () => {
        const rule = compileRuleDefinition(parts({ domain: 'medicalDevice' }, ['pkg::iso14971::clause7']))!;
        expect(rule.domain).toBe('medicalDevice');
        expect(rule.enforces).toEqual(['pkg::iso14971::clause7']);
    });
    it('states neither when the rule does not', () => {
        const rule = compileRuleDefinition(parts())!;
        expect(rule.domain).toBeUndefined();
        expect(rule.enforces).toBeUndefined();
    });
    it('passes both on to the effective rule set', () => {
        const rule = compileRuleDefinition(parts({ domain: 'medicalDevice' }, ['pkg::iso14971::clause7']))!;
        const { rules } = resolveEffectiveRules(ruleCandidatesFromConstraints([rule]), []);
        expect(rules[0].domain).toBe('medicalDevice');
        expect(rules[0].enforces).toEqual(['pkg::iso14971::clause7']);
    });
});
