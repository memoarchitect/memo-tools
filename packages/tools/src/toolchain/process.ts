// ─── Executable resolution and spawning, shared by every process adapter ─────
//
// Adapters build argument lists and parse output. Finding the binary, running
// it, and turning ENOENT into a clear missing-tool error is the same work for
// all of them, so it lives here — with no provider name in sight.
// ─────────────────────────────────────────────────────────────────────────────

import { accessSync, constants, existsSync, statSync } from 'node:fs';
import { homedir, platform } from 'node:os';
import { delimiter, isAbsolute, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { MissingToolError, type ToolInvocation } from './registry.js';

/** Expand `~`, then resolve relative paths against the project directory. */
export function resolveProjectPath(value: string, projectDir: string): string {
    if (value === '~') return homedir();
    if (value.startsWith('~/')) return resolve(homedir(), value.slice(2));
    return isAbsolute(value) ? value : resolve(projectDir, value);
}

/**
 * A configured executable is a path when it looks like one, and a PATH lookup
 * otherwise. `syside` means "whatever is on PATH"; `./bin/syside` means that
 * file.
 */
export function resolveExecutable(
    value: string | undefined,
    fallback: string,
    projectDir: string,
): string {
    if (!value) return fallback;
    return value.includes('/') || value.includes('\\') || value.startsWith('~')
        ? resolveProjectPath(value, projectDir)
        : value;
}

function isExecutableFile(candidate: string): boolean {
    try {
        if (!statSync(candidate).isFile()) return false;
        accessSync(candidate, constants.X_OK);
        return true;
    } catch {
        return false;
    }
}

/**
 * Absolute path of a command, resolved the way the shell would.
 *
 * `memo toolchain probe` prints this: knowing *which* `syside` ran matters as
 * much as knowing that one did.
 */
export function whichExecutable(command: string, env: NodeJS.ProcessEnv = process.env): string | undefined {
    if (command.includes('/') || command.includes('\\')) {
        return existsSync(command) ? resolve(command) : undefined;
    }
    const extensions = platform() === 'win32'
        ? (env.PATHEXT ?? '.COM;.EXE;.BAT;.CMD').split(';').filter(Boolean)
        : [''];
    for (const dir of (env.PATH ?? '').split(delimiter).filter(Boolean)) {
        for (const ext of extensions) {
            const candidate = resolve(dir, command + ext);
            if (isExecutableFile(candidate)) return candidate;
        }
    }
    return undefined;
}

export interface CaptureResult {
    status: number | null;
    stdout: string;
    stderr: string;
}

/**
 * Run a tool and capture its output.
 *
 * A non-zero status is not an exception: a validator rejecting the source is
 * the normal case, and its complaints are diagnostics. Only a binary that could
 * not be run at all is an error, because that means the user asked for a tool
 * MEMO cannot honour — and rule 2 says never downgrade to a different provider
 * in silence.
 */
export function captureToolInvocation(invocation: ToolInvocation, cwd: string): CaptureResult {
    const result = spawnSync(invocation.command, invocation.args, {
        cwd,
        encoding: 'utf8',
        maxBuffer: 64 * 1024 * 1024,
    });
    if (result.error) {
        throw new MissingToolError(invocation.provider, invocation.command, result.error.message);
    }
    return {
        status: result.status,
        stdout: result.stdout ?? '',
        stderr: result.stderr ?? '',
    };
}

/** First line of `<command> --version`, or undefined when it will not say. */
export function probeVersion(
    command: string,
    args: readonly string[] = ['--version'],
): string | undefined {
    const result = spawnSync(command, [...args], { encoding: 'utf8', timeout: 5000 });
    if (result.error || result.status !== 0) return undefined;
    const line = `${result.stdout ?? ''}${result.stderr ?? ''}`.split('\n')[0]?.trim();
    return line && line.length > 0 ? line : undefined;
}
