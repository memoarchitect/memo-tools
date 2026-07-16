import { chmodSync, existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { MEMOConfig } from '../model/config.js';
import {
    buildCompilerInvocation,
    buildPackagerInvocation,
    compileWithConfiguredTool,
    packageWithConfiguredTool,
} from '../model/toolchain.js';

const tempDirs: string[] = [];

afterEach(() => {
    for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function config(toolchain?: MEMOConfig['toolchain']): MEMOConfig {
    return { projectName: 'test', projectType: 'device', toolchain };
}

describe('toolchain provider configuration', () => {
    it('preserves internal compiler and packager defaults', () => {
        expect(buildCompilerInvocation(config(), '/project')).toBeUndefined();
        expect(buildPackagerInvocation(config(), '/project', '/project/model.kpar')).toBeUndefined();
    });

    it('builds a configured Syside compiler invocation', () => {
        expect(buildCompilerInvocation(config({
            compiler: 'syside',
            syside: {
                executable: './bin/syside',
                configFile: './config/syside.toml',
                warningsAsErrors: true,
            },
        }), '/project')).toEqual({
            command: '/project/bin/syside',
            args: [
                'check', '--colour', 'no', '--diagnose', 'all',
                '--config', '/project/config/syside.toml',
                '--warnings-as-errors', '/project',
            ],
            provider: 'syside',
        });
    });

    it('passes configured diagnostic scope and resolved ontology includes to Syside', () => {
        expect(buildCompilerInvocation(config({
            compiler: 'syside',
            syside: { diagnose: 'none' },
        }), '/project', ['/content/src', '/content/src'])).toMatchObject({
            args: [
                'check', '--colour', 'no', '--diagnose', 'none',
                '--warnings-as-errors', '--include', '/content/src', '/project',
            ],
        });
    });

    it('allows strict warning handling to be disabled explicitly', () => {
        expect(buildCompilerInvocation(config({
            compiler: 'syside',
            syside: { warningsAsErrors: false },
        }), '/project')).toMatchObject({
            args: ['check', '--colour', 'no', '--diagnose', 'all', '/project'],
        });
    });

    it('builds a configured SysAnd packager invocation', () => {
        expect(buildPackagerInvocation(config({
            packager: 'sysand',
            sysand: { executable: 'sysand-custom', configFile: 'sysand.toml' },
        }), '/project', '/project/model.kpar')).toEqual({
            command: 'sysand-custom',
            args: ['--config-file', '/project/sysand.toml', 'build', '/project/model.kpar'],
            provider: 'sysand',
        });
    });

    it('rejects unsupported role/provider combinations', () => {
        expect(() => buildCompilerInvocation(config({ compiler: 'sysand' } as any), '/project'))
            .toThrow('Choose "internal" or "syside"');
        expect(() => buildPackagerInvocation(config({ packager: 'syside' } as any), '/project', '/project/model.kpar'))
            .toThrow('Choose "internal" or "sysand"');
    });

    it.skipIf(process.platform === 'win32')('executes configured compiler and packager binaries', () => {
        const project = mkdtempSync(join(tmpdir(), 'memo-toolchain-'));
        tempDirs.push(project);
        const compiler = join(project, 'compiler');
        const packager = join(project, 'packager');
        const compilerMarker = join(project, 'compiler-ran');
        const output = join(project, 'model.kpar');
        writeFileSync(compiler, `#!/bin/sh\ntouch "${compilerMarker}"\n`);
        writeFileSync(packager, `#!/bin/sh\ntouch "$4"\n`);
        chmodSync(compiler, 0o755);
        chmodSync(packager, 0o755);

        expect(compileWithConfiguredTool(config({
            compiler: 'syside',
            syside: { executable: compiler },
        }), project)).toBe('syside');
        expect(existsSync(compilerMarker)).toBe(true);
        expect(packageWithConfiguredTool(config({
            packager: 'sysand',
            sysand: { executable: packager, configFile: 'sysand.toml' },
        }), project, output)).toBe('sysand');
    });
});
