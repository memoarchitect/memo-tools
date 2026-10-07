// ─── memo validate, answered by a running memo dev ───────────────────────────
//
// `memo dev` holds the project's compiled model in memory and keeps it current
// as files change. `memo validate` asks it to run the validation on that model
// rather than compiling the project again (validate-client.ts). The server
// records where it listens in `.memo/dev-server.json`, with a token a caller
// must present: only someone who can read the project can ask, which keeps a
// web page in the user's browser from triggering validations on localhost.
// ─────────────────────────────────────────────────────────────────────────────

import { randomBytes } from 'node:crypto';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { ValidateOptions } from '../commands/validate.js';

/** Where a running `memo dev` says how to reach it. */
export const DEV_SERVER_RECORD = join('.memo', 'dev-server.json');

/** The validate route; POST only, with the record's token. */
export const VALIDATE_ROUTE = '/__memo/validate';

export const TOKEN_HEADER = 'x-memo-token';

export interface DevServerRecord {
    pid: number;
    url: string;
    token: string;
    projectRoot: string;
}

/** What a validation run produced: its output streams and its exit code. */
export interface ValidationReply {
    exitCode: number;
    stdout: string;
    stderr: string;
}

export function newToken(): string {
    return randomBytes(24).toString('hex');
}

export function writeDevServerRecord(record: DevServerRecord): void {
    const path = join(record.projectRoot, DEV_SERVER_RECORD);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify(record, null, 2));
}

/** Removes the record, only when it is this process's. */
export function removeDevServerRecord(projectRoot: string, pid = process.pid): void {
    const record = readDevServerRecord(projectRoot);
    if (record?.pid === pid) rmSync(join(projectRoot, DEV_SERVER_RECORD), { force: true });
}

export function readDevServerRecord(projectRoot: string): DevServerRecord | undefined {
    try {
        const record = JSON.parse(readFileSync(join(projectRoot, DEV_SERVER_RECORD), 'utf8')) as DevServerRecord;
        return typeof record.url === 'string' && typeof record.token === 'string' && typeof record.pid === 'number'
            ? record
            : undefined;
    } catch {
        return undefined;
    }
}

/**
 * Answers the validate route; false for any other request. A wrong token is
 * refused before anything runs.
 */
export function serveValidate(
    req: IncomingMessage,
    res: ServerResponse,
    token: string | undefined,
    validate: ((options: ValidateOptions) => Promise<ValidationReply>) | undefined,
): boolean {
    if ((req.url ?? '').split('?')[0] !== VALIDATE_ROUTE) return false;
    const reply = (status: number, body: unknown) => {
        res.writeHead(status, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(body));
    };
    if (!validate || !token) {
        reply(404, { error: 'this server does not answer validations' });
        return true;
    }
    if (req.method !== 'POST') {
        reply(405, { error: 'POST only' });
        return true;
    }
    if (req.headers[TOKEN_HEADER] !== token) {
        reply(403, { error: 'wrong or missing token' });
        return true;
    }
    const chunks: Buffer[] = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', () => {
        let options: ValidateOptions;
        try {
            const body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}') as ValidateOptions;
            options = { format: body.format, output: body.output };
        } catch {
            reply(400, { error: 'the body is not JSON' });
            return;
        }
        validate(options).then(
            result => reply(200, result),
            error => reply(500, { error: error instanceof Error ? error.message : String(error) }),
        );
    });
    return true;
}
