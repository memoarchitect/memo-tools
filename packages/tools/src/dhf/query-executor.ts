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
// A query selects elements by default. `select: relationships` selects links
// instead — the shape every clause-traceability and allocation table has, where
// a row is the edge and the columns come from both of its ends:
//
//   ```memo-query
//   select: relationships
//   kind: conformsTo
//   where: target.package == "memo_artifacts_standards_iec_62304"
//   columns: source, target.clauseNumber, target.title
//   ```
//
// The block is replaced with rendered markdown (table / list / matrix / grouped).
// Reuses QueryContext from query-engine.ts so all model access is consistent.
// ─────────────────────────────────────────────────────────────────────────────

import type { QueryContext } from './query-engine.js';
import type { MemoElement, MemoRelationship } from '../model/semantic.js';
import * as yaml from 'yaml';
import { toModelType } from '../model/naming.js';

// ─── Query Block Schema ───────────────────────────────────────────────────────

/** What a query selects. Relationship rows carry `source.*` / `target.*` paths. */
export type QuerySelect = 'elements' | 'relationships';

/** One row of a result set — an element, or a relationship under `select: relationships`. */
export type QueryRow = MemoElement | MemoRelationship;

export interface MemoQuerySpec {
    /**
     * What the rows are. `elements` (the default) selects model elements and
     * `kind:` names element definitions; `relationships` selects links and
     * `kind:` names relationship types.
     */
    select?: QuerySelect;
    /** Element kind(s) — or relationship type(s) under `select: relationships` */
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
    'select', 'kind', 'where', 'traverse', 'display', 'columns', 'sort', 'empty',
    'group_by', 'limit', 'row_kind', 'col_kind', 'label', 'value',
]);

const KNOWN_DISPLAYS = new Set(['table', 'list', 'matrix', 'grouped', 'count', 'metric']);

const KNOWN_SELECTS = new Set<QuerySelect>(['elements', 'relationships']);

/** True when this spec's rows are relationships rather than elements. */
export function selectsRelationships(spec: MemoQuerySpec): boolean {
    return spec.select === 'relationships';
}

/**
 * Fields a relationship row answers without consulting its attribute map.
 *
 * `source` and `target` are the endpoint *names*, which is what a table column
 * wants; `source.<field>` / `target.<field>` reach the endpoint element itself.
 */
export const RELATIONSHIP_FIELDS = new Set([
    'id', 'type', 'kind', 'source', 'target', 'sourceId', 'targetId',
    'sourceEnd', 'targetEnd', 'file', 'flowItem',
]);

/** The `source` / `target` prefix of a dotted path, or undefined if it has none. */
export function endpointOf(field: string): 'source' | 'target' | undefined {
    const dot = field.indexOf('.');
    if (dot === -1) return undefined;
    const head = field.slice(0, dot);
    return head === 'source' || head === 'target' ? head : undefined;
}

/** Comparison operators the filter engine can actually evaluate. */
export type WhereOperator = '==' | '!=' | 'contains';

export interface WhereClause {
    field: string;
    op: WhereOperator;
    value: string;
}

const WHERE_PATTERNS: Array<{ re: RegExp; op: WhereOperator }> = [
    { re: /^([\w.]+)\s*==\s*["']?([^"']*)["']?$/, op: '==' },
    { re: /^([\w.]+)\s*!=\s*["']?([^"']*)["']?$/, op: '!=' },
    { re: /^([\w.]+)\s+contains\s+["']?([^"']*)["']?$/i, op: 'contains' },
];

/**
 * Parse a `where:` expression, or return null if this engine cannot evaluate it.
 *
 * Only a single comparison is supported. Boolean composition, parenthesised
 * groups and `starts with` are all unsupported — callers must treat null as an
 * error, never as "no filter". A dotted endpoint path (`target.layer`) parses,
 * but means nothing to an element query; `validateQuerySpec` rejects it there.
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
// `builder.ts` stores an enum attribute as the reference the author wrote, and
// every enum-typed attribute in the ontology and its exemplars is written
// qualified — the model holds `"RequirementKind::software"`, never `"software"`.
// So the qualified form is THE spelling, and a template writes
// `where: requirementKind == "RequirementKind::software"`.
//
// Comparison is exact. The alternative — accepting the bare member name too —
// buys two spellings for one value, which is the defect this area exists to
// remove, and it costs the reader the only clue to which enum is meant:
// `criticality == "high"` and `severity == "high"` are indistinguishable,
// `CriticalityKind::high` is not.
//
// Exact comparison alone would resurrect the silent failure, though: a bare
// value simply matches nothing and the section renders its `empty:` message.
// So a bare value that IS a member of the enum actually stored on that field is
// an error naming the qualified spelling — the filter is not evaluated on a
// guess. Same rule as everywhere else here: fail, never quietly narrow.
// ─────────────────────────────────────────────────────────────────────────────

/** The member name of an enum reference: `RequirementKind::software` → `software`. */
export function unqualifyEnum(value: string): string {
    const sep = value.lastIndexOf('::');
    return sep === -1 ? value : value.slice(sep + 2);
}

