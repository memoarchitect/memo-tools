// ─── Ontology Data Loader ────────────────────────────────────────────────────
// Loads ontology data from a JSON file exported by `memo export json`
// or from a drag-and-dropped file.
// ─────────────────────────────────────────────────────────────────────────────

import type { OntologyData, KindInfo, RelInfo, ElementInfo, RelationshipInfo, LayerInfo } from './types';

/**
 * Parse a MEMO model JSON export into OntologyData for the viewer.
 * Accepts the full `memo export json` output format.
 */
export function parseModelJson(json: unknown): OntologyData {
    const data = json as Record<string, unknown>;

    // Handle both direct model DTO and { model: ... } wrapper
    const model = (data.model || data) as Record<string, unknown>;

    const elementsObj = (model.elements || {}) as Record<string, Record<string, unknown>>;
    const relsArr = (model.relationships || []) as Array<Record<string, unknown>>;
    const viewpoints = (model.viewpoints || []) as Array<Record<string, unknown>>;
    const cosmaLayers = (model.architectureLayers || model.cosmaLayers || []) as Array<Record<string, unknown>>;

    // Extract kinds from elements
    const kindMap = new Map<string, KindInfo>();
    const elements: ElementInfo[] = [];

    for (const el of Object.values(elementsObj)) {
        const kind = el.kind as string;
        const layer = el.layer as string;
        const construct = el.construct as string;

        if (!kindMap.has(kind)) {
            kindMap.set(kind, {
                name: kind,
                label: kind.replace(/([A-Z])/g, ' $1').trim(),
                layer,
                construct,
            });
        }

        elements.push({
            id: el.id as string,
            name: el.name as string,
            kind,
            layer,
            construct,
            file: el.file as string | undefined,
            attributes: el.attributes as Record<string, string> | undefined,
        });
    }

    // Extract relationship types
    const relTypeMap = new Map<string, RelInfo>();
    const elementRelationships: RelationshipInfo[] = [];

    for (const rel of relsArr) {
        const type = rel.type as string;
        if (!relTypeMap.has(type)) {
            relTypeMap.set(type, {
                name: type,
                label: type.replace(/([A-Z])/g, ' $1').trim(),
                layer: 'crosscutting',
                color: '#6B7280',
            });
        }
        elementRelationships.push({
            type,
            sourceId: rel.sourceId as string,
            targetId: rel.targetId as string,
            sourceName: rel.sourceName as string | undefined,
            targetName: rel.targetName as string | undefined,
        });
    }

    // Layers
    const layers: LayerInfo[] = cosmaLayers.map(cl => ({
        id: cl.id as string,
        label: cl.label as string,
        color: cl.color as string,
    }));

    return {
        packageName: (model.projectName as string) || 'Unknown Package',
        packageType: 'ontology',
        version: '0.1.0',
        description: '',
        kinds: [...kindMap.values()].sort((a, b) => a.name.localeCompare(b.name)),
        relationships: [...relTypeMap.values()].sort((a, b) => a.name.localeCompare(b.name)),
        layers,
        viewpoints: viewpoints.map(vp => ({
            id: vp.id as string,
            label: vp.label as string,
            visibleKinds: (vp.visibleKinds || []) as string[],
            visibleRelationships: (vp.visibleRelationships || []) as string[],
        })),
        elements,
        elementRelationships,
    };
}

/** Load a JSON file from a URL */
export async function loadFromUrl(url: string): Promise<OntologyData> {
    const response = await fetch(url);
    const json = await response.json();
    return parseModelJson(json);
}

/** Load from a File object (drag-and-drop or file input) */
export async function loadFromFile(file: File): Promise<OntologyData> {
    const text = await file.text();
    const json = JSON.parse(text);
    return parseModelJson(json);
}
