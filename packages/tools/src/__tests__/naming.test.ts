import { describe, expect, it } from 'vitest';
import {
    matchesRelationshipType,
    toDefinitionName,
    toModelType,
    toModelTypeSet,
} from '../model/naming.js';

describe('source-name → model-type normalization', () => {
    it('decapitalizes a MEMO definition name to its model key', () => {
        expect(toModelType('Composes')).toBe('composes');
        expect(toModelType('DerivesFrom')).toBe('derivesFrom');
        expect(toModelType('Mitigates')).toBe('mitigates');
    });

    // A native keyword is already the model key. This is why the three
    // incompatible open-coded rules never surfaced: `flow` and `bind` are
    // fixpoints of all of them.
    it('leaves a native SysML keyword alone', () => {
        expect(toModelType('flow')).toBe('flow');
        expect(toModelType('bind')).toBe('bind');
        expect(toModelType('succession')).toBe('succession');
    });

    // Full .toLowerCase() was one of the rules in use. It collapses the interior
    // capitals a lowerCamelCase model key depends on, so `derivesFrom` would
    // stop matching the model and the filter would silently select nothing.
    it('changes only the first character', () => {
        expect(toModelType('DecisionRecordedInADR')).toBe('decisionRecordedInADR');
        expect(toModelType('TracesToDocument')).toBe('tracesToDocument');
        expect(toModelType('DerivesFrom')).not.toBe('derivesfrom');
    });

    it('survives empty input', () => {
        expect(toModelType('')).toBe('');
        expect(toDefinitionName('')).toBe('');
    });

    it('round-trips a MEMO definition name', () => {
        expect(toDefinitionName(toModelType('Composes'))).toBe('Composes');
    });

    it('matches a declared kind against a model type regardless of spelling', () => {
        expect(matchesRelationshipType('Composes', 'composes')).toBe(true);
        expect(matchesRelationshipType('composes', 'composes')).toBe(true);
        expect(matchesRelationshipType('flow', 'flow')).toBe(true);
        expect(matchesRelationshipType('Composes', 'derivesFrom')).toBe(false);
    });

    it('normalizes a whole selection list', () => {
        const set = toModelTypeSet(['Composes', 'flow', 'bind']);
        expect(set.has('composes')).toBe(true);
        expect(set.has('flow')).toBe(true);
        expect(set.has('bind')).toBe(true);
        expect(set.has('Composes')).toBe(false);
    });
});
