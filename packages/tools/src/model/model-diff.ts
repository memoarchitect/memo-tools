// ─── What changed between two models ─────────────────────────────────────────
//
// Pure and browser-safe. The Model Diff page compares two snapshots of the model the browser holds;
// the Releases page compares two pinned builds the server holds. Both ask this one function, over a
// minimal shape that a `MemoModelDTO` and a `MemoModel` (through `diffInputOf`) both satisfy.
// ─────────────────────────────────────────────────────────────────────────────

import type { MemoModel } from './semantic.js';

export interface DiffElement {
    id: string;
    name?: string;
    kind: string;
    layer?: string;
    doc?: string;
    attributes: Record<string, string>;
}

export interface DiffRelationship {
    id: string;
    type: string;
    sourceId: string;
    targetId: string;
}

export interface DiffInput<E extends DiffElement = DiffElement, R extends DiffRelationship = DiffRelationship> {
    elements: Record<string, E>;
    relationships: readonly R[];
}

export interface ModelDiff<E extends DiffElement = DiffElement, R extends DiffRelationship = DiffRelationship> {
    added: E[];
    removed: E[];
    changed: { element: E; changes: string[] }[];
    addedRels: R[];
    removedRels: R[];
    summary: { added: number; removed: number; changed: number; addedRels: number; removedRels: number };
}

export function computeModelDiff<E extends DiffElement, R extends DiffRelationship>(
    before: DiffInput<E, R>, after: DiffInput<E, R>,
): ModelDiff<E, R> {
    const added: E[] = [];
    const removed: E[] = [];
    const changed: { element: E; changes: string[] }[] = [];

    const beforeIds = new Set(Object.keys(before.elements));
    const afterIds = new Set(Object.keys(after.elements));
    for (const id of afterIds) if (!beforeIds.has(id)) added.push(after.elements[id]);
    for (const id of beforeIds) if (!afterIds.has(id)) removed.push(before.elements[id]);
    for (const id of beforeIds) {
        if (!afterIds.has(id)) continue;
        const b = before.elements[id];
        const a = after.elements[id];
        const changes: string[] = [];
        if (b.name !== a.name) changes.push(`name: "${b.name}" → "${a.name}"`);
        if (b.kind !== a.kind) changes.push(`kind: ${b.kind} → ${a.kind}`);
        if (b.layer !== a.layer) changes.push(`layer: ${b.layer} → ${a.layer}`);
        if (b.doc !== a.doc) changes.push('doc changed');
        if (JSON.stringify(b.attributes) !== JSON.stringify(a.attributes)) changes.push('attributes changed');
        if (changes.length > 0) changed.push({ element: a, changes });
    }

    // A relationship is what it joins, not the id it was numbered with: ids are assigned in the order the
    // builder meets the links, so one new file renumbers every link after it, and two models of different
    // commits would disagree about every one. Links are matched by type and ends, as a multiset.
    const signature = (r: R) => `${r.type}\u0000${r.sourceId}\u0000${r.targetId}`;
    const surplus = (from: readonly R[], against: readonly R[]): R[] => {
        const available = new Map<string, number>();
        for (const r of against) available.set(signature(r), (available.get(signature(r)) ?? 0) + 1);
        const rest: R[] = [];
        for (const r of from) {
            const left = available.get(signature(r)) ?? 0;
            if (left > 0) available.set(signature(r), left - 1);
            else rest.push(r);
        }
        return rest;
    };
    const addedRels = surplus(after.relationships, before.relationships);
    const removedRels = surplus(before.relationships, after.relationships);

    return {
        added, removed, changed, addedRels, removedRels,
        summary: {
            added: added.length, removed: removed.length, changed: changed.length,
            addedRels: addedRels.length, removedRels: removedRels.length,
        },
    };
}

/** A built model in the shape the diff reads. */
export function diffInputOf(model: MemoModel): DiffInput {
    const elements: Record<string, DiffElement> = {};
    for (const element of model.elements.values()) {
        elements[element.id] = {
            id: element.id, name: element.shortName ?? element.name, kind: element.kind, layer: element.layer,
            doc: element.doc, attributes: element.attributes ?? {},
        };
    }
    return {
        elements,
        relationships: [...model.relationships.values()].map(r => ({ id: r.id, type: r.type, sourceId: r.sourceId, targetId: r.targetId })),
    };
}

/** A diff reduced to what crosses the wire: ids, names, kinds, and what changed. */
export interface ModelDiffSummary {
    added: { id: string; name: string; kind: string }[];
    removed: { id: string; name: string; kind: string }[];
    changed: { id: string; name: string; kind: string; changes: string[] }[];
    addedRels: { id: string; type: string; source: string; target: string }[];
    removedRels: { id: string; type: string; source: string; target: string }[];
    summary: ModelDiff['summary'];
}

export function summarizeDiff(diff: ModelDiff, before: DiffInput, after: DiffInput): ModelDiffSummary {
    const name = (input: DiffInput, id: string) => input.elements[id]?.name || id.slice(id.lastIndexOf('::') + 2);
    const row = (e: DiffElement) => ({ id: e.id, name: e.name || e.id.slice(e.id.lastIndexOf('::') + 2), kind: e.kind });
    return {
        added: diff.added.map(row), removed: diff.removed.map(row),
        changed: diff.changed.map(c => ({ ...row(c.element), changes: c.changes })),
        addedRels: diff.addedRels.map(r => ({ id: r.id, type: r.type, source: name(after, r.sourceId), target: name(after, r.targetId) })),
        removedRels: diff.removedRels.map(r => ({ id: r.id, type: r.type, source: name(before, r.sourceId), target: name(before, r.targetId) })),
        summary: diff.summary,
    };
}
