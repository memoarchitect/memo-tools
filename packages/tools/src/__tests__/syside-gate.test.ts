import { execFileSync } from 'node:child_process';
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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

    // R8-S4. Both gates must name all three roots. `examples/` shipped to users
    // via `memo init --example` while checked by neither, which is how 733
    // SysIDE errors — including two introduced by R0 and R1 themselves — sat
    // behind a green build and 1858 green tests. A root silently dropped from
    // either list recreates that gap exactly, and nothing else would catch it.
    it.each([
        ['check-syside-gate.mjs', resolve(__dirname, '../../../../scripts/check-syside-gate.mjs')],
        ['build-kpar.sh', resolve(__dirname, '../../../../../memo/scripts/build-kpar.sh')],
    ])('%s checks src, extensions, and examples', (_name, path) => {
        const text = readFileSync(path, 'utf8');
        const checked = text.includes("'examples'") || text.includes('syside check src extensions examples');
        expect(checked).toBe(true);
    });
});
