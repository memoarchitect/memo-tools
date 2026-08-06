// ─── DHF Query Executor ───────────────────────────────────────────────────────
//
// Parses and executes `memo-query` fenced code blocks embedded in DHF markdown
// templates. Query syntax:
//
//   ```memo-query
//   kind: Hazard
//   where: layer == "risk"
//   traverse: outgoing mitigates
//   display: table
//   columns: name, layer, doc
//   sort: name
//   empty: "No hazards found."
//   group_by: layer
//   ```
//
// The block is replaced with rendered markdown (table / list / matrix / grouped).
// Reuses QueryContext from query-engine.ts so all model access is consistent.
// ─────────────────────────────────────────────────────────────────────────────

import type { QueryContext } from './query-engine.js';
import type { MemoElement } from '../model/semantic.js';
import * as yaml from 'yaml';

// ─── Query Block Schema ───────────────────────────────────────────────────────

export interface MemoQuerySpec {
    /** Element kind(s) to select — single string or array */
    kind?: string | string[];
    /** Filter expression: "field op value" (field, ==, !=, contains) */
    where?: string;
    /** Traverse relationships: "outgoing|incoming <relType>" */
    traverse?: string;
    /** Output display format */
    display?: 'table' | 'list' | 'matrix' | 'grouped' | 'count' | 'metric';
    /** Columns to include (for table/grouped) */
    columns?: string | string[];
    /** Sort field */
    sort?: string;
    /** Message when result is empty */
    empty?: string;
    /** Group by field (for grouped display) */
    group_by?: string;
    /** Max rows to show (default: unlimited) */
    limit?: number;
    /** For matrix: row kind and column kind */
    row_kind?: string;
    col_kind?: string;
    /** For metric: label + value field */
    label?: string;
    value?: string;
}

// ─── Parse a memo-query block ─────────────────────────────────────────────────

export function parseMemoQuery(blockContent: string): MemoQuerySpec | null {
    try {
        const parsed = yaml.parse(blockContent);
        if (typeof parsed !== 'object' || parsed === null) return null;
        return parsed as MemoQuerySpec;
    } catch {
        return null;
    }
}

// ─── Strict validation ────────────────────────────────────────────────────────
//
// A query directive this engine does not understand must never be ignored.
// `where:` used to fall through to `return elements` when no pattern matched,
// so a filter the parser could not read produced the FULL, unfiltered set —
// a compliance table that looks authoritative and is not. Everything below
// exists to turn that class of silence into an error.
//
// Validation is deliberately separate from execution so `memo dhf lint` can
// check a template without loading a model.
// ──────────────────────────────────────────────────────────────────────────────

/** A query directive that cannot be executed as written. */
export class MemoQueryError extends Error {
    constructor(message: string, readonly source?: string) {
        super(source ? `${source}: ${message}` : message);
        this.name = 'MemoQueryError';
    }
}

const KNOWN_KEYS = new Set([
    'kind', 'where', 'traverse', 'display', 'columns', 'sort', 'empty',
    'group_by', 'limit', 'row_kind', 'col_kind', 'label', 'value',
]);

const KNOWN_DISPLAYS = new Set(['table', 'list', 'matrix', 'grouped', 'count', 'metric']);

/** Comparison operators the filter engine can actually evaluate. */
export type WhereOperator = '==' | '!=' | 'contains';

export interface WhereClause {
    field: string;
    op: WhereOperator;
    value: string;
}

const WHERE_PATTERNS: Array<{ re: RegExp; op: WhereOperator }> = [
    { re: /^(\w+)\s*==\s*["']?([^"']*)["']?$/, op: '==' },
    { re: /^(\w+)\s*!=\s*["']?([^"']*)["']?$/, op: '!=' },
    { re: /^(\w+)\s+contains\s+["']?([^"']*)["']?$/i, op: 'contains' },
];

