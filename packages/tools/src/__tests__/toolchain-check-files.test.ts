import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { filesToCheck } from '../commands/toolchain';
import { canonicalPath } from '../model/native-project';

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

function tree(files: Record<string, string>): string {
    const root = canonicalPath(mkdtempSync(join(tmpdir(), 'memo-check-files-')));
    roots.push(root);
    for (const [path, text] of Object.entries(files)) {
        mkdirSync(join(root, path, '..'), { recursive: true });
        writeFileSync(join(root, path), text);
    }
    return root;
}

describe('the files `memo toolchain check` hands the validator for a directory', () => {
    it('includes a library a project keeps in its own memo_packages, once', () => {
        const root = tree({
            '.git/HEAD': '',
            'examples/demo/memo.package.yaml': 'name: demo\ninclude: [model]\n',
            'examples/demo/model/project.sysml': 'package demo { private import demo_anatomy::*; }\n',
            'examples/demo/memo_packages/demo-anatomy/memo.package.yaml': 'name: demo-anatomy\nsysmlDir: .\n',
            'examples/demo/memo_packages/demo-anatomy/anatomy.sysml': 'package demo_anatomy { part def Stomach; }\n',
        });
        const files = filesToCheck(join(root, 'examples')).map(file => file.slice(root.length + 1)).sort();
        expect(files).toEqual([
            'examples/demo/memo_packages/demo-anatomy/anatomy.sysml',
            'examples/demo/model/project.sysml',
        ]);
    });

    it('still leaves out memo_packages outside any project', () => {
        const root = tree({
            '.git/HEAD': '',
            'loose/model.sysml': 'package loose;\n',
            'loose/memo_packages/copy/copy.sysml': 'package copy;\n',
        });
        expect(filesToCheck(join(root, 'loose')).map(file => file.slice(root.length + 1))).toEqual(['loose/model.sysml']);
    });
});
