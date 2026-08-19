// ─── MEMO Semantic Model ──────────────────────────────────────────────────────
//
// Serializable model types produced by the builder from parsed AST.
// These types are what the CLI and web app work with — they are
// decoupled from Langium's AST nodes so they can be sent over WebSocket.
// ─────────────────────────────────────────────────────────────────────────────

import type { OntologyRegistriesDTO } from './relationship-legality.js';
import type { SemanticElementProvenance } from './source-provenance.js';

/** Direction of a port or action parameter */
export type ParameterDirection = 'in' | 'out' | 'inout';

/** Port specification on a port usage element */
export interface PortSpec {
    /** Port type name (qualified) */
    type: string;
    /** Direction: in, out, or inout (undefined = undirected) */
    direction?: ParameterDirection;
    /** True if conjugated (~) */
    isConjugated: boolean;
}

/** A typed parameter on an action definition */
export interface ActionParameter {
    /** Parameter name */
    name: string;
    /** Direction: in, out, or inout */
    direction: ParameterDirection;
    /** Type name (qualified) */
    type: string;
}

/** A model element (part, requirement, action, port, item, etc.) */
export interface MemoElement {
    /** Unique element identifier (usage name from SysML) */
    id: string;
    /** Stable short ID for deep-linking, e.g. "SW-REQ-4291" (set by builder) */
    shortId?: string;
    /** Stable technical UUID assigned during compilation; never used as a display label. */
    uuid?: string;
    /** Human-readable name (from 'attribute redefines name = ...' or id) */
    name: string;
    /** The kind key matching config.kinds, e.g. "Hazard", "Requirement" */
    kind: string;
    /** SysML v2 construct: 'part', 'requirement', 'action', 'port', 'item' */
    construct: string;
    /** Architecture layer from config, e.g. "risk", "requirements" */
    layer: string;
    /** Source file path (relative) */
    file: string;
    /** Containing package qualified name, e.g. "InfusionPump" */
    package?: string;
    /** All attributes as key-value pairs */
    attributes: Record<string, string>;
    /** Doc comment if present */
    doc?: string;
    /** Action parameters (for ActionDefinition elements) */
    parameters?: ActionParameter[];
    /** Parent action ID (for nested action usages) */
    parentAction?: string;
    /** Structural part this action is allocated to (from allocate statements) */
    allocatedTo?: string;
    /** Owner element ID (for ports nested inside a definition) */
    owner?: string;
    /** IDs of owned port elements (populated on the owner definition element) */
    ownedPorts?: string[];
    /** Port specification (for port usage elements) */
    portSpec?: PortSpec;
    /** Authoritative declaration and classifier provenance. */
    provenance?: SemanticElementProvenance;
}

/**
 * A package declared by project source.
 *
 * Containment in MEMO is package membership — an element's `package` names the
 * package that declares it. The packages themselves are carried separately
 * because a package that declares nothing yet is still a package: deriving the
 * list from element membership alone would make an empty one invisible, and a
 * container that disappears when you empty it is not a container.
 */
export interface MemoPackageDTO {
    /** Fully qualified name, `Parent::Child`. */
    qualifiedName: string;
    /** Declared name — the last segment of `qualifiedName`. */
    name: string;
    /** Qualified name of the declaring package, absent at file top level. */
    parent?: string;
    /** Project-relative file declaring it. */
    file: string;
}

/** A typed relationship between two elements */
export interface MemoRelationship {
    /** Unique relationship id (auto-generated) */
    id: string;
    /** Relationship type name (lowercase), e.g. "mitigates", "traceTo", "flow", "succession" */
    type: string;
    /** Source element id */
    sourceId: string;
    /** Source end name from connection usage, e.g. "control" */
    sourceEnd: string;
    /** Target element id */
    targetId: string;
    /** Target end name from connection usage, e.g. "hazard" */
    targetEnd: string;
    /** Source file path (relative) */
    file: string;
    /** Exact declaration range in the owning source revision. */
    sourceRange?: { offset: number; length: number };
    /**
     * True when `id` is the connection usage's declared name in SysML, so it
     * addresses exactly one declaration and survives a rebuild. Anonymous
     * connections get a positional id instead and cannot be edited by id.
     */
    named?: boolean;
    /** Item type being transported (for flow relationships) */
    flowItem?: string;
    /** Source port element ID (when connection endpoint is a port) */
    sourcePortId?: string;
    /** Target port element ID (when connection endpoint is a port) */
    targetPortId?: string;
    /** Attributes authored on the connection usage. */
    attributes?: Record<string, string>;
    /** Authoritative provenance of the connection declaration. */
    provenance?: SemanticElementProvenance;
}

/** A parse error from a specific file */
export interface ParseError {
    /** File path */
    file: string;
    /** Error message */
    message: string;
    /** Line number (1-based) */
    line?: number;
    /** Column number (1-based) */
    column?: number;
}

