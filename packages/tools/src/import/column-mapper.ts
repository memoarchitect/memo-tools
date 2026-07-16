// ─── Column-Mapping Assistant ─────────────────────────────────────────────────
//
// Infers column mappings from spreadsheet headers and applies them to produce
// a standard MEMO elements CSV ready for parseElementsCsv().
// ─────────────────────────────────────────────────────────────────────────────

import type { MEMOConfig } from '../model/config.js';
import type { ImportRecipe, ColumnMapping } from './recipes.js';

export type { ColumnMapping };

// ─── Inference ───────────────────────────────────────────────────────────────

/**
 * Infer column mappings for a set of spreadsheet headers.
 *
 * Strategy:
 * 1. If a `recipe` is provided, match each header against recipe.columnMappings
 *    using case-insensitive exact match.
 * 2. Fall back to a built-in heuristic for common column name patterns.
 * 3. Unrecognised columns pass through as dynamic attributes (camelCase normalised).
 *
 * Returns one ColumnMapping per *input* header. `targetAttribute` is `null`
 * (represented as empty string) for columns that should be skipped.
 */
export function inferColumnMappings(
    headers: string[],
    recipe?: ImportRecipe
): ColumnMapping[] {
    return headers.map((header) => {
        const normalised = header.trim().toLowerCase();

        // ── Recipe match ──────────────────────────────────────────────────────
        if (recipe) {
            const hit = recipe.columnMappings.find(
                (m) => m.sourceColumn.toLowerCase() === normalised
            );
            if (hit) return { ...hit, sourceColumn: header };
        }

        // ── Heuristic fallback ────────────────────────────────────────────────
        const heuristic = HEURISTIC_MAPPINGS.find(
            (m) => m.sourceColumn.toLowerCase() === normalised
        );
        if (heuristic) return { ...heuristic, sourceColumn: header };

        // ── Passthrough — normalise to camelCase attribute ────────────────────
        const attr = toCamelCase(header);
        return { sourceColumn: header, targetAttribute: attr };
    });
}

/** Common column name → MEMO attribute heuristics (supplement to recipe matching) */
const HEURISTIC_MAPPINGS: ColumnMapping[] = [
    { sourceColumn: 'id',             targetAttribute: 'id',   transform: 'sanitize-id' },
    { sourceColumn: 'identifier',     targetAttribute: 'id',   transform: 'sanitize-id' },
    { sourceColumn: 'uid',            targetAttribute: 'id',   transform: 'sanitize-id' },
    { sourceColumn: 'name',           targetAttribute: 'name' },
    { sourceColumn: 'title',          targetAttribute: 'name' },
    { sourceColumn: 'label',          targetAttribute: 'name' },
    { sourceColumn: 'description',    targetAttribute: 'doc' },
    { sourceColumn: 'text',           targetAttribute: 'doc' },
    { sourceColumn: 'notes',          targetAttribute: 'doc' },
    { sourceColumn: 'kind',           targetAttribute: 'kind' },
    { sourceColumn: 'type',           targetAttribute: 'kind' },
    { sourceColumn: 'category',       targetAttribute: 'kind' },
    { sourceColumn: 'construct',      targetAttribute: 'construct' },
];

// ─── Apply mappings ───────────────────────────────────────────────────────────

export interface MappedCsvResult {
    /** Standard elements CSV text ready for parseElementsCsv() */
    csv: string;
    /** Headers that had no mapping and were skipped */
    skippedColumns: string[];
    /** Warnings about missing required mappings or value transforms */
    warnings: string[];
}

/**
 * Apply a set of column mappings to raw spreadsheet rows and produce a
 * standard MEMO elements CSV string.
 *
 * @param rawRows    Rows from the source spreadsheet (header → cell value)
 * @param mappings   Mappings returned by inferColumnMappings()
 * @param config     Resolved MEMO config (used to auto-set kind if not mapped)
 * @param defaultKind  Kind to use when no kind column is present
 */
