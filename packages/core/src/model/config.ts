// ─── MEMO Configuration Types ─────────────────────────────────────────────────
//
// Domain packages (e.g. @memo/medical-modeling-profile) implement MEMOConfig as config.yaml.
// Projects inherit from domain configs via the `extends` field.
// The CLI merges the inheritance chain at startup.
//
// Four project types:
//   - "ontology" — shared type system (kinds + relationships)
//   - "profile"  — viewpoints, templates (extends an ontology)
//   - "library"  — reusable model elements (instances, not types)
//   - "device"   — specific medical device model referencing an ontology
// ─────────────────────────────────────────────────────────────────────────────

/** Project type discriminator */
export type ProjectType = 'ontology' | 'profile' | 'library' | 'device';

/** An architecture visualization layer grouping related entity kinds */
export interface ArchLayer {
    /** Unique layer identifier, e.g. "requirements", "architecture" */
    id: string;
    /** Human-readable label for the layer */
    label: string;
    /** Hex color for layer visualization, e.g. "#4A90D9" */
    color: string;
}

/** A typed relationship between entity kinds */
export interface RelationshipType {
    /** Relationship identifier, e.g. "mitigates" */
    name: string;
    /** Human-readable label, e.g. "Mitigates" */
    label: string;
    /** Architecture layer this relationship belongs to */
    layer: string;
    /** Hex color for relationship visualization */
    color: string;
}

/** SysML v2 constructs supported as entity base types */
export type SysMLConstruct =
    | 'part def'
    | 'requirement def'
    | 'action def'
    | 'action usage'
    | 'item def'
    | 'port def'
    | 'interface def'
    | 'connection def'
    | 'attribute def'
    | 'enum def';

/** Definition of an entity kind within a domain */
export interface KindDefinition {
    /** Human-readable label */
    label: string;
    /** Architecture layer this kind belongs to */
    layer?: string;
    /** SysML v2 construct this kind maps to */
    sysmlConstruct: SysMLConstruct;
    /** Icon identifier for the palette/diagram */
    icon?: string;
    /** Template file for new instances (relative to domain package) */
    template?: string;
    /** Default attributes for new instances */
    defaultAttributes?: Record<string, string>;
}

/** Legacy diagram type keys — each maps to exactly one SysML v2 view kind (see view-kinds.ts) */
export type DiagramType =
    | 'bdd' | 'ibd' | 'req' | 'ucd' | 'act' | 'afd' | 'pkg' | 'par' | 'risk'
    | 'stm' | 'seq' | 'fmea' | 'alloc' | 'threat-model';

/** Diagram definition — a named, typed view within a viewpoint */
export interface DiagramDefinition {
    /** Unique diagram identifier, e.g. "diag-risk-chain" */
    id: string;
    /** Human-readable name, e.g. "Risk Mitigation Chain" */
    name: string;
    /** SysML v2 diagram type */
    diagramType: DiagramType;
    /** Parent viewpoint ID this diagram belongs to */
    viewpointId: string;
    /** Whether this diagram is auto-generated from the viewpoint */
    auto: boolean;
    /** Description / purpose of this diagram (used in doc generation) */
    description?: string;
    /** Additional metadata properties (free-form, for doc generation) */
    properties?: Record<string, string>;
    /** Optional override: specific element IDs to include (subset of viewpoint) */
    elementIds?: string[];
    /** Optional override: specific relationship types to show */
    relationshipTypes?: string[];
}

/** Viewpoint definition for filtered model views */
export interface ViewpointDefinition {
    /** Unique viewpoint identifier */
    id: string;
    /** Human-readable name */
    label: string;
    /** Entity kinds visible in this viewpoint */
    visibleKinds: string[];
    /** Relationship types visible in this viewpoint */
    visibleRelationships: string[];
    /** Architecture layers visible in this viewpoint */
    visibleLayers: string[];
    /** SysML v2 diagram types supported by this viewpoint */
    supportedDiagramTypes?: DiagramType[];
    /** Auto-generated diagrams for this viewpoint */
    diagrams?: DiagramDefinition[];
}

