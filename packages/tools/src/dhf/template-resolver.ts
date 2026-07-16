// ─── DHF Template Resolver ────────────────────────────────────────────────────
//
// Resolves DHF document templates from:
//   1. Custom template directory (memo.dhf.yaml → template_dir)
//   2. The ontology's templates (memo/src/compliance/dhf-templates/ — the
//      templates are compliance content and live in the ontology repo)
//
// The ontology templates directory is discovered by walking up from the
// working directory (a project inside the monorepo tree) and, failing that,
// relative to this package (engine checked out with its ontology submodule).
//
// Also handles {{include:path}} partial resolution and {{project.*}} expansion.
// ─────────────────────────────────────────────────────────────────────────────

import { readFileSync, existsSync } from 'node:fs';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { VENDOR_DHF_TEMPLATES_DIR } from '../model/paths.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

/** Locate the ontology's dhf-templates directory. Cached after first hit. */
let vendorTemplatesDir: string | null | undefined;
export function findVendorTemplatesDir(startDir: string = process.cwd()): string | null {
    if (vendorTemplatesDir !== undefined) return vendorTemplatesDir;

    // 1. Walk up from the working directory (covers projects anywhere in the tree)
    let dir = resolve(startDir);
    while (true) {
        const candidate = join(dir, VENDOR_DHF_TEMPLATES_DIR);
        if (existsSync(candidate)) { vendorTemplatesDir = candidate; return candidate; }
        const parent = dirname(dir);
        if (parent === dir) break;
        dir = parent;
    }

    // 2. Relative to this package: <repo>/packages/tools/{src|lib}/dhf → <repo>/memo/...
    const fromPackage = resolve(__dirname, '../../../..', VENDOR_DHF_TEMPLATES_DIR);
    if (existsSync(fromPackage)) { vendorTemplatesDir = fromPackage; return fromPackage; }

    vendorTemplatesDir = null;
    return null;
}

/** Test hook: reset the cached vendor templates directory */
export function resetVendorTemplatesDirCache(): void {
    vendorTemplatesDir = undefined;
}

export interface TemplateLoadResult {
    content: string;
    /** Absolute path the template was loaded from */
    sourcePath: string;
    /** Parsed frontmatter (id, title, standard, clauses, required_for) */
    frontmatter: TemplateFrontmatter;
    /** Body content (after frontmatter) */
    body: string;
}

export interface TemplateFrontmatter {
    id?: string;
    title?: string;
    standard?: string;
    clauses?: string[];
    required_for?: string[];
    [key: string]: unknown;
}

// ─── Frontmatter parser ───────────────────────────────────────────────────────

const FRONTMATTER_RE = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/;

import * as yaml from 'yaml';

export function parseFrontmatter(content: string): { frontmatter: TemplateFrontmatter; body: string } {
    const match = content.match(FRONTMATTER_RE);
    if (!match) return { frontmatter: {}, body: content };

    try {
        const frontmatter = yaml.parse(match[1]) as TemplateFrontmatter ?? {};
        return { frontmatter, body: match[2] ?? '' };
    } catch {
        return { frontmatter: {}, body: content };
    }
}

// ─── Resolve template paths ───────────────────────────────────────────────────

/**
 * Resolve the filesystem path for a template ID.
 * Searches:
 *   1. Custom template dir (if provided)
 *   2. Ontology templates (memo/src/compliance/dhf-templates)
 */
export function resolveTemplatePath(
    templateId: string,
    customTemplateDir?: string,
): string | null {
    const candidates = buildCandidatePaths(templateId, customTemplateDir);
    for (const p of candidates) {
        if (existsSync(p)) return p;
    }
    return null;
}

function buildCandidatePaths(templateId: string, customDir?: string): string[] {
    const paths: string[] = [];
    const variants = [
        templateId,
        `${templateId}.md`,
    ];

    if (customDir) {
        for (const v of variants) {
            paths.push(join(customDir, v));
        }
    }

    const vendorDir = findVendorTemplatesDir();
    if (vendorDir) {
        for (const v of variants) {
            paths.push(join(vendorDir, v));
            // Also try standard-prefixed paths
            for (const standard of ['iso-14971', 'iec-62304', 'iec-62366', '21cfr820', 'fda-cybersecurity', 'shared']) {
                paths.push(join(vendorDir, standard, v));
                paths.push(join(vendorDir, standard, 'snippets', v));
            }
        }
    }

    return paths;
}

