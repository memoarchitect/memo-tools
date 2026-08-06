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
import {
    parseMemoQuery, validateQuerySpec, parseWhereClause, unqualifyEnum,
    htmlCommentRanges, isCommentedOut, type MemoQuerySpec,
} from './query-executor.js';
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

/** The `{ … }` body of `<something> def <name>` in an ontology source, or ''. */
function definitionBody(name: string, registry: KindRegistry): string {
    const entry = registry.entries().find(e => e.name === name);
    if (!entry?.sourceFile || !existsSync(entry.sourceFile)) return '';

    let source: string;
    try {
        source = readFileSync(entry.sourceFile, 'utf-8');
    } catch {
        return '';
    }

    const start = source.search(new RegExp(`def\\s+${name}\\b[^{]*\\{`));
    if (start === -1) return '';

    let depth = 0;
    for (let i = source.indexOf('{', start); i < source.length; i++) {
        if (source[i] === '{') depth++;
        else if (source[i] === '}') { depth--; if (depth === 0) return source.slice(start, i); }
    }
    return '';
}

/**
 * Attributes a kind declares, as name → declared type, following its supertype
 * chain. The type is `undefined` when the declaration does not name one.
 *
 * Read from the ontology source rather than a table in this file: the registry
 * records each kind's `sourceFile` and `superType`, so the declaration itself
 * stays the single source of truth. A hardcoded list here would be exactly the
 * duplicate registry this work is trying to remove.
 */
function attributesForKind(
    kind: string,
    registry: KindRegistry,
    seen = new Set<string>(),
): Map<string, string | undefined> {
    const found = new Map<string, string | undefined>();
    if (seen.has(kind)) return found;
    seen.add(kind);

    // `attribute [redefines|:>>] name [: Type]`
    for (const m of definitionBody(kind, registry).matchAll(
        /^\s*attribute\s+(?:redefines\s+|:>>\s*)?(\w+)\s*(?::\s*([\w:]+))?/gm,
    )) {
        found.set(m[1], m[2]);
    }

    const entry = registry.entries().find(e => e.name === kind);
    if (entry?.superType) {
        for (const [name, type] of attributesForKind(entry.superType, registry, seen)) {
            if (!found.has(name)) found.set(name, type);
        }
    }
    return found;
}

/**
 * The members an `enum def` declares, or null when `name` is not an enum in this
 * ontology. Null and empty are different answers: an unparseable enum must not
 * be read as "this enum has no valid values" and reject every query.
 */
function enumMembers(name: string, registry: KindRegistry): Set<string> | null {
    const entry = registry.entries().find(e => e.name === name);
    if (!entry || entry.sysmlConstruct !== 'enum def') return null;

    // Not anchored to line start: SysML allows `enum def K { enum a; enum b; }`
    // on one line, and an enum whose members the lint cannot see reads as
    // "no valid values" and would reject every query against it.
    const members = new Set<string>();
    for (const m of definitionBody(name, registry).matchAll(/\benum\s+(\w+)\s*;/g)) {
        members.add(m[1]);
    }
    return members.size > 0 ? members : null;
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

    // Two designations joined by a slash ("IEC 60601 / IEC 62304") is the
    // defect: a document claims one standard, and the others belong in
    // `clauses:`. A slash *inside* one designation is not — "ISO/IEC/IEEE
    // 42010:2022" is a single standard from a joint committee, and
    // "IEC 62304:2006+AMD1:2015" has none at all. The separator is the space
    // around the slash, which is what distinguishes the two.
    const standard = frontmatter.standard;
    if (typeof standard === 'string' && /\s\/|\/\s/.test(standard)) {
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
        //
        // Only when the rows are of `kind:`. With `traverse:`, `kind:` names the
        // *seeds* and the rows are whatever the relationship lands on, whose
        // kind is a fact about the project's model rather than the template —
        // checking columns against the seeds would reject every correct
        // traversal query.
        if (kinds.length > 0 && spec.traverse === undefined) {
            const declared = new Set<string>();
            for (const kind of kinds) for (const attr of attributesForKind(kind, registry).keys()) declared.add(attr);
            for (const col of resolveColumnList(spec)) {
                if (col.includes('.') || /\s+as\s+/i.test(col)) continue; // already reported by validateQuerySpec
                if (!BUILT_IN_FIELDS.has(col) && !declared.has(col)) {
                    add('error', 'unknown-column',
                        `column \`${col}\` is not an attribute of ${kinds.join('/')} — it will render as "—" for every row`);
                }
            }
        }

        // Comparing an enum attribute against a value the enum does not declare
        // matches nothing and renders the `empty:` message — a section that
        // silently vanishes from a regulated document. `layer` has its own rule
        // below for the same reason; this is that rule generalised to every
        // enum the ontology defines.
        if (kinds.length > 0 && typeof spec.where === 'string') {
            const clause = parseWhereClause(spec.where);
            if (clause && clause.field !== 'layer') {
                for (const kind of kinds) {
                    const declaredType = attributesForKind(kind, registry).get(clause.field);
                    if (!declaredType) continue;
                    const members = enumMembers(declaredType, registry);
                    if (!members) continue;

                    const wanted = unqualifyEnum(clause.value);
                    const matches = clause.op === 'contains'
                        ? [...members].some(m => m.toLowerCase().includes(wanted.toLowerCase()))
                        : members.has(wanted);
                    if (!matches) {
                        add('error', 'unknown-enum-value',
                            `\`${clause.value}\` is not a value of ${declaredType} (have: ${[...members].sort().join(', ')})`);
                    }
                    break; // one report per clause, not one per kind
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

    // Snippets are fragments, not documents: they carry no frontmatter by
    // design and are linted only for their query blocks. They are ids'd from
    // their own directory name, so `shared/snippets/approval-block.md` lists as
    // `snippets/approval-block` — matching only `shared/` reported all four
    // snippets as missing every required frontmatter key.
    if (!templateId.startsWith('shared/') && !templateId.startsWith('snippets/')) {
        lintFrontmatter(templateId, file, frontmatter as Record<string, unknown>, findings);
    }

    // A block parked inside an HTML comment renders nothing, so it is not a
    // finding — the executor skips it for the same reason.
    const commented = htmlCommentRanges(body);

    let block = 0;
    for (const m of body.matchAll(QUERY_BLOCK_RE)) {
        if (isCommentedOut(commented, m.index!)) continue;
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