/** Guided workflow step for wizard-like interactions */
export interface WorkflowStep {
    /** Step identifier */
    id: string;
    /** Human-readable label */
    label: string;
    /** Entity kinds involved in this step */
    kinds: string[];
    /** Prompt text for the user */
    prompt: string;
}

/** Guided workflow definition */
export interface WorkflowDefinition {
    /** Unique workflow identifier */
    id: string;
    /** Human-readable label */
    label: string;
    /** Ordered steps */
    steps: WorkflowStep[];
}

/** First-run configuration for new projects */
export interface FirstRunConfig {
    /** Template to scaffold, e.g. "infusion-pump" */
    template?: string;
    /** Prompt user for project metadata */
    promptForMetadata?: boolean;
    /** Auto-create starter files */
    scaffoldFiles?: string[];
}

/** Ontology reference in a device project */
export interface OntologyReference {
    /** Package name, e.g. "@memo/ontology" or "memo-ontology" on SysAnd */
    name: string;
    /** Semver version constraint, e.g. "^2.0.0" */
    version: string;
}

/** Self-describing metadata for an ontology package */
export interface OntologyMetadata {
    /** Package identifier, e.g. "@memo/ontology" */
    id: string;
    /** Semver version */
    version: string;
    /** Human-readable description */
    description: string;
    /** Author or organization */
    author?: string;
    /** License identifier, e.g. "Apache-2.0" */
    license?: string;
    /** Searchable tags, e.g. ["medical", "ISO-14971"] */
    tags?: string[];
}

/** Reference to an external ontology (OWL, JSON-LD, or SysAnd format) */
export interface ExternalOntologyRef {
    /** Import format */
    source: 'owl' | 'jsonld' | 'sysand';
    /** File path or URL to the ontology */
    uri: string;
    /** Namespace prefix, e.g. "fma" */
    prefix: string;
    /** Import only these classes/concepts (empty = import all) */
    subset?: string[];
}

/** Reference to a reusable element library */
export interface LibraryRef {
    /** Package name, e.g. "@sysand/std-library" */
    package: string;
    /** Import only these categories, e.g. ["USB", "Logging"] */
    categories?: string[];
}

/**
 * MEMOConfig — the complete project/domain configuration.
 *
 * Two project types:
 *   - "ontology": defines a shareable type system (publishable as .kpar)
 *   - "device": models a specific medical device (references an ontology)
 */
export interface MEMOConfig {
    /** Project name (set by `memo init`) */
    projectName: string;

    /** Project type: "ontology", "profile", "library", or "device" */
    projectType: ProjectType;

    /** Parent config to inherit from. String for single parent, array for multiple. */
    extends?: string | string[];

    /** Ontology references (device projects only) */
    ontologies?: OntologyReference[];

    /**
     * Optional ontology modules to load on top of the base ontology.
     * Modules are declared as optional in the base ontology's memo.package.yaml
     * under `optionalModules:`. Following OWL import semantics, only modules a
     * project explicitly opts into are loaded — disabled modules contribute
     * no kinds/relationships, no validation rules, and no viewpoints.
     *
     * Each entry is a package name like "@memo/ontology-ros" or a
     * short alias like "ros" (resolved against the base ontology's optionalModules list).
     */
    modules?: string[];

    /** Self-describing metadata for ontology packages */
    ontologyMetadata?: OntologyMetadata;

    /** External ontology imports (OWL, JSON-LD, SysAnd) */
    externalOntologies?: ExternalOntologyRef[];

    /** Reusable element library imports */
    libraries?: LibraryRef[];

    /** Architecture visualization layers */
    architectureLayers?: ArchLayer[];

    /** Entity kind definitions (keyed by kind identifier). Optional — prefer KindRegistry. */
    kinds?: Record<string, KindDefinition>;

    /** Typed relationship definitions with architecture layer mapping. Optional — prefer RelationshipRegistry. */
    relationshipTypes?: RelationshipType[];

    /** Viewpoint definitions for filtered views */
    viewpoints?: ViewpointDefinition[];

    /** Guided workflows for step-by-step modeling */
    workflows?: WorkflowDefinition[];

    /** First-run scaffolding configuration */
    firstRun?: FirstRunConfig;
}
