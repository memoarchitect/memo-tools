import { describe, it, expect, beforeAll } from 'vitest';
import { resolve, join } from 'node:path';
import { readdirSync } from 'node:fs';
import { RelationshipRegistry, pascalToCamelCase } from '../model/relationship-registry.js';
import { parseFiles } from '../model/parser-utils.js';

function getSysmlFiles(dir: string): string[] {
    const files: string[] = [];
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (entry.isDirectory()) {
            files.push(...getSysmlFiles(join(dir, entry.name)));
        } else if (entry.name.endsWith('.sysml') && entry.name !== 'index.sysml') {
            files.push(join(dir, entry.name));
        }
    }
    return files;
}

// ─── PascalCase → camelCase Tests ───────────────────────────────────────────

describe('pascalToCamelCase', () => {
    it('converts PascalCase to camelCase', () => {
        expect(pascalToCamelCase('Mitigates')).toBe('mitigates');
        expect(pascalToCamelCase('TraceTo')).toBe('traceTo');
        expect(pascalToCamelCase('HasSubProcedure')).toBe('hasSubProcedure');
        expect(pascalToCamelCase('Aggregation')).toBe('aggregation');
    });

    it('handles single character', () => {
        expect(pascalToCamelCase('A')).toBe('a');
    });

    it('handles empty string', () => {
        expect(pascalToCamelCase('')).toBe('');
    });

    it('handles already camelCase', () => {
        expect(pascalToCamelCase('mitigates')).toBe('mitigates');
    });
});

// ─── RelationshipRegistry Unit Tests ────────────────────────────────────────

describe('RelationshipRegistry', () => {
    it('registers and retrieves relationship types', () => {
        const registry = new RelationshipRegistry();
        registry.register({
            sysmlName: 'Mitigates',
            name: 'mitigates',
            label: 'Mitigates',
            layer: 'crosscutting',
            ends: [
                { name: 'mitigation', type: 'Mitigation' },
                { name: 'risk', type: 'Risk' },
            ],
        });

        expect(registry.has('mitigates')).toBe(true);
        expect(registry.size).toBe(1);

        const rel = registry.getRelType('mitigates');
        expect(rel).toBeDefined();
        expect(rel!.sysmlName).toBe('Mitigates');
        expect(rel!.layer).toBe('crosscutting');
        expect(rel!.ends).toHaveLength(2);
    });

    it('returns undefined for unknown relationship types', () => {
        const registry = new RelationshipRegistry();
        expect(registry.getRelType('nonExistent')).toBeUndefined();
        expect(registry.has('nonExistent')).toBe(false);
    });

    it('converts to RelationshipType for backward compat', () => {
        const registry = new RelationshipRegistry();
        registry.register({
            sysmlName: 'Mitigates',
            name: 'mitigates',
            label: 'Mitigates',
            layer: 'crosscutting',
            ends: [],
        });

        const relType = registry.toRelationshipType('mitigates');
        expect(relType).toEqual({
            name: 'mitigates',
            label: 'Mitigates',
            layer: 'crosscutting',
            color: '',
        });
    });

    it('converts to relationship types array', () => {
        const registry = new RelationshipRegistry();
        registry.register({ sysmlName: 'A', name: 'a', label: 'A', layer: 'l1', ends: [] });
        registry.register({ sysmlName: 'B', name: 'b', label: 'B', layer: 'l2', ends: [] });

        const arr = registry.toRelationshipTypesArray();
        expect(arr).toHaveLength(2);
        expect(arr[0].name).toBe('a');
        expect(arr[1].name).toBe('b');
    });

    it('lists relationship type names', () => {
        const registry = new RelationshipRegistry();
        registry.register({ sysmlName: 'X', name: 'x', label: 'X', layer: 'l', ends: [] });
        registry.register({ sysmlName: 'Y', name: 'y', label: 'Y', layer: 'l', ends: [] });

        expect(registry.relTypeNames()).toContain('x');
        expect(registry.relTypeNames()).toContain('y');
    });
});
