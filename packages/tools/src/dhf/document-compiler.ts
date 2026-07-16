// ─── DHF Document Compiler ───────────────────────────────────────────────────
//
// Orchestrates the markdown-first DHF document compilation pipeline:
//
//   1. Load markdown template (built-in or custom)
//   2. Resolve {{include:path}} partials
//   3. Resolve {{project.*}} from DhfConfigV2
//   4. Resolve {{ref:ID.attr}} from model elements
//   5. Resolve {{diagram:id}} (SVG placeholder or embed)
//   6. Resolve {{toc}} / {{glossary}}
//   7. Execute ```memo-query``` blocks
//   8. Execute ```memo-script``` blocks
//   9. Return resolved markdown (+ export pipeline produces DOCX/PDF/HTML/MD)
//
// The existing snapshot/diff system operates on the resolved markdown files.
// The existing LLM draft engine produces markdown with directives.
// ─────────────────────────────────────────────────────────────────────────────

import { writeFileSync, mkdirSync, existsSync, readFileSync } from 'node:fs';
import { resolve, join, dirname } from 'node:path';
import type { QueryContext } from './query-engine.js';
import { parseDirectives, applyDirectives } from './directive-parser.js';
import { processMemoQueryBlocks } from './query-executor.js';
import { processMemoScriptBlocks } from './script-runner.js';
import { loadTemplate, resolveIncludes, resolveProjectDirectives, parseFrontmatter } from './template-resolver.js';
import { extractProjectMeta, type DhfConfigV2 } from './dhf-config-v2.js';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface CompileOptions {
    /** Template ID or path (relative to template_dir or built-in) */
    templateId: string;
    /** Query context for model access */
    ctx: QueryContext;
    /** DHF config V2 */
    config: DhfConfigV2;
    /** Custom template base directory (absolute) */
    customTemplateDir?: string;
    /** Additional metadata injected into project scope */
    extraMeta?: Record<string, unknown>;
}

export interface CompileResult {
    /** Fully resolved markdown content */
    markdown: string;
    /** Extracted frontmatter from the template */
    frontmatter: Record<string, unknown>;
    /** Template ID used */
    templateId: string;
    /** Resolved title (frontmatter.title or templateId) */
    title: string;
    /** List of warnings accumulated during compilation */
    warnings: string[];
}

// ─── TOC generator ───────────────────────────────────────────────────────────

function generateToc(markdown: string): string {
    const headingRe = /^(#{2,4})\s+(.+)$/gm;
    const items: string[] = [];
    let match: RegExpExecArray | null;

    while ((match = headingRe.exec(markdown)) !== null) {
        const level = match[1].length - 2; // ## = 0, ### = 1, #### = 2
        const title = match[2].trim();
        const anchor = title.toLowerCase().replace(/[^\w\s-]/g, '').replace(/\s+/g, '-');
        const indent = '  '.repeat(level);
        items.push(`${indent}- [${title}](#${anchor})`);
    }

    return items.length > 0 ? '\n## Table of Contents\n\n' + items.join('\n') + '\n' : '';
}

// ─── Glossary generator ──────────────────────────────────────────────────────

function generateGlossary(ctx: QueryContext): string {
    const elements = ctx.allElements();
    if (elements.length === 0) return '\n_No elements in model._\n';

    const byKind = new Map<string, typeof elements>();
    for (const el of elements) {
        if (!byKind.has(el.kind)) byKind.set(el.kind, []);
        byKind.get(el.kind)!.push(el);
    }

    const sorted = [...byKind.entries()].sort(([a], [b]) => a.localeCompare(b));
    const lines: string[] = ['\n## Glossary\n'];

    for (const [kind, els] of sorted) {
        lines.push(`\n### ${kind}\n`);
        for (const el of els.sort((a, b) => a.name.localeCompare(b.name))) {
            const doc = el.doc ? ` — ${el.doc}` : '';
            lines.push(`- **${el.name}** \`${el.id}\`${doc}`);
        }
    }

    return lines.join('\n');
}

// ─── Main compile function ────────────────────────────────────────────────────

/** Options for compiling raw markdown content (a workbench document) */
export interface CompileContentOptions {
    /** Markdown body — frontmatter, if any, is stripped */
    content: string;
    /** Base directory for relative {{include:...}} resolution */
    baseDir?: string;
    ctx: QueryContext;
    config: DhfConfigV2;
    customTemplateDir?: string;
    extraMeta?: Record<string, unknown>;
}

/**
 * Compile already-loaded markdown content (e.g. a workbench document from
 * dhf/documents/) through the same pipeline as template compilation:
 * includes → project directives → ref/diagram/toc/glossary → queries → scripts.
 */
export async function compileMarkdownContent(options: CompileContentOptions): Promise<{ markdown: string; warnings: string[] }> {
    const { content: rawContent, baseDir, ctx, config, customTemplateDir, extraMeta = {} } = options;
    const warnings: string[] = [];
    const body = rawContent.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '');
    const projectMeta = { ...extractProjectMeta(config), ...extraMeta };
    const markdown = runCompilePipeline(body, baseDir ?? process.cwd(), ctx, config, customTemplateDir, projectMeta, warnings);
    return { markdown, warnings };
}

