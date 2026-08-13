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
    htmlCommentRanges, isCommentedOut, selectsRelationships, kindList,
    endpointOf, RELATIONSHIP_FIELDS, type MemoQuerySpec,
} from './query-executor.js';
import { parseMemoStandards, validateStandardsSpec } from './standards-block.js';
import type { KindRegistry } from '../model/kind-registry.js';
import type { RelationshipRegistry } from '../model/relationship-registry.js';
import { toModelType } from '../model/naming.js';

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
    /**
     * Resolved ontology relationship types. Omit to skip the checks that only
     * apply to `select: relationships` blocks.
     */
    relationshipRegistry?: RelationshipRegistry;
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
const STANDARDS_BLOCK_RE = /```memo-standards\r?\n([\s\S]*?)```/g;
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
    //    into a name is a search result, not a traceable artifact. The rule is
    //    about the field, not where it sits: `target.name contains` on a
    //    relationship endpoint is the same defect one level out.
    if (typeof spec.where === 'string') {
        const clause = parseWhereClause(spec.where);
        const leaf = clause ? clause.field.split('.').pop()! : '';
        if (clause?.op === 'contains' && (leaf === 'name' || leaf === 'doc' || leaf === 'description')) {
            add('error', 'no-text-matching',
                `\`where: ${spec.where}\` selects by text — filter on \`layer\`, on \`kind:\`, or by traversing a relationship instead`);
        }
    }

    const kinds = kindList(spec);

    // 3. Relationship queries: `kind:` names a relationship type, not an
    //    element definition, so the element-shaped checks below do not apply.
    if (selectsRelationships(spec)) {
        lintRelationshipQuery(spec, kinds, options, add);
        return;
    }

    // 4. Ontology-aware checks
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

        // Two ways an enum comparison silently selects nothing, both of which
        // render the `empty:` message and read like a real answer:
        //
        //   unknown-enum-value      — a value the enum does not declare (a typo)
        //   unqualified-enum-value  — a real member written without its enum
        //
        // The second is a spelling rule, not a leniency the engine could absorb.
        // The model stores `RequirementKind::software`, so that is the value;
        // accepting the bare name too would mean two spellings for one thing,
        // and would cost the reader the only clue to which enum is meant —
        // `criticality == "high"` and `severity == "high"` are indistinguishable.
        //
        // `layer` has its own rule below for the same underlying reason.
        if (kinds.length > 0 && typeof spec.where === 'string') {
            const clause = parseWhereClause(spec.where);
            if (clause && clause.field !== 'layer') {
                for (const kind of kinds) {
                    const declaredType = attributesForKind(kind, registry).get(clause.field);
                    if (!declaredType) continue;
                    const members = enumMembers(declaredType, registry);
                    if (!members) continue;

                    const wanted = unqualifyEnum(clause.value);
                    const known = clause.op === 'contains'
                        ? [...members].some(m => m.toLowerCase().includes(wanted.toLowerCase()))
                        : members.has(wanted);

                    if (!known) {
                        add('error', 'unknown-enum-value',
                            `\`${clause.value}\` is not a value of ${declaredType} (have: ${[...members].sort().join(', ')})`);
                    } else if (clause.op !== 'contains' && !clause.value.includes('::')) {
                        add('error', 'unqualified-enum-value',
                            `\`${clause.field} ${clause.op} "${clause.value}"\` names a ${declaredType} member without its enum, `
                            + `and the model stores the qualified reference — write `
                            + `\`${clause.field} ${clause.op} "${declaredType}::${clause.value}"\``);
                    }
                    break; // one report per clause, not one per kind
                }
            }
        }
    }

    // 5. Layer values must exist, or the query is silently empty forever.
    if (options.knownLayers && typeof spec.where === 'string') {
        const clause = parseWhereClause(spec.where);
        if (clause && clause.field === 'layer' && (clause.op === '==' || clause.op === '!=') && !options.knownLayers.has(clause.value)) {
            add('error', 'unknown-layer',
                `\`${clause.value}\` is not a layer in this ontology (have: ${[...options.knownLayers].sort().join(', ')})`);
        }
    }
}

