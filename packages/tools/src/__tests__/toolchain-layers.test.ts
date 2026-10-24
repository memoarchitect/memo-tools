// ─── Toolchain settings come from layers ─────────────────────────────────────
//
// The project's settings, then the user's, then the command line's flags: each beats the one
// before, and a `compiler` decides both roles it fills. The project names the compiler; a user
// overrides it for themselves without editing the project. Where a tool is on one machine is
// refused in a project's checked-in file.
// ─────────────────────────────────────────────────────────────────────────────

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { loadProjectSettings, setCommandLineToolchain } from '../model/config-loader.js';
import { mergeToolchain } from '../model/toolchain-merge.js';
import { USER_COMPILER_ENV, userToolchain } from '../model/user-settings.js';
import { defaultRegistry } from '../toolchain/default-registry.js';
import { resolveToolchain, ToolchainNotConfiguredError } from '../toolchain/effective.js';
import { DEFAULT_COMPILER } from '../toolchain/providers/default-compiler.js';
import { ProjectNamesUserSettingError } from '../toolchain/ownership.js';

describe('mergeToolchain', () => {
    it('a higher compiler decides both roles, dropping the explicit ones below it', () => {
        const merged = mergeToolchain({ validator: 'a', lowering: 'a', packager: 'p' }, { compiler: 'b' });
        expect(merged).toEqual({ packager: 'p', compiler: 'b' });
    });
    it('keeps an explicit role the higher layer sets itself, and other providers\' leaves', () => {
        const merged = mergeToolchain({ compiler: 'a', syside: { python: 'x', diagnose: 'all' } }, { compiler: 'b', validator: 'c', syside: { python: 'y' } });
        expect(merged).toEqual({ compiler: 'b', validator: 'c', syside: { python: 'y', diagnose: 'all' } });
    });
    it('leaves the roles alone when the higher layer names no compiler', () => {
        expect(mergeToolchain({ validator: 'a', lowering: 'a' }, { packager: 'p' })).toEqual({ validator: 'a', lowering: 'a', packager: 'p' });
    });
});

describe('the layers a command sees', () => {
    const dirs: string[] = [];
    const scratch = (): string => { const dir = mkdtempSync(join(tmpdir(), 'memo-layers-')); dirs.push(dir); return dir; };
    const envBefore = { ...process.env };
    afterEach(() => {
        setCommandLineToolchain({});
        process.env = { ...envBefore };
        for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
    });
    const project = (toolchain: string): string => {
        const dir = scratch();
        writeFileSync(join(dir, 'memo.tools.yaml'), `name: layers\n${toolchain}`);
        return dir;
    };
    const user = (yaml: string): void => {
        const dir = scratch();
        writeFileSync(join(dir, 'settings.yaml'), yaml);
        process.env.MEMO_CONFIG_DIR = dir;
        delete process.env[USER_COMPILER_ENV];
    };
    const lowering = (dir: string): string => resolveToolchain(loadProjectSettings(dir), defaultRegistry).lowering;

    it('a project that names nothing runs under the user\'s compiler', () => {
        user('toolchain:\n  compiler: syside\n');
        expect(lowering(project(''))).toBe('syside');
    });
    it('names nothing anywhere: the default compiler runs', () => {
        user('toolchain: {}\n');
        expect(lowering(project(''))).toBe(DEFAULT_COMPILER);
    });
    it('a project names its compiler, and that is what runs when the user says nothing', () => {
        user('toolchain: {}\n');
        expect(lowering(project('toolchain:\n  compiler: opensysml\n'))).toBe('opensysml');
    });
    it('the user\'s own setting beats the project\'s, without editing the project', () => {
        user('toolchain:\n  compiler: syside\n');
        expect(lowering(project('toolchain:\n  compiler: opensysml\n'))).toBe('syside');
    });
    it('a user\'s compiler decides both roles over a project that names them one by one', () => {
        user('toolchain:\n  compiler: syside\n');
        const dir = project('toolchain:\n  validator: opensysml\n  lowering: opensysml\n');
        const effective = resolveToolchain(loadProjectSettings(dir), defaultRegistry);
        expect([effective.validator, effective.lowering]).toEqual(['syside', 'syside']);
    });
    it('the variable beats the user\'s file, and both beat the project', () => {
        user('toolchain:\n  compiler: syside\n');
        process.env[USER_COMPILER_ENV] = 'opensysml';
        expect(userToolchain().compiler).toBe('opensysml');
        expect(lowering(project('toolchain:\n  compiler: syside\n'))).toBe('opensysml');
    });
    it('the command line beats the user and the project', () => {
        user('toolchain:\n  compiler: syside\n');
        const dir = project('toolchain:\n  compiler: syside\n');
        setCommandLineToolchain({ compiler: 'opensysml' });
        const effective = resolveToolchain(loadProjectSettings(dir), defaultRegistry);
        expect([effective.validator, effective.lowering]).toEqual(['opensysml', 'opensysml']);
    });
    it('a project\'s checked-in file may not say where a tool is on one machine', () => {
        user('toolchain:\n  compiler: syside\n');
        for (const pinned of [
            'toolchain:\n  opensysml:\n    binary: /usr/local/bin/sysml-grpc\n',
            'toolchain:\n  syside:\n    python: /usr/bin/python3\n',
        ]) {
            expect(() => lowering(project(pinned)), pinned).toThrow(ProjectNamesUserSettingError);
        }
        expect(() => lowering(project('toolchain:\n  syside:\n    python: /usr/bin/python3\n'))).toThrow(/your own settings file/);
    });
    it('a project keeps the settings that are the project\'s', () => {
        user('toolchain:\n  compiler: syside\n');
        const dir = project('toolchain:\n  packager: internal\n  syside:\n    diagnose: project\n    configFile: syside.toml\n');
        const effective = resolveToolchain(loadProjectSettings(dir), defaultRegistry);
        expect([effective.lowering, effective.packager]).toEqual(['syside', 'internal']);
    });
});
