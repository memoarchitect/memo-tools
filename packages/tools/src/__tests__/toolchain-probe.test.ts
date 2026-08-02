// `memo toolchain probe` and `memo config effective`.
//
// The question probe answers is "which binary am I actually running, and what
// version is it?" — the one that costs an afternoon when the only way to ask is
// to run a build and read the errors. So the assertions are about the resolved
// absolute path and the version, not about the command printing something.

import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createDefaultRegistry } from '../toolchain/default-registry.js';
import { formatProbeLine, effectiveConfigReport, probeToolchain } from '../toolchain/operations.js';
import { whichExecutable } from '../toolchain/process.js';
import type { MEMOConfig } from '../model/config.js';

const tempDirs: string[] = [];

afterEach(() => {
    for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function project(): string {
    const root = mkdtempSync(join(tmpdir(), 'memo-probe-'));
    tempDirs.push(root);
    const entry = join(root, 'model/catalog/project.sysml');
    mkdirSync(dirname(entry), { recursive: true });
    writeFileSync(entry, 'package ProjectCatalog {\n}\n');
    return root;
}

/** A fake tool that answers `--version`, so the test needs nothing installed. */
function fakeTool(root: string, name: string, version: string): string {
    const path = join(root, name);
    writeFileSync(path, `#!/bin/sh\necho "${name} ${version}"\n`);
    chmodSync(path, 0o755);
    return path;
}

const registry = createDefaultRegistry();

describe('memo toolchain probe', () => {
    it('resolves every role and reports the in-process transport for a bundled provider', () => {
        const root = project();
        const probe = probeToolchain({ config: { projectName: 'p' }, projectDir: root, registry });

        expect(probe.roles.map(r => r.role)).toEqual(['validator', 'lowering', 'package']);
        for (const role of probe.roles) {
            expect(role.availability.available).toBe(true);
            expect(role.source).toBe('default');
        }
    });

    it.skipIf(process.platform === 'win32')(
        'prints the resolved absolute executable and its version', () => {
            const root = project();
            const executable = fakeTool(root, 'syside', '0.10.2');
            const config: MEMOConfig = {
                projectName: 'p',
                toolchain: { validator: 'syside', syside: { executable } },
            };

            const probe = probeToolchain({ config, projectDir: root, registry });
            const validator = probe.roles.find(r => r.role === 'validator')!;

            expect(validator.availability.available).toBe(true);
            expect(validator.availability.executable).toBe(executable);
            expect(validator.availability.version).toBe('0.10.2');
            // The line users read: `/…/syside 0.10.2`.
            expect(formatProbeLine(validator)).toContain(`${executable} 0.10.2`);
        });

    it('reports a missing executable as unavailable, naming it', () => {
        const root = project();
        const config: MEMOConfig = {
            projectName: 'p',
            toolchain: { validator: 'syside', syside: { executable: join(root, 'not-here') } },
        };
        const validator = probeToolchain({ config, projectDir: root, registry })
            .roles.find(r => r.role === 'validator')!;

        // Unavailable, and still the selected provider — probe never reports a
        // different provider than the one that would run.
        expect(validator.availability.available).toBe(false);
        expect(validator.provider).toBe('syside');
        expect(formatProbeLine(validator)).toContain('unavailable');
    });

    it.skipIf(process.platform === 'win32')('resolves a bare command the way the shell would', () => {
        const root = project();
        const executable = fakeTool(root, 'fake-on-path', '1.2.3');
        expect(whichExecutable('fake-on-path', { PATH: root })).toBe(executable);
        expect(whichExecutable('fake-on-path', { PATH: '/nowhere' })).toBeUndefined();
    });
});

describe('memo config effective', () => {
    it('reports the resolved provider per role and where each came from', () => {
        const root = project();
        const report = effectiveConfigReport({
            config: { projectName: 'p', toolchain: { validator: 'syside', syside: { diagnose: 'none' } } },
            projectDir: root,
            settingsFile: join(root, 'memo.tools.yaml'),
            registry,
        });

        expect(report.toolchain.validator).toBe('syside');
        expect(report.toolchain.lowering).toBe(registry.defaultId('lowering'));
        expect(report.toolchain.selections.find(s => s.role === 'validator')?.source).toBe('settings');
        expect(report.toolchain.selections.find(s => s.role === 'lowering')?.source).toBe('default');
        expect(report.toolchain.providers.syside).toEqual({ diagnose: 'none' });
        expect(report.deprecations).toEqual([]);
    });

    it('surfaces the deprecated alias rather than honouring it silently', () => {
        const report = effectiveConfigReport({
            config: { projectName: 'p', toolchain: { compiler: 'syside' } },
            projectDir: project(),
            registry,
        });
        expect(report.toolchain.validator).toBe('syside');
        expect(report.deprecations.length).toBeGreaterThan(0);
    });
});
