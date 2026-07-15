// ─── MEMO Semantic Model ──────────────────────────────────────────────────────
//
// Serializable model types produced by the builder from parsed AST.
// These types are what the CLI and web app work with — they are
// decoupled from Langium's AST nodes so they can be sent over WebSocket.
// ─────────────────────────────────────────────────────────────────────────────

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
    /** Item type being transported (for flow relationships) */
    flowItem?: string;
    /** Source port element ID (when connection endpoint is a port) */
    sourcePortId?: string;
    /** Target port element ID (when connection endpoint is a port) */
    targetPortId?: string;
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
    visibleKinds: string[];
    visibleRelationships: string[];
    visibleLayers: string[];
    supportedDiagramTypes?: string[];
}

/** Diagram definition (serializable for WebSocket transport) */
export interface DiagramDTO {
    id: string;
    name: string;
    diagramType: string;
    /** SysML v2 spec view kind (one of the 8 standard kinds, see view-kinds.ts) */
    viewKind?: string;
    viewpointId: string;
    auto: boolean;
    description?: string;
    properties?: Record<string, string>;
    elementIds?: string[];
    relationshipTypes?: string[];
    /** SysML source containing the view definition (project-relative). */
    sourceFile?: string;
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
}

/** Serializable version of MemoModel for JSON transport */
export interface MemoModelDTO {
    elements: Record<string, MemoElement>;
    relationships: MemoRelationship[];
    errors: ParseError[];
    /** Viewpoint definitions from config (for client-side filtering) */
    viewpoints?: ViewpointDTO[];
    /** Architecture layer definitions from config */
    architectureLayers?: ArchLayerDTO[];
    /** Diagram definitions from config viewpoints */
    diagrams?: DiagramDTO[];
    /** Model metadata for versioning and attribution */
    metadata?: ModelMetadata;
}

/** Convert MemoModel to a plain JSON-serializable object */
export function modelToDTO(
    model: MemoModel,
    options?: { viewpoints?: ViewpointDTO[]; architectureLayers?: ArchLayerDTO[]; diagrams?: DiagramDTO[] }
): MemoModelDTO {
    const elements: Record<string, MemoElement> = {};
    for (const [id, el] of model.elements) {
        elements[id] = el;
    }
    return {
        elements,
        relationships: model.relationships,
        errors: model.errors,
        viewpoints: options?.viewpoints,
        architectureLayers: options?.architectureLayers,
        diagrams: options?.diagrams,
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
        elementsByKind,
        elementsByLayer,
        relationshipsByType,
        outgoing,
        incoming,
    };
}
