import { afterEach, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createProjectWatcher, type FileWatcher } from '../server/file-watcher.js';

describe('project file watcher', () => {
    const tempDirs: string[] = [];
    const watchers: FileWatcher[] = [];

    afterEach(() => {
        for (const watcher of watchers.splice(0)) watcher.close();
        for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
    });

    it('detects nested SysML changes with Chokidar 4', async () => {
        const root = mkdtempSync(join(tmpdir(), 'memo-watcher-'));
        tempDirs.push(root);
        const viewsDir = join(root, 'model', 'views');
        mkdirSync(viewsDir, { recursive: true });
        const source = join(viewsDir, 'architecture.sysml');
        writeFileSync(source, 'package Example {}\n', 'utf8');

        let changed = false;
        const watcher = createProjectWatcher(root, () => { changed = true; }, 10, true);
        watchers.push(watcher);

        // Wait for Chokidar's initial scan before changing the file.
        await new Promise(resolve => setTimeout(resolve, 100));
        writeFileSync(source, 'package Example { /* changed */ }\n', 'utf8');

        await expect.poll(() => changed, { timeout: 2000, interval: 20 }).toBe(true);
    });
});
