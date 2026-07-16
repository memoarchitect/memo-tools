import { describe, it, expect } from 'vitest';
import { RuleRegistry } from '../validator/rule-registry.js';

describe('RuleRegistry', () => {
    it('registers and retrieves rules', () => {
        const registry = new RuleRegistry();
        registry.register({
            id: 'CR-TEST-001',
            name: 'TestRule',
            description: 'A test rule',
            appliesTo: 'Hazard',
            predicate: 'requireRelationship',
            strength: 'required',
            severity: 'error',
            rationaleText: 'Testing',
            category: 'closure',
            attributes: {
                id: 'CR-TEST-001',
                relationshipType: 'mitigates',
                minCount: '1',
                maxCount: '',
                direction: 'any',
                relatedKinds: '',
            },
            file: 'test.sysml',
            superType: 'RelationshipConsistencyRule',
        });

        expect(registry.size).toBe(1);
        expect(registry.has('CR-TEST-001')).toBe(true);

        const entry = registry.getRule('CR-TEST-001');
        expect(entry).toBeDefined();
        expect(entry!.appliesTo).toBe('Hazard');
        expect(entry!.predicate).toBe('requireRelationship');
    });

    it('filters by category', () => {
        const registry = new RuleRegistry();
        registry.register({
            id: 'CR-CLOSURE-001', name: 'C1', description: '', appliesTo: 'X',
            predicate: 'requireAttribute', strength: 'required', severity: 'error',
            rationaleText: '', category: 'closure', attributes: { id: 'CR-CLOSURE-001', targetAttribute: 'a' },
            file: 'test.sysml',
        });
        registry.register({
            id: 'COV-001', name: 'C2', description: '', appliesTo: 'Y',
            predicate: 'coverageCheck', strength: 'required', severity: 'warning',
            rationaleText: '', category: 'coverage', attributes: { id: 'COV-001', standard: 'ISO 14971' },
            file: 'test.sysml',
        });

        expect(registry.byCategory('closure')).toHaveLength(1);
        expect(registry.byCategory('coverage')).toHaveLength(1);
        expect(registry.byStandard('ISO 14971')).toHaveLength(1);
    });
});
