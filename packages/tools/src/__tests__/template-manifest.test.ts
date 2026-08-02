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
            // The native entrypoint is what makes the scaffold a project: it
            // carries the imports and the ProjectMethodBinding.
            expect(existsSync(`${root}/model/catalog/project.sysml`)).toBe(true);
            expect(existsSync(`${root}/model/catalog/architecture/system.sysml`)).toBe(true);
            expect(existsSync(`${root}/model/catalog/assurance/requirements.sysml`)).toBe(true);
            expect(existsSync(`${root}/model/catalog/artifacts/catalog.sysml`)).toBe(true);
        }
    });

    it('uses an available template as the default', () => {
        expect(loaded.manifest.init.defaultTemplate).toBe('default');
    });
});
