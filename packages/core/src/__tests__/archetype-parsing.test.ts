import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { VENDOR_ONTOLOGY_SRC_DIR } from '../model/paths.js';

const ARCHETYPES_FILE = join(__dirname, '../../../..', VENDOR_ONTOLOGY_SRC_DIR, 'methodology/memo_archetypes.sysml');

const PART_INSTANCE_RE = /^\s*part\s+(\w+)\s*:\s*(\w+)\s*\{([\s\S]*?)\n\s*\}/gm;
const ATTR_RE = /attribute\s+(\w+)\s*=\s*(?:"([^"]*)"|(\w+(?:::\w+)*)|(-?\d+(?:\.\d+)?)|(true|false))\s*;/g;

function parseArchetypes() {
    const content = readFileSync(ARCHETYPES_FILE, 'utf-8');
    const parts: { name: string; type: string; attrs: Record<string, string>; multi: Record<string, string[]> }[] = [];
    for (const m of content.matchAll(PART_INSTANCE_RE)) {
        if (m[1] === 'def') continue;
        const attrs: Record<string, string> = {};
        const multi: Record<string, string[]> = {};
        for (const a of m[3].matchAll(ATTR_RE)) {
            const key = a[1];
            const val = a[2] ?? a[3] ?? a[4] ?? a[5] ?? '';
            if (!multi[key]) multi[key] = [];
            multi[key].push(val);
            attrs[key] = val;
        }
        parts.push({ name: m[1], type: m[2], attrs, multi });
    }
    return parts;
}

describe('SysML archetype definitions', () => {
    const archetypes = parseArchetypes();

    it('discovers all expected archetypes', () => {
        const names = archetypes.map(a => a.name);
        expect(names).toContain('minimal');
        expect(names).toContain('standardArchetype');
        expect(names).toContain('full');
        expect(names).toContain('samd');
        expect(names).toContain('connected');
        expect(names).toContain('monitoring');
        expect(names).toContain('infusion_pump');
        expect(names).toContain('blank');
    });

    it('all archetypes have Archetype type', () => {
        for (const a of archetypes) {
            expect(a.type).toBe('Archetype');
        }
    });

    it('device-class archetypes have category="device-class"', () => {
        const devices = archetypes.filter(a => a.attrs.category === 'device-class');
        expect(devices.length).toBeGreaterThanOrEqual(5);
    });

    it('profile archetypes have category="profile"', () => {
        const profiles = archetypes.filter(a => a.attrs.category === 'profile');
        expect(profiles.length).toBe(3);
        const names = profiles.map(p => p.name);
        expect(names).toContain('minimal');
        expect(names).toContain('standardArchetype');
        expect(names).toContain('full');
    });

    it('samd archetype has correct standards', () => {
        const samd = archetypes.find(a => a.name === 'samd')!;
        expect(samd.multi.includedStandard).toContain('ISO 14971');
        expect(samd.multi.includedStandard).toContain('IEC 62304');
        expect(samd.multi.includedStandard).toContain('IEC 82304-1');
    });

    it('infusion_pump archetype includes behavior layer', () => {
        const pump = archetypes.find(a => a.name === 'infusion_pump')!;
        expect(pump.multi.includedLayer).toContain('behavior');
        expect(pump.multi.includedLayer).toContain('arch_risk');
    });

    it('blank archetype has empty layers', () => {
        const blank = archetypes.find(a => a.name === 'blank')!;
        expect(blank.multi.includedLayer).toEqual(['']);
    });
});
