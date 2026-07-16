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

    // Build adjacency indexes from relationships
    const outgoing = new Map<string, MemoRelationship[]>();
    const incoming = new Map<string, MemoRelationship[]>();
    for (const rel of model.relationships) {
        if (!outgoing.has(rel.sourceId)) outgoing.set(rel.sourceId, []);
        outgoing.get(rel.sourceId)!.push(rel);
        if (!incoming.has(rel.targetId)) incoming.set(rel.targetId, []);
        incoming.get(rel.targetId)!.push(rel);
    }

    const visited = new Set<string>();
    visited.add(elementId);

    const nodes: ImpactNode[] = [];
    const edges: ImpactEdge[] = [];

    // BFS queue: [elementId, depth]
    const queue: [string, number][] = [[elementId, 0]];

    while (queue.length > 0) {
        const [currentId, depth] = queue.shift()!;
        if (depth >= maxDepth) continue;

        const nextDepth = depth + 1;

        // Downstream: follow outgoing relationships
        if (direction === 'downstream' || direction === 'both') {
            for (const rel of outgoing.get(currentId) || []) {
                const targetId = rel.targetId;
                edges.push({ fromId: currentId, toId: targetId, relType: rel.type, relId: rel.id });

                if (!visited.has(targetId)) {
                    visited.add(targetId);
                    const target = model.elements[targetId];
                    if (target) {
                        nodes.push({
                            elementId: targetId,
                            name: target.name,
                            kind: target.kind,
                            layer: target.layer,
                            depth: nextDepth,
                            viaRelType: rel.type,
                            direction: 'downstream',
                        });
                        queue.push([targetId, nextDepth]);
                    }
                }
            }
        }

        // Upstream: follow incoming relationships
        if (direction === 'upstream' || direction === 'both') {
            for (const rel of incoming.get(currentId) || []) {
                const sourceId = rel.sourceId;
                edges.push({ fromId: sourceId, toId: currentId, relType: rel.type, relId: rel.id });

                if (!visited.has(sourceId)) {
                    visited.add(sourceId);
                    const source = model.elements[sourceId];
                    if (source) {
                        nodes.push({
                            elementId: sourceId,
                            name: source.name,
                            kind: source.kind,
                            layer: source.layer,
                            depth: nextDepth,
                            viaRelType: rel.type,
                            direction: 'upstream',
                        });
                        queue.push([sourceId, nextDepth]);
                    }
                }
            }
        }
    }

    // Sort by depth, then name
    nodes.sort((a, b) => a.depth - b.depth || a.name.localeCompare(b.name));

    return {
        rootId: elementId,
        rootName: root.name,
        rootKind: root.kind,
        nodes,
        edges,
    };
}
