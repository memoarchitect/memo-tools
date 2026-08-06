// ─── DHF Template Lint ────────────────────────────────────────────────────────
//
// Checks every DHF markdown template against the ontology it claims to query.
//
// The failure mode this exists for: a template is prose with fenced query
// blocks, and nothing ever type-checked those blocks. A `kind:` naming a
// definition that does not exist, a `layer ==` comparing against a layer id the
// ontology never had, a `columns:` listing attributes no kind declares — each
// renders as a plausible, empty, or dash-filled table in a regulated document.
// None of them fail a build. This turns all of them into errors.
//
// Two modes:
//   structural  — frontmatter, query executability, includes. No model needed.
//   ontology    — kind / layer / column resolution. Needs a resolved ontology.
//
// Structural checks always run, so the lint is useful in a bare checkout.
// ──────────────────────────────────────────────────────────────────────────────

import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { parseFrontmatter, findVendorTemplatesDir, listBuiltinTemplates } from './template-resolver.js';
import { parseMemoQuery, validateQuerySpec, parseWhereClause, type MemoQuerySpec } from './query-executor.js';
import type { KindRegistry } from '../model/kind-registry.js';

export type LintSeverity = 'error' | 'warning';

export interface LintFinding {
    severity: LintSeverity;
    /** Template id, e.g. "iso-14971/fmea" */
    template: string;
    /** Source file path */
    file: string;
    /** 1-based query block index within the template, when the finding is in one */
    block?: number;
    /** Short machine-readable rule id */
    rule: string;
    message: string;
}

export interface LintOptions {
    /** Resolved ontology kinds. Omit to run structural checks only. */
    kindRegistry?: KindRegistry;
    /** Layer ids the ontology actually defines. Omit to skip layer checks. */
    knownLayers?: Set<string>;
    /** Restrict to templates whose id starts with this prefix. */
    filter?: string;
}

export interface LintReport {
    findings: LintFinding[];
    templatesChecked: number;
    ontologyAware: boolean;
}

// Frontmatter every template must carry. `clauses` is what a standards
// traceability matrix consumes, so a template without it is invisible to
// clause coverage — that is why it is an error and not a nicety.
const REQUIRED_FRONTMATTER = ['id', 'title', 'standard', 'clauses', 'required_for'] as const;

/** Fields `getField()` resolves without consulting an element's attribute map. */
const BUILT_IN_FIELDS = new Set(['name', 'id', 'kind', 'layer', 'doc', 'description']);

const QUERY_BLOCK_RE = /```memo-query\r?\n([\s\S]*?)```/g;
const INCLUDE_RE = /\{\{include:([^}]+)\}\}/g;

// ─── Attribute discovery ──────────────────────────────────────────────────────

/**
 * Attribute names a kind declares, following its supertype chain.
 *
 * Read from the ontology source rather than a table in this file: the registry
 * records each kind's `sourceFile` and `superType`, so the declaration itself
 * stays the single source of truth. A hardcoded list here would be exactly the
 * duplicate registry this work is trying to remove.
 */
function attributesForKind(kind: string, registry: KindRegistry, seen = new Set<string>()): Set<string> {
    const found = new Set<string>();
    if (seen.has(kind)) return found;
    seen.add(kind);

    const entry = registry.entries().find(e => e.name === kind);
    if (!entry?.sourceFile || !existsSync(entry.sourceFile)) return found;

    let source: string;
    try {
        source = readFileSync(entry.sourceFile, 'utf-8');
    } catch {
        return found;
    }

    // Isolate the definition body, then take its `attribute <name>` declarations.
    const defRe = new RegExp(`def\\s+${kind}\\b[^{]*\\{`);
    const start = source.search(defRe);
    if (start !== -1) {
        let depth = 0;
        let end = start;
        for (let i = source.indexOf('{', start); i < source.length; i++) {
            if (source[i] === '{') depth++;
            else if (source[i] === '}') { depth--; if (depth === 0) { end = i; break; } }
        }
        const body = source.slice(start, end);
        for (const m of body.matchAll(/^\s*attribute\s+(?:redefines\s+)?(\w+)/gm)) {
            found.add(m[1]);
        }
    }

    if (entry.superType) {
        for (const inherited of attributesForKind(entry.superType, registry, seen)) found.add(inherited);
    }
    return found;
}

// ─── Checks ───────────────────────────────────────────────────────────────────

function lintFrontmatter(
    templateId: string,
    file: string,
    frontmatter: Record<string, unknown>,
    findings: LintFinding[],
): void {
    for (const key of REQUIRED_FRONTMATTER) {
        const value = frontmatter[key];
        const missing = value === undefined || value === null
            || (typeof value === 'string' && value.trim() === '')
            || (Array.isArray(value) && value.length === 0);
        if (missing) {
            findings.push({
                severity: 'error', template: templateId, file, rule: 'frontmatter-required',
                message: `missing frontmatter \`${key}:\``,
            });
        }
    }

    const standard = frontmatter.standard;
    if (typeof standard === 'string' && standard.includes('/')) {
        findings.push({
            severity: 'error', template: templateId, file, rule: 'frontmatter-one-standard',
            message: `\`standard: ${standard}\` names more than one standard — use a single designation and put the others in \`clauses:\``,
        });
    }
}

