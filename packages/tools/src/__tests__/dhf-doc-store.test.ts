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
    listRepoTemplates, readRepoTemplate, saveRepoTemplate,
} from '../server/dhf-doc-store.js';
import type { DhfDocDTO } from '@memoarchitect/tools';

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

describe('the system a document belongs to', () => {
    it('round-trips the system through the frontmatter', () => {
        saveDhfDoc(root, doc({ systemId: 'gpcaPump' }));
        expect(readFileSync(join(root, 'dhf', 'documents', 'DOC-UN-001.md'), 'utf8')).toContain('system: gpcaPump');
        expect(loadDhfDocs(root)[0].systemId).toBe('gpcaPump');
    });

    it('writes no system key for a project-wide document', () => {
        saveDhfDoc(root, doc());
        expect(readFileSync(join(root, 'dhf', 'documents', 'DOC-UN-001.md'), 'utf8')).not.toContain('system:');
        expect(loadDhfDocs(root)[0].systemId).toBeUndefined();
    });

    it('drops a system it no longer belongs to instead of leaving the old one', () => {
        saveDhfDoc(root, doc({ systemId: 'gpcaPump' }));
        const saved = loadDhfDocs(root)[0];
        saveDhfDoc(root, { ...saved, systemId: undefined });
        expect(loadDhfDocs(root)[0].systemId).toBeUndefined();
    });

    it('treats a blank system in a hand-edited file as project-wide', () => {
        mkdirSync(join(root, 'dhf', 'documents'), { recursive: true });
        writeFileSync(join(root, 'dhf', 'documents', 'DOC-A.md'), '---\nid: DOC-A\nsystem: "   "\n---\n\n# A\n');
        expect(loadDhfDocs(root)[0].systemId).toBeUndefined();
    });
});

describe('project template library', () => {
    it('lists only markdown files under dhf/templates', () => {
        mkdirSync(join(root, 'dhf', 'templates'), { recursive: true });
        mkdirSync(join(root, 'notes'), { recursive: true });
        mkdirSync(join(root, 'dhf', 'documents'), { recursive: true });
        writeFileSync(join(root, 'dhf', 'templates', 'custom.md'), '---\ntitle: My Custom Template\n---\n\n# Ignored\n');
        writeFileSync(join(root, 'dhf', 'templates', 'untitled.md'), 'no frontmatter\n\n# Heading Title\n');
        writeFileSync(join(root, 'notes', 'garbage.md'), '# Not a template\n');
        writeFileSync(join(root, 'dhf', 'documents', 'DOC-X.md'), '# existing doc\n');

        const templates = listRepoTemplates(root);
        const paths = templates.map(t => t.path);
        expect(paths).toContain('dhf/templates/custom.md');
        expect(paths).toContain('dhf/templates/untitled.md');
        expect(paths).not.toContain('notes/garbage.md');
        expect(paths).not.toContain('dhf/documents/DOC-X.md');
        expect(templates.find(t => t.path === 'dhf/templates/custom.md')!.title).toBe('My Custom Template');
        expect(templates.find(t => t.path === 'dhf/templates/untitled.md')!.title).toBe('Heading Title');
    });

    it('reads a project-local template and rejects path escapes', () => {
        mkdirSync(join(root, 'dhf', 'templates'), { recursive: true });
        writeFileSync(join(root, 'dhf', 'templates', 'tpl.md'), '# T\n');
        expect(readRepoTemplate(root, 'dhf/templates/tpl.md')).toBe('# T\n');
        expect(() => readRepoTemplate(root, '../outside.md')).toThrow();
        expect(() => readRepoTemplate(root, 'missing.md')).toThrow();
    });

    it('adds a reusable template with a safe unique filename', () => {
        const first = saveRepoTemplate(root, 'Risk Review', '# Risk Review\n\nSections');
        const second = saveRepoTemplate(root, 'Risk Review', '# Another');
        expect(first).toBe('dhf/templates/risk-review.md');
        expect(second).toBe('dhf/templates/risk-review-2.md');
        expect(readFileSync(join(root, first), 'utf8')).toContain('title: Risk Review');
        expect(listRepoTemplates(root).map(t => t.path).sort()).toEqual([first, second].sort());
    });
});
