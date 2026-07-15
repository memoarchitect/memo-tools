// ─── Re-import Diff ───────────────────────────────────────────────────────────
//
// Computes a structured diff between the current model state and a batch of
// incoming CSV elements, enabling "update without replacement" workflows.
// Users can see what changed, what is new, and what was removed before
// committing to the import.
// ─────────────────────────────────────────────────────────────────────────────

import type { MemoModel, MemoElement } from '../model/semantic.js';
import type { CsvElement } from '../serializer/csv-io.js';

// ─── Types ───────────────────────────────────────────────────────────────────

/** One field that changed between the existing element and the incoming CSV row */
export interface FieldChange {
    field: string;
    currentValue: string;
    incomingValue: string;
}

/** An element that already exists in the model but has incoming changes */
export interface ModifiedElement {
    current: MemoElement;
    incoming: CsvElement;
    changes: FieldChange[];
}

/**
 * Structured diff between the current model and an incoming CSV batch.
 *
 * - `added`     — elements in the CSV that don't exist in the model yet
 * - `modified`  — elements that exist in both but have field differences
 * - `unchanged` — element IDs present in both with no differences
 * - `removed`   — element IDs in the model that are NOT in the incoming CSV
 *                 (only populated if `detectRemovals` was true — callers opt in
 *                 because removal detection requires knowing the CSV represents
 *                 the full population, not a partial update)
 */
export interface ImportDiff {
    added: CsvElement[];
    modified: ModifiedElement[];
    unchanged: string[];
    removed: string[];
    /** Total count of incoming rows */
    incomingCount: number;
    /** Total count of current model elements */
    currentCount: number;
}

// ─── computeImportDiff ───────────────────────────────────────────────────────

/**
 * Compute the diff between the current model and an incoming batch of elements.
 *
 * @param model           Current MEMO model (from the builder)
 * @param incoming        Parsed elements from the incoming CSV
 * @param detectRemovals  If true, elements in the model that are missing from
 *                        the incoming batch are listed in `removed`. Only set
 *                        this to true when the CSV represents a full replacement
 *                        of the population, not a partial update.
 */
export function computeImportDiff(
    model: MemoModel,
    incoming: CsvElement[],
    detectRemovals = false
): ImportDiff {
    const added: CsvElement[] = [];
    const modified: ModifiedElement[] = [];
    const unchanged: string[] = [];
    const removed: string[] = [];

    const incomingById = new Map<string, CsvElement>(incoming.map((el) => [el.id, el]));

    for (const inEl of incoming) {
        const existing = model.elements.get(inEl.id);
        if (!existing) {
            added.push(inEl);
            continue;
        }

        const changes = diffElement(existing, inEl);
        if (changes.length > 0) {
            modified.push({ current: existing, incoming: inEl, changes });
        } else {
            unchanged.push(inEl.id);
        }
    }

    if (detectRemovals) {
        for (const [id] of model.elements) {
            if (!incomingById.has(id)) {
                removed.push(id);
            }
        }
    }

    return {
        added,
        modified,
        unchanged,
        removed,
        incomingCount: incoming.length,
        currentCount: model.elements.size,
    };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const PROVENANCE_PREFIX = '_import_';

/** Compare a model element against an incoming CSV element, returning changed fields */
function diffElement(current: MemoElement, incoming: CsvElement): FieldChange[] {
    const changes: FieldChange[] = [];

    // Fixed fields
    if (current.name !== incoming.name) {
        changes.push({ field: 'name', currentValue: current.name, incomingValue: incoming.name });
    }
    if (current.kind !== incoming.kind) {
        changes.push({ field: 'kind', currentValue: current.kind, incomingValue: incoming.kind });
    }
    if ((current.doc ?? '') !== (incoming.doc ?? '')) {
        changes.push({ field: 'doc', currentValue: current.doc ?? '', incomingValue: incoming.doc ?? '' });
    }

    // Dynamic attributes (skip provenance fields — they always differ)
    const allAttrKeys = new Set([
        ...Object.keys(current.attributes),
        ...Object.keys(incoming.attributes),
    ]);
    for (const key of allAttrKeys) {
        if (key === 'name') continue;
        if (key.startsWith(PROVENANCE_PREFIX)) continue;
        const cv = current.attributes[key] ?? '';
        const iv = incoming.attributes[key] ?? '';
        if (cv !== iv) {
            changes.push({ field: key, currentValue: cv, incomingValue: iv });
        }
    }

    return changes;
}

// ─── Formatting helpers (used by CLI display) ────────────────────────────────

/** Summarise an ImportDiff to a one-line string */
export function formatDiffSummary(diff: ImportDiff): string {
    const parts: string[] = [];
    if (diff.added.length > 0)     parts.push(`+${diff.added.length} added`);
    if (diff.modified.length > 0)  parts.push(`~${diff.modified.length} modified`);
    if (diff.unchanged.length > 0) parts.push(`=${diff.unchanged.length} unchanged`);
    if (diff.removed.length > 0)   parts.push(`-${diff.removed.length} removed`);
    return parts.length > 0 ? parts.join(', ') : 'no changes';
}