// ─── Load a template ─────────────────────────────────────────────────────────

export function loadTemplate(
    templateId: string,
    customTemplateDir?: string,
): TemplateLoadResult | null {
    const path = resolveTemplatePath(templateId, customTemplateDir);
    if (!path) return null;

    try {
        const content = readFileSync(path, 'utf-8');
        const { frontmatter, body } = parseFrontmatter(content);
        return { content, sourcePath: path, frontmatter, body };
    } catch {
        return null;
    }
}

// ─── Resolve {{include:path}} partials ────────────────────────────────────────

const INCLUDE_RE = /\{\{include:([^}]+)\}\}/g;

export function resolveIncludes(
    content: string,
    baseDir: string,
    customTemplateDir?: string,
    depth = 0,
): string {
    if (depth > 5) return content; // Prevent infinite recursion

    return content.replace(INCLUDE_RE, (_match, includePath: string) => {
        const trimmed = includePath.trim();

        // Try relative to base dir first
        const relativePath = resolve(baseDir, trimmed);
        if (existsSync(relativePath)) {
            try {
                const included = readFileSync(relativePath, 'utf-8');
                const { body } = parseFrontmatter(included);
                return resolveIncludes(body, dirname(relativePath), customTemplateDir, depth + 1);
            } catch { /* fall through */ }
        }

        // Try as template ID
        const templatePath = resolveTemplatePath(trimmed, customTemplateDir);
        if (templatePath) {
            try {
                const included = readFileSync(templatePath, 'utf-8');
                const { body } = parseFrontmatter(included);
                return resolveIncludes(body, dirname(templatePath), customTemplateDir, depth + 1);
            } catch { /* fall through */ }
        }

        return `\n> ⚠️ Include not found: ${trimmed}\n`;
    });
}

// ─── Resolve {{project.*}} directives ─────────────────────────────────────────

export function resolveProjectDirectives(
    content: string,
    projectMeta: Record<string, unknown>,
): string {
    const PROJECT_RE = /\{\{project\.([^}]+)\}\}/g;
    return content.replace(PROJECT_RE, (_match, key: string) => {
        const value = getNestedValue(projectMeta, key.trim());
        return value !== undefined ? String(value) : `{{project.${key}}}`;
    });
}

function getNestedValue(obj: Record<string, unknown>, key: string): unknown {
    const parts = key.split('.');
    let current: unknown = obj;
    for (const part of parts) {
        if (current === null || current === undefined) return undefined;
        current = (current as Record<string, unknown>)[part];
    }
    return current;
}

// ─── List all available built-in templates ────────────────────────────────────

import { readdirSync } from 'node:fs';

export interface BuiltinTemplateInfo {
    id: string;
    path: string;
    standard: string;
    frontmatter: TemplateFrontmatter;
}

export function listBuiltinTemplates(): BuiltinTemplateInfo[] {
    const results: BuiltinTemplateInfo[] = [];

    function scan(dir: string, standard: string): void {
        try {
            for (const entry of readdirSync(dir, { withFileTypes: true })) {
                const full = join(dir, entry.name);
                if (entry.isDirectory()) {
                    scan(full, entry.name);
                } else if (entry.name.endsWith('.md') && !entry.name.startsWith('_')) {
                    const id = entry.name.replace(/\.md$/, '');
                    try {
                        const content = readFileSync(full, 'utf-8');
                        const { frontmatter } = parseFrontmatter(content);
                        results.push({ id: `${standard}/${id}`, path: full, standard, frontmatter });
                    } catch { /* skip */ }
                }
            }
        } catch { /* skip if dir doesn't exist */ }
    }

    const vendorDir = findVendorTemplatesDir();
    if (vendorDir) {
        scan(vendorDir, 'shared');
    }

    return results;
}
