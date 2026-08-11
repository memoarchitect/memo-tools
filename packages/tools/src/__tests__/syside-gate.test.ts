import { execFileSync } from 'node:child_process';
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

let directory: string | undefined;

afterEach(() => {
    if (directory) rmSync(directory, { recursive: true, force: true });
    directory = undefined;
});

describe('SysIDE suite gate', () => {
    it('fails the suite command when SysIDE rejects its source', () => {
        // Deliberate negative: a gate that reports a compiler failure but exits
        // zero would recreate the exact green-suite/red-build gap R0 closes.
        directory = mkdtempSync(join(tmpdir(), 'memo-syside-gate-'));
        const failingSyside = join(directory, 'syside');
        writeFileSync(failingSyside, '#!/bin/sh\nexit 37\n');
        chmodSync(failingSyside, 0o755);

        const gate = resolve(__dirname, '../../../../scripts/check-syside-gate.mjs');
        expect(() => execFileSync(process.execPath, [gate], {
            env: { ...process.env, SYSIDE_EXECUTABLE: failingSyside },
            stdio: 'pipe',
        })).toThrow();
    });
});
