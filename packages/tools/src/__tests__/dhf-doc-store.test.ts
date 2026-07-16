// ─── DHF Document Store Tests ─────────────────────────────────────────────────
//
// File-backed persistence for DHF workbench documents (dhf/documents/*.md),
// settings (.memo/dhf-settings.json), and repo template listing.
// ─────────────────────────────────────────────────────────────────────────────

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
    loadDhfDocs, saveDhfDoc, deleteDhfDoc,
    loadDhfSettings, saveDhfSettings,
    listRepoTemplates, readRepoTemplate,
} from '../server/dhf-doc-store.js';
import type { DhfDocDTO } from '@memo/tools';

let root: string;

beforeEach(() => { root = mkdtempSync(join(tmpdir(), 'memo-dhf-store-')); });
afterEach(() => { rmSync(root, { recursive: true, force: true }); });

const doc = (over: Partial<DhfDocDTO> = {}): DhfDocDTO => ({
    id: 'DOC-UN-001',
    title: 'User Needs',
    group: 'Requirements',
    templateId: '21cfr820/user-needs',
    content: '---\nid: DOC-UN-001\ntitle: User Needs\n---\n\n# User Needs\n\nBody text.\n',
    createdAt: 1700000000000,
    authors: 'Jane Smith | Lead Engineer',
    approvers: '',
    ...over,
});

describe('DHF doc persistence', () => {
    it('round-trips a document through save and load', () => {
        saveDhfDoc(root, doc());
        const loaded = loadDhfDocs(root);
        expect(loaded).toHaveLength(1);
        expect(loaded[0].id).toBe('DOC-UN-001');
        expect(loaded[0].title).toBe('User Needs');
        expect(loaded[0].group).toBe('Requirements');
        expect(loaded[0].templateId).toBe('21cfr820/user-needs');
        expect(loaded[0].createdAt).toBe(1700000000000);
        expect(loaded[0].authors).toBe('Jane Smith | Lead Engineer');
        expect(loaded[0].content).toContain('# User Needs');
        expect(loaded[0].content).toContain('Body text.');
    });

    it('writes one markdown file per document under dhf/documents', () => {
        saveDhfDoc(root, doc());
        expect(existsSync(join(root, 'dhf', 'documents', 'DOC-UN-001.md'))).toBe(true);
    });

    it('preserves user-added frontmatter keys on save', () => {
        saveDhfDoc(root, doc({
            content: '---\nid: DOC-UN-001\nstatus: draft\ncustom_field: keep-me\n---\n\nBody\n',
        }));
        const raw = readFileSync(join(root, 'dhf', 'documents', 'DOC-UN-001.md'), 'utf8');
        expect(raw).toContain('custom_field: keep-me');
        expect(raw).toContain('status: draft');
        expect(raw).toContain('group: Requirements');
    });

    it('deletes a document file', () => {
        saveDhfDoc(root, doc());
        expect(deleteDhfDoc(root, 'DOC-UN-001')).toBe(true);
        expect(loadDhfDocs(root)).toHaveLength(0);
        expect(deleteDhfDoc(root, 'DOC-UN-001')).toBe(false);
    });

    it('returns empty list when dhf/documents does not exist', () => {
        expect(loadDhfDocs(root)).toEqual([]);
    });
});

describe('DHF settings persistence', () => {
    it('round-trips settings', () => {
        expect(loadDhfSettings(root)).toBeNull();
        saveDhfSettings(root, { company: 'Acme Medical', product: 'GPCA Pump' });
        expect(loadDhfSettings(root)).toEqual({ company: 'Acme Medical', product: 'GPCA Pump' });
    });
});

describe('repo template listing', () => {
    it('lists markdown files with titles, skipping documents/exports and node_modules', () => {
        mkdirSync(join(root, 'templates'), { recursive: true });
        mkdirSync(join(root, 'dhf', 'documents'), { recursive: true });
        mkdirSync(join(root, 'node_modules', 'pkg'), { recursive: true });
        writeFileSync(join(root, 'templates', 'custom.md'), '---\ntitle: My Custom Template\n---\n\n# Ignored\n');
        writeFileSync(join(root, 'templates', 'untitled.md'), 'no frontmatter\n\n# Heading Title\n');
        writeFileSync(join(root, 'dhf', 'documents', 'DOC-X.md'), '# existing doc\n');
        writeFileSync(join(root, 'node_modules', 'pkg', 'README.md'), '# dep readme\n');

        const templates = listRepoTemplates(root);
        const paths = templates.map(t => t.path);
        expect(paths).toContain('templates/custom.md');
        expect(paths).toContain('templates/untitled.md');
        expect(paths).not.toContain('dhf/documents/DOC-X.md');
        expect(paths.some(p => p.includes('node_modules'))).toBe(false);
        expect(templates.find(t => t.path === 'templates/custom.md')!.title).toBe('My Custom Template');
        expect(templates.find(t => t.path === 'templates/untitled.md')!.title).toBe('Heading Title');
    });

    it('reads a project-local template and rejects path escapes', () => {
        writeFileSync(join(root, 'tpl.md'), '# T\n');
        expect(readRepoTemplate(root, 'tpl.md')).toBe('# T\n');
        expect(() => readRepoTemplate(root, '../outside.md')).toThrow();
        expect(() => readRepoTemplate(root, 'missing.md')).toThrow();
    });
});
