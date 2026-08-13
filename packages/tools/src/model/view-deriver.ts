// ─── View Deriver ────────────────────────────────────────────────────────────
//
// Derives ViewpointDTO / DiagramDTO entries from views modelled in SysML.
//
// A product model can declare views as part usages of the ontology view kinds
// (DiagramView, DocumentView, and their specializations). Each view carries:
//   - `part viewpointDefinition :>> <ontologyViewpoint>;`  → grouping viewpoint
//   - `part selectionQuery { attribute includeElementKinds = {...}; ... }`
//     → captured by the builder as `selectionQuery.*` prefixed attributes
//
// This module projects those elements into the same DTO shapes the web app
// already consumes for config-defined viewpoints, so SysML-modelled views
// appear in the Diagrams browser with an auto-populated element selection.
// ─────────────────────────────────────────────────────────────────────────────

import type { MemoModel, MemoElement, ViewpointDTO, DiagramDTO } from './semantic.js';
import type { KindRegistry } from './kind-registry.js';
import { resolveViewKind, VIEW_KIND_SHORT_ID_PREFIX } from './view-kinds.js';

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
    const explicitIdList = splitList(view.attributes['selectionQuery.includeElementIds']);
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
    for (const reference of explicitIdList) {
        const direct = model.elements.get(reference);
        if (direct) { ids.add(direct.id); continue; }
        const authored = [...model.elements.values()].find(element => element.attributes.id === reference);
        if (authored) ids.add(authored.id);
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

/** Resolve the authored ISO 42010 viewpoint usage referenced by a view. */
function resolveViewpoints(
    view: MemoElement,
    model: MemoModel,
): Array<{ id: string; label: string; ref: string; group?: string; declaredLayers?: string[]; explorerLane?: string; explorerOrder?: number }> {
    // `viewpointDefinition` is the canonical property declared by MemoView.
    // Keep the former `viewpoint` spelling as a compatibility fallback for
    // projects authored before the ontology adopted the ISO 42010 vocabulary.
    const raw = view.attributes['viewpointDefinition'] || view.attributes['viewpoint'];
    if (!raw) return [];

    return splitList(raw).map(ref => {
        const authored = model.elements.get(ref);
        return {
            id: authored?.attributes['id'] || ref,
            label: authored?.attributes['title']
                || authored?.attributes['name']
                || `${viewpointLabel(ref)} Viewpoint`,
            group: authored?.attributes['group'],
            // The viewpoint's own `includedLayers`, as authored. Distinct from
            // the DTO's `visibleLayers`, which is accumulated from the views
            // that bind to it — a viewpoint states which layers it frames even
            // before any view exists.
            declaredLayers: splitList(authored?.attributes['includedLayers'] ?? ''),
            explorerLane: authored?.attributes['explorerLane'],
            explorerOrder: Number.isFinite(Number(authored?.attributes['explorerOrder']))
                ? Number(authored?.attributes['explorerOrder'])
                : undefined,
            ref,
        };
    });
}

/** Scenario links are authored on the view; they are never inferred from content. */
function resolveScenarioIds(view: MemoElement, model: MemoModel): string[] {
    return splitList(view.attributes['scenario'])
        .map(reference => model.elements.get(reference)?.id ?? reference);
}

export interface DerivedViews {
    viewpoints: ViewpointDTO[];
    diagrams: DiagramDTO[];
}

/**
 * Derive viewpoint and diagram DTOs from view elements modelled in SysML.
 * Views are grouped by their `viewpointDefinition` binding. The binding and
 * the authored `id`/`title` attributes come from the ontology's ISO 42010
 * viewpoint usage; they are not inferred from filenames or display names.
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

        const authoredViewpoints = resolveViewpoints(el, model);
        // A renderer sample without a binding remains in Model > Samples, but
        // an authored ISO 42010 binding is always authoritative. In
        // particular, a real project may legitimately contain `samples` in
        // its package name and still organize its views by viewpoint.
        const usesRendererSampleFallback = isRendererSample && authoredViewpoints.length === 0;
        // A view with no viewpoint binding is genuinely unassigned. Do not
        // misclassify it as a "Document View" merely because its binding was
        // absent or could not be resolved.
        const vpIds = usesRendererSampleFallback
            ? ['__model']
            : authoredViewpoints.length > 0
                ? authoredViewpoints.map(vp => vp.id)
                : ['__unassigned'];
        const vpId = vpIds[0];
        for (const authoredViewpoint of authoredViewpoints.length > 0
            ? authoredViewpoints
            : [{ id: '__unassigned', label: 'Unassigned Views', ref: '__unassigned' }]) {
            if (!usesRendererSampleFallback && !viewpointsById.has(authoredViewpoint.id)) {
                viewpointsById.set(authoredViewpoint.id, {
                    id: authoredViewpoint.id,
                    label: authoredViewpoint.label,
                    group: authoredViewpoint.group,
                    explorerLane: authoredViewpoint.explorerLane,
                    explorerOrder: authoredViewpoint.explorerOrder,
                    declaredLayers: authoredViewpoint.declaredLayers?.length
                        ? authoredViewpoint.declaredLayers : undefined,
                    visibleKinds: [],
                    visibleRelationships: [],
                    visibleLayers: [],
                });
            }
        }
        const vps = vpIds.map(id => viewpointsById.get(id)).filter((vp): vp is ViewpointDTO => Boolean(vp));

        const queryKinds = splitList(el.attributes['selectionQuery.includeElementKinds']);
        // Carried in the spelling SOURCE used — `Composes` for a MEMO
        // `connection def`, `flow`/`bind` for a native keyword — because this
        // list is a declaration, and a viewpoint that says "Composes" should
        // read back as "Composes". A `MemoRelationship.type` is lowerCamelCase,
        // so any consumer that MATCHES against the model must normalize first
        // with `toModelType` / `toModelTypeSet` from `model/naming.ts`. Do not
        // normalize here: it would lowercase what the UI displays.
        const queryRels = splitList(el.attributes['selectionQuery.includeRelationshipKinds']);
        for (const vp of vps) {
            // Palette/filter eligibility follows the ontology specialization
            // closure, so a user FirmwareComponent specializing
            // SoftwareComponent is recognized automatically.
            for (const k of expandKinds(queryKinds, kindRegistry)) {
                if (!vp.visibleKinds.includes(k)) vp.visibleKinds.push(k);
            }
            for (const l of splitList(el.attributes['selectionQuery.includeLayers'])) {
                if (!vp.visibleLayers.includes(l)) vp.visibleLayers.push(l);
            }
            for (const r of queryRels) {
                if (!vp.visibleRelationships.includes(r)) vp.visibleRelationships.push(r);
            }
        }

        // A view usage inherits the attribute values its `view def` binds, and
        // SysIDE forbids restating them on the usage, so the definition is the
        // only place they can live. The usage's own values still win where it
        // declares any.
        const inherited = kindRegistry?.getViewDefaults(el.kind) ?? {};
        const attr = (name: string): string | undefined => el.attributes[name] || inherited[name];

        // Presentation hints declared on the view — the renderer stays dumb and
        // just honors them
        const properties: Record<string, string> = {};
        for (const hint of ['layoutHint', 'styleHint', 'presentationKind'] as const) {
            const value = attr(hint);
            if (value) properties[hint] = value;
        }

        // Every view resolves to exactly one of the 8 spec view kinds: an
        // explicit `viewKind` declaration wins, else the legacy diagramType
        // key maps; document-backed views (no diagramType) become browser.
        const viewKind = resolveViewKind(attr('viewKind'), el.attributes['diagramType']);

        diagrams.push({
            id: isRendererSample
                ? `diag-sample-${el.id}`
                : el.attributes['id'] || el.id,
            // `name` remains the user-facing title in the transport DTO; the
            // stable authored ID above owns routing and persistence.
            name: el.attributes['title'] || el.attributes['name'] || el.name,
            diagramType: el.attributes['diagramType'] || 'bdd',
            viewKind,
            viewpointId: vpId,
            viewpointIds: vpIds,
            group: el.attributes['group'],
            ...(resolveScenarioIds(el, model).length > 0 ? { scenarioIds: resolveScenarioIds(el, model) } : {}),
            auto: true,
            description: el.attributes['shortDescription'] || el.doc,
            ...(Object.keys(properties).length > 0 ? { properties } : {}),
            elementIds: resolveViewElementIds(el, model, kindRegistry),
            relationshipTypes: queryRels,
            // This view's own admitted kinds, not the viewpoint's. A viewpoint
            // accumulates the kinds of every view under it, so an IBD sharing the
            // logical viewpoint with a state-machine view would otherwise offer
            // StateMachine and Transition as shapes to draw on an IBD.
            ...(queryKinds.length > 0
                ? { elementKinds: [...expandKinds(queryKinds, kindRegistry)] }
                : {}),
            sourceFile: el.file,
        });
    }

    // Views use their standard SysML view-kind family, rather than the generic
    // MemoDiagramView element family: GEN-1, ACT-1, STM-1, and so on.
    const diagramsByPrefix = new Map<string, DiagramDTO[]>();
    for (const diagram of diagrams) {
        const prefix = VIEW_KIND_SHORT_ID_PREFIX[diagram.viewKind as keyof typeof VIEW_KIND_SHORT_ID_PREFIX] ?? 'BRW';
        diagramsByPrefix.set(prefix, [...(diagramsByPrefix.get(prefix) ?? []), diagram]);
    }
    for (const [prefix, views] of diagramsByPrefix) {
        views.sort((a, b) => a.id.localeCompare(b.id)).forEach((diagram, index) => {
            diagram.shortId = `${prefix}-${index + 1}`;
        });
    }

    return { viewpoints: [...viewpointsById.values()], diagrams };
}