/** The complete semantic model — serializable for WebSocket transport */
export interface MemoModel {
    /** All elements indexed by id */
    elements: Map<string, MemoElement>;
    /** All relationships */
    relationships: MemoRelationship[];
    /** Parse errors encountered */
    errors: ParseError[];
    /** Packages declared by project source, including empty ones. */
    packages: MemoPackageDTO[];

    // ─── Derived indexes (computed by builder) ──────────────────────────

    /** Elements grouped by kind */
    elementsByKind: Map<string, MemoElement[]>;
    /** Elements grouped by architecture layer */
    elementsByLayer: Map<string, MemoElement[]>;
    /** Relationships grouped by type */
    relationshipsByType: Map<string, MemoRelationship[]>;
    /** Outgoing relationships from element id */
    outgoing: Map<string, MemoRelationship[]>;
    /** Incoming relationships to element id */
    incoming: Map<string, MemoRelationship[]>;
}

/** Viewpoint definition (serializable subset of config) */
export interface ViewpointDTO {
    id: string;
    label: string;
    /** Optional ontology-authored grouping used by Memo Architect. */
    group?: string;
    visibleKinds: string[];
    visibleRelationships: string[];
    visibleLayers: string[];
    /**
     * Layers the viewpoint itself declares it frames (`includedLayers`).
     *
     * `visibleLayers` above is accumulated from the views bound to this
     * viewpoint, so it reflects what happens to be drawn. This is the authored
     * intent, and is what consumers should order or filter by.
     */
    declaredLayers?: string[];
    /** Ontology-authored V-model lane: architecture or assurance. */
    explorerLane?: string;
    /** Position within the authored Explorer lane. Lower values come first. */
    explorerOrder?: number;
    supportedDiagramTypes?: string[];
}

/** Diagram definition (serializable for WebSocket transport) */
export interface DiagramDTO {
    id: string;
    /** Compact, stable display identifier of the authored view, e.g. "GEN-3". */
    shortId?: string;
    name: string;
    diagramType: string;
    /** SysML v2 spec view kind (one of the 8 standard kinds, see view-kinds.ts) */
    viewKind?: string;
    viewpointId: string;
    /** All viewpoints this reusable view conforms to; viewpointId is the primary legacy value. */
    viewpointIds?: string[];
    /** Optional grouping of views within a viewpoint. */
    group?: string;
    /** Explicit scenarios this diagram is linked to, when authored. */
    scenarioIds?: string[];
    auto: boolean;
    description?: string;
    properties?: Record<string, string>;
    elementIds?: string[];
    relationshipTypes?: string[];
    /**
     * Kinds this view admits, from its own `selectionQuery.includeElementKinds`
     * expanded through the ontology specialization closure. Drives the authoring
     * palette: these are the shapes it makes sense to draw on this view, as
     * distinct from the union its viewpoint accumulates.
     */
    elementKinds?: string[];
    /** SysML source containing the view definition (project-relative). */
    sourceFile?: string;
    /** SysML package that owns the view; independent of source-file location. */
    package?: string;
    /**
     * The model element id of the view's own declaration.
     *
     * `id` is the AUTHORED identifier ("GEN-3") because that is what routes and
     * persists; a package mutation needs the element instead, and there was no
     * way to get from one to the other in the client.
     */
    elementId?: string;
    /**
     * Every project-relative file whose change can alter what this view
     * renders: its own source, the files owning its elements, and the
     * transitive import closure of both. See model/source-graph.ts.
     */
    sourceFiles?: string[];
}

/**
 * File-level dependency graph of the model's SysML sources.
 *
 * `dependsOn[file]` lists the files `file` can draw names from, transitively
 * through package imports. Files with no dependencies are omitted.
 */
export interface SourceGraphDTO {
    dependsOn: Record<string, string[]>;
}

/** Architecture layer info (serializable subset of config) */
export interface ArchLayerDTO {
    id: string;
    label: string;
    color: string;
}

/** Model metadata for version/attribution */
export interface ModelMetadata {
    /** Project name from config */
    projectName?: string;
    /** Semantic version (from config or auto-incremented) */
    version?: string;
    /** Git user name (from git config) */
    gitUser?: string;
    /** Git branch name */
    gitBranch?: string;
    /** Last commit short hash */
    gitCommitShort?: string;
    /** True when the model project has uncommitted Git changes. */
    gitDirty?: boolean;
}