export async function compileMarkdownDocument(options: CompileOptions): Promise<CompileResult> {
    const { templateId, ctx, config, customTemplateDir, extraMeta = {} } = options;
    const warnings: string[] = [];

    // 1. Load template
    const tpl = loadTemplate(templateId, customTemplateDir ?? config.template_dir);
    if (!tpl) {
        warnings.push(`Template not found: ${templateId}`);
        return {
            markdown: `# ${templateId}\n\n_Template not found: ${templateId}_\n`,
            frontmatter: {},
            templateId,
            title: templateId,
            warnings,
        };
    }

    const projectMeta = { ...extractProjectMeta(config), ...extraMeta };
    const content = runCompilePipeline(
        tpl.body, dirname(tpl.sourcePath), ctx, config, customTemplateDir, projectMeta, warnings,
    );

    const title = String(tpl.frontmatter.title ?? templateId);

    return {
        markdown: content,
        frontmatter: tpl.frontmatter,
        templateId,
        title,
        warnings,
    };
}

/** Steps 2–7 of the compile pipeline, shared by template and content compilation */
function runCompilePipeline(
    body: string,
    baseDir: string,
    ctx: QueryContext,
    config: DhfConfigV2,
    customTemplateDir: string | undefined,
    projectMeta: Record<string, unknown>,
    warnings: string[],
): string {
    // 2. Resolve {{include:path}} partials
    let content = resolveIncludes(
        body,
        baseDir,
        customTemplateDir ?? config.template_dir,
    );

    // 3. Resolve {{project.*}} directives
    content = resolveProjectDirectives(content, projectMeta);

    // 4. Resolve {{ref:ID.attr}}, {{diagram:id}}, {{toc}}, {{glossary}}
    content = applyDirectives(content, (directive) => {
        switch (directive.kind) {
            case 'ref': {
                if (!directive.elementId) return directive.raw;
                const el = ctx.element(directive.elementId);
                if (!el) {
                    warnings.push(`Element not found: ${directive.elementId}`);
                    return `_[ref: ${directive.elementId} not found]_`;
                }
                const attr = directive.attribute || 'name';
                if (attr === 'name') return el.name;
                if (attr === 'id') return el.id;
                if (attr === 'kind') return el.kind;
                if (attr === 'layer') return el.layer;
                if (attr === 'doc' || attr === 'description') return el.doc || '';
                return el.attributes?.[attr] ? String(el.attributes[attr]) : `_[${attr} not found]_`;
            }
            case 'project': {
                const val = getNestedValue(projectMeta, directive.projectKey ?? '');
                return val !== undefined ? String(val) : directive.raw;
            }
            case 'diagram': {
                const diagramId = directive.diagramId ?? '';
                return `\n\n> **[Diagram: ${diagramId}]** _(diagram embed — run \`memo dev\` to view)_\n\n`;
            }
            case 'toc': {
                // TOC is resolved after all other directives, so we use a placeholder
                return '{{__TOC_PLACEHOLDER__}}';
            }
            case 'glossary': {
                return generateGlossary(ctx);
            }
            default:
                return directive.raw;
        }
    });

    // 5. Execute memo-query blocks
    content = processMemoQueryBlocks(content, ctx);

    // 6. Execute memo-script blocks
    content = processMemoScriptBlocks(content, ctx, projectMeta);

    // 7. Replace TOC placeholder with actual TOC (after query/script blocks are rendered)
    const toc = generateToc(content);
    content = content.replace('{{__TOC_PLACEHOLDER__}}', toc);

    return content;
}

// ─── Batch compile ───────────────────────────────────────────────────────────

export interface BatchCompileOptions {
    templates: Array<{ id: string; outputPath?: string }>;
    ctx: QueryContext;
    config: DhfConfigV2;
    outputDir: string;
    customTemplateDir?: string;
}

export interface BatchCompileResult {
    results: Map<string, CompileResult>;
    failed: string[];
}

export async function batchCompileMarkdown(options: BatchCompileOptions): Promise<BatchCompileResult> {
    const { templates, ctx, config, outputDir, customTemplateDir } = options;

    if (!existsSync(outputDir)) mkdirSync(outputDir, { recursive: true });

    const results = new Map<string, CompileResult>();
    const failed: string[] = [];

    for (const tpl of templates) {
        try {
            const result = await compileMarkdownDocument({
                templateId: tpl.id,
                ctx,
                config,
                customTemplateDir,
            });
            results.set(tpl.id, result);

            if (tpl.outputPath) {
                const outputPath = resolve(outputDir, tpl.outputPath);
                mkdirSync(dirname(outputPath), { recursive: true });
                writeFileSync(outputPath, result.markdown, 'utf-8');
            }
        } catch (err) {
            failed.push(tpl.id);
        }
    }

    return { results, failed };
}

// ─── Utility ─────────────────────────────────────────────────────────────────

function getNestedValue(obj: Record<string, unknown>, key: string): unknown {
    const parts = key.split('.');
    let current: unknown = obj;
    for (const part of parts) {
        if (current === null || typeof current !== 'object') return undefined;
        current = (current as Record<string, unknown>)[part];
    }
    return current;
}

// ─── Load a raw DHF markdown file (for editing in the workbench) ─────────────

export function loadDhfMarkdownFile(filePath: string): {
    content: string;
    frontmatter: Record<string, unknown>;
    body: string;
} | null {
    try {
        if (!existsSync(filePath)) return null;
        const content = readFileSync(filePath, 'utf-8');
        const { frontmatter, body } = parseFrontmatter(content);
        return { content, frontmatter, body };
    } catch {
        return null;
    }
}
