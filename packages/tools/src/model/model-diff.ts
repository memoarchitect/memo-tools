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
    /** The language construct (`item`, `port`, `interface`, …) and whether this is its definition. */
    construct?: string;
    isDefinition?: boolean;
    owner?: string;
    portSpec?: { type: string; isConjugated?: boolean };
    /** An action's parameters: the item a flow carries is declared here when the flow names none with `of`. */
    parameters?: readonly { name: string; direction: string; type: string }[];
    attributeMultiplicity?: Record<string, string>;
    enumMembers?: readonly string[];
}

export interface DiffRelationship {
    id: string;
    type: string;
    sourceId: string;
    targetId: string;
    /** The `flow def` or `interface def` the link is declared as. */
    kind?: string;
    /** The item a flow carries. */
    flowItem?: string;
    /** The port or feature at the source end; on a succession, the guard (`[g]`) it is taken under. */
    sourceEnd?: string;
    targetEnd?: string;
    sourcePortId?: string;
    targetPortId?: string;
    attributes?: Record<string, string>;
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
    /** Links with the same type and ends on both sides whose content differs. */
    changedRels: { relationship: R; before: R; changes: string[] }[];
    summary: { added: number; removed: number; changed: number; addedRels: number; removedRels: number; changedRels: number };
}

/** What differs between two links with the same type and ends. */
function linkChanges(before: DiffRelationship, after: DiffRelationship): string[] {
    const changes: string[] = [];
    const field = (label: string, b: string | undefined, a: string | undefined) => {
        if ((b ?? '') !== (a ?? '')) changes.push(`${label}: ${b || '(none)'} → ${a || '(none)'}`);
    };
    field('kind', before.kind, after.kind);
    field('item', before.flowItem, after.flowItem);
    field(after.type === 'succession' ? 'guard' : 'source end', before.sourceEnd, after.sourceEnd);
    field('target end', before.targetEnd, after.targetEnd);
    field('source port', before.sourcePortId, after.sourcePortId);
    field('target port', before.targetPortId, after.targetPortId);
    const b = before.attributes ?? {};
    const a = after.attributes ?? {};
    for (const key of [...new Set([...Object.keys(b), ...Object.keys(a)])].sort()) field(key, b[key], a[key]);
    return changes;
}

const parameterText = (element: DiffElement) =>
    (element.parameters ?? []).map(p => `${p.direction} ${p.name} : ${p.type}`).join('; ');

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
        if (parameterText(b) !== parameterText(a)) changes.push(`parameters: ${parameterText(b) || '(none)'} → ${parameterText(a) || '(none)'}`);
        const bounds = (e: DiffElement, key: string) => e.attributeMultiplicity?.[key] ?? '1..1';
        for (const key of [...new Set([...Object.keys(b.attributeMultiplicity ?? {}), ...Object.keys(a.attributeMultiplicity ?? {})])].sort()) {
            if (bounds(b, key) !== bounds(a, key)) changes.push(`multiplicity of ${key}: ${bounds(b, key)} → ${bounds(a, key)}`);
        }
        if ((b.enumMembers ?? []).join() !== (a.enumMembers ?? []).join()) changes.push(`members: ${(b.enumMembers ?? []).join(', ')} → ${(a.enumMembers ?? []).join(', ')}`);
        if (changes.length > 0) changed.push({ element: a, changes });
    }

    // A relationship is what it joins, not the id it was numbered with: ids are assigned in the order the
    // builder meets the links, so one new file renumbers every link after it, and two models of different
    // commits would disagree about every one. Links are matched by type and ends, as a multiset. Among links
    // with one signature, those with identical content pair off first, so a link that changed is not paired
    // with a twin that did not; what is left pairs in order and is a changed link.
    const signature = (r: R) => `${r.type}\u0000${r.sourceId}\u0000${r.targetId}`;
    const waiting = new Map<string, R[]>();
    for (const r of before.relationships) waiting.set(signature(r), [...(waiting.get(signature(r)) ?? []), r]);
    const unmatched: R[] = [];
    for (const r of after.relationships) {
        const candidates = waiting.get(signature(r));
        const same = candidates?.findIndex(b => linkChanges(b, r).length === 0) ?? -1;
        if (same >= 0) candidates!.splice(same, 1);
        else unmatched.push(r);
    }
    const addedRels: R[] = [];
    const changedRels: ModelDiff<E, R>['changedRels'] = [];
    for (const r of unmatched) {
        const previous = waiting.get(signature(r))?.shift();
        if (previous) changedRels.push({ relationship: r, before: previous, changes: linkChanges(previous, r) });
        else addedRels.push(r);
    }
    const removedRels = [...waiting.values()].flat();

    return {
        added, removed, changed, addedRels, removedRels, changedRels,
        summary: {
            added: added.length, removed: removed.length, changed: changed.length,
            addedRels: addedRels.length, removedRels: removedRels.length, changedRels: changedRels.length,
        },
    };
}

/** A built model in the shape the diff reads. */
export function diffInputOf(model: MemoModel): DiffInput {
    const elements: Record<string, DiffElement> = {};
    for (const element of model.elements.values()) {
        elements[element.id] = {
            id: element.id, name: element.shortName ?? element.name, kind: element.kind, layer: element.layer,
            doc: element.doc, attributes: element.attributes ?? {}, parameters: element.parameters,
            construct: element.construct, isDefinition: element.isDefinition, owner: element.owner, portSpec: element.portSpec,
            attributeMultiplicity: element.attributeMultiplicity, enumMembers: element.enumMembers,
        };
    }
    return {
        elements,
        relationships: [...model.relationships.values()].map(r => ({
            id: r.id, type: r.type, sourceId: r.sourceId, targetId: r.targetId, kind: r.kind, flowItem: r.flowItem,
            sourceEnd: r.sourceEnd, targetEnd: r.targetEnd,
            sourcePortId: r.sourcePortId, targetPortId: r.targetPortId, attributes: r.attributes,
        })),
    };
}

/** A diff reduced to what crosses the wire: ids, names, kinds, and what changed. */
export interface ModelDiffSummary {
    added: { id: string; name: string; kind: string }[];
    removed: { id: string; name: string; kind: string }[];
    changed: { id: string; name: string; kind: string; changes: string[] }[];
    addedRels: { id: string; type: string; source: string; target: string }[];
    removedRels: { id: string; type: string; source: string; target: string }[];
    changedRels: { id: string; type: string; source: string; target: string; changes: string[] }[];
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
        changedRels: diff.changedRels.map(c => ({ id: c.relationship.id, type: c.relationship.type, source: name(after, c.relationship.sourceId), target: name(after, c.relationship.targetId), changes: c.changes })),
        summary: diff.summary,
    };
}
