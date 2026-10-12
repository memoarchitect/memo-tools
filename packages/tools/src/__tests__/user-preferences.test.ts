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

    it('drop the role when it is cleared', () => {
        const dir = root();
        saveUserPreferences(dir, { role: 'safetyEngineer' });
        saveUserPreferences(dir, {});
        expect(loadUserPreferences(dir)).toEqual({});
    });
});
