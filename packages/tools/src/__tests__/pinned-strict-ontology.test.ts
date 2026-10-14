import { afterEach, describe, expect, it, vi } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pinnedTarget } from '../commands/pinned-target.js';

const dirs: string[] = [];
afterEach(() => { while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true }); vi.restoreAllMocks(); });

const git = (cwd: string, ...args: string[]) => execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8' });

function repo(lockedVersion: string, installedVersion: string) {
    const root = mkdtempSync(join(tmpdir(), 'memo-strict-')); dirs.push(root);
    git(root, 'init', '-q', '-b', 'main'); git(root, 'config', 'user.email', 't@t'); git(root, 'config', 'user.name', 't');
    mkdirSync(join(root, 'model'), { recursive: true });
    mkdirSync(join(root, 'memo_packages/the-ontology/model'), { recursive: true });
    writeFileSync(join(root, 'memo.package.yaml'), 'name: m\nentrypoint: model/p.sysml\ninclude: [model]\n');
    writeFileSync(join(root, 'model/p.sysml'), 'package p { part a; }\n');
    writeFileSync(join(root, 'memo_packages/the-ontology/model/o.sysml'), 'package o {}\n');
    writeFileSync(join(root, 'memo_packages/the-ontology/memo.package.yaml'), `name: the-ontology\nversion: ${installedVersion}\nsysmlDir: model\n`);
    writeFileSync(join(root, 'memo.lock.yaml'),
        `ontology: the-ontology\nversion: "${lockedVersion}"\nlockedAt: "2026-01-01"\npackages:\n  - name: the-ontology\n    version: "${lockedVersion}"\n    type: ontology\n    checksum: "x"\n`);
    git(root, 'add', '-A'); git(root, 'commit', '-q', '-m', 'base');
    return root;
}

describe('--at with --strict-ontology', () => {
    it('refuses a commit made with another ontology version, and says which', async () => {
        const root = repo('0.13.0', '0.14.0');
        vi.spyOn(console, 'error').mockImplementation(() => undefined);
        const exit = vi.spyOn(process, 'exit').mockImplementation((() => { throw new Error('exit'); }) as never);
        await expect(pinnedTarget(root, { at: 'HEAD', strictOntology: true })).rejects.toThrow('exit');
        expect(exit).toHaveBeenCalledWith(1);
        expect((console.error as unknown as ReturnType<typeof vi.fn>).mock.calls.flat().join(' ')).toMatch(/the-ontology 0\.13\.0, not 0\.14\.0/);
    });

    it('warns and goes on without it, and says nothing when the versions agree', async () => {
        const root = repo('0.13.0', '0.14.0');
        const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
        const target = await pinnedTarget(root, { at: 'HEAD' });
        expect(target?.dir).toBeTruthy();
        expect(error.mock.calls.flat().join(' ')).toMatch(/made with the-ontology 0\.13\.0/);
        const same = repo('0.14.0', '0.14.0');
        error.mockClear();
        await pinnedTarget(same, { at: 'HEAD' });
        expect(error.mock.calls.flat().join(' ')).not.toMatch(/made with/);
    });
});
