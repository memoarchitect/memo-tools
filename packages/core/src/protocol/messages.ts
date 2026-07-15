// ─── WebSocket Protocol Messages ──────────────────────────────────────────────
//
// Shared types for the CLI dev server ↔ Web app WebSocket protocol.
// ─────────────────────────────────────────────────────────────────────────────

import type { MemoModelDTO } from '../model/semantic.js';
import type { ValidationResult, CompletenessReport } from '../validator/types.js';
import type { OntologyPackageInfo } from '../model/ontology-loader.js';
import type { MethodologyDescriptor } from '../model/methodology-loader.js';

// ─── Server → Client ────────────────────────────────────────────────────────

export type ServerMessage =
    | ModelUpdateMessage
    | ValidationUpdateMessage
    | CompletenessUpdateMessage
    | ErrorMessage
    | ImportResultMessage
    | DiagramParseResultMessage
    | DiagramSourceResultMessage
    | OntologyPackagesMessage
    | MethodologyUpdateMessage
    | DiagramLayoutMessage
    | OntologyInstallResultMessage
    | OntologyRemoveResultMessage
    | LlmStatusMessage
    | LlmAskResultMessage
    | LlmGenerateResultMessage
    | LlmDraftResultMessage
    | LlmSuggestResultMessage
    | RestartRequiredMessage
    | DhfDocsMessage
    | DhfSettingsMessage
    | DhfTemplatesResultMessage
    | DhfTemplateContentMessage;

export interface ModelUpdateMessage {
    type: 'model:update';
    payload: MemoModelDTO;
}

export interface ValidationUpdateMessage {
    type: 'validation:update';
    payload: ValidationResult;
}

export interface CompletenessUpdateMessage {
    type: 'completeness:update';
    payload: CompletenessReport;
}

export interface ErrorMessage {
    type: 'error';
    payload: { message: string };
}

/** Server sends ontology package metadata when client connects or memo.package.yaml changes */
export interface OntologyPackagesMessage {
    type: 'ontology:packages';
    payload: { packages: OntologyPackageInfo[] };
}

/** Server sends parsed methodology data — Phase B (data-only, no UI yet) */
export interface MethodologyUpdateMessage {
    type: 'methodology:update';
    payload: MethodologyDescriptor;
}

// ─── Client → Server ────────────────────────────────────────────────────────

export type ClientMessage =
    | RequestRefreshMessage
    | ElementUpdateMessage
    | ElementCreateMessage
    | AddRelationshipMessage
    | CsvImportMessage
    | DiagramCreateMessage
    | DiagramUpdateMessage
    | DiagramDeleteMessage
    | DiagramParseMessage
    | DiagramSourceRequestMessage
    | DiagramSourceSaveMessage
    | OntologySaveSelectionMessage
    | OntologyInstallMessage
    | OntologyRemoveMessage
    | DiagramLayoutUpdateMessage
    | LlmAskMessage
    | LlmGenerateMessage
    | LlmDraftMessage
    | LlmSuggestMessage
    | DhfDocsLoadMessage
    | DhfDocSaveMessage
    | DhfDocDeleteMessage
    | DhfSettingsSaveMessage
    | DhfTemplatesListMessage
    | DhfTemplateReadMessage;

export interface RequestRefreshMessage {
    type: 'request:refresh';
}

/** Client requests the server to persist ontology selection to memo.package.yaml */
export interface OntologySaveSelectionMessage {
    type: 'ontology:save-selection';
    payload: { selected: string[] };
}

/** Client requests installing an ontology from git URL, npm package, or local path */
export interface OntologyInstallMessage {
    type: 'ontology:install';
    payload: { source: string };
}

/** Server responds to ontology:install with success/failure */
export interface OntologyInstallResultMessage {
    type: 'ontology:install:result';
    payload: { success: boolean; packageName?: string; error?: string };
}

/** Client requests removing an installed ontology package */
export interface OntologyRemoveMessage {
    type: 'ontology:remove';
    payload: { packageName: string };
}

/** Server responds to ontology:remove with success/failure */
export interface OntologyRemoveResultMessage {
    type: 'ontology:remove:result';
    payload: { success: boolean; packageName: string; error?: string };
}

/** Client requests an element field update (2-way sync) */
export interface ElementUpdateMessage {
    type: 'element:update';
    payload: {
        elementId: string;
        doc?: string;
        attributes?: Record<string, string>;
    };
}

/** Client requests a new element creation in SysML */
export interface ElementCreateMessage {
    type: 'element:create';
    payload: {
        name: string;
        kind: string;
        construct: string;
        attributes?: Record<string, string>;
    };
}

/** Client requests a new relationship between two elements */
export interface AddRelationshipMessage {
    type: 'relationship:add';
    payload: {
        sourceId: string;
        targetId: string;
        type: string;
    };
}