/** Serializable version of MemoModel for JSON transport */
export interface MemoModelDTO {
    elements: Record<string, MemoElement>;
    /** Enum definitions available to a view for typed presentation categories. */
    enumerations?: EnumDefinitionDTO[];
    relationships: MemoRelationship[];
    errors: ParseError[];
    /** Packages declared by project source, including empty ones. */
    packages?: MemoPackageDTO[];
    /** Viewpoint definitions from config (for client-side filtering) */
    viewpoints?: ViewpointDTO[];
    /** Architecture layer definitions from config */
    architectureLayers?: ArchLayerDTO[];
    /** Diagram definitions from config viewpoints */
    diagrams?: DiagramDTO[];
    /** Model metadata for versioning and attribution */
    metadata?: ModelMetadata;
    /**
     * Ontology relationship and kind definitions. The client needs these to
     * decide relationship legality from the ontology rather than a hardcoded
     * table — see model/relationship-legality.ts.
     */
    registries?: OntologyRegistriesDTO;
    /**
     * Build counter for this model. Increments on every rebuild, so a client
     * can tell a fresh model from a re-delivered one and order source-change
     * notifications against it.
     */
    revision?: number;
    /**
     * Import dependencies between source files, so any surface can decide
     * whether a changed file affects what it is showing.
     */
    sourceGraph?: SourceGraphDTO;
    /** Content hashes used as per-file web mutation preconditions. */
    sourceHashes?: Record<string, string>;
    /** Canonical SysML ingestion records; Memo elements are their projection. */
    sysmlIr?: import('../sysml-ir/index.js').SysmlIR;
    /**
     * Memo element ID → IR identity ID, for the revision this model is.
     *
     * The address an authoring write quotes (§6.2). Shipped instead of the
     * whole IR because a surface that only needs to *name* an element does not
     * need every declared property of every node.
     */
    irIdentities?: Record<string, string>;
    /**
     * Clause coverage report — the same computation `memo standards check`
     * prints. The dev server computes it once per rebuild and ships it here so
     * the Architect can badge document cards with gap counts without a second
     * request and without a second computation.
     *
     * Absent when the standards library was not found, or when the server did
     * not compute it (e.g. a static export build that does not need the badges).
     */
    standardsReport?: import('../dhf/standards-report.js').StandardsReport;
}

/** A SysML enum and its literals, preserved for view declarations. */
export interface EnumDefinitionDTO {
    name: string;
    literals: string[];
}

/** Convert MemoModel to a plain JSON-serializable object */
export function modelToDTO(
    model: MemoModel,
    options?: {
        viewpoints?: ViewpointDTO[];
        architectureLayers?: ArchLayerDTO[];
        diagrams?: DiagramDTO[];
        registries?: OntologyRegistriesDTO;
        revision?: number;
        sourceGraph?: SourceGraphDTO;
        sourceHashes?: Record<string, string>;
        irIdentities?: Record<string, string>;
        enumerations?: EnumDefinitionDTO[];
    }
): MemoModelDTO {
    const elements: Record<string, MemoElement> = {};
    for (const [id, el] of model.elements) {
        elements[id] = el;
    }
    return {
        elements,
        enumerations: options?.enumerations,
        relationships: model.relationships,
        errors: model.errors,
        packages: model.packages,
        viewpoints: options?.viewpoints,
        architectureLayers: options?.architectureLayers,
        diagrams: options?.diagrams,
        registries: options?.registries,
        revision: options?.revision,
        sourceGraph: options?.sourceGraph,
        sourceHashes: options?.sourceHashes,
        sysmlIr: undefined,
        irIdentities: options?.irIdentities,
    };
}

/** Reconstruct a MemoModel from a DTO (e.g. received over WebSocket) */
export function dtoToModel(dto: MemoModelDTO): MemoModel {
    const elements = new Map<string, MemoElement>(Object.entries(dto.elements));
    const relationships = dto.relationships;

    const elementsByKind = new Map<string, MemoElement[]>();
    const elementsByLayer = new Map<string, MemoElement[]>();
    for (const el of elements.values()) {
        if (!elementsByKind.has(el.kind)) elementsByKind.set(el.kind, []);
        elementsByKind.get(el.kind)!.push(el);
        if (!elementsByLayer.has(el.layer)) elementsByLayer.set(el.layer, []);
        elementsByLayer.get(el.layer)!.push(el);
    }

    const relationshipsByType = new Map<string, MemoRelationship[]>();
    const outgoing = new Map<string, MemoRelationship[]>();
    const incoming = new Map<string, MemoRelationship[]>();
    for (const rel of relationships) {
        if (!relationshipsByType.has(rel.type)) relationshipsByType.set(rel.type, []);
        relationshipsByType.get(rel.type)!.push(rel);
        if (!outgoing.has(rel.sourceId)) outgoing.set(rel.sourceId, []);
        outgoing.get(rel.sourceId)!.push(rel);
        if (!incoming.has(rel.targetId)) incoming.set(rel.targetId, []);
        incoming.get(rel.targetId)!.push(rel);
    }

    return {
        elements,
        relationships,
        errors: dto.errors,
        packages: dto.packages ?? [],
        elementsByKind,
        elementsByLayer,
        relationshipsByType,
        outgoing,
        incoming,
    };
}