/**
 * Checks that only make sense once the rows are relationships.
 *
 * Two things are checkable here and one is not. The relationship *type* is
 * checkable: it is a `connection def` in the ontology, so a name no connection
 * def declares selects nothing forever. A flat *column* is checkable: a link
 * carries only its ends, its type and whatever the connection def declares, so
 * `doc` — which no relationship has — renders "—" in every row. What is not
 * checkable is a dotted path: `target.clauseNumber` resolves against whichever
 * elements a project happens to link, and that is a fact about the project, not
 * about the template. Reporting it would reject every correct query, exactly as
 * `unknown-column` did under `traverse:`.
 */
function lintRelationshipQuery(
    spec: MemoQuerySpec,
    types: string[],
    options: LintOptions,
    add: (severity: LintSeverity, rule: string, message: string) => void,
): void {
    const registry = options.relationshipRegistry;
    if (!registry) return;

    for (const type of types) {
        // PascalCase is already reported by validateQuerySpec with the fix.
        if (/^[A-Z]/.test(type)) continue;
        const entry = registry.getRelType(type);
        if (!entry) {
            add('error', 'unknown-relationship-type',
                `\`kind: ${type}\` is not a connection definition in the ontology`);
        } else if (entry.isAbstract) {
            add('warning', 'abstract-relationship-type',
                `\`kind: ${type}\` is abstract, so no project can instantiate it — this query can only ever be empty`);
        }
    }

    const declared = new Set<string>(RELATIONSHIP_FIELDS);
    for (const type of types) {
        for (const attr of relationshipAttributes(type, registry)) declared.add(attr);
    }

    // With no `kind:`, the rows are every link in the model and no connection
    // def's attributes are known, so only the built-in fields are checkable.
    for (const col of resolveColumnList(spec)) {
        if (endpointOf(col) || col.includes('.') || /\s+as\s+/i.test(col)) continue;
        if (!declared.has(col)) {
            add('error', 'unknown-column',
                `column \`${col}\` is not a field of ${types.length > 0 ? types.join('/') : 'a relationship'}`
                + ' — it will render as "—" for every row'
                + (BUILT_IN_FIELDS.has(col) ? `; \`${col}\` is an element field, so write \`source.${col}\` or \`target.${col}\`` : ''));
        }
    }
}

/** Attributes a relationship type declares, following its supertype chain. */
function relationshipAttributes(
    type: string,
    registry: RelationshipRegistry,
    seen = new Set<string>(),
): string[] {
    if (seen.has(type)) return [];
    seen.add(type);
    const entry = registry.getRelType(type);
    if (!entry) return [];
    const inherited = entry.superType
        ? relationshipAttributes(toModelType(entry.superType), registry, seen)
        : [];
    return [...(entry.attributes ?? []), ...inherited];
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

    // `memo-standards` blocks are linted for the same reason: a directive the
    // renderer does not understand must not be silently ignored. They resolve
    // nothing against the ontology — their vocabulary is fixed and their data
    // is the clause library — so this is a syntax check, not a model check.
    let standardsBlock = 0;
    for (const m of body.matchAll(STANDARDS_BLOCK_RE)) {
        if (isCommentedOut(commented, m.index!)) continue;
        standardsBlock++;
        const spec = parseMemoStandards(m[1]);
        if (!spec) {
            findings.push({
                severity: 'error', template: templateId, file, block: standardsBlock,
                rule: 'standards-invalid-yaml', message: 'memo-standards block is not valid YAML',
            });
            continue;
        }
        try {
            validateStandardsSpec(spec);
        } catch (error) {
            findings.push({
                severity: 'error', template: templateId, file, block: standardsBlock,
                rule: 'standards-directive',
                message: error instanceof Error ? error.message : String(error),
            });
        }
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