/** Client sends CSV data for bulk import of elements and/or relationships */
export interface CsvImportMessage {
    type: 'csv:import';
    payload: {
        /** CSV text for elements (optional — can import only relationships) */
        elementsCsv?: string;
        /** CSV text for relationships (optional — can import only elements) */
        relationshipsCsv?: string;
        /** Target package name for generated SysML file */
        packageName?: string;
        /** Target .sysml file path (relative to project root) */
        targetFile?: string;
    };
}

/** Client creates a new user diagram under a viewpoint */
export interface DiagramCreateMessage {
    type: 'diagram:create';
    payload: {
        id: string;
        name: string;
        diagramType: string;
        viewpointId: string;
        description?: string;
        properties?: Record<string, string>;
        elementIds?: string[];
        relationshipTypes?: string[];
    };
}

/** Client updates an existing diagram's metadata */
export interface DiagramUpdateMessage {
    type: 'diagram:update';
    payload: {
        id: string;
        name?: string;
        description?: string;
        properties?: Record<string, string>;
        elementIds?: string[];
        relationshipTypes?: string[];
    };
}

/** Client deletes a user-created diagram */
export interface DiagramDeleteMessage {
    type: 'diagram:delete';
    payload: { id: string };
}

/** Client requests server-side SysML parse to extract element IDs */
export interface DiagramParseMessage {
    type: 'diagram:parse';
    payload: {
        diagramId: string;
        text: string;
    };
}

/** Server responds with parsed element IDs (or errors) */
export interface DiagramParseResultMessage {
    type: 'diagram:parse:result';
    payload: {
        diagramId: string;
        elementIds: string[];
        errors: string[];
    };
}

/** Client requests the exact SysML file backing a source-derived diagram. */
export interface DiagramSourceRequestMessage {
    type: 'diagram:source:request';
    payload: {
        requestId: string;
        diagramId: string;
    };
}

/** Client saves the exact SysML file backing a source-derived diagram. */
export interface DiagramSourceSaveMessage {
    type: 'diagram:source:save';
    payload: {
        requestId: string;
        diagramId: string;
        text: string;
    };
}

/** Server response for loading or saving a diagram's SysML source file. */
export interface DiagramSourceResultMessage {
    type: 'diagram:source:result';
    payload: {
        requestId: string;
        diagramId: string;
        operation: 'load' | 'save';
        success: boolean;
        sourceFile?: string;
        text?: string;
        error?: string;
    };
}

// ─── Sidecar Layout ─────────────────────────────────────────────────────────

/** Per-node visual override stored in the view's .viewlayout companion. */
export interface DiagramNodeLayout {
    x: number;
    y: number;
    width?: number;
    height?: number;
    color?: string;
    /** Per-diagram boundary-port positions, relative to the owning node. */
    ports?: Record<string, { x: number; y: number; side?: 'top' | 'bottom' | 'left' | 'right' }>;
}

/** Per-edge visual override */
export interface DiagramEdgeLayout {
    color?: string;
    strokeWidth?: number;
    labelVisible?: boolean;
    style?: 'solid' | 'dashed' | 'dotted';
    /** User-adjusted orthogonal route points in canvas coordinates. */
    points?: Array<{ x: number; y: number }>;
    /** Endpoint identity captured with a manual route. A changed attachment
     * invalidates the bends and returns the edge to automatic routing. */
    source?: string;
    target?: string;
    sourcePortId?: string;
    targetPortId?: string;
}

/** Full layout for one diagram, deserialized from its .viewlayout companion. */
export interface DiagramLayout {
    nodes: Record<string, DiagramNodeLayout>;
    edges: Record<string, DiagramEdgeLayout>;
    canvas?: {
        zoom?: number;
        pan?: { x: number; y: number };
        grid?: number;
        snap?: boolean;
        /** False after the first user geometry override. */
        autoLayout?: boolean;
        /** Animate directional flow along connectors. */
        flowAnimation?: boolean;
    };
}

/** Server → Client: initial layout data for all diagrams that have sidecars */
export interface DiagramLayoutMessage {
    type: 'diagram:layout';
    payload: { layouts: Record<string, DiagramLayout> };
}

/** Client → Server: save updated positions after user drags nodes */
export interface DiagramLayoutUpdateMessage {
    type: 'diagram:layout:update';
    payload: {
        diagramId: string;
        layout: DiagramLayout;
    };
}

// ─── LLM Messages ────────────────────────────────────────────────────────────

/** Server → Client: whether an LLM provider is configured and available */
export interface LlmStatusMessage {
    type: 'llm:status';
    payload: { available: boolean; provider?: string; model?: string };
}

/** Client → Server: ask a natural language question about the model */
export interface LlmAskMessage {
    type: 'llm:ask';
    payload: { requestId: string; question: string };
}

