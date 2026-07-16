import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { parse as parseYaml } from 'yaml';
import { findMemoManifests, resolveManifestPath } from '../model/manifest.js';

interface Archetype {
    id: string;
    category: string;
    includedLayers: string[];
    includedStandards: string[];
}

function loadArchetypes(): Archetype[] {
    const loaded = findMemoManifests(__dirname).find(candidate => candidate.manifest.init.archetypes);
    expect(loaded).toBeDefined();
    const path = resolveManifestPath(loaded!, loaded!.manifest.init.archetypes);
    const parsed = parseYaml(readFileSync(path, 'utf-8')) as { archetypes: Archetype[] };
    return parsed.archetypes;
}

describe('manifest archetype catalog', () => {
    const archetypes = loadArchetypes();

    it('discovers all expected archetypes', () => {
        const names = archetypes.map(a => a.id);
        expect(names).toContain('samd');
        expect(names).toContain('connected');
        expect(names).toContain('monitoring');
        expect(names).toContain('infusion_pump');
        expect(names).toContain('blank');
        expect(names).toHaveLength(5);
    });

    it('device-class archetypes have category="device-class"', () => {
        expect(archetypes.every(a => a.category === 'device-class')).toBe(true);
    });

    it('samd archetype has correct standards', () => {
        const samd = archetypes.find(a => a.id === 'samd')!;
        expect(samd.includedStandards).toContain('ISO 14971');
        expect(samd.includedStandards).toContain('IEC 62304');
        expect(samd.includedStandards).toContain('IEC 82304-1');
    });

    it('infusion_pump archetype includes behavior layer', () => {
        const pump = archetypes.find(a => a.id === 'infusion_pump')!;
        expect(pump.includedLayers).toContain('behavior');
        expect(pump.includedLayers).toContain('arch_risk');
    });

    it('blank archetype has empty layers', () => {
        const blank = archetypes.find(a => a.id === 'blank')!;
        expect(blank.includedLayers).toEqual([]);
    });
});
