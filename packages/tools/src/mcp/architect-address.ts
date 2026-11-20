// ─── Where this project's Architect is running ───────────────────────────────
//
// An AI coding tool's answers link to elements in Architect, so the MCP server needs the address of
// the Architect open on this project. `memo dev` records it in `.memo/architect.json` while it runs;
// the MCP server reads it, and falls back to `MEMO_ARCHITECT_URL`, then to the default address, when
// no Architect is running. The file is this machine's runtime state and is kept out of git.
// ─────────────────────────────────────────────────────────────────────────────

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ensureGitIgnored } from '../server/project-gitignore.js';

const ADDRESS_FILE = '.memo/architect.json';
export const DEFAULT_ARCHITECT_URL = 'http://localhost:3000';

function alive(pid: unknown): boolean {
    if (typeof pid !== 'number') return false;
    try { process.kill(pid, 0); return true; } catch (error) { return (error as NodeJS.ErrnoException).code === 'EPERM'; }
}

/** Record that Architect serves this project at `url`; returns the function that clears it. */
export function recordArchitectAddress(projectRoot: string, url: string): () => void {
    const path = join(projectRoot, ADDRESS_FILE);
    try {
        ensureGitIgnored(projectRoot, ADDRESS_FILE, 'MEMO Architect: where it is running on this machine');
        mkdirSync(join(projectRoot, '.memo'), { recursive: true });
        writeFileSync(path, `${JSON.stringify({ url, pid: process.pid })}\n`, 'utf8');
    } catch {
        // Links then use the default address; nothing else depends on the record.
    }
    return () => {
        try {
            const recorded = JSON.parse(readFileSync(path, 'utf8'));
            if (recorded?.pid === process.pid) rmSync(path, { force: true });
        } catch { /* already gone */ }
    };
}

/** The address of the Architect running on this project, else the configured or default one. */
export function architectAddress(projectRoot: string, env: NodeJS.ProcessEnv = process.env): string {
    const path = join(projectRoot, ADDRESS_FILE);
    if (existsSync(path)) {
        try {
            const recorded = JSON.parse(readFileSync(path, 'utf8'));
            if (typeof recorded?.url === 'string' && alive(recorded.pid)) return recorded.url;
        } catch { /* a damaged record is no record */ }
    }
    return env.MEMO_ARCHITECT_URL ?? DEFAULT_ARCHITECT_URL;
}
