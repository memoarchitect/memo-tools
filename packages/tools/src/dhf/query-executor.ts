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

// ─── Execute a query against the model context ────────────────────────────────

export function executeQuery(spec: MemoQuerySpec, ctx: QueryContext): MemoElement[] {
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
    // Supports: "field == value", "field != value", "field contains value"
    const eqMatch = where.match(/^(\w+)\s*==\s*["']?([^"']*)["']?$/);
    const neqMatch = where.match(/^(\w+)\s*!=\s*["']?([^"']*)["']?$/);
    const containsMatch = where.match(/^(\w+)\s+contains\s+["']?([^"']*)["']?$/i);

    if (eqMatch) {
        const [, field, value] = eqMatch;
        return elements.filter(el => String(getField(el, field) ?? '') === value);
    }
    if (neqMatch) {
        const [, field, value] = neqMatch;
        return elements.filter(el => String(getField(el, field) ?? '') !== value);
    }
    if (containsMatch) {
        const [, field, value] = containsMatch;
        const lv = value.toLowerCase();
        return elements.filter(el => String(getField(el, field) ?? '').toLowerCase().includes(lv));
    }
    return elements;
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

export function processMemoQueryBlocks(content: string, ctx: QueryContext): string {
    return content.replace(QUERY_BLOCK_RE, (_match, blockContent: string) => {
        const spec = parseMemoQuery(blockContent);
        if (!spec) return `\n> ⚠️ Invalid memo-query block\n`;
        const elements = executeQuery(spec, ctx);
        return renderQueryResult(spec, elements, ctx);
    });
}
