import { describe, it, expect } from 'vitest';
import { existsSync } from 'node:fs';
import { findMemoManifests, resolveManifestPath } from '../model/manifest.js';

function loadManifest() {
    const loaded = findMemoManifests(__dirname).find(candidate => candidate.manifest.templates);
    expect(loaded).toBeDefined();
    return loaded!;
}

describe('ontology template manifest', () => {
    const loaded = loadManifest();

    it('declares the available project templates', () => {
        expect(Object.keys(loaded.manifest.templates)).toEqual([
            'default',
            'samd',
            'connected-device',
            'monitoring-device',
            'infusion-pump',
        ]);
    });

    it('points every template at a complete project', () => {
        for (const path of Object.values(loaded.manifest.templates)) {
            const root = resolveManifestPath(loaded, path);
            expect(existsSync(`${root}/memo.package.yaml`)).toBe(true);
            expect(existsSync(`${root}/src/architecture/system.sysml`)).toBe(true);
            expect(existsSync(`${root}/src/assurance/requirements.sysml`)).toBe(true);
            expect(existsSync(`${root}/src/artifacts/artifacts.sysml`)).toBe(true);
        }
    });

    it('uses an available template as the default', () => {
        expect(loaded.manifest.init.defaultTemplate).toBe('default');
    });
});
