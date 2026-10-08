// ─── Finding the Python that has SysIDE ──────────────────────────────────────
//
// The user chooses the compiler; MEMO looks for its tools in the usual places and
// takes the first interpreter that really imports it.

import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { findSysidePython, sysidePythonCandidates } from '../toolchain/providers/syside-python.js';

describe.skipIf(process.platform === 'win32')('where SysIDE\'s Python is looked for', () => {
    const dirs: string[] = [];
    const scratch = () => { const d = mkdtempSync(join(tmpdir(), 'memo-py-')); dirs.push(d); return d; };
    afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });

    /** A virtual environment whose python imports syside (or fails to, as a real one without it does). */
    const environment = (root: string, name: string, hasSyside: boolean): string => {
        const bin = join(root, name, 'bin');
        mkdirSync(bin, { recursive: true });
        const python = join(bin, 'python');
        writeFileSync(python, `#!/bin/sh\n${hasSyside ? 'exit 0' : 'exit 1'}\n`);
        chmodSync(python, 0o755);
        return python;
    };
    const env = (extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv => ({ PATH: '', ...extra });

    it('looks in the active environment first, then the project\'s, then the repository above it', () => {
        const repo = scratch();
        const project = join(repo, 'models', 'pump');
        mkdirSync(project, { recursive: true });
        const active = environment(scratch(), 'active', true);
        const own = environment(project, '.venv', true);
        const above = environment(repo, '.syside-venv', true);
        const virtualEnv = join(active, '..', '..');
        expect(sysidePythonCandidates(project, env({ VIRTUAL_ENV: virtualEnv }))).toEqual([active, own, above]);
    });

    it('takes the first one that imports SysIDE, skipping one that does not', () => {
        const project = scratch();
        environment(project, '.venv', false);
        const good = environment(project, '.syside-venv', true);
        // `.syside-venv` is looked at before `.venv`, so make the first miss visible too.
        expect(findSysidePython(project, env())).toBe(good);
    });

    it('finds nothing when no interpreter imports it, rather than guessing', () => {
        const project = scratch();
        environment(project, '.venv', false);
        expect(findSysidePython(project, env())).toBeUndefined();
    });
});
