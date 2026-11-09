// ─── Where a definition is used ──────────────────────────────────────────────
//
// An item, a port or an interface definition is used by the flows that carry it, the links typed by it, the ports
// typed by it and the action parameters typed by it. Those four answer both "what does this touch" on an element's
// page and "who does this change break" in `contract-changes.ts`, so they are worked out here, once.
//
// Nothing here names an ontology kind. Pure and browser-safe.
// ─────────────────────────────────────────────────────────────────────────────

import type { DiffElement, DiffRelationship } from '../model/model-diff.js';
import type { MemoElement, MemoModelDTO, MemoRelationship } from '../model/semantic.js';

export const leafName = (name: string) => name.slice(name.lastIndexOf(':') + 1);

type Lookup<E> = (id: string) => E | undefined;

/** The item a flow carries: the one it names, or the type of the parameter at its source end. */
export function carriedItem<E extends DiffElement>(flow: DiffRelationship, element: Lookup<E>): string | undefined {
    if (flow.flowItem) return leafName(flow.flowItem);
    const parameter = element(flow.sourceId)?.parameters?.find(p => p.name === flow.sourceEnd);
    return parameter ? leafName(parameter.type) : undefined;
}

export interface DefinitionUses<E, R> {
    flows: R[];
    typedLinks: R[];
    ports: E[];
    parameters: { element: E; name: string; direction: string }[];
}

export function definitionUses<E extends DiffElement, R extends DiffRelationship>(
    definitionName: string, elements: readonly E[], relationships: readonly R[], element: Lookup<E>,
): DefinitionUses<E, R> {
    return {
        flows: relationships.filter(r => r.type === 'flow' && carriedItem(r, element) === definitionName),
        typedLinks: relationships.filter(r => r.kind && leafName(r.kind) === definitionName),
        ports: elements.filter(e => e.portSpec && leafName(e.portSpec.type) === definitionName && e.owner),
        parameters: elements.flatMap(e => (e.parameters ?? [])
            .filter(p => leafName(p.type) === definitionName)
            .map(p => ({ element: e, name: p.name, direction: p.direction }))),
    };
}

/** The flows that run over an interface: between its two ends, or a feature inside them, in the same direction. */
export function flowsOver<R extends DiffRelationship>(link: DiffRelationship, relationships: readonly R[]): R[] {
    const within = (flowEnd: string | undefined, linkEnd: string | undefined) =>
        !linkEnd || flowEnd === linkEnd || (flowEnd ?? '').startsWith(`${linkEnd}.`);
    return relationships.filter(r => r.type === 'flow' && r.sourceId === link.sourceId && r.targetId === link.targetId
        && within(r.sourceEnd, link.sourceEnd) && within(r.targetEnd, link.targetEnd));
}

export interface UsedElement { id: string; name: string; kind: string }
export interface UsedLink { id: string; source: UsedElement; target: UsedElement; item?: string; kind?: string }
export interface WhereUsed {
    producers: UsedElement[];
    consumers: UsedElement[];
    flows: UsedLink[];
    interfaces: UsedLink[];
    ports: (UsedElement & { owner: UsedElement })[];
    behaviours: UsedElement[];
}

/** Everything that uses a definition, read from the model; empty for an id that is not one. */
export function whereUsed(model: MemoModelDTO, id: string): WhereUsed {
    const none: WhereUsed = { producers: [], consumers: [], flows: [], interfaces: [], ports: [], behaviours: [] };
    const definition = model.elements[id];
    if (!definition?.isDefinition) return none;
    const element = (key: string) => model.elements[key];
    const all = Object.values(model.elements);
    const used = (key: string): UsedElement => ({ id: key, name: element(key)?.name ?? leafName(key), kind: element(key)?.kind ?? '' });
    const uses = definitionUses<MemoElement, MemoRelationship>(definition.shortName ?? definition.name, all, model.relationships, element);
    const link = (r: MemoRelationship): UsedLink => ({
        id: r.id, source: used(r.sourceId), target: used(r.targetId), item: carriedItem(r, element), kind: r.kind,
    });
    const distinct = <T extends { id: string }>(rows: T[]) => [...new Map(rows.map(row => [row.id, row])).values()];
    const byName = <T extends { name: string }>(rows: T[]) => rows.sort((a, b) => a.name.localeCompare(b.name));
    const root = (key: string) => {
        let current = key;
        const seen = new Set<string>();
        while (element(current)?.parentAction && !seen.has(current)) { seen.add(current); current = element(current)!.parentAction!; }
        return current;
    };
    const interfaceLinks = model.relationships.filter(r => r.type === 'interface');
    const steps = [...uses.flows.map(f => f.sourceId), ...uses.parameters.map(p => p.element.id)].filter(key => element(key)?.parentAction);
    return {
        producers: byName(distinct([
            ...uses.flows.map(f => used(f.sourceId)),
            ...uses.parameters.filter(p => p.direction === 'out').map(p => used(p.element.id)),
        ])),
        consumers: byName(distinct([
            ...uses.flows.map(f => used(f.targetId)),
            ...uses.parameters.filter(p => p.direction === 'in').map(p => used(p.element.id)),
        ])),
        flows: uses.flows.map(link),
        interfaces: [
            ...uses.typedLinks.filter(r => r.type === 'interface'),
            ...interfaceLinks.filter(i => flowsOver(i, uses.flows).length > 0),
        ].filter((r, index, rows) => rows.indexOf(r) === index).map(link),
        ports: byName(uses.ports.map(p => ({ ...used(p.id), owner: used(p.owner!) }))),
        behaviours: byName(distinct(steps.map(key => used(root(key))))),
    };
}
