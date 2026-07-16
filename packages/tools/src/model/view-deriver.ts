// ─── View Deriver ────────────────────────────────────────────────────────────
//
// Derives ViewpointDTO / DiagramDTO entries from views modelled in SysML.
//
// A product model can declare views as part usages of the ontology view kinds
// (DiagramView, DocumentView, and their specializations). Each view carries:
//   - `part viewpoint :> <ontologyViewpoint>;`  → grouping viewpoint
//   - `part selectionQuery { attribute includeElementKinds = {...}; ... }`
//     → captured by the builder as `selectionQuery.*` prefixed attributes
//
// This module projects those elements into the same DTO shapes the web app
// already consumes for config-defined viewpoints, so SysML-modelled views
// appear in the Diagrams browser with an auto-populated element selection.
// ─────────────────────────────────────────────────────────────────────────────

import type { MemoModel, MemoElement, ViewpointDTO, DiagramDTO } from './semantic.js';
import type { KindRegistry } from './kind-registry.js';
import { resolveViewKind } from './view-kinds.js';

/** Kinds whose instances are treated as model-defined views. */
function isViewElement(el: MemoElement, kindRegistry?: KindRegistry): boolean {
    if (el.kind === 'Viewpoint' || el.kind === 'ViewSelectionQuery' || el.kind === 'ViewInclusionRule') return false;
    if (!el.kind.endsWith('View')) return false;
    // Views are declared in the viewpoints group of the ontology; when the
    // registry knows the kind, require that so product kinds named *View
    // (unrelated to the view mechanism) are not swept in.
    const entry = kindRegistry?.getKind(el.kind);
    if (entry && entry.layer !== 'unknown') return entry.layer === 'viewpoints';
    return true;
}

/** Expand a set of kind names with all transitive specializations. */
function expandKinds(kinds: Iterable<string>, kindRegistry?: KindRegistry): Set<string> {
    const expanded = new Set<string>();
    const queue = [...kinds];
    while (queue.length > 0) {
        const k = queue.pop()!;
        if (expanded.has(k)) continue;
        expanded.add(k);
        const entry = kindRegistry?.getKind(k);
        for (const sub of entry?.derivedBy ?? []) queue.push(sub);
    }
    return expanded;
}

function splitList(raw: string | undefined): string[] {
    if (!raw) return [];
    return raw.split(',').map(s => s.trim()).filter(Boolean);
}

/**
 * Resolve the element ids a view selects.
 *
 * Membership comes from two declared sources, both owned by the model:
 *   1. `selectionQuery.includeElementKinds` (specializations included); when no
 *      kinds are given, `includeLayers` selects whole layers instead
 *   2. explicit `IncludedIn` relationships targeting the view
 */
export function resolveViewElementIds(
    view: MemoElement,
    model: MemoModel,
    kindRegistry?: KindRegistry
): string[] {
    const kindList = splitList(view.attributes['selectionQuery.includeElementKinds']);
    const layerList = splitList(view.attributes['selectionQuery.includeLayers']);

    const kinds = expandKinds(kindList, kindRegistry);
    const layers = new Set(layerList);

    const ids = new Set<string>();
    if (kindList.length > 0 || layerList.length > 0) {
        for (const el of model.elements.values()) {
            if (el.id === view.id) continue;
            if (kinds.size > 0 && !kinds.has(el.kind)) continue;
            if (kinds.size === 0 && layers.size > 0 && !layers.has(el.layer)) continue;
            ids.add(el.id);
        }
    }
    for (const rel of model.incoming.get(view.id) ?? []) {
        if (rel.type.toLowerCase() === 'includedin' && rel.sourceId !== view.id) ids.add(rel.sourceId);
    }
    return [...ids];
}

/** Human label from a viewpoint reference like "riskViewpoint" → "Risk". */
function viewpointLabel(ref: string): string {
    const base = ref.replace(/Viewpoint$/, '');
    const spaced = base.replace(/([a-z])([A-Z])/g, '$1 $2');
    return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

export interface DerivedViews {
    viewpoints: ViewpointDTO[];
    diagrams: DiagramDTO[];
}

/**
 * Derive viewpoint and diagram DTOs from view elements modelled in SysML.
 * Views are grouped by their `viewpoint :>` binding; views without one are
 * grouped under a generic "Model Views" viewpoint.
 */
export function deriveModelViews(model: MemoModel, kindRegistry?: KindRegistry): DerivedViews {
    const viewpointsById = new Map<string, ViewpointDTO>();
    const diagrams: DiagramDTO[] = [];

    for (const el of model.elements.values()) {
        if (!isViewElement(el, kindRegistry)) continue;

        // Explicit renderer samples live in path-derived packages containing
        // a `samples` segment and are surfaced under Model Viewpoint > Samples.
        const isRendererSample = el.package
            ? el.package.split('::').some(segment => /(?:^|_)samples(?:_|$)/.test(segment))
            : false;

        // Views without a viewpoint binding are typically document-backed
        // (RMF, SDD, DHF index, ...) — group them under "Document Views".
        const vpRef = el.attributes['viewpoint'] || 'documentViewsViewpoint';
        const vpId = isRendererSample ? '__model' : `vp-${vpRef}`;
        if (!isRendererSample && !viewpointsById.has(vpId)) {
            viewpointsById.set(vpId, {
                id: vpId,
                label: vpRef === 'documentViewsViewpoint' ? 'Document Views' : `${viewpointLabel(vpRef)} Viewpoint`,
                visibleKinds: [],
                visibleRelationships: [],
                visibleLayers: [],
            });
        }
        const vp = viewpointsById.get(vpId);

        const queryKinds = splitList(el.attributes['selectionQuery.includeElementKinds']);
        const queryRels = splitList(el.attributes['selectionQuery.includeRelationshipKinds']);
        if (vp) {
            for (const k of queryKinds) {
                if (!vp.visibleKinds.includes(k)) vp.visibleKinds.push(k);
            }
            for (const l of splitList(el.attributes['selectionQuery.includeLayers'])) {
                if (!vp.visibleLayers.includes(l)) vp.visibleLayers.push(l);
            }
            for (const r of queryRels) {
                if (!vp.visibleRelationships.includes(r)) vp.visibleRelationships.push(r);
            }
        }

        // Presentation hints declared on the view — the renderer stays dumb and
        // just honors them
        const properties: Record<string, string> = {};
        for (const hint of ['layoutHint', 'styleHint', 'presentationKind'] as const) {
            if (el.attributes[hint]) properties[hint] = el.attributes[hint];
        }

        // Every view resolves to exactly one of the 8 spec view kinds: an
        // explicit `viewKind` declaration wins, else the legacy diagramType
        // key maps; document-backed views (no diagramType) become browser.
        const viewKind = resolveViewKind(el.attributes['viewKind'], el.attributes['diagramType']);

        diagrams.push({
            id: isRendererSample ? `diag-sample-${el.id}` : `view-${el.id}`,
            name: el.attributes['title'] || el.name,
            diagramType: el.attributes['diagramType'] || 'bdd',
            viewKind,
            viewpointId: vpId,
            auto: true,
            description: el.attributes['shortDescription'] || el.doc,
            ...(Object.keys(properties).length > 0 ? { properties } : {}),
            elementIds: resolveViewElementIds(el, model, kindRegistry),
            relationshipTypes: queryRels,
            sourceFile: el.file,
        });
    }

    return { viewpoints: [...viewpointsById.values()], diagrams };
}
