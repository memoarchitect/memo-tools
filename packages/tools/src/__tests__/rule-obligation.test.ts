import { describe, expect, it } from 'vitest';
import { compileRuleDefinition, mapObligation } from '../validator/constraint-loader.js';
import { renderRule } from '../server/rule-writer.js';

const parts = (attrs: Record<string, string>) => ({
    typeName: 'SomeRule',
    attrs: { providedId: 'X-1', appliesTo: 'Hazard', ...attrs },
    body: { kind: 'bool', value: true } as never,
});

describe('rule obligation', () => {
    it('reads the bare member or the qualified literal', () => {
        expect(mapObligation('required')).toBe('required');
        expect(mapObligation('RuleObligationKind::bestPractice')).toBe('bestPractice');
        expect(mapObligation('mandatory')).toBeUndefined();
        expect(mapObligation(undefined)).toBeUndefined();
    });

    it('takes a severity from the obligation when the rule states none', () => {
        expect(compileRuleDefinition(parts({ obligation: 'required' }))?.severity).toBe('error');
        expect(compileRuleDefinition(parts({ obligation: 'recommended' }))?.severity).toBe('warning');
        expect(compileRuleDefinition(parts({ obligation: 'bestPractice' }))?.severity).toBe('info');
    });

    it('keeps a severity the rule states, and warns when it states neither', () => {
        expect(compileRuleDefinition(parts({ obligation: 'required', severity: 'info' }))?.severity).toBe('info');
        expect(compileRuleDefinition(parts({}))?.severity).toBe('warning');
    });

    it('writes the obligation of a new rule', () => {
        const { text } = renderRule({
            id: 'ORG-1', typeName: 'R', appliesTo: 'Hazard', predicateExpression: 'true', severity: 'error',
            rationaleText: 'why', file: 'a.sysml', obligation: 'required',
        });
        expect(text).toContain('attribute obligation = RuleObligationKind::required;');
    });
});
