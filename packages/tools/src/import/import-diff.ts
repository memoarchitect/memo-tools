// ─── Re-import Diff ───────────────────────────────────────────────────────────
//
// Computes a structured diff between the current model state and a batch of
// incoming elements, enabling "update without replacement" workflows.
// Users can see what changed, what is new, and what was removed before
// committing to the import.
//
// Two kinds of batch. A batch of elements from another system (each carries a
// `source`) is matched by the record they were made from — (system,
// identifier) — never by the MEMO name, and its removals are the elements of
// THAT system only. A MEMO-shaped CSV (no `source`) is matched by name, as it
// always was.
// ─────────────────────────────────────────────────────────────────────────────

import type { MemoModel, MemoElement } from '../model/semantic.js';
import type { CsvElement } from '../serializer/csv-io.js';
import { baselineOf, type Baseline } from '../analysis/suspect-links.js';

// ─── Types ───────────────────────────────────────────────────────────────────

/** One field that changed between the existing element and the incoming CSV row */
export interface FieldChange {
    field: string;
    currentValue: string;
    incomingValue: string;
}

/** A link that touches an imported element, and what the import does to it. */
export interface AffectedLink {
    relationshipId: string;
    relationshipType: string;
    /** The other end. */
    otherId: string;
    /** True when the link carries a `@TraceBaseline`, so it can be suspect once the element moves or goes. */
    baselined: boolean;
    /** The baseline, for asking the one suspect predicate what the import would do to this link. */
    baseline?: Baseline;
}

/** An element that already exists in the model but has incoming changes */
export interface ModifiedElement {
    current: MemoElement;
    incoming: CsvElement;
    changes: FieldChange[];
    /** True when the source's revision of the record is not the one the model holds. */
    revisionMoved?: boolean;
    /** The links to this element; the baselined ones become suspect when `revisionMoved`. */
    links?: AffectedLink[];
}

/** An element whose source record is gone from the export. */
export interface RemovedElement {
    id: string;
    /** The links to this element; the baselined ones are flagged as pointing at a withdrawn record. */
    links: AffectedLink[];
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
 *                 the full population, not a partial update). For a batch from
 *                 another system, only that system's elements, and not ones
 *                 already withdrawn.
 * - `withdrawn` — what `removed` is, with the links each one leaves behind
 */
export interface ImportDiff {
    added: CsvElement[];
    modified: ModifiedElement[];
    unchanged: string[];
    removed: string[];
    withdrawn: RemovedElement[];
    /** Total count of incoming rows */
    incomingCount: number;
    /** Total count of current model elements */
    currentCount: number;
}

// ─── Source identity ─────────────────────────────────────────────────────────

const SYSTEM = 'externalReference.sourceSystem';
const IDENTIFIER = 'externalReference.identifier';
const REVISION = 'externalReference.revision';

/** The key a record is matched by across imports. */
const sourceKey = (system: string, identifier: string) => `${system}\u0000${identifier}`;

/** The model's elements that were imported from `system`, by source identifier. */
export function importedElements(model: MemoModel, system?: string): Map<string, MemoElement> {
    const found = new Map<string, MemoElement>();
    for (const element of model.elements.values()) {
        const elementSystem = element.attributes[SYSTEM];
        const identifier = element.attributes[IDENTIFIER];
        if (elementSystem === undefined || identifier === undefined) continue;
        if (system !== undefined && elementSystem !== system) continue;
        found.set(sourceKey(elementSystem, identifier), element);
    }
    return found;
}

/** Every link that touches an element, by its two ends. */
export function linksOf(model: MemoModel, elementId: string): AffectedLink[] {
    const links: AffectedLink[] = [];
    for (const relationship of model.relationships) {
        const otherId = relationship.sourceId === elementId ? relationship.targetId
            : relationship.targetId === elementId ? relationship.sourceId : undefined;
        if (otherId === undefined) continue;
        links.push({
            relationshipId: relationship.id,
            relationshipType: relationship.type,
            otherId,
            baselined: relationship.attributes?.['sourceRevision'] !== undefined,
            baseline: baselineOf(relationship.attributes),
        });
    }
    return links;
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
    const withdrawn: RemovedElement[] = [];

    const fromSource = incoming.some((el) => el.source);
    const systems = new Set(incoming.flatMap((el) => (el.source ? [el.source.system] : [])));
    const known = fromSource ? importedElements(model) : new Map<string, MemoElement>();
    const matched = new Set<string>();

    for (const inEl of incoming) {
        const existing = inEl.source
            ? known.get(sourceKey(inEl.source.system, inEl.source.identifier))
            : model.elements.get(inEl.id);
        if (!existing) {
            added.push(inEl);
            continue;
        }
        matched.add(existing.id);

        const changes = diffElement(existing, inEl);
        const revisionMoved = inEl.source !== undefined && existing.attributes[REVISION] !== inEl.source.revision;
        if (changes.length > 0 || revisionMoved) {
            modified.push({
                current: existing, incoming: inEl, changes,
                ...(inEl.source ? { revisionMoved, links: linksOf(model, existing.id) } : {}),
            });
        } else {
            unchanged.push(existing.id);
        }
    }

    if (detectRemovals) {
        for (const [id, element] of model.elements) {
            if (matched.has(id)) continue;
            if (fromSource) {
                // Only the elements this import owns: another system's, and authored ones, are not
                // missing from an export that never claimed them. A withdrawn one is already gone.
                const system = element.attributes[SYSTEM];
                if (system === undefined || !systems.has(system)) continue;
                if (element.attributes['sourceWithdrawn'] === 'true') continue;
                withdrawn.push({ id, links: linksOf(model, id) });
            }
            removed.push(id);
        }
    }

    return {
        added,
        modified,
        unchanged,
        removed,
        withdrawn,
        incomingCount: incoming.length,
        currentCount: model.elements.size,
    };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Compare a model element against an incoming element, returning changed fields.
 *
 * The incoming side decides which attributes are compared: the model's flat map
 * also holds what the builder derives (`usageType`, the source record itself),
 * none of which an import states.
 */
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

    const keys = incoming.source
        ? Object.keys(incoming.attributes)
        : [...new Set([...Object.keys(current.attributes), ...Object.keys(incoming.attributes)])];
    for (const key of keys) {
        if (key === 'name') continue;
        const cv = current.attributes[key] ?? '';
        const iv = incoming.attributes[key] ?? '';
        if (cv !== iv) {
            changes.push({ field: key, currentValue: cv, incomingValue: iv });
        }
    }

    // A record that is back in the export is no longer withdrawn.
    if (incoming.source && current.attributes['sourceWithdrawn'] === 'true') {
        changes.push({ field: 'sourceWithdrawn', currentValue: 'true', incomingValue: 'false' });
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
