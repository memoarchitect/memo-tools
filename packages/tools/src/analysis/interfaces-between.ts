// ─── Interfaces between two elements ────────────────────────────────────────
//
// Every interface in the model joins two PORTS, and a port belongs to an
// element. "What interfaces are there between node A and node B" is therefore
// a question about the ports' owners, and answering it by hand means chasing
// each port to the part that declares it. This does that once, for any two
// elements of any kind, on any layer: two ROS nodes, a controller and a
// driver board, two software components.
//
// Nothing here knows what a ROS node, a topic or a port type is. An interface
// is a relationship whose `type` is `interface`; the ontology kind it was
// declared as (`RosTopicInterface`, `PhysicalInterface`, ...) arrives as the
// relationship's `kind`, and a caller that wants "every ROS interface" or
// "every physical interface" passes the supertype and the ontology's own
// specialization chain decides what matches.
// ─────────────────────────────────────────────────────────────────────────────

import type { MemoElement, MemoModelDTO, MemoRelationship } from '../model/semantic.js';
import { carriedItem, flowsOver } from './where-used.js';

export interface InterfaceEnd {
    /** The port, or the element the interface is drawn to when it names no port. */
    portId: string;
    /** The element whose boundary the port is on (the one that was asked about). */
    ownerId: string;
    /** The port the interface is written on, when `portId` is reached from it through `bind`. */
    viaPortId?: string;
}

export interface InterfaceBetween {
    id: string;
    name: string;
    /** The ontology kind the interface was declared as, if it was typed. */
    kind?: string;
    attributes: Record<string, string>;
    /** Ends in declaration order; `from` is the interface's source end. */
    from: InterfaceEnd;
    to: InterfaceEnd;
    /** The flows that run over it and the item each carries, when it names or implies one. */
    carries: { flowId: string; item?: string }[];
    /** True when the interface runs from the second element to the first. */
    reversed: boolean;
}

export interface InterfacesBetweenOptions {
    /** Keep only interfaces of this kind or a specialization of it. */
    kind?: string;
    /**
     * Whether `kind` matches `ancestor`, by the ontology's specialization chain.
     * Required with `kind`; without it only an exact kind name matches.
     */
    kindConforms?: (kind: string, ancestor: string) => boolean;
    /**
     * Count an interface on a port of something NESTED inside either element.
     * Defaults to true: a node that owns an inner part which owns the port is
     * still the node the interface leaves. It also follows `bind`: a link to a
     * nested part goes through a port on its parent, bound to the part's own.
     */
    includeNested?: boolean;
}

/** The owner chain of an element id, nearest first, ending at the element itself. */
function ancestry(model: MemoModelDTO, id: string): string[] {
    const chain: string[] = [];
    const seen = new Set<string>();
    let current: string | undefined = id;
    while (current && !seen.has(current)) {
        seen.add(current);
        chain.push(current);
        current = model.elements[current]?.owner;
    }
    return chain;
}

export function interfacesBetween(
    model: MemoModelDTO,
    a: string,
    b: string,
    options: InterfacesBetweenOptions = {},
): InterfaceBetween[] {
    const includeNested = options.includeNested ?? true;
    const matchesKind = (relationship: MemoRelationship): boolean => {
        if (!options.kind) return true;
        if (!relationship.kind) return false;
        return relationship.kind === options.kind
            || (options.kindConforms?.(relationship.kind, options.kind) ?? false);
    };
    /** Which of the two asked-about elements an end belongs to, if either. */
    const ownerOf = (endId: string): string | undefined => {
        const chain = includeNested ? ancestry(model, endId) : [endId, model.elements[endId]?.owner ?? ''];
        return chain.find(id => id === a || id === b);
    };
    /** Definitions by short name, built on first use; a name two packages define resolves to neither. */
    let definitionIndex: Map<string, MemoElement | undefined> | undefined;
    const definitions = () => {
        if (definitionIndex) return definitionIndex;
        definitionIndex = new Map();
        for (const e of Object.values(model.elements)) {
            if (!e.isDefinition) continue;
            const name = e.shortName ?? e.name;
            definitionIndex.set(name, definitionIndex.has(name) ? undefined : e);
        }
        return definitionIndex;
    };
    /** The element a link end reaches: `q` on a part is the port of that name on the part or on its definition. */
    const portOf = (elementId: string, end: string | undefined): string | undefined => {
        let current = elementId;
        for (const segment of (end ?? '').split('.').filter(Boolean)) {
            const owned = `${current}::${segment}`;
            if (model.elements[owned]) { current = owned; continue; }
            const element = model.elements[current];
            const definition = element && !element.isDefinition ? definitions().get(element.kind) : undefined;
            const inherited = definition ? `${definition.id}::${segment}` : undefined;
            if (!inherited || !model.elements[inherited]) return undefined;
            current = inherited;
        }
        return current === elementId ? undefined : current;
    };
    interface BoundEnd { elementId: string; port: string }
    const bound = new Map<string, BoundEnd[]>();
    for (const { type, sourceId, sourceEnd, targetId, targetEnd } of model.relationships) {
        if (type !== 'bind') continue;
        const source = { elementId: sourceId, port: portOf(sourceId, sourceEnd) ?? sourceId };
        const target = { elementId: targetId, port: portOf(targetId, targetEnd) ?? targetId };
        bound.set(source.port, [...(bound.get(source.port) ?? []), target]);
        bound.set(target.port, [...(bound.get(target.port) ?? []), source]);
    }
    /** An end as asked about: on the element it names, or on the first end bound to it that belongs to either element. */
    const resolve = (elementId: string, end: string | undefined): InterfaceEnd | undefined => {
        const written = portOf(elementId, end) ?? elementId;
        const direct = ownerOf(elementId);
        if (direct) return { portId: written, ownerId: direct };
        if (!includeNested) return undefined;
        const seen = new Set([written]);
        const queue = [written];
        for (const port of queue) {
            for (const next of bound.get(port) ?? []) {
                if (seen.has(next.port)) continue;
                seen.add(next.port);
                const ownerId = ownerOf(next.elementId);
                if (ownerId) return { portId: next.port, ownerId, viaPortId: written };
                queue.push(next.port);
            }
        }
        return undefined;
    };

    const found: InterfaceBetween[] = [];
    for (const relationship of model.relationships) {
        if (relationship.type !== 'interface' || !matchesKind(relationship)) continue;
        const from = resolve(relationship.sourcePortId ?? relationship.sourceId, relationship.sourceEnd);
        const to = resolve(relationship.targetPortId ?? relationship.targetId, relationship.targetEnd);
        if (!from || !to || from.ownerId === to.ownerId) continue;
        found.push({
            id: relationship.id,
            name: relationship.shortName ?? relationship.id,
            kind: relationship.kind,
            attributes: relationship.attributes ?? {},
            from,
            to,
            carries: flowsOver(relationship, model.relationships).map(flow => ({ flowId: flow.id, item: carriedItem(flow, id => model.elements[id]) })),
            reversed: from.ownerId === b,
        });
    }
    return found.sort((x, y) => x.id.localeCompare(y.id));
}