/**
 * The qualified value stored on the compared field whose member name is
 * `queryValue`, if any row has one — i.e. the spelling the author meant to
 * write. Reads through the row's own field resolver so it works the same for a
 * relationship endpoint (`target.requirementKind`) as for an element.
 */
function qualifiedSpellingOf<T>(rows: T[], read: (row: T) => unknown, queryValue: string): string | undefined {
    if (queryValue.includes('::')) return undefined;
    for (const row of rows) {
        const stored = String(read(row) ?? '');
        if (stored.includes('::') && unqualifyEnum(stored) === queryValue) return stored;
    }
    return undefined;
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
    return 'expected `field == value`, `field != value`, or `field contains value`';
}

/**
 * Why a dotted path cannot be used here, or undefined when it can.
 *
 * Dotted paths exist for relationship rows, which have no useful flat fields of
 * their own: everything a compliance table wants to show lives on one of the two
 * ends. An element row has no ends, so a dotted path there is a query that will
 * render "—" in every cell — the silence this engine exists to turn into errors.
 */
function diagnoseDottedPath(path: string, relationships: boolean): string | undefined {
    if (!path.includes('.')) return undefined;
    if (!relationships) {
        return 'a dotted path names a relationship endpoint, and this query selects elements — add `select: relationships`';
    }
    if (!endpointOf(path)) {
        return 'a dotted path must start with `source.` or `target.`';
    }
    return undefined;
}

/**
 * Validate a query spec against what the engine can execute.
 * Returns a list of human-readable problems; empty means executable.
 */
export function validateQuerySpec(spec: MemoQuerySpec): string[] {
    const problems: string[] = [];
    const relationships = selectsRelationships(spec);

    for (const key of Object.keys(spec)) {
        if (!KNOWN_KEYS.has(key)) {
            problems.push(`unknown directive \`${key}:\` (known: ${[...KNOWN_KEYS].sort().join(', ')})`);
        }
    }

    if (spec.select !== undefined && !KNOWN_SELECTS.has(spec.select)) {
        problems.push(`unknown \`select: ${spec.select}\` (known: ${[...KNOWN_SELECTS].sort().join(', ')})`);
    }

    // A relationship type is stored lower-camel (`AllocatedTo` → `allocatedTo`)
    // and matched exactly, so the PascalCase name of the connection def selects
    // nothing at all. Same rule, and the same message, as `traverse:`.
    if (relationships) {
        for (const type of kindList(spec)) {
            if (/^[A-Z]/.test(type)) {
                problems.push(`\`kind: ${type}\` names a relationship type in PascalCase — use \`${pascalToCamel(type)}\``);
            }
        }
    }

    if (spec.where !== undefined) {
        if (typeof spec.where !== 'string') {
            problems.push('`where:` must be a string');
        } else {
            const clause = parseWhereClause(spec.where);
            if (!clause) {
                problems.push(`cannot evaluate \`where: ${spec.where}\` — ${diagnoseWhere(spec.where)}`);
            } else {
                const why = diagnoseDottedPath(clause.field, relationships);
                if (why) problems.push(`cannot evaluate \`where: ${spec.where}\` — ${why}`);
            }
        }
    }

    if (spec.sort !== undefined) {
        if (typeof spec.sort !== 'string') {
            problems.push('`sort:` must be a string');
        } else if (/\s/.test(spec.sort.trim())) {
            problems.push(`cannot evaluate \`sort: ${spec.sort}\` — only a bare field name is supported (no \`asc\`/\`desc\`)`);
        } else {
            const why = diagnoseDottedPath(spec.sort.trim(), relationships);
            if (why) problems.push(`cannot evaluate \`sort: ${spec.sort}\` — ${why}`);
        }
    }

    for (const col of resolveColumns(spec)) {
        if (/\s+as\s+/i.test(col)) {
            problems.push(`column \`${col}\` uses an alias — \`as\` is not supported`);
            continue;
        }
        const why = diagnoseDottedPath(col, relationships);
        if (why) problems.push(`column \`${col}\` — ${why}`);
    }

    if (spec.group_by !== undefined) {
        const why = diagnoseDottedPath(String(spec.group_by), relationships);
        if (why) problems.push(`\`group_by: ${spec.group_by}\` — ${why}`);
    }

    if (spec.display !== undefined && !KNOWN_DISPLAYS.has(spec.display)) {
        problems.push(`unknown \`display: ${spec.display}\` (known: ${[...KNOWN_DISPLAYS].sort().join(', ')})`);
    }

    if (spec.traverse !== undefined) {
        const parts = String(spec.traverse).trim().split(/\s+/);
        if (relationships) {
            // Traversal walks *from* an element along an edge. The rows here are
            // already the edges, so there is nothing to walk from — rather than
            // pick an end silently, say so.
            problems.push('`traverse:` selects elements reached from a seed, so it cannot be combined with `select: relationships`');
        } else if (parts.length !== 2 || !['outgoing', 'incoming'].includes(parts[0])) {
            problems.push(`cannot evaluate \`traverse: ${spec.traverse}\` — expected \`outgoing <relType>\` or \`incoming <relType>\``);
        } else if (parts[1] !== '*' && /^[A-Z]/.test(parts[1])) {
            problems.push(`\`traverse: ${spec.traverse}\` names a relationship type in PascalCase — use \`${pascalToCamel(parts[1])}\``);
        }
    }

    return problems;
}