/**
 * Parse a `where:` expression, or return null if this engine cannot evaluate it.
 *
 * Only a single comparison is supported. Boolean composition, parenthesised
 * groups, dotted endpoint paths (`target.layer`) and `starts with` are all
 * unsupported — callers must treat null as an error, never as "no filter".
 */
export function parseWhereClause(where: string): WhereClause | null {
    const expr = where.trim();
    for (const { re, op } of WHERE_PATTERNS) {
        const m = expr.match(re);
        if (m) return { field: m[1], op, value: m[2] };
    }
    return null;
}

// ─── Enum-qualified values ────────────────────────────────────────────────────
//
// `builder.ts` stores an enum attribute as the reference the author wrote, so
// the model holds `"RequirementKind::software"` — while a template author
// writes `where: requirementKind == "software"`, which is the value as it
// appears in the ontology's `enum def`. Comparing the raw strings makes that
// query match nothing and render the `empty:` message: a section that silently
// disappears from a regulated document, which is the same class of failure the
// strict parser exists to stop, one layer further down.
//
// So `==` and `!=` compare on the unqualified member name whenever the query
// side is unqualified. A qualified query value still compares exactly, and an
// attribute that is not an enum has no `::` and is unaffected. Ambiguity across
// enums (`SeverityKind::high` vs `CriticalityKind::high`) cannot arise here:
// the comparison is scoped to one attribute, which has one type.
// ─────────────────────────────────────────────────────────────────────────────

/** The member name of an enum reference: `RequirementKind::software` → `software`. */
export function unqualifyEnum(value: string): string {
    const sep = value.lastIndexOf('::');
    return sep === -1 ? value : value.slice(sep + 2);
}

/** Equality between a stored attribute value and a `where:` value. */
export function valuesEqual(stored: string, queryValue: string): boolean {
    if (stored === queryValue) return true;
    // Only relax in the qualified→unqualified direction. A query that spells the
    // qualifier out is asking for that exact enum and should not match another.
    if (queryValue.includes('::')) return false;
    return unqualifyEnum(stored) === queryValue;
}

/** Explain why a `where:` expression is unsupported, for an actionable message. */
function diagnoseWhere(where: string): string {
    const expr = where.trim();
    if (/\b(and|or)\b/i.test(expr)) {
        return 'boolean composition (`and` / `or`) is not supported — use a single comparison, or narrow with `kind:`';
    }
    if (/\bstarts with\b|\bends with\b|\bmatches\b/i.test(expr)) {
        return 'only `==`, `!=` and `contains` are supported';
    }
    if (/^\w+\.\w+/.test(expr)) {
        return 'dotted endpoint paths (e.g. `target.layer`) are not supported — a query selects elements, not relationships';
    }
    return 'expected `field == value`, `field != value`, or `field contains value`';
}

/**
 * Validate a query spec against what the engine can execute.
 * Returns a list of human-readable problems; empty means executable.
 */
