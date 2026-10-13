import type { MemoModel } from './semantic.js';
import { toElementIndex } from './element-index.js';

/**
 * The model reduced to the elements in `kept`, for a statement ABOUT those elements (completeness,
 * a workspace's document). It is not a model rules run on: see the note below.
 */
export function narrowModel(full: MemoModel, kept: ReadonlyMap<string, MemoModel['elements'] extends { values(): IterableIterator<infer E> } ? E : never>): MemoModel {
    const byKind = new Map<string, any[]>();
    const byLayer = new Map<string, any[]>();
    for (const element of kept.values()) {
        (byKind.get(element.kind) ?? byKind.set(element.kind, []).get(element.kind)!).push(element);
        (byLayer.get(element.layer) ?? byLayer.set(element.layer, []).get(element.layer)!).push(element);
    }
    // Narrow the SUBJECT SET, not the graph.
    //
    // This used to drop out-of-scope elements from `elements` and filter
    // `relationships` to edges with both endpoints kept — while leaving
    // `outgoing`, `incoming` and `relationshipsByType` pointing at the FULL
    // model. The result was a model that contradicted itself, and every
    // rule that NAVIGATES a trace silently saw nothing: `navigate` looks the
    // far endpoint up in `elements`, so an edge to a dropped element
    // returned no result.
    //
    // Measured on gpca-pump (2026-08-19): 374 of 723 elements dropped, and
    // ALL 110 `satisfiedBy` edges lost an endpoint — every architecture
    // element went, because `filePackages` maps every file, so the
    // module-scope test was applied to architecture kinds that
    // the layer selection governs instead. XL-002 then reported 89 requirements
    // as lacking requirements-to-architecture traceability that the source
    // plainly traces.
    //
    // The comment above already said the intent: "only the subject set
    // narrows". `subjectsForScope` reads `elementsByKind`, so narrowing
    // that alone is both sufficient and consistent.

    const relationships = full.relationships.filter(r => kept.has(r.sourceId) && kept.has(r.targetId));
    const relationshipsByType = new Map<string, typeof relationships>();
    const outgoing = new Map<string, typeof relationships>();
    const incoming = new Map<string, typeof relationships>();
    for (const r of relationships) {
        (relationshipsByType.get(r.type) ?? relationshipsByType.set(r.type, []).get(r.type)!).push(r);
        (outgoing.get(r.sourceId) ?? outgoing.set(r.sourceId, []).get(r.sourceId)!).push(r);
        (incoming.get(r.targetId) ?? incoming.set(r.targetId, []).get(r.targetId)!).push(r);
    }
    return {
        ...full,
        elements: toElementIndex(kept as any),
        elementsByKind: byKind,
        elementsByLayer: byLayer,
        relationships,
        relationshipsByType,
        outgoing,
        incoming,
    };
}
