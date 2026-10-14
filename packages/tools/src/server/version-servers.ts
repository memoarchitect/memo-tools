// ─── Opening a version: a read-only server for a pinned directory ────────────
//
// The Version selector lists Working, the releases the model's records name, and the unreleased refs
// of the repository (the latest tag, the tip of the current branch), each marked "not a release".
// Opening one resolves the pin here, with the library, so an ordering error, an unpinned system folder
// or drift is answered to the client as a message; then a read-only `memo-architect dev` is started in
// the pinned directory, and the client is sent to its address. One child per directory: opening the
// same version twice reuses it. Children are tied to this process over IPC and go when it does.
// ─────────────────────────────────────────────────────────────────────────────

import { execFile, spawn, type ChildProcess } from 'node:child_process';
import { promisify } from 'node:util';
import type { MemoModel } from '../model/semantic.js';
import type { MEMOConfig } from '../model/config.js';
import { buildRelease, pinWorktree, refInfo, releaseInfo } from '../model/pinned.js';
import type { PinnedInfo } from '../protocol/messages.js';

const git = promisify(execFile);

/** An unreleased ref the selector offers. */
export interface VersionRef {
    /** What `--at` is given. */
    name: string;
    kind: 'tag' | 'branch';
    commit: string;
    /** "Latest tag rc-1", "Latest commit on main". */
    label: string;
}

/** What the person chose: a release record, by element id, or an unreleased ref. */
export interface VersionSelection {
    release?: string;
    ref?: string;
}

async function run(cwd: string, args: string[]): Promise<string> {
    try {
        return (await git('git', ['-C', cwd, ...args])).stdout.trim();
    } catch {
        return '';
    }
}

/** The latest tag and the tip of the current branch. Neither is a release. */
export async function listRefs(projectRoot: string): Promise<VersionRef[]> {
    const refs: VersionRef[] = [];
    const branch = await run(projectRoot, ['symbolic-ref', '--short', '-q', 'HEAD']);
    const head = await run(projectRoot, ['rev-parse', 'HEAD']);
    if (branch && head) refs.push({ name: branch, kind: 'branch', commit: head, label: `Latest commit on ${branch}` });
    const tag = await run(projectRoot, ['for-each-ref', '--sort=-creatordate', '--count=1', '--format=%(refname:short) %(objectname)', 'refs/tags']);
    const [name, object] = tag.split(' ');
    if (name) {
        const commit = await run(projectRoot, ['rev-parse', `${name}^{commit}`]) || object;
        refs.push({ name, kind: 'tag', commit, label: `Latest tag ${name}` });
    }
    return refs;
}

export interface VersionServersOptions {
    projectRoot: string;
    /** The command a pinned child runs: the Architect entry and the flags that make it look the same. */
    entry: string;
    args: string[];
    /** The working model, which holds the release records. */
    workingModel: () => MemoModel | undefined;
    /** Where the working model is served, for the pinned view's way back. */
    workingUrl: () => string;
    toolchain?: MEMOConfig['toolchain'];
}

export interface VersionServers {
    refs(): Promise<VersionRef[]>;
    open(selection: VersionSelection): Promise<{ url: string; info: PinnedInfo }>;
    close(): void;
}

export function createVersionServers(options: VersionServersOptions): VersionServers {
    const children = new Map<string, { child: ChildProcess; opened: Promise<string> }>();

    async function serve(dir: string, info: PinnedInfo): Promise<{ url: string; info: PinnedInfo }> {
        const withWay = { ...info, workingUrl: options.workingUrl() };
        const existing = children.get(dir);
        if (existing && existing.child.exitCode === null) return { url: await existing.opened, info: withWay };
        const child = spawn(process.execPath, [options.entry, 'dev', '--pinned-dir', dir, '--port', '0', '--no-open', ...options.args], {
            cwd: dir,
            env: { ...process.env, MEMO_PINNED_INFO: JSON.stringify(withWay), MEMO_PINNED_PREFERENCES: options.projectRoot },
            stdio: ['ignore', 'inherit', 'inherit', 'ipc'],
        });
        const opened = new Promise<string>((resolve, reject) => {
            const timer = setTimeout(() => reject(new Error('the pinned view did not start within two minutes')), 120_000);
            child.once('message', (message: { type?: string; url?: string }) => {
                clearTimeout(timer);
                if (message?.type === 'memo:read-only-ready' && message.url) resolve(message.url);
                else reject(new Error('the pinned view started without saying where'));
            });
            child.once('exit', code => { clearTimeout(timer); reject(new Error(`the pinned view exited with code ${code}`)); });
        });
        opened.catch(() => children.delete(dir));
        children.set(dir, { child, opened });
        return { url: await opened, info: withWay };
    }

    return {
        refs: () => listRefs(options.projectRoot),
        async open(selection) {
            if (selection.ref) {
                const pin = await pinWorktree(options.projectRoot, selection.ref);
                return serve(pin.projectDir, refInfo(selection.ref, pin));
            }
            if (selection.release) {
                const model = options.workingModel();
                if (!model) throw new Error('the working model is not built yet');
                const build = await buildRelease(options.projectRoot, { model }, selection.release, { config: { toolchain: options.toolchain } });
                return serve(build.assembly.dir, releaseInfo(build));
            }
            throw new Error('say which version to open: a release record or a ref');
        },
        close() {
            for (const { child } of children.values()) child.kill('SIGTERM');
            children.clear();
        },
    };
}
