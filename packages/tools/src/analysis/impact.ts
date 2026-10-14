// ─── Impact Analysis ────────────────────────────────────────────────────────
//
// BFS traversal from a root element through relationship graph.
// Supports downstream (follow outgoing), upstream (follow incoming), or both.
// ─────────────────────────────────────────────────────────────────────────────

import type { MemoModelDTO, MemoRelationship } from '../model/semantic.js';

export interface ImpactNode {
    elementId: string;
    name: string;
    kind: string;
    layer: string;
    depth: number;
    /** Relationship type that connects this node to its parent in the traversal */
    viaRelType: string;
    /** Direction of the relationship from the parent's perspective */
    direction: 'downstream' | 'upstream';
}

export interface ImpactEdge {
    fromId: string;
    toId: string;
    relType: string;
    relId: string;
}

export interface ImpactResult {
    rootId: string;
    rootName: string;
    rootKind: string;
    nodes: ImpactNode[];
    edges: ImpactEdge[];
}

export type ImpactDirection = 'downstream' | 'upstream' | 'both';

/** The part of a model the traversal reads: elements by id, and the links between them. */
export interface ImpactGraph {
    element(id: string): { name: string; kind: string; layer: string } | undefined;
    links: Iterable<{ id: string; type: string; sourceId: string; targetId: string }>;
}

export interface TraverseOptions {
    direction?: ImpactDirection;
    maxDepth?: number;
    /** Relation types never followed (`composes`: containment is not a dependency). */
    skipTypes?: ReadonlySet<string>;
    /** Elements reached and listed, but not expanded: the traversal does not pass through them. */
    stopAt?: ReadonlySet<string>;
}

/**
 * BFS from one or several roots over a graph. The roots are not in the result's nodes. One traversal
 * serves an element's neighbourhood (`computeImpact`) and the reach of a whole change (`model/impact.ts`).
 */
export function traverseImpact(
    graph: ImpactGraph, roots: readonly string[], options: TraverseOptions = {},
): { nodes: ImpactNode[]; edges: ImpactEdge[] } {
    const { direction = 'both', maxDepth = 10, skipTypes, stopAt } = options;
    const outgoing = new Map<string, { id: string; type: string; sourceId: string; targetId: string }[]>();
    const incoming = new Map<string, { id: string; type: string; sourceId: string; targetId: string }[]>();
    for (const rel of graph.links) {
        if (skipTypes?.has(rel.type)) continue;
        (outgoing.get(rel.sourceId) ?? outgoing.set(rel.sourceId, []).get(rel.sourceId)!).push(rel);
        (incoming.get(rel.targetId) ?? incoming.set(rel.targetId, []).get(rel.targetId)!).push(rel);
    }
    const visited = new Set<string>(roots);
    const nodes: ImpactNode[] = [];
    const edges: ImpactEdge[] = [];
    const queue: [string, number][] = roots.map(id => [id, 0]);
    const reach = (id: string, from: string, rel: { id: string; type: string }, depth: number, way: 'downstream' | 'upstream') => {
        if (visited.has(id)) return;
        visited.add(id);
        const element = graph.element(id);
        if (!element) return;
        nodes.push({ elementId: id, name: element.name, kind: element.kind, layer: element.layer, depth, viaRelType: rel.type, direction: way });
        if (!stopAt?.has(id)) queue.push([id, depth]);
    };
    for (let next = 0; next < queue.length; next++) {
        const [currentId, depth] = queue[next];
        if (depth >= maxDepth) continue;
        if (direction === 'downstream' || direction === 'both') {
            for (const rel of outgoing.get(currentId) ?? []) {
                edges.push({ fromId: currentId, toId: rel.targetId, relType: rel.type, relId: rel.id });
                reach(rel.targetId, currentId, rel, depth + 1, 'downstream');
            }
        }
        if (direction === 'upstream' || direction === 'both') {
            for (const rel of incoming.get(currentId) ?? []) {
                edges.push({ fromId: rel.sourceId, toId: currentId, relType: rel.type, relId: rel.id });
                reach(rel.sourceId, currentId, rel, depth + 1, 'upstream');
            }
        }
    }
    nodes.sort((x, y) => x.depth - y.depth || x.name.localeCompare(y.name));
    return { nodes, edges };
}

/**
 * Compute impact analysis via BFS from a root element.
 *
 * - `downstream`: follows outgoing relationships (what does this element affect?)
 * - `upstream`: follows incoming relationships (what depends on this element?)
 * - `both`: follows both directions
 */
export function computeImpact(
    model: MemoModelDTO,
    elementId: string,
    direction: ImpactDirection = 'both',
    maxDepth: number = 10
): ImpactResult {
    const root = model.elements[elementId];
    if (!root) {
        return { rootId: elementId, rootName: '(unknown)', rootKind: '', nodes: [], edges: [] };
    }
    const { nodes, edges } = traverseImpact({ element: id => model.elements[id], links: model.relationships }, [elementId], { direction, maxDepth });
    return { rootId: elementId, rootName: root.name, rootKind: root.kind, nodes, edges };
}
