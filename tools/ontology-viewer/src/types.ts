// ─── Ontology Viewer Types ───────────────────────────────────────────────────
// Standalone types for the ontology viewer — no dependency on @memo/core.
// Data is loaded from JSON files (memo.package.yaml parsed to JSON, or from
// the model DTO exported by `memo export json`).
// ─────────────────────────────────────────────────────────────────────────────

export interface KindInfo {
    name: string;
    label: string;
    layer: string;
    construct: string;
    superType?: string;
    defaultAttributes?: Record<string, string>;
}

export interface RelInfo {
    name: string;
    label: string;
    layer: string;
    color: string;
}

export interface LayerInfo {
    id: string;
    label: string;
    color: string;
}

export interface ViewpointInfo {
    id: string;
    label: string;
    visibleKinds: string[];
    visibleRelationships?: string[];
}

export interface ElementInfo {
    id: string;
    name: string;
    kind: string;
    layer: string;
    construct: string;
    file?: string;
    attributes?: Record<string, string>;
}

export interface RelationshipInfo {
    type: string;
    sourceId: string;
    targetId: string;
    sourceName?: string;
    targetName?: string;
}

export interface OntologyData {
    packageName: string;
    packageType: string;
    version: string;
    description: string;
    extends?: string;
    kinds: KindInfo[];
    relationships: RelInfo[];
    layers: LayerInfo[];
    viewpoints: ViewpointInfo[];
    elements: ElementInfo[];
    elementRelationships: RelationshipInfo[];
}

export type GroupBy = 'layer' | 'construct' | 'source';
