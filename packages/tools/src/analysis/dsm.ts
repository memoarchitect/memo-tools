// ─── Design Structure Matrix (DSM) Analysis ────────────────────────────────
//
// Builds an N×N dependency matrix from relationships between elements.
// Supports filtering by element kinds and relationship types.
// Includes partitioning/clustering to suggest architectural groupings.
// ─────────────────────────────────────────────────────────────────────────────

import type { MemoModelDTO, MemoElement, MemoRelationship } from '../model/semantic.js';

/** A single cell in the DSM matrix */
export interface DSMCell {
    /** Number of relationships from row element to column element */
    count: number;
    /** Relationship types present in this cell */
    types: string[];
    /** Flow items carried (for flow relationships) */
    flowItems: string[];
}

/** DSM computation result */
export interface DSMResult {
    /** Ordered element IDs (both row and column axis) */
    elementIds: string[];
    /** Element metadata indexed by ID */
    elements: Record<string, { name: string; kind: string; layer: string; allocatedTo?: string }>;
    /** The N×N matrix: matrix[rowIdx][colIdx] */
    matrix: (DSMCell | null)[][];
    /** Cluster assignments: clusterId → element IDs */
    clusters: Map<number, string[]>;
    /** Total number of dependencies */
    totalDependencies: number;
}

/** Options for DSM computation */
export interface DSMOptions {
    /** Element kinds to include (default: functional kinds) */
    kinds?: string[];
    /** Relationship types to count as dependencies (default: flow, decomposedBy, allocateTo) */
    relationshipTypes?: string[];
    /** Whether to run clustering (default: true) */
    cluster?: boolean;
}

const DEFAULT_KINDS = ['Function', 'Function', 'ActionDefinition', 'ActionUsage'];
const DEFAULT_REL_TYPES = ['flow', 'decomposedBy', 'composedOf', 'allocateTo', 'succession'];

/**
 * Compute a Design Structure Matrix from model elements and relationships.
 */
export function computeDSM(model: MemoModelDTO, options?: DSMOptions): DSMResult {
    const kinds = new Set(options?.kinds ?? DEFAULT_KINDS);
    const relTypes = new Set(options?.relationshipTypes ?? DEFAULT_REL_TYPES);
    const shouldCluster = options?.cluster ?? true;

    // 1. Collect eligible elements
    const eligibleElements: MemoElement[] = [];
    for (const el of Object.values(model.elements)) {
        if (kinds.has(el.kind)) {
            eligibleElements.push(el);
        }
    }

    // Sort by kind then name for stable ordering
    eligibleElements.sort((a, b) => {
        const kindCmp = a.kind.localeCompare(b.kind);
        return kindCmp !== 0 ? kindCmp : a.name.localeCompare(b.name);
    });

    const elementIds = eligibleElements.map(e => e.id);
    const idToIdx = new Map<string, number>();
    for (let i = 0; i < elementIds.length; i++) {
        idToIdx.set(elementIds[i], i);
    }

    const n = elementIds.length;

    // 2. Build elements metadata
    const elements: DSMResult['elements'] = {};
    for (const el of eligibleElements) {
        elements[el.id] = {
            name: el.name,
            kind: el.kind,
            layer: el.layer,
            allocatedTo: el.allocatedTo,
        };
    }

    // 3. Build the matrix
    const matrix: (DSMCell | null)[][] = Array.from({ length: n }, () =>
        Array.from({ length: n }, () => null),
    );

    let totalDependencies = 0;

    for (const rel of model.relationships) {
        if (!relTypes.has(rel.type)) continue;

        const srcIdx = idToIdx.get(rel.sourceId);
        const tgtIdx = idToIdx.get(rel.targetId);
        if (srcIdx === undefined || tgtIdx === undefined) continue;
        if (srcIdx === tgtIdx) continue; // skip self-loops

        let cell = matrix[srcIdx][tgtIdx];
        if (!cell) {
            cell = { count: 0, types: [], flowItems: [] };
            matrix[srcIdx][tgtIdx] = cell;
        }

        cell.count++;
        if (!cell.types.includes(rel.type)) {
            cell.types.push(rel.type);
        }
        if (rel.flowItem && !cell.flowItems.includes(rel.flowItem)) {
            cell.flowItems.push(rel.flowItem);
        }
        totalDependencies++;
    }

    // 4. Clustering (simple adjacency-based connected components)
    const clusters = shouldCluster
        ? clusterDSM(elementIds, matrix)
        : new Map<number, string[]>();

    return { elementIds, elements, matrix, clusters, totalDependencies };
}

/**
 * Simple clustering: group elements that are connected (directly or transitively).
 * Uses union-find for connected component detection.
 */
function clusterDSM(
    elementIds: string[],
    matrix: (DSMCell | null)[][],
): Map<number, string[]> {
    const n = elementIds.length;
    const parent = Array.from({ length: n }, (_, i) => i);
    const rank = new Array(n).fill(0);

    function find(x: number): number {
        if (parent[x] !== x) parent[x] = find(parent[x]);
        return parent[x];
    }

    function union(a: number, b: number): void {
        const ra = find(a);
        const rb = find(b);
        if (ra === rb) return;
        if (rank[ra] < rank[rb]) { parent[ra] = rb; }
        else if (rank[ra] > rank[rb]) { parent[rb] = ra; }
        else { parent[rb] = ra; rank[ra]++; }
    }

    // Union elements that have any dependency (either direction)
    for (let i = 0; i < n; i++) {
        for (let j = 0; j < n; j++) {
            if (i !== j && (matrix[i][j] || matrix[j][i])) {
                union(i, j);
            }
        }
    }

    // Collect clusters
    const clusterMap = new Map<number, string[]>();
    for (let i = 0; i < n; i++) {
        const root = find(i);
        if (!clusterMap.has(root)) clusterMap.set(root, []);
        clusterMap.get(root)!.push(elementIds[i]);
    }

    // Re-key clusters with sequential IDs
    const result = new Map<number, string[]>();
    let clusterId = 0;
    for (const members of clusterMap.values()) {
        result.set(clusterId++, members);
    }
    return result;
}

/**
 * Reorder DSM elements to minimize off-diagonal dependencies (band optimization).
 * Groups clustered elements together and returns the reordered result.
 */
export function reorderDSM(dsm: DSMResult): DSMResult {
    // Build ordered list: cluster members together
    const ordered: string[] = [];
    const placed = new Set<string>();

    // Place clustered elements in order
    for (const [, members] of dsm.clusters) {
        for (const id of members) {
            if (!placed.has(id)) {
                ordered.push(id);
                placed.add(id);
            }
        }
    }

    // Place any remaining (shouldn't happen, but safety)
    for (const id of dsm.elementIds) {
        if (!placed.has(id)) {
            ordered.push(id);
        }
    }

    // Rebuild matrix with new ordering
    const n = ordered.length;
    const oldIdx = new Map<string, number>();
    for (let i = 0; i < dsm.elementIds.length; i++) {
        oldIdx.set(dsm.elementIds[i], i);
    }

    const matrix: (DSMCell | null)[][] = Array.from({ length: n }, () =>
        Array.from({ length: n }, () => null),
    );

    for (let newRow = 0; newRow < n; newRow++) {
        for (let newCol = 0; newCol < n; newCol++) {
            const oldRow = oldIdx.get(ordered[newRow])!;
            const oldCol = oldIdx.get(ordered[newCol])!;
            matrix[newRow][newCol] = dsm.matrix[oldRow][oldCol];
        }
    }

    return {
        ...dsm,
        elementIds: ordered,
        matrix,
    };
}