export function validateQuerySpec(spec: MemoQuerySpec): string[] {
    const problems: string[] = [];

    for (const key of Object.keys(spec)) {
        if (!KNOWN_KEYS.has(key)) {
            problems.push(`unknown directive \`${key}:\` (known: ${[...KNOWN_KEYS].sort().join(', ')})`);
        }
    }

    if (spec.where !== undefined) {
        if (typeof spec.where !== 'string') {
            problems.push('`where:` must be a string');
        } else if (!parseWhereClause(spec.where)) {
            problems.push(`cannot evaluate \`where: ${spec.where}\` — ${diagnoseWhere(spec.where)}`);
        }
    }

    if (spec.sort !== undefined) {
        if (typeof spec.sort !== 'string') {
            problems.push('`sort:` must be a string');
        } else if (/\s/.test(spec.sort.trim())) {
            problems.push(`cannot evaluate \`sort: ${spec.sort}\` — only a bare field name is supported (no \`asc\`/\`desc\`)`);
        }
    }

    for (const col of resolveColumns(spec)) {
        if (/\s+as\s+/i.test(col)) {
            problems.push(`column \`${col}\` uses an alias — \`as\` is not supported`);
        } else if (col.includes('.')) {
            problems.push(`column \`${col}\` uses a dotted path — a query selects elements, not relationships`);
        }
    }

    if (spec.display !== undefined && !KNOWN_DISPLAYS.has(spec.display)) {
        problems.push(`unknown \`display: ${spec.display}\` (known: ${[...KNOWN_DISPLAYS].sort().join(', ')})`);
    }

    if (spec.traverse !== undefined) {
        const parts = String(spec.traverse).trim().split(/\s+/);
        if (parts.length !== 2 || !['outgoing', 'incoming'].includes(parts[0])) {
            problems.push(`cannot evaluate \`traverse: ${spec.traverse}\` — expected \`outgoing <relType>\` or \`incoming <relType>\``);
        } else if (parts[1] !== '*' && /^[A-Z]/.test(parts[1])) {
            // Relationship types are stored lower-camel (`AllocatedTo` → `allocatedTo`)
            // and matched exactly, so a capitalised name silently matches nothing.
            problems.push(`\`traverse: ${spec.traverse}\` names a relationship type in PascalCase — use \`${parts[1].charAt(0).toLowerCase() + parts[1].slice(1)}\``);
        }
    }

    return problems;
}

// ─── Commented-out blocks ─────────────────────────────────────────────────────
//
// A template may park a query it cannot run yet inside an HTML comment, with a
// visible TODO beside it — the honest way to ship a section whose query shape
// the engine does not support yet. A commented block renders nothing, so it
// must neither be executed nor linted; otherwise "park it until the engine
// catches up" is not available and the alternative is a table that renders
// empty and reads like a clean audit.
// ─────────────────────────────────────────────────────────────────────────────

const HTML_COMMENT_RE = /<!--[\s\S]*?-->/g;

/** Character ranges of the HTML comments in `content`. */
export function htmlCommentRanges(content: string): Array<[number, number]> {
    const ranges: Array<[number, number]> = [];
    for (const m of content.matchAll(HTML_COMMENT_RE)) {
        ranges.push([m.index!, m.index! + m[0].length]);
    }
    return ranges;
}

export function isCommentedOut(ranges: Array<[number, number]>, offset: number): boolean {
    return ranges.some(([start, end]) => offset >= start && offset < end);
}

/** Throw if the spec cannot be executed as written. */
export function assertExecutable(spec: MemoQuerySpec, source?: string): void {
    const problems = validateQuerySpec(spec);
    if (problems.length > 0) {
        throw new MemoQueryError(problems.join('; '), source);
    }
}

// ─── Execute a query against the model context ────────────────────────────────

export function executeQuery(spec: MemoQuerySpec, ctx: QueryContext, source?: string): MemoElement[] {
    assertExecutable(spec, source);

    let elements: MemoElement[] = [];

    // 1. Select by kind(s)
    if (spec.kind) {
        const kinds = Array.isArray(spec.kind) ? spec.kind : [spec.kind];
        elements = ctx.elementsByKinds(kinds);
    } else {
        elements = ctx.allElements();
    }

    // 2. Apply where filter
    if (spec.where) {
        elements = applyFilter(elements, spec.where);
    }

    // 3. Traverse relationships
    if (spec.traverse && elements.length > 0) {
        elements = applyTraverse(elements, spec.traverse, ctx);
    }

    // 4. Sort
    if (spec.sort) {
        const field = spec.sort;
        elements = [...elements].sort((a, b) => {
            const av = getField(a, field) ?? '';
            const bv = getField(b, field) ?? '';
            return String(av).localeCompare(String(bv));
        });
    }

    // 5. Limit
    if (spec.limit && spec.limit > 0) {
        elements = elements.slice(0, spec.limit);
    }

    return elements;
}