/** Server → Client: answer to a model Q&A question */
export interface LlmAskResultMessage {
    type: 'llm:ask:result';
    payload: { requestId: string; answer?: string; error?: string };
}

/** Client → Server: generate SysML v2 from a natural language description */
export interface LlmGenerateMessage {
    type: 'llm:generate';
    payload: { requestId: string; description: string };
}

/** Server → Client: generated SysML v2 code */
export interface LlmGenerateResultMessage {
    type: 'llm:generate:result';
    payload: { requestId: string; sysml?: string; explanation?: string; suggestedFile?: string; error?: string };
}

/** Client → Server: draft one or all sections of a DHF document type */
export interface LlmDraftMessage {
    type: 'llm:draft';
    payload: { requestId: string; documentTypeId: string; targetSections?: string[] };
}

/** Server → Client: drafted DHF markdown content */
export interface LlmDraftResultMessage {
    type: 'llm:draft:result';
    payload: { requestId: string; markdown?: string; summary?: string; error?: string };
}

/** Client → Server: ask for AI-driven completeness suggestions */
export interface LlmSuggestMessage {
    type: 'llm:suggest';
    payload: { requestId: string };
}

/** Server → Client: list of suggested next modeling steps */
export interface LlmSuggestResultMessage {
    type: 'llm:suggest:result';
    payload: { requestId: string; suggestions?: string[]; error?: string };
}

/** Server → Client: ontology changed on disk — client must reload after server restart */
export interface RestartRequiredMessage {
    type: 'app:restart-required';
    reason: 'ontology-source-changed' | 'ontology-selection-changed';
    changedFile: string;
    instruction: string;
}

// ─── DHF Workbench Documents ─────────────────────────────────────────────────

/** A DHF workbench document persisted as markdown in the project's dhf/documents/ */
export interface DhfDocDTO {
    id: string;
    title: string;
    group: string;
    templateId: string;
    /** Full markdown source including YAML frontmatter */
    content: string;
    createdAt: number;
    /** "Name | Role" entries, one per line */
    authors: string;
    /** "Name | Role" entries, one per line */
    approvers: string;
}

/** Project-level DHF settings persisted in .memo/dhf-settings.json */
export interface DhfSettingsDTO {
    company?: string;
    product?: string;
    deviceType?: string;
    version?: string;
    phase?: string;
    documentNumberingPrefix?: string;
    primaryColor?: string;
    [key: string]: unknown;
}

/** A markdown file in the project repo usable as a document template */
export interface DhfRepoTemplateInfo {
    /** Path relative to project root */
    path: string;
    /** Title from frontmatter or first heading, falls back to filename */
    title: string;
}

/** Client → Server: request all persisted DHF documents */
export interface DhfDocsLoadMessage {
    type: 'dhf:docs:load';
}

/** Server → Client: all persisted DHF documents (on connect and after changes) */
export interface DhfDocsMessage {
    type: 'dhf:docs';
    payload: { docs: DhfDocDTO[] };
}

/** Client → Server: create or update a DHF document file */
export interface DhfDocSaveMessage {
    type: 'dhf:doc:save';
    payload: { doc: DhfDocDTO };
}

/** Client → Server: delete a DHF document file */
export interface DhfDocDeleteMessage {
    type: 'dhf:doc:delete';
    payload: { docId: string };
}

/** Server → Client: persisted DHF settings (on connect) */
export interface DhfSettingsMessage {
    type: 'dhf:settings';
    payload: { settings: DhfSettingsDTO };
}

/** Client → Server: persist DHF settings */
export interface DhfSettingsSaveMessage {
    type: 'dhf:settings:save';
    payload: { settings: DhfSettingsDTO };
}

/** Client → Server: list markdown files in the repo usable as templates */
export interface DhfTemplatesListMessage {
    type: 'dhf:templates:list';
    payload: { requestId: string };
}

/** Server → Client: repo template listing */
export interface DhfTemplatesResultMessage {
    type: 'dhf:templates:result';
    payload: { requestId: string; templates: DhfRepoTemplateInfo[] };
}

/** Client → Server: read one repo template file */
export interface DhfTemplateReadMessage {
    type: 'dhf:template:read';
    payload: { requestId: string; path: string };
}

/** Server → Client: repo template content */
export interface DhfTemplateContentMessage {
    type: 'dhf:template:content';
    payload: { requestId: string; path: string; content?: string; error?: string };
}

/** Server → Client: CSV import results */
export interface ImportResultMessage {
    type: 'import:result';
    payload: {
        success: boolean;
        elementsImported: number;
        relationshipsImported: number;
        errors: string[];
        warnings: string[];
        /** Path to generated .sysml file */
        generatedFile?: string;
    };
}
