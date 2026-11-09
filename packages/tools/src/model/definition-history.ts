// ─── One definition across releases ───────────────────────────────────────────
//
// The history of a single definition: what it was in each release and what changed from the one before, read with the
// model diff restricted to that definition and the links that touch or carry it. Pure and browser-safe.

import { computeModelDiff, type DiffElement, type DiffInput, type DiffRelationship } from './model-diff.js';

/** `input` is absent for a release that could not be built. */
export interface HistoryPoint { label: string; commit: string; input?: DiffInput }
export type DefinitionVersionStatus = 'added' | 'changed' | 'unchanged' | 'removed' | 'absent' | 'unavailable';
export interface DefinitionVersion { label: string; commit: string; status: DefinitionVersionStatus; changes: string[] }

const leaf = (id: string) => id.slice(id.lastIndexOf(':') + 1);

function sliceOf(input: DiffInput, id: string, name: string): DiffInput {
    const element: DiffElement | undefined = input.elements[id];
    const touches = (r: DiffRelationship) => r.sourceId === id || r.targetId === id || r.flowItem === name || leaf(r.flowItem ?? '') === name || r.kind === name || leaf(r.kind ?? '') === name;
    return { elements: element ? { [id]: element } : {}, relationships: input.relationships.filter(touches) };
}

/** The definition in each version, newest first. `points` run oldest to newest. */
export function definitionHistory(points: readonly HistoryPoint[], id: string): DefinitionVersion[] {
    const known = points.map(point => point.input?.elements[id]).find(Boolean);
    const name = known?.name || leaf(id);
    const nameOf = (input: DiffInput, elementId: string) => input.elements[elementId]?.name || leaf(elementId);
    return points.map((point, index): DefinitionVersion => {
        const row = { label: point.label, commit: point.commit };
        if (!point.input) return { ...row, status: 'unavailable', changes: [] };
        const present = Boolean(point.input.elements[id]);
        // Compared with the last version that could be read.
        const previous = points.slice(0, index).reverse().find(earlier => earlier.input)?.input;
        const wasPresent = Boolean(previous?.elements[id]);
        if (!present) return { ...row, status: wasPresent ? 'removed' : 'absent', changes: [] };
        if (!previous || !wasPresent) return { ...row, status: 'added', changes: [] };
        const diff = computeModelDiff(sliceOf(previous, id, name), sliceOf(point.input, id, name));
        const link = (r: DiffRelationship, side: DiffInput) => `${r.type} ${nameOf(side, r.sourceId)} → ${nameOf(side, r.targetId)}`;
        const changes = [
            ...(diff.changed[0]?.changes ?? []),
            ...diff.addedRels.map(r => `added ${link(r, point.input!)}`),
            ...diff.removedRels.map(r => `removed ${link(r, previous)}`),
            ...diff.changedRels.map(c => `${link(c.relationship, point.input!)}: ${c.changes.join('; ')}`),
        ];
        return { ...row, status: changes.length > 0 ? 'changed' : 'unchanged', changes };
    }).reverse();
}
