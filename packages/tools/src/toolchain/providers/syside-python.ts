// ─── Finding the Python that has SysIDE ──────────────────────────────────────
//
// A user chooses the compiler; they should not have to say where its tools are.
// SysIDE's stage 1 export runs in a Python that can `import syside`, and people
// keep that in a few usual places. This looks there, in order, and takes the first
// interpreter that really imports it, so nothing needs configuring unless the
// install is somewhere unusual (`toolchain.syside.python`, or `MEMO_SYSIDE_PYTHON`,
// still win when given).
// ─────────────────────────────────────────────────────────────────────────────

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir, platform } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { whichExecutable } from '../process.js';

const WINDOWS = platform() === 'win32';
const BIN = WINDOWS ? 'Scripts' : 'bin';
const PYTHON = WINDOWS ? 'python.exe' : 'python';

/** Virtual environment directory names people use for a project's own Python. */
const PROJECT_ENVIRONMENTS = ['.syside-venv', '.venv', 'venv'];

/** How far above the project to look: a repository's environment often sits beside several projects. */
const PARENT_LEVELS = 3;

/** Where a Python with SysIDE is looked for, in order, for a project. Candidates that do not exist are dropped. */
export function sysidePythonCandidates(projectDir: string, env: NodeJS.ProcessEnv = process.env): string[] {
    const found: string[] = [];
    const add = (path: string | undefined) => { if (path && !found.includes(path)) found.push(path); };
    const inEnvironment = (dir: string) => join(dir, BIN, PYTHON);

    // The environment the user is already in.
    if (env.VIRTUAL_ENV) add(inEnvironment(env.VIRTUAL_ENV));
    // The project's own, then the repository's above it.
    let dir = resolve(projectDir);
    for (let level = 0; level <= PARENT_LEVELS; level++) {
        for (const name of PROJECT_ENVIRONMENTS) add(inEnvironment(join(dir, name)));
        const parent = dirname(dir);
        if (parent === dir) break;
        dir = parent;
    }
    // Where SysIDE's own documentation puts it, then the interpreters on PATH.
    add(inEnvironment(join(homedir(), '.venvs', 'syside')));
    // SysIDE 1.0 ships its CLI inside the Python package, so `uv tool install syside`
    // is the way to get the `syside` command, and it keeps the interpreter here.
    add(inEnvironment(join(env.UV_TOOL_DIR ?? join(homedir(), '.local', 'share', 'uv', 'tools'), 'syside')));
    add(whichExecutable('python3', env));
    add(whichExecutable('python', env));
    return found.filter(candidate => existsSync(candidate));
}

const verdicts = new Map<string, boolean>();

/** Whether an interpreter can import SysIDE (remembered for the process: it does not change under us). */
export function importsSyside(python: string): boolean {
    const known = verdicts.get(python);
    if (known !== undefined) return known;
    const result = spawnSync(python, ['-c', 'import syside'], { stdio: 'ignore', timeout: 20_000 });
    const ok = result.status === 0;
    verdicts.set(python, ok);
    return ok;
}

/** The first candidate that imports SysIDE, or undefined (the caller then names what was looked at). */
export function findSysidePython(projectDir: string, env: NodeJS.ProcessEnv = process.env): string | undefined {
    return sysidePythonCandidates(projectDir, env).find(importsSyside);
}

/** The places that were looked at, for the error that says none had SysIDE. */
export function describeSysidePythonSearch(projectDir: string, env: NodeJS.ProcessEnv = process.env): string {
    const looked = sysidePythonCandidates(projectDir, env);
    return looked.length > 0
        ? `Looked at: ${looked.join(', ')}. None can import syside.`
        : 'No Python was found in the usual places.';
}
