// ─── DHF Template Resolver Tests ─────────────────────────────────────────────
//
// Templates live in the installed @memoarchitect/ontology package;
// the resolver must find them through npm resolution and still honor an explicit
// custom template directory first.
// ─────────────────────────────────────────────────────────────────────────────

import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
    loadTemplate, resolveTemplatePath, listBuiltinTemplates,
    findVendorTemplatesDir, resetVendorTemplatesDirCache,
} from '../dhf/template-resolver.js';

beforeEach(() => resetVendorTemplatesDirCache());

describe('vendor template resolution', () => {
    it('finds the ontology dhf-templates directory', () => {
        const dir = findVendorTemplatesDir();
        expect(dir).toBeTruthy();
        expect(dir).toMatch(/src[/\\]compliance[/\\]dhf-templates$/);
    });

    it('loads a template by standard-prefixed id', () => {
        const tpl = loadTemplate('iso-14971/rmp');
        expect(tpl).toBeTruthy();
        expect(tpl!.frontmatter.title).toBe('Risk Management Plan');
        expect(tpl!.sourcePath).toContain('dhf-templates/iso-14971/rmp.md');
    });

    it('resolves shared snippets used by {{include}}', () => {
        expect(resolveTemplatePath('shared/snippets/approval-block.md')).toBeTruthy();
    });

    it('lists the ontology template catalog', () => {
        const all = listBuiltinTemplates();
        expect(all.length).toBeGreaterThan(30);
    });

    it('prefers an explicit custom template directory', () => {
        const custom = mkdtempSync(join(tmpdir(), 'memo-tpl-'));
        writeFileSync(join(custom, 'rmp.md'), '---\ntitle: Custom RMP\n---\n\n# Custom\n');
        const tpl = loadTemplate('rmp', custom);
        expect(tpl!.frontmatter.title).toBe('Custom RMP');
    });
});