export function applyColumnMappings(
    rawRows: Record<string, string>[],
    mappings: ColumnMapping[],
    config: MEMOConfig,
    defaultKind?: string
): MappedCsvResult {
    const warnings: string[] = [];
    const skippedColumns: string[] = [];

    // Collect unique target attributes to form the output header row
    const targetAttrs = new Set<string>();
    const activeMap: ColumnMapping[] = [];

    for (const m of mappings) {
        if (!m.targetAttribute) {
            skippedColumns.push(m.sourceColumn);
            continue;
        }
        // Skip duplicate target (first mapping wins)
        if (targetAttrs.has(m.targetAttribute)) continue;
        targetAttrs.add(m.targetAttribute);
        activeMap.push(m);
    }

    // Ensure required fixed columns are present
    const hasId   = targetAttrs.has('id');
    const hasName = targetAttrs.has('name');
    const hasKind = targetAttrs.has('kind');

    if (!hasId)   warnings.push("No column mapped to 'id' — id will be auto-generated from row number");
    if (!hasName) warnings.push("No column mapped to 'name'");
    if (!hasKind && !defaultKind) warnings.push("No column mapped to 'kind' and no defaultKind set");

    // Build output column order: fixed cols first, then dynamic attrs
    const FIXED = ['id', 'name', 'kind', 'construct', 'doc'];
    const dynamicTargets = Array.from(targetAttrs).filter((t) => !FIXED.includes(t));
    const outputHeaders = [
        ...FIXED.filter((f) => targetAttrs.has(f)),
        ...dynamicTargets,
    ];
    // Ensure 'id', 'name', 'kind' are always present
    for (const req of ['id', 'name', 'kind']) {
        if (!outputHeaders.includes(req)) outputHeaders.unshift(req);
    }

    const lines: string[] = [outputHeaders.map(escapeCsv).join(',')];

    rawRows.forEach((row, rowIdx) => {
        const out: Record<string, string> = {};

        // Apply mappings
        for (const m of activeMap) {
            const raw = row[m.sourceColumn] ?? '';
            out[m.targetAttribute] = applyTransform(raw, m.transform);
        }

        // Auto-generate id if missing
        if (!out['id'] || out['id'].trim() === '') {
            out['id'] = `row_${rowIdx + 1}`;
        }

        // Apply defaultKind if kind not mapped or empty
        if ((!out['kind'] || out['kind'].trim() === '') && defaultKind) {
            out['kind'] = defaultKind;
        }

        // Validate kind against config kinds (warn but keep)
        const kind = out['kind'];
        if (kind && config.kinds && !config.kinds[kind]) {
            warnings.push(`Row ${rowIdx + 2}: unknown kind '${kind}' (not in config)`);
        }

        const rowValues = outputHeaders.map((h) => escapeCsv(out[h] ?? ''));
        lines.push(rowValues.join(','));
    });

    return { csv: lines.join('\n') + '\n', skippedColumns, warnings };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function applyTransform(value: string, transform?: ColumnMapping['transform']): string {
    if (!transform) return value;
    switch (transform) {
        case 'sanitize-id': return sanitizeId(value);
        case 'upper': return value.toUpperCase();
        case 'lower': return value.toLowerCase();
        default: return value;
    }
}

/**
 * Sanitize a raw cell value into a valid SysML identifier.
 * - Strips leading/trailing whitespace
 * - Replaces spaces and hyphens with underscores
 * - Removes remaining non-identifier characters
 * - Prepends 'e_' if the result starts with a digit
 * - Lowercases the result
 */
function sanitizeId(raw: string): string {
    let s = raw.trim()
        .replace(/[\s\-]+/g, '_')
        .replace(/[^a-zA-Z0-9_]/g, '')
        .toLowerCase();
    if (/^\d/.test(s)) s = 'e_' + s;
    return s;
}

/** Convert a string to camelCase for use as an attribute name */
function toCamelCase(s: string): string {
    return s
        .trim()
        .replace(/[^a-zA-Z0-9 _-]/g, '')
        .split(/[\s_-]+/)
        .map((word, i) => i === 0 ? word.toLowerCase() : word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
        .join('');
}

/** Minimal CSV field escaping */
function escapeCsv(value: string): string {
    if (value.includes(',') || value.includes('"') || value.includes('\n')) {
        return `"${value.replace(/"/g, '""')}"`;
    }
    return value;
}
