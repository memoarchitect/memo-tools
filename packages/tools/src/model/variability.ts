// ─── Design options: what a release selects ──────────────────────────────────
//
// A variation point owns variants (`variant` edges, variation point to variant). A variant
// exists for a feature (`realizesFeature`, variant to feature), and a release record selects
// features (`selectsFeature`, record to feature). So a release selects a variant exactly when
// it selects a feature the variant realizes, and `selectRelease` is that join, nothing more:
// it reads the relations the builder made from the ontology's typed dependencies and names
// none of the model's kinds. Pure, so the Architect runs the same function in the browser.
// ─────────────────────────────────────────────────────────────────────────────

import type { MemoRelationship } from './semantic.js';

/** The part of a model the join reads. */
export interface VariabilityGraph {
    elements: { get(id: string): { owner?: string } | undefined; keys(): Iterable<string> };
    relationships: readonly MemoRelationship[];
}

export interface VariationPointSelection {
    /** The variation (a usage or a definition that owns the variants). */
    variationPoint: string;
    /** Every variant it owns or references, in declaration order. */
    variants: string[];
    /** The variants the release selects: each realizes a feature the release selects. */
    selected: string[];
    /** Variants that realize no feature. A release can neither select nor drop them; they stay in the view. */
    unbound: string[];
}

export interface ReleaseSelection {
    record: string;
    /** The features the record selects. */
    features: string[];
    points: VariationPointSelection[];
    /** Variants the release does not select, and everything they own: the 100% view leaves these out. */
    excluded: Set<string>;
    /**
     * The variation points of the item the record is a release of (`releaseOf`) that it leaves
     * unresolved: the point owns at least one variant that realizes a feature, is not itself in an
     * excluded variant, and the record selects zero or several of its variants rather than one.
     * Empty for a record with no `releaseOf`: there is no item to judge. CR-ONT-090's exactly-one
     * half is this list, for an approved or released record.
     */
    unresolved: string[];
}

/** The variation points of a model with their variants and the features the variants realize. */
export function variationPoints(graph: VariabilityGraph): { variationPoint: string; variants: string[] }[] {
    const points = new Map<string, string[]>();
    for (const r of graph.relationships) {
        if (r.type !== 'variant') continue;
        const variants = points.get(r.sourceId) ?? [];
        if (!variants.includes(r.targetId)) variants.push(r.targetId);
        points.set(r.sourceId, variants);
    }
    return [...points].map(([variationPoint, variants]) => ({ variationPoint, variants }));
}

/** The features each variant realizes. */
export function realizedFeatures(graph: VariabilityGraph): Map<string, string[]> {
    const byVariant = new Map<string, string[]>();
    for (const r of graph.relationships) {
        if (r.type !== 'realizesFeature') continue;
        const features = byVariant.get(r.sourceId) ?? [];
        if (!features.includes(r.targetId)) features.push(r.targetId);
        byVariant.set(r.sourceId, features);
    }
    return byVariant;
}

/** The features a record selects. */
export function selectedFeatures(graph: VariabilityGraph, recordId: string): string[] {
    return [...new Set(graph.relationships.filter(r => r.type === 'selectsFeature' && r.sourceId === recordId).map(r => r.targetId))];
}

/** Whether `id` is `ancestor` or owned, at any depth, by it. */
function within(graph: VariabilityGraph, id: string, ancestor: Set<string>): boolean {
    for (let current: string | undefined = id, hops = 0; current && hops < 1000; hops++) {
        if (ancestor.has(current)) return true;
        current = graph.elements.get(current)?.owner;
    }
    return false;
}

/** The release's view of the model's design options: which variants it selects and which it leaves out. */
export function selectRelease(graph: VariabilityGraph, recordId: string): ReleaseSelection {
    const features = selectedFeatures(graph, recordId);
    const chosen = new Set(features);
    const realized = realizedFeatures(graph);
    const points: VariationPointSelection[] = [];
    const dropped = new Set<string>();
    for (const { variationPoint, variants } of variationPoints(graph)) {
        const selected: string[] = [];
        const unbound: string[] = [];
        for (const variant of variants) {
            const own = realized.get(variant) ?? [];
            if (own.length === 0) unbound.push(variant);
            else if (own.some(feature => chosen.has(feature))) selected.push(variant);
            else dropped.add(variant);
        }
        points.push({ variationPoint, variants, selected, unbound });
    }
    // A variant another point also selects stays; only a variant nothing selects is left out.
    for (const point of points) for (const variant of point.selected) dropped.delete(variant);
    const excluded = closeOverOwnership(graph, dropped);
    return { record: recordId, features, points, excluded, unresolved: unresolvedPoints(graph, recordId, points, excluded) };
}

/** The item a record is a release of, and the variation points that item owns. */
function unresolvedPoints(graph: VariabilityGraph, recordId: string, points: VariationPointSelection[], excluded: Set<string>): string[] {
    const items = new Set(graph.relationships.filter(r => r.type === 'releaseOf' && r.sourceId === recordId).map(r => r.targetId));
    if (items.size === 0) return [];
    const realized = realizedFeatures(graph);
    return points
        .filter(p => p.selected.length !== 1)
        .filter(p => p.variants.some(v => (realized.get(v) ?? []).length > 0))
        .filter(p => !excluded.has(p.variationPoint))
        .filter(p => ownedBy(graph, p.variationPoint, items))
        .map(p => p.variationPoint);
}

/** Whether `id` is owned, at any depth, by one of `owners` (not the owner itself). */
function ownedBy(graph: VariabilityGraph, id: string, owners: Set<string>): boolean {
    const own = graph.elements.get(id)?.owner;
    return own !== undefined && within(graph, own, owners);
}

function closeOverOwnership(graph: VariabilityGraph, roots: Set<string>): Set<string> {
    const all = new Set<string>(roots);
    if (roots.size === 0) return all;
    for (const id of graph.elements.keys()) if (!all.has(id) && within(graph, id, roots)) all.add(id);
    return all;
}
