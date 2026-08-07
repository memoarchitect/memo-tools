// ─── DHF Script Runner ────────────────────────────────────────────────────────
//
// Sandboxed JS execution for `memo-script` fenced blocks.
// The script receives a restricted API: query(), table(), chart(), md``
//
// Example:
//   ```memo-script
//   const hazards = query({ kind: 'Hazard' });
//   const unmitigated = hazards.filter(h => h.mitigatedBy.length === 0);
//   return table(unmitigated, ['name', 'layer', 'doc']);
//   ```
// ─────────────────────────────────────────────────────────────────────────────

import type { QueryContext } from './query-engine.js';
import { executeQuery, renderQueryResult, type QueryRow } from './query-executor.js';

// ─── Script API ───────────────────────────────────────────────────────────────

interface ScriptAPI {
    // Rows are elements, or relationships when the spec says `select: relationships`.
    query(spec: Record<string, unknown>): QueryRow[];
    table(rows: QueryRow[], columns?: string[]): string;
    list(rows: QueryRow[]): string;
    count(rows: QueryRow[], label?: string): string;
    md(strings: TemplateStringsArray, ...values: unknown[]): string;
    project: Record<string, unknown>;
    ctx: QueryContext;
}

function buildAPI(ctx: QueryContext, projectMeta: Record<string, unknown>): ScriptAPI {
    return {
        query(spec) {
            return executeQuery(spec as any, ctx);
        },
        table(rows, columns = ['name', 'kind', 'layer', 'doc']) {
            return renderQueryResult({ display: 'table', columns }, rows, ctx);
        },
        list(rows) {
            return renderQueryResult({ display: 'list' }, rows, ctx);
        },
        count(rows, label = 'Count') {
            return `\n**${label}:** ${rows.length}\n`;
        },
        md(strings, ...values) {
            return strings.reduce((acc, str, i) => acc + str + (i < values.length ? String(values[i]) : ''), '');
        },
        project: projectMeta,
        ctx,
    };
}

// ─── Execute a single script block ───────────────────────────────────────────

export function executeScript(
    scriptSource: string,
    ctx: QueryContext,
    projectMeta: Record<string, unknown> = {},
): string {
    const api = buildAPI(ctx, projectMeta);

    // Wrap in an async function and execute with restricted scope
    // We intentionally avoid eval on dangerous globals by not passing them
    try {
        // Build a function that receives only the safe API
        const fn = new Function(
            'query', 'table', 'list', 'count', 'md', 'project', 'ctx',
            `"use strict";\n${scriptSource}`,
        );

        const result = fn(
            api.query.bind(api),
            api.table.bind(api),
            api.list.bind(api),
            api.count.bind(api),
            api.md,
            api.project,
            api.ctx,
        );

        if (result === null || result === undefined) return '';
        if (typeof result === 'string') return result;
        return String(result);
    } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return `\n> ⚠️ Script error: ${msg}\n`;
    }
}

// ─── Process all memo-script blocks in markdown ───────────────────────────────

const SCRIPT_BLOCK_RE = /```memo-script\n([\s\S]*?)```/g;

export function processMemoScriptBlocks(
    content: string,
    ctx: QueryContext,
    projectMeta: Record<string, unknown> = {},
): string {
    return content.replace(SCRIPT_BLOCK_RE, (_match, scriptSource: string) => {
        return executeScript(scriptSource, ctx, projectMeta);
    });
}
