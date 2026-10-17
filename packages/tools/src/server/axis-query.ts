// ─── Evaluating a matrix axis ────────────────────────────────────────────────
//
// An axis of a traceability matrix or a DSM is hand-picked elements or a
// `memo-query` (see model/view-deriver.ts, `readMatrixDefinition`). The query is
// the one the DHF templates use, run by the same executor, so a filter written
// for a document selects the same elements on a matrix.
//
// The screen shows the count and a few rows BEFORE it renders anything, and
// refuses to render a product of two axes it considers too large. The count has
// to be cheap and honest for that, so the ids come back only when they fit the
// caller's limit: an axis that does not fit is refused, not sliced.
// ─────────────────────────────────────────────────────────────────────────────

import type { QueryContext } from '../dhf/query-engine.js';
import { executeQuery, MemoQueryError, parseMemoQuery, selectsRelationships } from '../dhf/query-executor.js';
import type { MemoElement } from '../model/semantic.js';

/** One matched element, enough to recognise it in a preview. */
export interface AxisPreviewRow {
    id: string;
    name: string;
    kind: string;
    package?: string;
}

export interface AxisQueryResult {
    /** Set when the query could not be run; nothing else is meaningful then. */
    error?: string;
    count: number;
    /** Every matched id, present only when there are no more than the limit. */
    ids?: string[];
    /** The first few matches, in the order the query returned them. */
    preview: AxisPreviewRow[];
}

export const DEFAULT_AXIS_ID_LIMIT = 5000;
export const DEFAULT_AXIS_PREVIEW = 25;

export function runAxisQuery(
    text: string, ctx: QueryContext,
    limits: { ids?: number; preview?: number } = {},
): AxisQueryResult {
    const idLimit = limits.ids ?? DEFAULT_AXIS_ID_LIMIT;
    const previewLimit = limits.preview ?? DEFAULT_AXIS_PREVIEW;
    const empty: AxisQueryResult = { count: 0, preview: [] };
    if (!text.trim()) return { ...empty, error: 'The query is empty.' };

    const spec = parseMemoQuery(text);
    if (!spec) return { ...empty, error: 'The query is not valid: write it as `kind: Requirement`, one directive per line.' };
    if (selectsRelationships(spec)) {
        return { ...empty, error: 'An axis lists elements; a query that selects relationships cannot be one.' };
    }
    let rows;
    try {
        rows = executeQuery(spec, ctx) as MemoElement[];
    } catch (error) {
        if (error instanceof MemoQueryError) return { ...empty, error: error.message };
        throw error;
    }
    // A traversal can reach the same element twice.
    const unique = [...new Map(rows.map(row => [row.id, row])).values()];
    return {
        count: unique.length,
        ...(unique.length <= idLimit ? { ids: unique.map(row => row.id) } : {}),
        preview: unique.slice(0, previewLimit).map(row => ({
            id: row.id, name: row.name, kind: row.kind, ...(row.package ? { package: row.package } : {}),
        })),
    };
}