function applyFilter(elements: MemoElement[], where: string): MemoElement[] {
    const clause = parseWhereClause(where);
    // Never fall through to the unfiltered set: a filter the engine cannot read
    // must fail, not quietly widen the result to everything.
    if (!clause) throw new MemoQueryError(`cannot evaluate \`where: ${where}\` — ${diagnoseWhere(where)}`);

    const { field, op, value } = clause;
    switch (op) {
        case '==':
            return elements.filter(el => valuesEqual(String(getField(el, field) ?? ''), value));
        case '!=':
            return elements.filter(el => !valuesEqual(String(getField(el, field) ?? ''), value));
        case 'contains': {
            const lv = value.toLowerCase();
            return elements.filter(el => String(getField(el, field) ?? '').toLowerCase().includes(lv));
        }
    }
}

function applyTraverse(
    seeds: MemoElement[],
    traverse: string,
    ctx: QueryContext,
): MemoElement[] {
    // "outgoing mitigates" | "incoming derivedFrom" | "outgoing *"
    const parts = traverse.trim().split(/\s+/);
    const direction = (parts[0] === 'incoming' ? 'incoming' : 'outgoing') as 'outgoing' | 'incoming';
    const relType = parts[1] || '*';

    const seen = new Set<string>();
    const result: MemoElement[] = [];

    for (const seed of seeds) {
        const rels = relType === '*'
            ? (direction === 'outgoing' ? ctx.outgoing(seed.id) : ctx.incoming(seed.id))
            : ctx.related(seed.id, relType, direction);

        for (const rel of rels) {
            const targetId = direction === 'outgoing' ? rel.targetId : rel.sourceId;
            const target = ctx.element(targetId);
            if (target && !seen.has(target.id)) {
                seen.add(target.id);
                result.push(target);
            }
        }
    }

    return result;
}

function getField(el: MemoElement, field: string): unknown {
    // Built-in fields
    if (field === 'name') return el.name;
    if (field === 'id') return el.id;
    if (field === 'kind') return el.kind;
    if (field === 'layer') return el.layer;
    if (field === 'doc' || field === 'description') return el.doc || '';
    // Try attributes map
    if (el.attributes) return el.attributes[field];
    return undefined;
}

// ─── Render query results as markdown ─────────────────────────────────────────

export function renderQueryResult(
    spec: MemoQuerySpec,
    elements: MemoElement[],
    ctx: QueryContext,
): string {
    if (elements.length === 0) {
        return spec.empty ? `\n_${spec.empty}_\n` : '\n_No results found._\n';
    }

    const display = spec.display || 'table';

    switch (display) {
        case 'table': return renderTable(spec, elements);
        case 'list': return renderList(spec, elements);
        case 'grouped': return renderGrouped(spec, elements);
        case 'matrix': return renderMatrix(spec, elements, ctx);
        case 'count': return `\n**${elements.length}** ${spec.kind || 'elements'}\n`;
        case 'metric': return renderMetric(spec, elements);
        default: return renderTable(spec, elements);
    }
}

function resolveColumns(spec: MemoQuerySpec): string[] {
    if (spec.columns) {
        if (Array.isArray(spec.columns)) return spec.columns;
        return spec.columns.split(',').map(c => c.trim());
    }
    return ['name', 'kind', 'layer', 'doc'];
}

function renderTable(spec: MemoQuerySpec, elements: MemoElement[]): string {
    const cols = resolveColumns(spec);
    const header = '| ' + cols.map(c => capitalize(c)).join(' | ') + ' |';
    const sep = '| ' + cols.map(() => '---').join(' | ') + ' |';
    const rows = elements.map(el => {
        const cells = cols.map(c => {
            const val = getField(el, c);
            return val ? String(val).replace(/\|/g, '\\|') : '—';
        });
        return '| ' + cells.join(' | ') + ' |';
    });
    return '\n' + [header, sep, ...rows].join('\n') + '\n';
}

function renderList(spec: MemoQuerySpec, elements: MemoElement[]): string {
    return '\n' + elements.map(el => `- **${el.name}** _(${el.kind})_ — ${el.doc || el.layer || ''}`).join('\n') + '\n';
}

