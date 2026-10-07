// ─── memo validate, asking a running memo dev ────────────────────────────────
//
// When `memo dev` is running for the project it already holds the compiled
// model, kept current as files change, so `memo validate` asks it to validate
// that model instead of compiling the project again (server/dev-validate.ts).
// Anything it cannot answer — no server, a server from another project, a run
// that names its own toolchain — is validated here as before.
// ─────────────────────────────────────────────────────────────────────────────

import { resolve } from 'node:path';
import type { ValidateOptions } from './validate.js';
import {
    readDevServerRecord, TOKEN_HEADER, VALIDATE_ROUTE, type ValidationReply,
} from '../server/dev-validate.js';

/** Options a running server answers; any other one names a run of its own. */
const SERVED_OPTIONS = new Set(['format', 'output', 'server']);

/** Whether a run with these options may be answered by a running `memo dev`. */
export function servable(options: ValidateOptions | undefined): boolean {
    if (options?.server === false) return false;
    return Object.entries(options ?? {}).every(([key, value]) => SERVED_OPTIONS.has(key) || value === undefined);
}

function alive(pid: number): boolean {
    try {
        process.kill(pid, 0);
        return true;
    } catch (error) {
        return (error as NodeJS.ErrnoException).code === 'EPERM';
    }
}

/**
 * The reply of the `memo dev` running for projectRoot, or undefined when none
 * answers. `output` is sent resolved against cwd, since the server runs in the
 * project root.
 */
export async function validateWithDevServer(
    projectRoot: string, cwd: string, options: ValidateOptions | undefined,
): Promise<ValidationReply | undefined> {
    const record = readDevServerRecord(projectRoot);
    if (!record || resolve(record.projectRoot) !== resolve(projectRoot) || !alive(record.pid)) return undefined;
    try {
        const response = await fetch(new URL(VALIDATE_ROUTE, record.url), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', [TOKEN_HEADER]: record.token },
            body: JSON.stringify({
                format: options?.format,
                output: options?.output ? resolve(cwd, options.output) : undefined,
            }),
        });
        if (!response.ok) return undefined;
        return await response.json() as ValidationReply;
    } catch {
        return undefined;
    }
}
