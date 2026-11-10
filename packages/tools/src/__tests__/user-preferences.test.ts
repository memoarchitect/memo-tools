import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { loadUserPreferences, saveUserPreferences, USER_PREFERENCES_FILE } from '../server/user-preferences.js';

describe('one person\'s choices for a model', () => {
    const roots: string[] = [];
    const root = () => { const dir = mkdtempSync(join(tmpdir(), 'memo-prefs-')); roots.push(dir); return dir; };
    afterEach(() => { for (const dir of roots.splice(0)) rmSync(dir, { recursive: true, force: true }); });

    it('are none until a choice is saved', () => {
        expect(loadUserPreferences(root())).toEqual({});
    });

    it('round-trip the role through a visible file the .gitignore lists', () => {
        const dir = root();
        writeFileSync(join(dir, '.gitignore'), 'node_modules/', 'utf8');
        saveUserPreferences(dir, { role: 'safetyEngineer' });
        expect(loadUserPreferences(dir)).toEqual({ role: 'safetyEngineer' });
        const ignore = readFileSync(join(dir, '.gitignore'), 'utf8');
        expect(ignore.split('\n')).toContain(USER_PREFERENCES_FILE);
        expect(ignore.startsWith('node_modules/\n')).toBe(true);
        saveUserPreferences(dir, { role: 'projectLead' });
        expect(readFileSync(join(dir, '.gitignore'), 'utf8').split(USER_PREFERENCES_FILE).length).toBe(2);
    });

    it('keep the experimental features switched on, once each, and drop them when none are', () => {
        const dir = root();
        saveUserPreferences(dir, { features: ['guide', 'guide', ' custom-dashboards '] });
        expect(loadUserPreferences(dir)).toEqual({ features: ['guide', 'custom-dashboards'] });
        saveUserPreferences(dir, { features: [] });
        expect(loadUserPreferences(dir)).toEqual({});
    });

    it('keep only a choice to hide package folders, the default being to show them', () => {
        const dir = root();
        saveUserPreferences(dir, { packageFolders: false });
        expect(loadUserPreferences(dir)).toEqual({ packageFolders: false });
        saveUserPreferences(dir, { packageFolders: true });
        expect(loadUserPreferences(dir)).toEqual({});
    });

    it('drop the role when it is cleared', () => {
        const dir = root();
        saveUserPreferences(dir, { role: 'safetyEngineer' });
        saveUserPreferences(dir, {});
        expect(loadUserPreferences(dir)).toEqual({});
    });

    it('keep favorites of a known type, once each, in the order added', () => {
        const dir = root();
        saveUserPreferences(dir, {
            favorites: [
                { type: 'view', ref: 'pkg::overview' },
                { type: 'element', ref: ' pkg::pump ' },
                { type: 'view', ref: 'pkg::overview' },
                { type: 'folder', ref: 'Requirement', packageName: 'needs' },
                { type: 'folder', ref: 'Requirement' },
                { type: 'nonsense', ref: 'x' } as never,
                { type: 'element', ref: '' },
            ],
        });
        expect(loadUserPreferences(dir).favorites).toEqual([
            { type: 'view', ref: 'pkg::overview' },
            { type: 'element', ref: 'pkg::pump' },
            { type: 'folder', ref: 'Requirement', packageName: 'needs' },
            { type: 'folder', ref: 'Requirement' },
        ]);
    });

    it('keep the views and elements opened last, once each, at most ten', () => {
        const dir = root();
        const ids = Array.from({ length: 12 }, (_, i) => `pkg::e${i}`);
        saveUserPreferences(dir, { recentElements: ['pkg::e0', ...ids], recentViews: ['pkg::v1', 'pkg::v1', 'pkg::v2'] });
        const saved = loadUserPreferences(dir);
        expect(saved.recentElements).toEqual(ids.slice(0, 10));
        expect(saved.recentViews).toEqual(['pkg::v1', 'pkg::v2']);
    });

    it('keep favorites and recents beside the other choices', () => {
        const dir = root();
        const all = { role: 'safetyEngineer', favorites: [{ type: 'viewpoint' as const, ref: 'riskViewpoint' }], recentViews: ['pkg::v1'] };
        saveUserPreferences(dir, all);
        expect(loadUserPreferences(dir)).toEqual(all);
    });

    it('keep the workspace beside the role, and drop each when cleared', () => {
        const dir = root();
        saveUserPreferences(dir, { role: 'safetyEngineer', workspace: 'pump::PumpSystem' });
        expect(loadUserPreferences(dir)).toEqual({ role: 'safetyEngineer', workspace: 'pump::PumpSystem' });
        saveUserPreferences(dir, { role: 'safetyEngineer' });
        expect(loadUserPreferences(dir)).toEqual({ role: 'safetyEngineer' });
    });
});

describe('project defaults and personal overrides', () => {
    const dirs: string[] = [];
    const project = (yaml: string) => { const d = mkdtempSync(join(tmpdir(), 'memo-prefs-')); dirs.push(d); writeFileSync(join(d, 'memo.package.yaml'), yaml, 'utf8'); return d; };
    afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });

    it('applies the project defaults when the person has chosen nothing', () => {
        const dir = project('name: x\npreferences:\n  features: [custom-dashboards]\n  packageFolders: false\n');
        expect(loadUserPreferences(dir)).toEqual({ features: ['custom-dashboards'], packageFolders: false });
    });

    it('lets a person opt out of every default feature with an empty list', () => {
        const dir = project('preferences:\n  features: [custom-dashboards]\n');
        saveUserPreferences(dir, {});
        expect(readFileSync(join(dir, USER_PREFERENCES_FILE), 'utf8')).toContain('features: []');
        expect(loadUserPreferences(dir)).toEqual({});
    });

    it('lets a person override one key and keep following the rest', () => {
        const dir = project('preferences:\n  role: projectLead\n  features: [guide]\n');
        saveUserPreferences(dir, { role: 'safetyEngineer', features: ['guide'] });
        expect(readFileSync(join(dir, USER_PREFERENCES_FILE), 'utf8')).not.toContain('features');
        expect(loadUserPreferences(dir)).toEqual({ role: 'safetyEngineer', features: ['guide'] });
    });

    it('lets a person show package folders the project hides', () => {
        const dir = project('preferences:\n  packageFolders: false\n');
        saveUserPreferences(dir, { packageFolders: true });
        expect(loadUserPreferences(dir)).toEqual({});
    });
});
