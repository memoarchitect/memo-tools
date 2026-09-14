// ─── Dashboard Store Tests ────────────────────────────────────────────────────
//
// Custom dashboards are markdown files in two scopes: dashboards/ (committed)
// and dashboards/user/ (git-ignored). See plans/memo-custom-dashboards.md.
// ─────────────────────────────────────────────────────────────────────────────

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
    loadDashboards, saveDashboard, deleteDashboard, moveDashboard, dashboardTitle, ensureUserDashboardsIgnored,
} from '../server/dashboard-store.js';

let root: string;

beforeEach(() => { root = mkdtempSync(join(tmpdir(), 'memo-dashboard-store-')); });
afterEach(() => { rmSync(root, { recursive: true, force: true }); });

describe('dashboard persistence', () => {
    it('writes shared dashboards under dashboards/ and user ones under dashboards/user/', () => {
        expect(saveDashboard(root, 'shared', 'team', '# Team\n')).toBe(join('dashboards', 'team.md'));
        expect(saveDashboard(root, 'user', 'mine', '# Mine\n')).toBe(join('dashboards', 'user', 'mine.md'));
        expect(readFileSync(join(root, 'dashboards', 'team.md'), 'utf8')).toBe('# Team\n');
        expect(readFileSync(join(root, 'dashboards', 'user', 'mine.md'), 'utf8')).toBe('# Mine\n');
    });

    it('explains the folders in dashboards/README.md, and never lists the README', () => {
        saveDashboard(root, 'shared', 'team', '# Team\n');
        expect(readFileSync(join(root, 'dashboards', 'README.md'), 'utf8')).toContain('dashboards/user/');
        expect(loadDashboards(root).map(d => d.id)).toEqual(['team']);
        expect(() => saveDashboard(root, 'shared', 'README', 'x')).toThrow(/Invalid dashboard id/);
    });

    it('keeps a hand-edited README', () => {
        mkdirSync(join(root, 'dashboards'), { recursive: true });
        writeFileSync(join(root, 'dashboards', 'README.md'), 'ours');
        saveDashboard(root, 'shared', 'team', '# Team\n');
        expect(readFileSync(join(root, 'dashboards', 'README.md'), 'utf8')).toBe('ours');
    });

    it('ignores the user folder in the project .gitignore only once a user dashboard exists', () => {
        saveDashboard(root, 'shared', 'team', '# Team\n');
        expect(existsSync(join(root, '.gitignore'))).toBe(false);
        saveDashboard(root, 'user', 'mine', '# Mine\n');
        saveDashboard(root, 'user', 'again', '# Again\n');
        const ignore = readFileSync(join(root, '.gitignore'), 'utf8');
        expect(ignore.match(/^dashboards\/user\/$/gm)).toHaveLength(1);
    });

    it('appends to an existing .gitignore without disturbing it, and respects an existing rule', () => {
        writeFileSync(join(root, '.gitignore'), 'node_modules/');
        ensureUserDashboardsIgnored(root);
        expect(readFileSync(join(root, '.gitignore'), 'utf8')).toMatch(/^node_modules\/\n\n# MEMO Architect: personal dashboards\ndashboards\/user\/\n$/);

        writeFileSync(join(root, '.gitignore'), '/dashboards/user\n');
        ensureUserDashboardsIgnored(root);
        expect(readFileSync(join(root, '.gitignore'), 'utf8')).toBe('/dashboards/user\n');
    });

    it('lists both scopes, shared first, with titles and paths', () => {
        saveDashboard(root, 'user', 'home', '---\ntitle: My home\n---\nbody');
        saveDashboard(root, 'shared', 'home', '# Team home\n');
        saveDashboard(root, 'shared', 'arch', '# Architecture\n');
        const list = loadDashboards(root);
        expect(list.map(d => `${d.scope}:${d.id}:${d.title}`)).toEqual([
            'shared:arch:Architecture',
            'shared:home:Team home',
            'user:home:My home',
        ]);
        expect(list[2].path).toBe(join('dashboards', 'user', 'home.md'));
    });

    it('skips non-markdown files and names that are not valid ids', () => {
        mkdirSync(join(root, 'dashboards'), { recursive: true });
        writeFileSync(join(root, 'dashboards', 'notes.txt'), 'x');
        writeFileSync(join(root, 'dashboards', '.hidden.md'), 'x');
        expect(loadDashboards(root)).toEqual([]);
    });

    it('refuses ids that could escape the directory', () => {
        expect(() => saveDashboard(root, 'shared', '../evil', 'x')).toThrow(/Invalid dashboard id/);
        expect(() => saveDashboard(root, 'shared', 'a/b', 'x')).toThrow(/Invalid dashboard id/);
        expect(() => saveDashboard(root, 'personal' as any, 'ok', 'x')).toThrow(/Unknown dashboard scope/);
    });

    it('deletes a dashboard in one scope only', () => {
        saveDashboard(root, 'shared', 'home', 'a');
        saveDashboard(root, 'user', 'home', 'b');
        expect(deleteDashboard(root, 'user', 'home')).toBe(true);
        expect(deleteDashboard(root, 'user', 'home')).toBe(false);
        expect(loadDashboards(root).map(d => d.scope)).toEqual(['shared']);
    });

    it('moves between scopes and refuses to overwrite', () => {
        saveDashboard(root, 'user', 'draft', '# Draft\n');
        expect(moveDashboard(root, 'draft', 'user', 'shared')).toBe(join('dashboards', 'draft.md'));
        expect(loadDashboards(root).map(d => `${d.scope}:${d.id}`)).toEqual(['shared:draft']);

        saveDashboard(root, 'user', 'draft', '# Another\n');
        expect(() => moveDashboard(root, 'draft', 'user', 'shared')).toThrow(/already exists/);
        expect(readFileSync(join(root, 'dashboards', 'draft.md'), 'utf8')).toBe('# Draft\n');
    });
});

describe('dashboardTitle', () => {
    it('prefers frontmatter, then the first heading, then the id', () => {
        expect(dashboardTitle('---\ntitle: T\n---\n# H', 'id')).toBe('T');
        expect(dashboardTitle('intro\n\n# Heading\n', 'id')).toBe('Heading');
        expect(dashboardTitle('no heading', 'id')).toBe('id');
        expect(dashboardTitle('---\n: [bad\n---\n# H', 'id')).toBe('H');
    });
});
