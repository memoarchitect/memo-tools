// ─── memo config set / get / unset ───────────────────────────────────────────
//
// The settings that are the user's own are written to the user's settings file
// by a command, never to the project, and the registry says which they are.
// ─────────────────────────────────────────────────────────────────────────────

import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ConfigSettingError, configSetCommand, configUnsetCommand, userSettingReports } from '../commands/config.js';
import { USER_COMPILER_ENV, userSettingsPath, userToolchain } from '../model/user-settings.js';
import { defaultRegistry } from '../toolchain/default-registry.js';

describe('memo config', () => {
    let dir: string;
    const envBefore = { ...process.env };
    beforeEach(() => {
        dir = mkdtempSync(join(tmpdir(), 'memo-config-'));
        process.env.MEMO_CONFIG_DIR = dir;
        delete process.env[USER_COMPILER_ENV];
        vi.spyOn(console, 'log').mockImplementation(() => undefined);
    });
    afterEach(() => {
        vi.restoreAllMocks();
        process.env = { ...envBefore };
        rmSync(dir, { recursive: true, force: true });
    });

    it('sets the compiler in the user\'s settings file, creating it', () => {
        expect(existsSync(userSettingsPath())).toBe(false);
        configSetCommand('compiler', 'opensysml');
        expect(userToolchain().compiler).toBe('opensysml');
        expect(readFileSync(join(dir, 'settings.yaml'), 'utf8')).toContain('compiler: opensysml');
    });

    it('keeps the comments and the other keys of a file somebody already wrote', () => {
        writeFileSync(join(dir, 'settings.yaml'), '# mine\ntoolchain:\n  compiler: syside\n  syside:\n    python: /opt/py\nother: 1\n');
        configSetCommand('compiler', 'opensysml');
        configSetCommand('opensysml.binary', '/opt/sysml-grpc');
        const text = readFileSync(join(dir, 'settings.yaml'), 'utf8');
        expect(text).toContain('# mine');
        expect(text).toContain('other: 1');
        expect(text).toContain('python: /opt/py');
        expect(userToolchain()).toMatchObject({ compiler: 'opensysml', syside: { python: '/opt/py' }, opensysml: { binary: '/opt/sysml-grpc' } });
    });

    it('refuses a compiler no provider is registered as', () => {
        expect(() => configSetCommand('compiler', 'nope')).toThrow(/syside, opensysml/);
        expect(existsSync(userSettingsPath())).toBe(false);
    });

    it('refuses a project\'s setting, saying where it goes', () => {
        expect(() => configSetCommand('packager', 'internal')).toThrow(ConfigSettingError);
        expect(() => configSetCommand('packager', 'internal')).toThrow(/project setting/);
        expect(() => configSetCommand('syside.diagnose', 'all')).toThrow(/project setting/);
        expect(() => configSetCommand('nothing.here', 'x')).toThrow(/not a toolchain setting/);
    });

    it('unsets what it set, and says so when there was nothing', () => {
        configSetCommand('compiler', 'syside');
        configUnsetCommand('compiler');
        expect(userToolchain().compiler).toBeUndefined();
        configUnsetCommand('compiler');
        expect(vi.mocked(console.log).mock.calls.at(-1)?.[0]).toContain('was not set');
    });

    it('reports the layer that decided: the command line, the environment, your file, then the project', () => {
        configSetCommand('compiler', 'syside');
        const compiler = () => userSettingReports(defaultRegistry, {}, process.env).find(r => r.path === 'compiler')!;
        expect(compiler()).toMatchObject({ value: 'syside', layer: 'user settings' });
        process.env[USER_COMPILER_ENV] = 'opensysml';
        expect(compiler()).toMatchObject({ value: 'opensysml', layer: 'environment' });
        const withFlag = userSettingReports(defaultRegistry, { compiler: 'syside' }, process.env).find(r => r.path === 'compiler')!;
        expect(withFlag).toMatchObject({ layer: 'command line' });
        expect(withFlag.layers.map(l => l.layer)).toEqual(['command line', 'environment', 'user settings']);
        // The project's own choice is the lowest layer, which yours override.
        const withProject = userSettingReports(defaultRegistry, {}, process.env, { compiler: 'opensysml' }).find(r => r.path === 'compiler')!;
        expect(withProject.layers.map(l => `${l.layer}:${l.value}`)).toEqual(['environment:opensysml', 'user settings:syside', 'project:opensysml']);
    });

    it('lists the choice of compiler and nothing about where its tools are', () => {
        const paths = userSettingReports(defaultRegistry).map(r => r.path);
        expect(paths).toEqual(['compiler']);
    });

    it('lists the low-level overrides only when asked, and the registry says which they are', () => {
        const paths = userSettingReports(defaultRegistry, {}, process.env, {}, true).map(r => r.path);
        expect(paths).toEqual(expect.arrayContaining(['compiler', 'validator', 'lowering', 'opensysml.binary', 'syside.python']));
        expect(paths).not.toContain('packager');
        expect(paths).not.toContain('syside.diagnose');
    });

    it('still sets a low-level override, for an unusual install', () => {
        configSetCommand('syside.python', '/opt/py/bin/python');
        expect(userToolchain()).toMatchObject({ syside: { python: '/opt/py/bin/python' } });
    });
});
