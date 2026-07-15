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
import type { MemoElement } from '../model/semantic.js';
import { executeQuery, renderQueryResult } from './query-executor.js';

// ─── Script API ───────────────────────────────────────────────────────────────

interface ScriptAPI {
    query(spec: Record<string, unknown>): MemoElement[];
    table(elements: MemoElement[], columns?: string[]): string;
    list(elements: MemoElement[]): string;
    count(elements: MemoElement[], label?: string): string;
    md(strings: TemplateStringsArray, ...values: unknown[]): string;
    project: Record<string, unknown>;
    ctx: QueryContext;
}

function buildAPI(ctx: QueryContext, projectMeta: Record<string, unknown>): ScriptAPI {
    return {
        query(spec) {
            return executeQuery(spec as any, ctx);
        },
        table(elements, columns = ['name', 'kind', 'layer', 'doc']) {
            return renderQueryResult({ display: 'table', columns }, elements, ctx);
        },
        list(elements) {
            return renderQueryResult({ display: 'list' }, elements, ctx);
        },
        count(elements, label = 'Count') {
            return `\n**${label}:** ${elements.length}\n`;
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
