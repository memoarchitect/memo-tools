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

    it('rejects path traversal and unrelated paths', () => {
        expect(resolveProjectAssetRequest(project, '/model/model.sysml')).toBeUndefined();
        expect(resolveProjectAssetRequest(project, '/model/assets/../secret.sysml')).toBeUndefined();
        expect(resolveProjectAssetRequest(project, '/model/assets/%2e%2e/secret.sysml')).toBeUndefined();
    });
});

describe('client source watcher ownership', () => {
    it('leaves model and sidecar updates to MEMO WebSocket reconciliation', () => {
        expect(isModelOwnedWatchPath('/project/model/catalog/system.sysml')).toBe(true);
        expect(isModelOwnedWatchPath('/project/model/assets/screen/capture.png')).toBe(true);
        expect(isModelOwnedWatchPath('/project/.memo/user-diagrams.json')).toBe(true);
        expect(isModelOwnedWatchPath('/project/memo.config.yaml')).toBe(true);
    });

    it('continues watching actual client source files', () => {
        expect(isModelOwnedWatchPath('/architect/packages/web/src/App.tsx')).toBe(false);
        expect(isModelOwnedWatchPath('/architect/packages/web/src/style.css')).toBe(false);
    });
});
