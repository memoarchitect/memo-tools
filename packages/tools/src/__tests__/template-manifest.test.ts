import { describe, it, expect } from 'vitest';
import { existsSync } from 'node:fs';
import { findMemoManifests, resolveManifestPath } from '../model/manifest.js';

describe('ontology template manifest', () => {
    const loaded = findMemoManifests(__dirname).find(candidate => candidate.manifest.init?.template);

    it('names the one project skeleton, and it is a complete project', () => {
        expect(loaded).toBeDefined();
        const root = resolveManifestPath(loaded!, loaded!.manifest.init.template);
        expect(existsSync(`${root}/memo.package.yaml`)).toBe(true);
        // The native entrypoint is what makes the scaffold a project: it
        // carries the imports and the ProjectMethodBinding.
        expect(existsSync(`${root}/model/methodology/project.sysml`)).toBe(true);
        expect(existsSync(`${root}/model/catalog/architecture/system.sysml`)).toBe(true);
        expect(existsSync(`${root}/model/catalog/assurance/requirements.sysml`)).toBe(true);
        expect(existsSync(`${root}/model/catalog/artifacts/catalog.sysml`)).toBe(true);
    });
});
