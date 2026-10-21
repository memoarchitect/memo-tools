import { execFileSync } from 'node:child_process';
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { MEMOConfig } from '../model/config.js';
import { buildSysideInvocation } from '../toolchain/providers/syside.js';

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
        const checked = text.includes("['src', 'extensions', 'examples']")
            || text.includes('src extensions examples');
        expect(checked).toBe(true);
    });

    // Every caller goes through memo-tools' validator provider, so the engine is
    // a setting and an exception granted to one caller is granted to all.
    it.each([
        ['check-syside-gate.mjs', resolve(__dirname, '../../../../scripts/check-syside-gate.mjs')],
        ['build-kpar.sh', resolve(__dirname, '../../../../../memo/scripts/build-kpar.sh')],
        ['check-project-portability.sh', resolve(__dirname, '../../../../../memo/scripts/check-project-portability.sh')],
    ])('%s runs the selected validator through memo toolchain check', (_name, path) => {
        const text = readFileSync(path, 'utf8');
        expect(text).toMatch(/'toolchain', 'check'|toolchain check/);
        expect(text).toMatch(/--toolchain\.validator/);
        expect(text).not.toMatch(/syside check (src|"\$)|spawnSync\(executable/);
    });

    it('asks SysIDE for full diagnostics with warnings as errors by default', () => {
        const { args } = buildSysideInvocation({ config: { modelName: 'x' } as MEMOConfig, projectDir: '/p', files: ['/p/a.sysml'] }, '0.10.3');
        expect(args).toEqual(expect.arrayContaining(['--diagnose', 'all', '--warnings-as-errors']));
    });

    it('diagnoses the project alone by default on SysIDE 1.0, whose bundled library fails `all`', () => {
        const { args } = buildSysideInvocation({ config: { modelName: 'x' } as MEMOConfig, projectDir: '/p', files: ['/p/a.sysml'] }, '1.0.0');
        expect(args).toEqual(expect.arrayContaining(['--diagnose', 'project', '--warnings-as-errors']));
    });
});
