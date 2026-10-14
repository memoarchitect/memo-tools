import { afterEach, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { idsRebase } from '../commands/ids-rebase.js';

const dirs: string[] = [];
afterEach(() => { while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true }); });

const git = (cwd: string, ...args: string[]) => execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8' });
const registry = (entries: Record<string, string>) =>
    `elements:\n${Object.entries(entries).map(([k, v]) => `  "${k}":\n    shortId: "${v}"\n    uuid: "u-${k}"\n`).join('')}`;
const part = (name: string, id: string) => `    part ${name} { @MemoIdentity { :>> providedId = "${id}"; } }\n`;

/** main hands out REQ-124 to p::b; the branch handed it to p::mine, and the two were merged. */
function repo() {
    const root = mkdtempSync(join(tmpdir(), 'memo-ids-')); dirs.push(root);
    mkdirSync(join(root, 'model'), { recursive: true });
    git(root, 'init', '-q', '-b', 'main'); git(root, 'config', 'user.email', 't@t'); git(root, 'config', 'user.name', 't');
    writeFileSync(join(root, 'memo.package.yaml'), 'name: m\nentrypoint: model/p.sysml\ninclude: [model]\n');
    writeFileSync(join(root, 'memo.identity.yaml'), registry({ 'p::a': 'REQ-1', 'p::b': 'REQ-124' }));
    writeFileSync(join(root, 'model/p.sysml'), `package p {\n${part('a', 'REQ-1')}${part('b', 'REQ-124')}}\n`);
    git(root, 'add', '-A'); git(root, 'commit', '-q', '-m', 'base');
    // the merged working tree
    writeFileSync(join(root, 'memo.identity.yaml'), registry({ 'p::a': 'REQ-1', 'p::b': 'REQ-124', 'p::mine': 'REQ-124' }));
    writeFileSync(join(root, 'model/q.sysml'), `package q {\n${part('mine', 'REQ-124')}}\n`);
    return root;
}

describe('memo ids rebase', () => {
    it('keeps the target\'s ids, renumbers the branch\'s clashing ones, and leaves the rest', async () => {
        const root = repo();
        const result = await idsRebase(root, 'main');
        expect(result.changes.map(c => [c.from, c.to])).toEqual([['REQ-124', 'REQ-125'], ['REQ-124', 'REQ-125']]);
        const identity = readFileSync(join(root, 'memo.identity.yaml'), 'utf8');
        expect(identity).toContain('"p::b":\n    shortId: "REQ-124"');
        expect(identity).toContain('"p::mine":\n    shortId: "REQ-125"');
        expect(readFileSync(join(root, 'model/q.sysml'), 'utf8')).toContain('"REQ-125"');
        expect(readFileSync(join(root, 'model/p.sysml'), 'utf8')).toContain('"REQ-124"');
        // a second run finds nothing left to do
        expect((await idsRebase(root, 'main')).changes).toEqual([]);
    });

    it('writes nothing on a dry run, and says so for a ref that is not one', async () => {
        const root = repo();
        const before = readFileSync(join(root, 'memo.identity.yaml'), 'utf8');
        const result = await idsRebase(root, 'main', { dryRun: true });
        expect(result.wrote).toBe(false);
        expect(readFileSync(join(root, 'memo.identity.yaml'), 'utf8')).toBe(before);
        await expect(idsRebase(root, 'no-such-ref')).rejects.toThrow(/not a commit or a ref/);
    });
});