/** `kind:` as a list, whichever of the two spellings the block used. */
export function kindList(spec: MemoQuerySpec): string[] {
    if (spec.kind === undefined) return [];
    return Array.isArray(spec.kind) ? spec.kind : [spec.kind];
}

const pascalToCamel = toModelType;

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

export function executeQuery(spec: MemoQuerySpec, ctx: QueryContext, source?: string): QueryRow[] {
    assertExecutable(spec, source);

    return selectsRelationships(spec)
        ? executeRelationshipQuery(spec, ctx)
        : executeElementQuery(spec, ctx);
}

function executeElementQuery(spec: MemoQuerySpec, ctx: QueryContext): MemoElement[] {
    // 1. Select by kind(s)
    let elements = spec.kind ? ctx.elementsByKinds(kindList(spec)) : ctx.allElements();

    // 2. Apply where filter
    if (spec.where) elements = applyFilter(elements, spec.where, ctx);

    // 3. Traverse relationships
    if (spec.traverse && elements.length > 0) {
        elements = applyTraverse(elements, spec.traverse, ctx);
    }

    // 4. Sort
    if (spec.sort) elements = sortRows(elements, spec.sort, el => getField(el, spec.sort!));

    // 5. Limit
    if (spec.limit && spec.limit > 0) elements = elements.slice(0, spec.limit);

    return elements;
}

/**
 * Rows are the links themselves.
 *
 * `kind:` names relationship types here, resolved through the same lower-camel
 * index the builder writes (`AllocatedTo` → `allocatedTo`) — the PascalCase
 * spelling is rejected in validation rather than silently matching nothing.
 */
function executeRelationshipQuery(spec: MemoQuerySpec, ctx: QueryContext): MemoRelationship[] {
    let rels = spec.kind
        ? kindList(spec).flatMap(type => ctx.relationshipsByType(type))
        : ctx.allRelationships();

    if (spec.where) rels = applyFilter(rels, spec.where, ctx);
    if (spec.sort) rels = sortRows(rels, spec.sort, rel => getRelField(rel, spec.sort!, ctx));
    if (spec.limit && spec.limit > 0) rels = rels.slice(0, spec.limit);

    return rels;
}

function sortRows<T>(rows: T[], _field: string, read: (row: T) => unknown): T[] {
    // Numeric-aware, because the fields documents sort on are numbered: clause
    // "14" belongs after "9", and "REQ-CS-2" before "REQ-CS-10". Plain
    // lexicographic ordering put clause 14 at the top of a conformance matrix,
    // which reads as a broken table long before anyone works out why.
    return [...rows].sort((a, b) =>
        String(read(a) ?? '').localeCompare(String(read(b) ?? ''), undefined, { numeric: true }));
}

