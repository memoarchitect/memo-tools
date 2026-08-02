import { afterEach, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createOntologyWatcher, createProjectWatcher, type FileWatcher } from '../server/file-watcher.js';

describe('project file watcher', () => {
    const tempDirs: string[] = [];
    const watchers: FileWatcher[] = [];

    afterEach(() => {
        for (const watcher of watchers.splice(0)) watcher.close();
        for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
    });

    /** A temp project with the given project-relative SysML files. */
    function project(files: Record<string, string>): string {
        const root = mkdtempSync(join(tmpdir(), 'memo-watcher-'));
        tempDirs.push(root);
        for (const [relativePath, contents] of Object.entries(files)) {
            const absolute = join(root, relativePath);
            mkdirSync(join(absolute, '..'), { recursive: true });
            writeFileSync(absolute, contents, 'utf8');
        }
        return root;
    }

    it('detects nested SysML changes with Chokidar 4', async () => {
        const root = project({ 'model/views/architecture.sysml': 'package Example {}\n' });

        let changed = false;
        const watcher = createProjectWatcher(root, () => { changed = true; }, 10, true);
        watchers.push(watcher);

        // Wait for Chokidar's initial scan before changing the file.
        await new Promise(resolve => setTimeout(resolve, 100));
        writeFileSync(join(root, 'model/views/architecture.sysml'), 'package Example { /* changed */ }\n', 'utf8');

        await expect.poll(() => changed, { timeout: 2000, interval: 20 }).toBe(true);
    });

    it('watches SysML outside model/, which the build also ingests', async () => {
        const root = project({ 'views/catalog.sysml': 'package Catalog {}\n' });

        const seen: string[][] = [];
        watchers.push(createProjectWatcher(root, files => { seen.push(files); }, 10, true));

        await new Promise(resolve => setTimeout(resolve, 100));
        writeFileSync(join(root, 'views/catalog.sysml'), 'package Catalog { /* changed */ }\n', 'utf8');

        await expect.poll(() => seen.length, { timeout: 2000, interval: 20 }).toBeGreaterThan(0);
        expect(seen.flat()).toContain(join('views', 'catalog.sysml'));
    });

    it('reports the project-relative paths that changed', async () => {
        const root = project({ 'model/a.sysml': 'package A {}\n', 'model/b.sysml': 'package B {}\n' });

        const seen: string[][] = [];
        watchers.push(createProjectWatcher(root, files => { seen.push(files); }, 30, true));

        await new Promise(resolve => setTimeout(resolve, 100));
        writeFileSync(join(root, 'model/a.sysml'), 'package A { /* 1 */ }\n', 'utf8');
        writeFileSync(join(root, 'model/b.sysml'), 'package B { /* 1 */ }\n', 'utf8');

        // One rebuild for the burst, carrying both files.
        await expect.poll(() => seen.flat().length, { timeout: 2000, interval: 20 }).toBeGreaterThanOrEqual(2);
        expect(seen.flat()).toEqual(expect.arrayContaining([join('model', 'a.sysml'), join('model', 'b.sysml')]));
    });

    it('leaves installed ontology sources to the ontology watcher', async () => {
        const root = project({
            'model/a.sysml': 'package A {}\n',
            'memo_packages/ontology/sysml/kinds.sysml': 'package Kinds {}\n',
        });

        const seen: string[][] = [];
        watchers.push(createProjectWatcher(root, files => { seen.push(files); }, 10, true, {
            ontologyRoots: [join(root, 'memo_packages', 'ontology')],
        }));

        await new Promise(resolve => setTimeout(resolve, 100));
        writeFileSync(join(root, 'memo_packages/ontology/sysml/kinds.sysml'), 'package Kinds { /* changed */ }\n', 'utf8');
        await new Promise(resolve => setTimeout(resolve, 300));
        expect(seen.flat()).toEqual([]);

        // A project file in the same tree still rebuilds.
        writeFileSync(join(root, 'model/a.sysml'), 'package A { /* changed */ }\n', 'utf8');
        await expect.poll(() => seen.flat(), { timeout: 2000, interval: 20 })
            .toContain(join('model', 'a.sysml'));
    });

    it('watches a native package sysmlDir without assuming a sysml/ child', async () => {
        const root = project({
            'model/catalog/project.sysml': 'package Project {}\n',
            'reusable-src/kinds.sysml': 'package Kinds {}\n',
        });
        const sourceRoot = join(root, 'reusable-src');
        let changedFile = '';
        watchers.push(createOntologyWatcher(root, [sourceRoot], file => { changedFile = file; }, 10));

        await new Promise(resolve => setTimeout(resolve, 100));
        const file = join(sourceRoot, 'kinds.sysml');
        writeFileSync(file, 'package Kinds { /* changed */ }\n', 'utf8');

        await expect.poll(() => changedFile, { timeout: 2000, interval: 20 }).toBe(file);
    });

    it('ignores files the build does not read', async () => {
        const root = project({ 'model/a.sysml': 'package A {}\n', 'notes.md': '# notes\n' });

        const seen: string[][] = [];
        watchers.push(createProjectWatcher(root, files => { seen.push(files); }, 10, true));

        await new Promise(resolve => setTimeout(resolve, 100));
        writeFileSync(join(root, 'notes.md'), '# changed\n', 'utf8');
        await new Promise(resolve => setTimeout(resolve, 300));

        expect(seen.flat()).toEqual([]);
    });
});
