import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { pinWorktree, pruneBuilds } from '../model/pinned.js';

const git = (cwd: string, ...args: string[]) => execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8' }).trim();

describe('prune keeps the most recently used builds', () => {
    let root: string;
    afterEach(() => rmSync(root, { recursive: true, force: true }));

    it('removes older pinned worktrees through git and older assemblies', async () => {
        root = realpathSync(mkdtempSync(join(tmpdir(), 'memo-prune-')));
        git(root, 'init', '-q');
        git(root, 'config', 'user.email', 't@t'); git(root, 'config', 'user.name', 't');
        const shas: string[] = [];
        for (const n of [1, 2, 3]) {
            writeFileSync(join(root, 'f.txt'), String(n));
            git(root, 'add', '.'); git(root, 'commit', '-qm', String(n));
            shas.push(git(root, 'rev-parse', 'HEAD'));
        }
        const pins = [];
        for (const [i, sha] of shas.entries()) {
            const pin = await pinWorktree(root, sha);
            const when = new Date(Date.now() - (shas.length - i) * 60_000);
            utimesSync(pin.dir, when, when);
            pins.push(pin);
        }
        for (const key of ['a', 'b']) mkdirSync(join(root, '.memo', 'assembled', key), { recursive: true });
        utimesSync(join(root, '.memo', 'assembled', 'a'), new Date(0), new Date(0));

        const dry = await pruneBuilds(root, { keep: 1, dryRun: true });
        expect(dry.removed).toHaveLength(3);
        expect(existsSync(pins[0].dir)).toBe(true);

        const done = await pruneBuilds(root, { keep: 1 });
        expect(done.removed.map(r => r.dir).sort()).toEqual([pins[0].dir, pins[1].dir, join(root, '.memo', 'assembled', 'a')].sort());
        expect(existsSync(pins[2].dir)).toBe(true);
        expect(existsSync(pins[0].dir)).toBe(false);
        expect(git(root, 'worktree', 'list')).not.toContain(pins[0].sha.slice(0, 12));
    });
});