function renderGrouped(spec: MemoQuerySpec, elements: MemoElement[]): string {
    const groupField = spec.group_by || 'layer';
    const groups = new Map<string, MemoElement[]>();

    for (const el of elements) {
        const key = String(getField(el, groupField) ?? 'Other');
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key)!.push(el);
    }

    const parts: string[] = [];
    for (const [key, els] of groups) {
        parts.push(`\n**${key}** (${els.length})\n`);
        parts.push(renderTable(spec, els));
    }
    return parts.join('');
}

function renderMatrix(spec: MemoQuerySpec, elements: MemoElement[], ctx: QueryContext): string {
    // Row/col breakdown by two fields
    const rowField = spec.row_kind || 'kind';
    const colField = spec.col_kind || 'layer';
    const rowVals = [...new Set(elements.map(el => String(getField(el, rowField) ?? '?')))].sort();
    const colVals = [...new Set(elements.map(el => String(getField(el, colField) ?? '?')))].sort();

    const header = '| | ' + colVals.join(' | ') + ' |';
    const sep = '| --- | ' + colVals.map(() => '---').join(' | ') + ' |';
    const rows = rowVals.map(rv => {
        const cells = colVals.map(cv => {
            const count = elements.filter(el =>
                String(getField(el, rowField) ?? '?') === rv &&
                String(getField(el, colField) ?? '?') === cv
            ).length;
            return count > 0 ? String(count) : '—';
        });
        return `| **${rv}** | ${cells.join(' | ')} |`;
    });
    return '\n' + [header, sep, ...rows].join('\n') + '\n';
}

function renderMetric(spec: MemoQuerySpec, elements: MemoElement[]): string {
    const label = spec.label || 'Count';
    const value = spec.value ? elements.reduce((sum, el) => {
        const v = Number(getField(el, spec.value!) ?? 0);
        return sum + (isNaN(v) ? 0 : v);
    }, 0) : elements.length;
    return `\n**${label}:** ${value}\n`;
}

function capitalize(s: string): string {
    return s.charAt(0).toUpperCase() + s.slice(1).replace(/_/g, ' ');
}

// ─── Process all memo-query blocks in a markdown string ───────────────────────

const QUERY_BLOCK_RE = /```memo-query\n([\s\S]*?)```/g;

export interface ProcessQueryOptions {
    /** Template id or path, used to make error messages locatable. */
    source?: string;
    /**
     * How to handle a block the engine cannot execute.
     * `throw` (default) fails the compile — correct for `memo dhf export`, where
     * a wrong table is worse than no document. `annotate` renders the error into
     * the output instead, for previews where partial output beats none.
     */
    onError?: 'throw' | 'annotate';
}

export function processMemoQueryBlocks(
    content: string,
    ctx: QueryContext,
    options: ProcessQueryOptions = {},
): string {
    const { source, onError = 'throw' } = options;
    const commented = htmlCommentRanges(content);
    let blockIndex = 0;

    return content.replace(QUERY_BLOCK_RE, (match, blockContent: string, offset: number) => {
        // Leave a parked block exactly as written — it is documentation of a
        // query the engine cannot run yet, not a query to run.
        if (isCommentedOut(commented, offset)) return match;
        blockIndex++;
        const where = source ? `${source} (memo-query block ${blockIndex})` : `memo-query block ${blockIndex}`;

        const spec = parseMemoQuery(blockContent);
        if (!spec) {
            if (onError === 'throw') throw new MemoQueryError('block is not valid YAML', where);
            return `\n> ⚠️ **${where}** — block is not valid YAML\n`;
        }

        try {
            const elements = executeQuery(spec, ctx, where);
            return renderQueryResult(spec, elements, ctx);
        } catch (error) {
            if (onError === 'throw') throw error;
            const message = error instanceof Error ? error.message : String(error);
            return `\n> ⚠️ **${message}**\n`;
        }
    });
}
