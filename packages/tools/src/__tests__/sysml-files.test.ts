import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, relative } from 'node:path';
import { findSysmlFiles } from '../model/sysml-files.js';

// ─── SysML source discovery ─────────────────────────────────────────────────
//
// These rules previously lived in a downstream patch-package patch, re-applied
// across fourteen copy-pasted walkers. They are upstream behaviour now, and the
// cases below are why each skip exists — parsing build output or a project's
// scratch samples reports duplicate elements and errors against files nobody
// edits.

let root: string;

beforeAll(() => {
    root = mkdtempSync(resolve(tmpdir(), 'memo-walk-'));
    // A project root is identified by its manifest.
    writeFileSync(resolve(root, 'memo.package.yaml'), 'name: t\n');

    const file = (...parts: string[]) => {
        const full = resolve(root, ...parts);
        mkdirSync(resolve(full, '..'), { recursive: true });
        writeFileSync(full, 'package p {}');
    };

    file('model', 'a.sysml');
    file('model', 'nested', 'b.sysml');
    file('model', 'samples', 'kept.sysml');     // nested samples: real content
    file('samples', 'scratch.sysml');            // top-level samples: scratch
    for (const dir of ['node_modules', '.memo', '.git', '.sysand', '.venv', '__pycache__', 'dist']) {
        file(dir, 'skipped.sysml');
    }
    file('notes.md');
});

afterAll(() => rmSync(root, { recursive: true, force: true }));

describe('findSysmlFiles', () => {
    const found = () => findSysmlFiles(root).map(f => relative(root, f).split('\\').join('/')).sort();

    it('collects .sysml files recursively and nothing else', () => {
        expect(found()).toEqual(['model/a.sysml', 'model/nested/b.sysml', 'model/samples/kept.sysml']);
    });

    it.each(['node_modules', '.memo', '.git', '.sysand', '.venv', '__pycache__', 'dist'])(
        'skips %s, which holds tool output rather than authored sources',
        dir => {
            expect(found().some(f => f.startsWith(`${dir}/`))).toBe(false);
        },
    );

    it("skips a project's top-level samples/, which is scratch beside the manifest", () => {
        expect(found()).not.toContain('samples/scratch.sysml');
    });

    it('keeps nested model/samples/, which is real content in the bundled examples', () => {
        expect(found()).toContain('model/samples/kept.sysml');
    });

    it('keeps samples/ when there is no manifest beside it', () => {
        const bare = mkdtempSync(resolve(tmpdir(), 'memo-bare-'));
        mkdirSync(resolve(bare, 'samples'), { recursive: true });
        writeFileSync(resolve(bare, 'samples', 'x.sysml'), 'package p {}');
        try {
            expect(findSysmlFiles(bare)).toHaveLength(1);
        } finally {
            rmSync(bare, { recursive: true, force: true });
        }
    });

    it('returns empty for an unreadable or missing directory rather than throwing', () => {
        expect(findSysmlFiles(resolve(root, 'does-not-exist'))).toEqual([]);
    });
});
