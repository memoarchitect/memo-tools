import { describe, expect, it } from 'vitest';
import { resolve } from 'node:path';
import { isModelOwnedWatchPath, resolveProjectAssetRequest } from '../server/dev-server';

describe('project screen-capture assets', () => {
    const project = resolve('/tmp', 'memo-project');

    it('resolves a project-relative capture beneath model/assets', () => {
        expect(resolveProjectAssetRequest(
            project,
            '/model/assets/mainScreenLayout/main-screen.png?cache=1',
        )).toBe(resolve(project, 'model/assets/mainScreenLayout/main-screen.png'));
    });

    // A project whose source lives in `src/` has no `model/` directory, and
    // keeps its captures in `assets/`. Those used to resolve to nothing, so
    // the UI Screens workspace drew its regions over a blank backdrop.
    it('resolves a capture beneath a src-layout project\'s assets', () => {
        expect(resolveProjectAssetRequest(
            project,
            '/assets/UI/login-screen.png?cache=1',
        )).toBe(resolve(project, 'assets/UI/login-screen.png'));
    });

    // The ui-screen-regions example keeps its captures with the rest of the
    // catalog. Only `model/assets` was served, so the capture 404ed and Detect
    // had no pixels to read.
    it('resolves a capture beneath the catalog layout\'s artifacts/assets', () => {
        expect(resolveProjectAssetRequest(
            project,
            '/model/catalog/artifacts/assets/screen-captures/mainScreenLayout/main-screen-2.4.1.png',
        )).toBe(resolve(project, 'model/catalog/artifacts/assets/screen-captures/mainScreenLayout/main-screen-2.4.1.png'));
        expect(resolveProjectAssetRequest(project, '/model/catalog/artifacts/assets/../reviews/notes.sysml')).toBeUndefined();
        expect(resolveProjectAssetRequest(project, '/model/catalog/system.sysml')).toBeUndefined();
    });

    it('rejects path traversal and unrelated paths', () => {
        expect(resolveProjectAssetRequest(project, '/model/model.sysml')).toBeUndefined();
        expect(resolveProjectAssetRequest(project, '/model/assets/../secret.sysml')).toBeUndefined();
        expect(resolveProjectAssetRequest(project, '/model/assets/%2e%2e/secret.sysml')).toBeUndefined();
        expect(resolveProjectAssetRequest(project, '/assets/../secret.sysml')).toBeUndefined();
        expect(resolveProjectAssetRequest(project, '/assets/%2e%2e/.env')).toBeUndefined();
        expect(resolveProjectAssetRequest(project, '/src/project.sysml')).toBeUndefined();
    });
});

describe('client source watcher ownership', () => {
    it('leaves model and sidecar updates to MEMO WebSocket reconciliation', () => {
        expect(isModelOwnedWatchPath('/project/model/catalog/system.sysml')).toBe(true);
        expect(isModelOwnedWatchPath('/project/model/assets/screen/capture.png')).toBe(true);
        expect(isModelOwnedWatchPath('/project/model/catalog/artifacts/assets/screen/capture.png')).toBe(true);
        expect(isModelOwnedWatchPath('/project/.memo/user-diagrams.json')).toBe(true);
        expect(isModelOwnedWatchPath('/project/memo.config.yaml')).toBe(true);
    });

    it('continues watching actual client source files', () => {
        expect(isModelOwnedWatchPath('/architect/packages/web/src/App.tsx')).toBe(false);
        expect(isModelOwnedWatchPath('/architect/packages/web/src/style.css')).toBe(false);
    });
});