function lintQueryBlock(
    templateId: string,
    file: string,
    block: number,
    spec: MemoQuerySpec,
    options: LintOptions,
    findings: LintFinding[],
): void {
    const add = (severity: LintSeverity, rule: string, message: string) =>
        findings.push({ severity, template: templateId, file, block, rule, message });

    // 1. Executable as written (where/sort/columns shape/display/traverse/typos)
    for (const problem of validateQuerySpec(spec)) {
        add('error', 'query-unexecutable', problem);
    }

    // 2. Compliance content must never be selected by matching text.
    //    A document whose contents depend on whether an engineer typed "emc"
    //    into a name is a search result, not a traceable artifact.
    if (typeof spec.where === 'string') {
        const clause = parseWhereClause(spec.where);
        if (clause?.op === 'contains' && (clause.field === 'name' || clause.field === 'doc' || clause.field === 'description')) {
            add('error', 'no-text-matching',
                `\`where: ${spec.where}\` selects by text — filter on \`layer\`, on \`kind:\`, or by traversing a relationship instead`);
        }
    }

    const kinds = spec.kind === undefined ? [] : (Array.isArray(spec.kind) ? spec.kind : [spec.kind]);

    // 3. Ontology-aware checks
    const registry = options.kindRegistry;
    if (registry) {
        const entries = registry.entries();
        for (const kind of kinds) {
            const entry = entries.find(e => e.name === kind);
            if (!entry) {
                add('error', 'unknown-kind', `\`kind: ${kind}\` is not a definition in the ontology`);
            } else if (entry.isAbstract) {
                add('warning', 'abstract-kind',
                    `\`kind: ${kind}\` is abstract, so no project can instantiate it — this query can only ever be empty`);
            }
        }

        // Columns must resolve, or every row renders "—" with no indication why.
        if (kinds.length > 0) {
            const declared = new Set<string>();
            for (const kind of kinds) for (const attr of attributesForKind(kind, registry)) declared.add(attr);
            for (const col of resolveColumnList(spec)) {
                if (col.includes('.') || /\s+as\s+/i.test(col)) continue; // already reported by validateQuerySpec
                if (!BUILT_IN_FIELDS.has(col) && !declared.has(col)) {
                    add('error', 'unknown-column',
                        `column \`${col}\` is not an attribute of ${kinds.join('/')} — it will render as "—" for every row`);
                }
            }
        }
    }

    // 4. Layer values must exist, or the query is silently empty forever.
    if (options.knownLayers && typeof spec.where === 'string') {
        const clause = parseWhereClause(spec.where);
        if (clause && clause.field === 'layer' && (clause.op === '==' || clause.op === '!=') && !options.knownLayers.has(clause.value)) {
            add('error', 'unknown-layer',
                `\`${clause.value}\` is not a layer in this ontology (have: ${[...options.knownLayers].sort().join(', ')})`);
        }
    }
}

function resolveColumnList(spec: MemoQuerySpec): string[] {
    if (!spec.columns) return [];
    return Array.isArray(spec.columns) ? spec.columns : spec.columns.split(',').map(c => c.trim()).filter(Boolean);
}

function lintIncludes(
    templateId: string,
    file: string,
    body: string,
    templatesDir: string,
    findings: LintFinding[],
): void {
    for (const m of body.matchAll(INCLUDE_RE)) {
        const target = m[1].trim();
        const rel = target.endsWith('.md') ? target : `${target}.md`;
        const candidates = [join(templatesDir, rel), join(dirname(file), rel)];
        if (!candidates.some(existsSync)) {
            findings.push({
                severity: 'error', template: templateId, file, rule: 'unresolved-include',
                message: `\`{{include:${target}}}\` does not resolve`,
            });
        }
    }
}

// ─── Entry points ─────────────────────────────────────────────────────────────

/**
 * Lint one template's raw content.
 *
 * Separate from `lintTemplates` so the rules can be exercised against fixture
 * strings rather than only against whatever happens to be on disk.
 */
export function lintTemplateContent(
    templateId: string,
    file: string,
    raw: string,
    options: LintOptions = {},
    templatesDir?: string,
): LintFinding[] {
    const findings: LintFinding[] = [];
    const { frontmatter, body } = parseFrontmatter(raw);

    // Snippets under shared/ are fragments, not documents: they carry no
    // frontmatter by design and are linted only for their query blocks.
    if (!templateId.startsWith('shared/')) {
        lintFrontmatter(templateId, file, frontmatter as Record<string, unknown>, findings);
    }

    let block = 0;
    for (const m of body.matchAll(QUERY_BLOCK_RE)) {
        block++;
        const spec = parseMemoQuery(m[1]);
        if (!spec) {
            findings.push({
                severity: 'error', template: templateId, file, block,
                rule: 'query-invalid-yaml', message: 'memo-query block is not valid YAML',
            });
            continue;
        }
        lintQueryBlock(templateId, file, block, spec, options, findings);
    }

    if (templatesDir) lintIncludes(templateId, file, body, templatesDir, findings);

    return findings;
}

export function lintTemplates(options: LintOptions = {}): LintReport {
    const findings: LintFinding[] = [];
    const templatesDir = findVendorTemplatesDir();
    if (!templatesDir) {
        return {
            findings: [{
                severity: 'error', template: '(none)', file: '(none)', rule: 'no-templates',
                message: 'could not locate the ontology DHF template directory',
            }],
            templatesChecked: 0,
            ontologyAware: false,
        };
    }

    let templates = listBuiltinTemplates();
    if (options.filter) templates = templates.filter(t => t.id.startsWith(options.filter!));

    for (const tpl of templates) {
        let raw: string;
        try {
            raw = readFileSync(tpl.path, 'utf-8');
        } catch {
            findings.push({
                severity: 'error', template: tpl.id, file: tpl.path, rule: 'unreadable',
                message: 'could not read template',
            });
            continue;
        }

        findings.push(...lintTemplateContent(tpl.id, tpl.path, raw, options, templatesDir));
    }

    return {
        findings,
        templatesChecked: templates.length,
        ontologyAware: Boolean(options.kindRegistry),
    };
}
