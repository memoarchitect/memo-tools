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

import type { MemoModelDTO, MemoRelationship } from '../model/semantic.js';

export interface InterfaceEnd {
    /** The port, or the element the interface is drawn to when it names no port. */
    portId: string;
    /** The element whose boundary the port is on (the one that was asked about). */
    ownerId: string;
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
     * still the node the interface leaves.
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

    const found: InterfaceBetween[] = [];
    for (const relationship of model.relationships) {
        if (relationship.type !== 'interface' || !matchesKind(relationship)) continue;
        const fromPort = relationship.sourcePortId ?? relationship.sourceId;
        const toPort = relationship.targetPortId ?? relationship.targetId;
        const fromOwner = ownerOf(fromPort);
        const toOwner = ownerOf(toPort);
        if (!fromOwner || !toOwner || fromOwner === toOwner) continue;
        found.push({
            id: relationship.id,
            name: relationship.shortName ?? relationship.id,
            kind: relationship.kind,
            attributes: relationship.attributes ?? {},
            from: { portId: fromPort, ownerId: fromOwner },
            to: { portId: toPort, ownerId: toOwner },
            reversed: fromOwner === b,
        });
    }
    return found.sort((x, y) => x.id.localeCompare(y.id));
}
