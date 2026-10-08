// ─── Changing the compiler setting (what Architect's server calls) ───────────
//
// The CLI has no settings commands: a setting is changed in Architect, and the
// server does it through these functions. They write the user's own file or the
// project's checked-in one, and the registry says which settings are whose.
// ─────────────────────────────────────────────────────────────────────────────

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { USER_COMPILER_ENV, userSettingsPath, userToolchain } from '../model/user-settings.js';
import { defaultRegistry } from '../toolchain/default-registry.js';
import {
    applyProjectSetting, applyUserSetting, ConfigSettingError, userSettingReports, userToolchainStatus,
} from '../toolchain/user-settings-status.js';

describe('changing the compiler setting', () => {
    let dir: string;
    let project: string;
    const envBefore = { ...process.env };
    beforeEach(() => {
        dir = mkdtempSync(join(tmpdir(), 'memo-settings-'));
        project = join(dir, 'project');
        mkdirSync(project);
        process.env.MEMO_CONFIG_DIR = join(dir, 'user');
        delete process.env[USER_COMPILER_ENV];
    });
    afterEach(() => {
        process.env = { ...envBefore };
        rmSync(dir, { recursive: true, force: true });
    });

    describe('the user\'s own', () => {
        it('sets the compiler in the user\'s settings file, creating it', () => {
            expect(existsSync(userSettingsPath())).toBe(false);
            applyUserSetting('compiler', 'opensysml', defaultRegistry);
            expect(userToolchain().compiler).toBe('opensysml');
            expect(readFileSync(userSettingsPath(), 'utf8')).toContain('compiler: opensysml');
        });

        it('keeps the comments and the other keys of a file somebody already wrote', () => {
            mkdirSync(join(dir, 'user'));
            writeFileSync(userSettingsPath(), '# mine\ntoolchain:\n  compiler: syside\n  syside:\n    python: /opt/py\nother: 1\n');
            applyUserSetting('compiler', 'opensysml', defaultRegistry);
            const text = readFileSync(userSettingsPath(), 'utf8');
            expect(text).toContain('# mine');
            expect(text).toContain('other: 1');
            expect(userToolchain()).toMatchObject({ compiler: 'opensysml', syside: { python: '/opt/py' } });
        });

        it('refuses a compiler no provider is registered as, and writes nothing', () => {
            expect(() => applyUserSetting('compiler', 'nope', defaultRegistry)).toThrow(/syside, opensysml/);
            expect(existsSync(userSettingsPath())).toBe(false);
        });

        it('refuses a setting that is the project\'s alone', () => {
            expect(() => applyUserSetting('packager', 'internal', defaultRegistry)).toThrow(ConfigSettingError);
            expect(() => applyUserSetting('syside.diagnose', 'all', defaultRegistry)).toThrow(/project setting/);
            expect(() => applyUserSetting('nothing.here', 'x', defaultRegistry)).toThrow(/not a toolchain setting/);
        });

        it('removes what it set, and says when there was nothing to remove', () => {
            applyUserSetting('compiler', 'syside', defaultRegistry);
            expect(applyUserSetting('compiler', undefined, defaultRegistry).changed).toBe(true);
            expect(userToolchain().compiler).toBeUndefined();
            expect(applyUserSetting('compiler', undefined, defaultRegistry).changed).toBe(false);
        });
    });

    describe('the project\'s', () => {
        const file = () => join(project, 'memo.package.yaml');

        it('writes the compiler into the project\'s settings file, keeping its comments and keys', () => {
            writeFileSync(file(), '# the project\nname: pump\ntoolchain:\n  packager: internal\n');
            applyProjectSetting(project, 'compiler', 'opensysml', defaultRegistry);
            const text = readFileSync(file(), 'utf8');
            expect(text).toContain('# the project');
            expect(text).toContain('name: pump');
            expect(text).toContain('packager: internal');
            expect(text).toContain('compiler: opensysml');
        });

        it('creates the toolchain block when the file has none', () => {
            writeFileSync(file(), 'name: pump\n');
            applyProjectSetting(project, 'compiler', 'syside', defaultRegistry);
            expect(readFileSync(file(), 'utf8')).toMatch(/toolchain:\s+compiler: syside/);
        });

        it('never writes a settings file of a directory above the project', () => {
            writeFileSync(join(dir, 'memo.package.yaml'), 'name: above\n');
            applyProjectSetting(project, 'compiler', 'syside', defaultRegistry);
            expect(readFileSync(join(dir, 'memo.package.yaml'), 'utf8')).toBe('name: above\n');
            expect(readFileSync(file(), 'utf8')).toContain('compiler: syside');
        });

        it('refuses where a tool is on one machine: it would be wrong for everyone else', () => {
            expect(() => applyProjectSetting(project, 'syside.python', '/usr/bin/python3', defaultRegistry)).toThrow(/one machine/);
            expect(() => applyProjectSetting(project, 'opensysml.binary', '/x', defaultRegistry)).toThrow(ConfigSettingError);
            expect(existsSync(file())).toBe(false);
        });

        it('refuses a compiler no provider is registered as', () => {
            expect(() => applyProjectSetting(project, 'compiler', 'nope', defaultRegistry)).toThrow(/syside, opensysml/);
        });

        it('removes the compiler it named', () => {
            writeFileSync(file(), 'name: pump\ntoolchain:\n  compiler: syside\n  packager: internal\n');
            expect(applyProjectSetting(project, 'compiler', undefined, defaultRegistry).changed).toBe(true);
            expect(readFileSync(file(), 'utf8')).not.toContain('compiler');
            expect(readFileSync(file(), 'utf8')).toContain('packager: internal');
        });
    });

    describe('what a panel shows', () => {
        it('reports the layer that decided: the command line, the environment, the user, then the project', () => {
            applyUserSetting('compiler', 'syside', defaultRegistry);
            const compiler = (commandLine = {}, project = {}) =>
                userSettingReports(defaultRegistry, commandLine, process.env, project).find(r => r.path === 'compiler')!;
            expect(compiler()).toMatchObject({ value: 'syside', layer: 'user settings' });
            process.env[USER_COMPILER_ENV] = 'opensysml';
            expect(compiler()).toMatchObject({ value: 'opensysml', layer: 'environment' });
            expect(compiler({ compiler: 'syside' })).toMatchObject({ layer: 'command line' });
            expect(compiler({}, { compiler: 'opensysml' }).layers.map(l => `${l.layer}:${l.value}`))
                .toEqual(['environment:opensysml', 'user settings:syside', 'project:opensysml']);
        });

        it('lists the choice of compiler and nothing about where its tools are', () => {
            expect(userSettingReports(defaultRegistry).map(r => r.path)).toEqual(['compiler']);
        });

        it('lists the low-level overrides only when asked, and the registry says which they are', () => {
            const paths = userSettingReports(defaultRegistry, {}, process.env, {}, true).map(r => r.path);
            expect(paths).toEqual(expect.arrayContaining(['compiler', 'validator', 'lowering', 'opensysml.binary', 'syside.python']));
            expect(paths).not.toContain('packager');
            expect(paths).not.toContain('syside.diagnose');
        });

        it('says when the environment decides the compiler, so a saved choice is not what runs', () => {
            expect(userToolchainStatus(defaultRegistry).compilerFromEnvironment).toBe(false);
            process.env[USER_COMPILER_ENV] = 'syside';
            expect(userToolchainStatus(defaultRegistry).compilerFromEnvironment).toBe(true);
        });
    });
});
