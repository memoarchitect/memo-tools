import { describe, it, expect, beforeAll } from 'vitest';
import { resolve, join } from 'node:path';
import { readdirSync } from 'node:fs';
import { resolveLayerFromPath, resolveStandardFromPath } from '../model/layer-resolver.js';
import { KindRegistry } from '../model/kind-registry.js';
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

// ─── Layer Resolver Tests ────────────────────────────────────────────────────

describe('resolveLayerFromPath', () => {
    it('resolves layer from subdirectory name', () => {
        expect(resolveLayerFromPath('sysml/safety/risk-management.sysml')).toBe('safety');
        expect(resolveLayerFromPath('sysml/operational/operational.sysml')).toBe('operational');
        expect(resolveLayerFromPath('sysml/operational/purpose/business.sysml')).toBe('operational');
    });

    it('maps relationships/ to crosscutting', () => {
        expect(resolveLayerFromPath('sysml/relationships/relationships.sysml')).toBe('crosscutting');
    });

    it('handles full paths with /sysml/ segment', () => {
        expect(resolveLayerFromPath('/some/project/packages/ontology/sysml/software/software.sysml')).toBe('software');
    });

    it('returns unknown for files directly under sysml/', () => {
        expect(resolveLayerFromPath('sysml/index.sysml')).toBe('unknown');
    });

    it('returns unknown for paths without /sysml/', () => {
        expect(resolveLayerFromPath('src/model/builder.ts')).toBe('unknown');
    });

    it('handles Windows-style backslashes', () => {
        expect(resolveLayerFromPath('sysml\\safety\\hazard.sysml')).toBe('safety');
    });
});

// ─── Standard Resolver Tests ────────────────────────────────────────────────

describe('resolveStandardFromPath', () => {
    it('extracts standard from compliance subdirectory', () => {
        expect(resolveStandardFromPath('sysml/compliance/iso_14971/rmf.sysml')).toBe('iso_14971');
        expect(resolveStandardFromPath('sysml/compliance/iec_62304/slc.sysml')).toBe('iec_62304');
    });

    it('handles absolute paths', () => {
        expect(resolveStandardFromPath('/project/ontology/sysml/compliance/iso_14971/rmf.sysml')).toBe('iso_14971');
    });

    it('returns undefined for non-compliance layers', () => {
        expect(resolveStandardFromPath('sysml/safety/hazard.sysml')).toBeUndefined();
        expect(resolveStandardFromPath('sysml/software/sw.sysml')).toBeUndefined();
    });

    it('returns undefined for files directly under compliance/', () => {
        expect(resolveStandardFromPath('sysml/compliance/legacy.sysml')).toBeUndefined();
    });

    it('handles Windows backslashes', () => {
        expect(resolveStandardFromPath('sysml\\compliance\\iso_14971\\rmf.sysml')).toBe('iso_14971');
    });
});

// ─── KindRegistry Unit Tests ─────────────────────────────────────────────────

describe('KindRegistry', () => {
    it('registers and retrieves kinds', () => {
        const registry = new KindRegistry();
        registry.register({
            name: 'Hazard',
            label: 'Hazard',
            layer: 'safety',
            sysmlConstruct: 'part def',
        });

        expect(registry.has('Hazard')).toBe(true);
        expect(registry.size).toBe(1);

        const kind = registry.getKind('Hazard');
        expect(kind).toBeDefined();
        expect(kind!.layer).toBe('safety');
        expect(kind!.sysmlConstruct).toBe('part def');
    });

    it('returns undefined for unknown kinds', () => {
        const registry = new KindRegistry();
        expect(registry.getKind('NonExistent')).toBeUndefined();
        expect(registry.has('NonExistent')).toBe(false);
    });

    it('converts to KindDefinition for backward compat', () => {
        const registry = new KindRegistry();
        registry.register({
            name: 'Hazard',
            label: 'Hazard',
            layer: 'safety',
            sysmlConstruct: 'part def',
        });

        const kindDef = registry.toKindDefinition('Hazard');
        expect(kindDef).toEqual({
            label: 'Hazard',
            layer: 'safety',
            sysmlConstruct: 'part def',
        });
    });

    it('converts to kinds record', () => {
        const registry = new KindRegistry();
        registry.register({ name: 'A', label: 'A', layer: 'l1', sysmlConstruct: 'part def' });
        registry.register({ name: 'B', label: 'B', layer: 'l2', sysmlConstruct: 'requirement def' });

        const record = registry.toKindsRecord();
        expect(Object.keys(record)).toHaveLength(2);
        expect(record.A.layer).toBe('l1');
        expect(record.B.sysmlConstruct).toBe('requirement def');
    });

    it('lists kind names', () => {
        const registry = new KindRegistry();
        registry.register({ name: 'X', label: 'X', layer: 'l', sysmlConstruct: 'part def' });
        registry.register({ name: 'Y', label: 'Y', layer: 'l', sysmlConstruct: 'part def' });

        expect(registry.kindNames()).toContain('X');
        expect(registry.kindNames()).toContain('Y');
    });

    it('groups compliance kinds by standard', () => {
        const registry = new KindRegistry();
        registry.register({ name: 'RiskManagementFile', label: 'RiskManagementFile', layer: 'compliance', sysmlConstruct: 'part def', standard: 'iso_14971' });
        registry.register({ name: 'SoftwareLifecyclePlan', label: 'SoftwareLifecyclePlan', layer: 'compliance', sysmlConstruct: 'part def', standard: 'iec_62304' });
        registry.register({ name: 'Hazard', label: 'Hazard', layer: 'safety', sysmlConstruct: 'part def' });

        const groups = registry.getComplianceGroups();
        expect(groups).toHaveLength(2);
        expect(groups[0].standard).toBe('iec_62304');
        expect(groups[0].kinds).toHaveLength(1);
        expect(groups[1].standard).toBe('iso_14971');
        expect(groups[1].kinds).toHaveLength(1);
    });

    it('returns empty array when no compliance kinds exist', () => {
        const registry = new KindRegistry();
        registry.register({ name: 'Hazard', label: 'Hazard', layer: 'safety', sysmlConstruct: 'part def' });
        expect(registry.getComplianceGroups()).toHaveLength(0);
    });
});