function applyFilter<T extends QueryRow>(rows: T[], where: string, ctx: QueryContext): T[] {
    const clause = parseWhereClause(where);
    // Never fall through to the unfiltered set: a filter the engine cannot read
    // must fail, not quietly widen the result to everything.
    if (!clause) throw new MemoQueryError(`cannot evaluate \`where: ${where}\` — ${diagnoseWhere(where)}`);

    const { field, op, value } = clause;
    const read = (row: T) => rowField(row, field, ctx);

    // A bare enum member never matches, because the model stores the qualified
    // reference. Say so instead of returning an empty — or, for `!=`, a
    // complete — set that reads like a real answer.
    if (op === '==' || op === '!=') {
        const qualified = qualifiedSpellingOf(rows, read, value);
        if (qualified) {
            throw new MemoQueryError(
                `\`${field} ${op} "${value}"\` names an enum member without its enum, and the model stores `
                + `\`${qualified}\` — write \`${field} ${op} "${qualified}"\``,
            );
        }
    }

    switch (op) {
        case '==':
            return rows.filter(row => String(read(row) ?? '') === value);
        case '!=':
            return rows.filter(row => String(read(row) ?? '') !== value);
        case 'contains': {
            const lv = value.toLowerCase();
            return rows.filter(row => String(read(row) ?? '').toLowerCase().includes(lv));
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
    // The declaring package. Structural, one per source file, and the fact that
    // says which standard a clause belongs to — the standards library is one
    // package per standard, so `target.package == "…_iec_62304"` is the exact
    // per-standard selector a clause-conformance table needs. Clause *numbers*
    // are not: "5" is a clause of seven different standards in this library.
    if (field === 'package') return el.package || '';
    if (field === 'doc' || field === 'description') return el.doc || '';
    // Try attributes map
    if (el.attributes) return el.attributes[field];
    return undefined;
}

/** True when a row is a relationship rather than an element. */
function isRelationshipRow(row: QueryRow): row is MemoRelationship {
    return 'sourceId' in row;
}

/** Read `field` off a row, whichever kind of row it is. */
function rowField(row: QueryRow, field: string, ctx: QueryContext): unknown {
    return isRelationshipRow(row) ? getRelField(row, field, ctx) : getField(row, field);
}

/**
 * Read a field off a relationship.
 *
 * Bare `source` / `target` are the endpoint names, which is what a table cell
 * wants. `source.<field>` / `target.<field>` resolve the endpoint element and
 * read the field off it — the reason relationship rows need dotted paths at
 * all, since a link carries almost nothing on itself.
 */
function getRelField(rel: MemoRelationship, field: string, ctx: QueryContext): unknown {
    const endpoint = endpointOf(field);
    if (endpoint) {
        const el = ctx.element(endpoint === 'source' ? rel.sourceId : rel.targetId);
        return el ? getField(el, field.slice(field.indexOf('.') + 1)) : undefined;
    }

    switch (field) {
        case 'source': return ctx.elementName(rel.sourceId);
        case 'target': return ctx.elementName(rel.targetId);
        case 'id': return rel.id;
        // `kind` is the element word for "what is this"; a template that writes
        // it against a link means the link's type, and answering is kinder than
        // rendering a dash.
        case 'kind':
        case 'type': return rel.type;
        case 'sourceId': return rel.sourceId;
        case 'targetId': return rel.targetId;
        case 'sourceEnd': return rel.sourceEnd;
        case 'targetEnd': return rel.targetEnd;
        case 'file': return rel.file;
        case 'flowItem': return rel.flowItem;
        default: return rel.attributes?.[field];
    }
}

// ─── Render query results as markdown ─────────────────────────────────────────

export function renderQueryResult(
    spec: MemoQuerySpec,
    rows: QueryRow[],
    ctx: QueryContext,
): string {
    if (rows.length === 0) {
        return spec.empty ? `\n_${spec.empty}_\n` : '\n_No results found._\n';
    }

    const read = (row: QueryRow, field: string) => rowField(row, field, ctx);
    const display = spec.display || 'table';

    switch (display) {
        case 'table': return renderTable(spec, rows, read);
        case 'list': return renderList(spec, rows, read);
        case 'grouped': return renderGrouped(spec, rows, read);
        case 'matrix': return renderMatrix(spec, rows, read);
        case 'count': return `\n**${rows.length}** ${spec.kind || (selectsRelationships(spec) ? 'relationships' : 'elements')}\n`;
        case 'metric': return renderMetric(spec, rows, read);
        default: return renderTable(spec, rows, read);
    }
}

/** Read one field off one row — the only way the renderers touch a row. */
type ReadField = (row: QueryRow, field: string) => unknown;

function resolveColumns(spec: MemoQuerySpec): string[] {
    if (spec.columns) {
        if (Array.isArray(spec.columns)) return spec.columns;
        return spec.columns.split(',').map(c => c.trim());
    }
    // A relationship row has no name/layer of its own; what it has is two ends.
    return selectsRelationships(spec)
        ? ['source', 'type', 'target']
        : ['name', 'kind', 'layer', 'doc'];
}

function renderTable(spec: MemoQuerySpec, rows: QueryRow[], read: ReadField): string {
    const cols = resolveColumns(spec);
    const header = '| ' + cols.map(c => columnHeader(c)).join(' | ') + ' |';
    const sep = '| ' + cols.map(() => '---').join(' | ') + ' |';
    const body = rows.map(row => {
        const cells = cols.map(c => {
            const val = read(row, c);
            return val ? String(val).replace(/\|/g, '\\|') : '—';
        });
        return '| ' + cells.join(' | ') + ' |';
    });
    return '\n' + [header, sep, ...body].join('\n') + '\n';
}

function renderList(spec: MemoQuerySpec, rows: QueryRow[], read: ReadField): string {
    const line = (row: QueryRow) => selectsRelationships(spec)
        ? `- **${read(row, 'source')}** → **${read(row, 'target')}** _(${read(row, 'type')})_`
        : `- **${read(row, 'name')}** _(${read(row, 'kind')})_ — ${read(row, 'doc') || read(row, 'layer') || ''}`;
    return '\n' + rows.map(line).join('\n') + '\n';
}

function renderGrouped(spec: MemoQuerySpec, rows: QueryRow[], read: ReadField): string {
    const groupField = spec.group_by || (selectsRelationships(spec) ? 'type' : 'layer');
    const groups = new Map<string, QueryRow[]>();

    for (const row of rows) {
        const key = String(read(row, groupField) ?? 'Other');
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key)!.push(row);
    }

    const parts: string[] = [];
    for (const [key, group] of groups) {
        parts.push(`\n**${key}** (${group.length})\n`);
        parts.push(renderTable(spec, group, read));
    }
    return parts.join('');
}

function renderMatrix(spec: MemoQuerySpec, rows: QueryRow[], read: ReadField): string {
    // Row/col breakdown by two fields
    const rowField = spec.row_kind || 'kind';
    const colField = spec.col_kind || 'layer';
    const rowVals = [...new Set(rows.map(r => String(read(r, rowField) ?? '?')))].sort();
    const colVals = [...new Set(rows.map(r => String(read(r, colField) ?? '?')))].sort();

    const header = '| | ' + colVals.join(' | ') + ' |';
    const sep = '| --- | ' + colVals.map(() => '---').join(' | ') + ' |';
    const body = rowVals.map(rv => {
        const cells = colVals.map(cv => {
            const count = rows.filter(r =>
                String(read(r, rowField) ?? '?') === rv &&
                String(read(r, colField) ?? '?') === cv
            ).length;
            return count > 0 ? String(count) : '—';
        });
        return `| **${rv}** | ${cells.join(' | ')} |`;
    });
    return '\n' + [header, sep, ...body].join('\n') + '\n';
}

function renderMetric(spec: MemoQuerySpec, rows: QueryRow[], read: ReadField): string {
    const label = spec.label || 'Count';
    const value = spec.value ? rows.reduce((sum, row) => {
        const v = Number(read(row, spec.value!) ?? 0);
        return sum + (isNaN(v) ? 0 : v);
    }, 0) : rows.length;
    return `\n**${label}:** ${value}\n`;
}

function capitalize(s: string): string {
    return s.charAt(0).toUpperCase() + s.slice(1).replace(/_/g, ' ');
}

/**
 * Header text for a column. A dotted endpoint path becomes readable words
 * ("target.clauseNumber" → "Target Clause Number"), which is why relationship
 * tables need no column aliases. Flat column headers are left exactly as they
 * were, so no existing document's tables change.
 */
function columnHeader(col: string): string {
    if (!col.includes('.')) return capitalize(col);
    return col
        .split('.')
        .map(seg => capitalize(seg.replace(/([a-z0-9])([A-Z])/g, '$1 $2')))
        .join(' ');
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
