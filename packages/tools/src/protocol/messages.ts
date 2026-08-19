// ─── WebSocket Protocol Messages ──────────────────────────────────────────────
//
// Shared types for the CLI dev server ↔ Web app WebSocket protocol.
// ─────────────────────────────────────────────────────────────────────────────

import type { MemoModelDTO } from '../model/semantic.js';
import type { ValidationResult, CompletenessReport } from '../validator/types.js';
import type { OntologyPackageInfo } from '../model/ontology-loader.js';
import type { MethodologyDescriptor } from '../model/methodology-loader.js';
import type { EffectiveRule, RuleResolutionDiagnostic } from '../model/methodology-resolver.js';
import type {
    RelationshipCreateRequest,
    RelationshipDeleteRequest,
    RelationshipUpdateRequest,
    RelationshipDiagnostic,
} from '../model/relationship-legality.js';
import type { ChatMessage } from '../llm/llm-provider.js';
import type { ProposedChange } from '../llm/chat-engine.js';
import type { LlmSettingsStatus, LLMProviderName } from '../llm/llm-settings.js';

/**
 * Transport ordering for one live project workspace. This intentionally sits
 * beside the protocol rather than in the semantic DTO: restarts make a new
 * session, while a client applies an incremental publication only when its
 * `baseRevision` is the revision it already holds.
 */
export interface WorkspaceRevision {
    workspaceSessionId: string;
    revision: number;
    baseRevision: number | null;
    sourceGraphHash: string;
    reusableRegistryHash: string;
    projectRegistryHash: string;
    changedSourceIds: string[];
    modelDelta?: ModelDelta;
    snapshot?: boolean;
}

/** Incremental semantic-model changes between adjacent workspace revisions. */
export interface ModelDelta {
    upsertElements: Record<string, MemoModelDTO['elements'][string]>;
    removeElementIds: string[];
    /** Non-element collections/metadata are replaced atomically. */
    patch: Omit<MemoModelDTO, 'elements'>;
}

interface WorkspacePublication {
    revision?: WorkspaceRevision;
}

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
    | RulesUpdateMessage
    | DiagramLayoutMessage
    | OntologyInstallResultMessage
    | OntologyRemoveResultMessage
    | LlmStatusMessage
    | LlmAskResultMessage
    | LlmChatResultMessage
    | LlmApplyResultMessage
    | LlmSettingsMessage
    | LlmSettingsSaveResultMessage
    | LlmGenerateResultMessage
    | LlmDraftResultMessage
    | LlmSuggestResultMessage
    | RestartRequiredMessage
    | EditConflictMessage
    | DhfDocsMessage
    | DhfSettingsMessage
    | DhfTemplatesResultMessage
    | DhfTemplateContentMessage
    | DhfTemplateSaveResultMessage
    | RelationshipCreateResultMessage
    | RelationshipDeleteResultMessage
    | RelationshipUpdateResultMessage
    | ElementDeleteResultMessage
    | ElementMutationResultMessage
    | PackageMutationResultMessage
    | MethodologySourceResultMessage
    | RulePolicyWriteResultMessage
    | ScreenCaptureUploadResultMessage
    | SourceCoherenceMessage
    | SourceChangedMessage;

export interface ModelUpdateMessage extends WorkspacePublication {
    type: 'model:update';
    payload: MemoModelDTO;
}

export interface ValidationUpdateMessage extends WorkspacePublication {
    type: 'validation:update';
    payload: ValidationResult;
}

export interface CompletenessUpdateMessage extends WorkspacePublication {
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

/**
 * Server → Client: which source files changed on disk, sent with the rebuild
 * they caused.
 *
 * `model:update` says what the model is now; this says what moved. A surface
 * showing a file — the SysML editor, a view, an element — needs the second to
 * know whether it is looking at stale content, since the model DTO alone
 * cannot distinguish "your file changed" from "some other file changed".
 */
export interface SourceChangedMessage {
    type: 'source:changed';
    payload: {
        /** Project-relative paths that changed, added, or were removed. */
        files: string[];
        /** Model revision produced by the rebuild these changes triggered. */
        revision: number;
        /** Wall-clock time of the rebuild, for "updated 2s ago" affordances. */
        at: number;
        /** Accepted server writes observed in this watcher batch, file → transaction ID. */
        serverTransactions?: Record<string, string>;
    };
}

/**
 * Server sends the effective rule set: which rules are active, at what
 * severity, and under whose authority.
 *
 * Section 10.4 makes this governance data, not enforcement evidence. It says
 * what the effective SET is and how it got that way; whether a rule's predicate
 * fires is the separate question section 4.1 answers with Option P.
 */
export interface RulesUpdateMessage {
    type: 'rules:update';
    payload: {
        rules: EffectiveRule[];
        diagnostics: RuleResolutionDiagnostic[];
    };
}

/** Server's answer to a RulePolicy write. */
export interface RulePolicyWriteResultMessage {
    type: 'rule:policy:write:result';
    payload: {
        requestId: string;
        success: boolean;
        /** Refusal code from `checkRulePolicy`, when the decision was rejected. */
        code?: string;
        error?: string;
        revision?: string;
        transactionId?: string;
        conflict?: boolean;
    };
}

/**
 * Client asks the server to write a RulePolicy into methodology source.
 *
 * The editor never composes SysML text itself. It names the rule and the
 * decision; Tools renders the `RulePolicy` and writes it through the same
 * precondition-checked path as every other mutation, so a rule tailored from
 * the browser is subject to the same conflict rules as one typed in SysIDE.
 */
export interface RulePolicyWriteMessage {
    type: 'rule:policy:write';
    payload: {
        requestId: string;
        /** `constraint def` type name the policy targets. */
        targetRuleType: string;
        disposition: 'enabled' | 'disabled' | 'replaced';
        severityOverride?: 'error' | 'warning' | 'info';
        replacementRuleType?: string;
        rationaleText: string;
        authority?: string;
        approvalReference?: string;
        /** Methodology source file to write into. */
        sourceFile: string;
        baseRevision: string;
    };
}

/** Server sends parsed methodology data — Phase B (data-only, no UI yet) */
export interface MethodologyUpdateMessage {
    type: 'methodology:update';
    payload: MethodologyDescriptor;
}

export interface MethodologySourceRequestMessage {
    type: 'methodology:source:request';
    payload: { requestId: string; sourceFile: string };
}

export interface MethodologySourceSaveMessage {
    type: 'methodology:source:save';
    payload: { requestId: string; sourceFile: string; text: string; baseRevision: string };
}

export interface MethodologySourceResultMessage {
    type: 'methodology:source:result';
    payload: {
        requestId: string;
        sourceFile: string;
        operation: 'load' | 'save';
        success: boolean;
        text?: string;
        revision?: string;
        transactionId?: string;
        conflict?: boolean;
        error?: string;
    };
}

// ─── Client → Server ────────────────────────────────────────────────────────

export type ClientMessage =
    | RequestRefreshMessage
    | ElementUpdateMessage
    | ElementCreateMessage
    | ElementDeleteMessage
    | RelationshipCreateMessage
    | RelationshipDeleteMessage
    | RelationshipUpdateMessage
    | ScreenCaptureUploadMessage
    | CsvImportMessage
    | DiagramCreateMessage
    | DiagramUpdateMessage
    | DiagramDeleteMessage
    | DiagramParseMessage
    | DiagramSourceRequestMessage
    | DiagramSourceSaveMessage
    | MethodologySourceRequestMessage
    | MethodologySourceSaveMessage
    | RulePolicyWriteMessage
    | OntologySaveSelectionMessage
    | OntologyInstallMessage
    | OntologyRemoveMessage
    | DiagramLayoutUpdateMessage
    | LlmAskMessage
    | LlmChatMessage
    | LlmApplyMessage
    | LlmSettingsSaveMessage
    | LlmGenerateMessage
    | LlmDraftMessage
    | LlmSuggestMessage
    | DhfDocsLoadMessage
    | DhfDocSaveMessage
    | DhfDocDeleteMessage
    | DhfSettingsSaveMessage
    | DhfTemplatesListMessage
    | DhfTemplateReadMessage
    | DhfTemplateSaveMessage;

export interface RequestRefreshMessage {
    type: 'request:refresh';
}

/** Preconditions carried by a browser mutation before Tools writes SysML. */
export interface ModelMutationPrecondition {
    workspaceSessionId: string;
    baseRevision: number;
    sourceFile: string;
    expectedSourceHash: string;
    targetElementIds: string[];
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
        requestId: string;
        id: string;
        elementId: string;
        doc?: string;
        attributes?: Record<string, string>;
        precondition: ModelMutationPrecondition;
    };
}

/** Client requests a new element creation in SysML */
export interface ElementCreateMessage {
    type: 'element:create';
    payload: {
        requestId: string;
        id: string;
        name: string;
        kind: string;
        construct: string;
        attributes?: Record<string, string>;
        precondition: ModelMutationPrecondition;
    };
}

export interface ElementMutationResultMessage {
    type: 'element:mutation:result';
    payload: {
        requestId: string;
        elementId: string;
        success: boolean;
        transactionId?: string;
        conflict?: boolean;
        sourceFile?: string;
        expectedSourceHash?: string;
        currentSourceHash?: string;
        rejectedDraft?: unknown;
        error?: string;
        /**
         * The write was addressed to an IR identity the current revision does
         * not have (§6.2). Reported separately from a source-hash conflict
         * because the remedy is the same but the cause is not: the file may be
         * untouched and the *address* out of date.
         */
        stale?: boolean;
        /** IR identity of the written declaration, for the client's next edit. */
        irIdentity?: string;
        /** Advisory notes about a write that succeeded — see ElementWriteWarning. */
        warnings?: Array<{ code: string; message: string }>;
    };
}

/**
 * Result of a containment edit: creating, renaming or removing a package, or
 * moving an element into one.
 *
 * One message type for all four because they answer the same question — what
 * does the model contain now — and a client that acts on containment reacts to
 * them identically.
 */
export interface PackageMutationResultMessage {
    type: 'package:mutation:result';
    payload: {
        requestId: string;
        success: boolean;
        /** Project-relative files the operation wrote. */
        filePaths?: string[];
        /** Qualified name the operation produced or acted on. */
        qualifiedName?: string;
        error?: string;
        /** The move was addressed to an IR identity the revision does not have. */
        stale?: boolean;
        /** Advisory notes about a write that succeeded — see PACKAGE_EDIT_IS_TEXT_ONLY. */
        warnings?: Array<{ code: string; message: string }>;
    };
}

/** A scoped project-source conflict; other files remain editable. */
export interface EditConflictMessage {
    type: 'app:edit-conflict';
    payload: {
        /**
         * Why the edit was refused.
         *
         * `source-changed` — the file moved under the edit. `stale-identity` —
         * the file may be untouched and the *address* out of date (§6.2). The
         * remedy is the same reload, but telling the user the file changed when
         * it did not is a false explanation, so the two are named apart.
         */
        reason?: 'source-changed' | 'stale-identity';
        /** The server's own account of the refusal, when it has one. */
        detail?: string;
        sourceFile: string;
        targetElementIds: string[];
        baseRevision: number | string;
        currentRevision: number | string;
        expectedSourceHash: string;
        currentSourceHash: string;
        rejectedCommandId: string;
        rejectedDraft: unknown;
    };
}

/** Client requests deletion of one project-owned element and its relationships. */
export interface ElementDeleteMessage {
    type: 'element:delete';
    payload: { requestId: string; elementId: string; precondition: ModelMutationPrecondition };
}

/** Server confirms that the element and connected relationships were removed. */
export interface ElementDeleteResultMessage {
    type: 'element:delete:result';
    payload: {
        requestId: string;
        elementId: string;
        success: boolean;
        sourceFiles?: string[];
        removedRelationshipIds?: string[];
        error?: string;
    };
}

/** Persist a screen-capture image inside the model repository. */
export interface ScreenCaptureUploadMessage {
    type: 'screen-capture:upload';
    payload: {
        requestId: string;
        /** Geometry view name; used as the asset directory name. */
        viewName: string;
        fileName: string;
        /** Base64 payload without a data-URL prefix. */
        base64: string;
        mediaType: 'image/png' | 'image/jpeg' | 'image/webp';
    };
}

/** Result of persisting a screen-capture image. */
export interface ScreenCaptureUploadResultMessage {
    type: 'screen-capture:upload:result';
    payload: {
        requestId: string;
        success: boolean;
        /** Project-relative URI suitable for ScreenCapture.imageUri. */
        imageUri?: string;
        imageHash?: string;
        error?: string;
    };
}

/**
 * Client requests a new model relationship between two elements.
 *
 * This is a request/response exchange, not fire-and-forget: the server
 * revalidates the request against the ontology before writing, and answers with
 * relationship:create:result. The client shows a pending row until then.
 */
export interface RelationshipCreateMessage {
    type: 'relationship:create';
    payload: RelationshipCreateRequest & { precondition: ModelMutationPrecondition };
}

/** Server response to relationship:create */
export interface RelationshipCreateResultMessage {
    type: 'relationship:create:result';
    payload: {
        requestId: string;
        success: boolean;
        /**
         * Stable ID of the created connection usage.
         *
         * Absent when the relationship was written in a SysML production that
         * takes no declared name — a succession or a flow. See `notation`.
         */
        relationshipId?: string;
        /** SysML production the relationship was written in. */
        notation?: string;
        /** The exact declaration text inserted. */
        declaration?: string;
        /** Normalized camelCase relationship type */
        type?: string;
        sourceId?: string;
        targetId?: string;
        /** Project-relative .sysml file the relationship was written to */
        sourceFile?: string;
        /** Actionable diagnostics (REL-xxx) — populated on failure */
        diagnostics?: RelationshipDiagnostic[];
        error?: string;
    };
}

/** Client requests deletion of one relationship usage */
export interface RelationshipDeleteMessage {
    type: 'relationship:delete';
    payload: RelationshipDeleteRequest & { precondition: ModelMutationPrecondition };
}

/** Server response to relationship:delete */
export interface RelationshipDeleteResultMessage {
    type: 'relationship:delete:result';
    payload: {
        requestId: string;
        success: boolean;
        relationshipId: string;
        /** File the usage was removed from */
        sourceFile?: string;
        /** The exact declaration removed, so the client can offer undo */
        removedDeclaration?: string;
        diagnostics?: RelationshipDiagnostic[];
        error?: string;
    };
}

/** Client requests an atomic endpoint change for one relationship usage. */
export interface RelationshipUpdateMessage {
    type: 'relationship:update';
    payload: RelationshipUpdateRequest & { precondition: ModelMutationPrecondition };
}

/** Server response to relationship:update. */
export interface RelationshipUpdateResultMessage {
    type: 'relationship:update:result';
    payload: {
        requestId: string;
        success: boolean;
        relationshipId: string;
        sourceId?: string;
        targetId?: string;
        sourceFile?: string;
        diagnostics?: RelationshipDiagnostic[];
        error?: string;
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
        viewKind?: string;
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
        /**
         * Revision the edit was based on, from the load (or last save) that
         * produced the buffer. The server refuses the write when the file has
         * moved on since, so a stale editor cannot silently discard work that
         * arrived from another editor, another client, or the relationship
         * writer. There is no unconditional overwrite route.
         */
        baseRevision: string;
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
        /** Content revision of the file as it now stands on disk. */
        revision?: string;
        transactionId?: string;
        /**
         * Set when a save was refused because the file changed underneath the
         * edit. `text` and `revision` carry the current on-disk state so the
         * client can show the conflict rather than guess.
         */
        conflict?: boolean;
        /**
         * Parse errors in the text that was written. The save still succeeds —
         * saving work in progress is legitimate — but the editor can surface
         * them immediately instead of waiting for the rebuild.
         */
        parseErrors?: string[];
    };
}

// ─── Sidecar Layout ─────────────────────────────────────────────────────────

/** Per-node visual override stored in the view's .viewlayout companion. */
export interface DiagramNodeLayout {
    /**
     * Position, in the coordinate frame named by `parent`.
     *
     * A nested node's position is local to its parent — React Flow's own
     * convention — and a top-level node's is board coordinates. The two are
     * different frames, so a stored pair means nothing without knowing which
     * one it was written in. When a node that used to sit on the board becomes
     * nested (or stops being nested), the saved numbers are silently
     * reinterpreted in the new frame and the node jumps.
     *
     * `parent` records the frame so a reader can rebase instead of guessing.
     * That is the whole fix: layout stays pure presentation and survives a
     * change in model nesting, which is not a presentation change at all.
     */
    x: number;
    y: number;
    /**
     * The node this position was saved relative to; absent means board
     * coordinates. Written since layout v2. Absent in a v1 sidecar, which is
     * why loading must treat "no parent recorded" as "unknown frame" and leave
     * the position alone rather than assume the board.
     */
    parent?: string | null;
    width?: number;
    height?: number;
    color?: string;
    /** Border colour override. Omitted means the notation's automatic colour. */
    borderColor?: string;
    /** Label colour override. Omitted means the notation's automatic colour. */
    textColor?: string;
    /** Label size in px. Omitted means the notation's automatic size. */
    fontSize?: number;
    /** Label weight. Omitted means the notation's automatic weight. */
    fontWeight?: number;
    /** Horizontal label alignment. Omitted means the notation's automatic alignment. */
    textAlign?: 'left' | 'center' | 'right';
    /** Vertical label alignment. Omitted means the notation's automatic alignment. */
    verticalAlign?: 'top' | 'middle' | 'bottom';
    /** Fill opacity 0..1, for dimming context around the parts under review. */
    opacity?: number;
    /** Per-diagram boundary-port positions, relative to the owning node. */
    ports?: Record<string, { x: number; y: number; side?: 'top' | 'bottom' | 'left' | 'right'; size?: number }>;
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

/** Presentation-only annotation stored with a diagram, never as a model fact. */
export interface DiagramAnnotation {
    kind: 'note' | 'text' | 'constraint';
    x: number;
    y: number;
    width?: number;
    height?: number;
    text: string;
    color?: string;
}

/** Full layout for one diagram, deserialized from its .viewlayout companion. */
export interface DiagramLayout {
    nodes: Record<string, DiagramNodeLayout>;
    edges: Record<string, DiagramEdgeLayout>;
    annotations?: Record<string, DiagramAnnotation>;
    canvas?: {
        zoom?: number;
        pan?: { x: number; y: number };
        grid?: number;
        snap?: boolean;
        /** False after the first user geometry override. */
        autoLayout?: boolean;
        /** Animate directional flow along connectors. */
        flowAnimation?: boolean;
        /** IBD display choices persist with the view rather than component state. */
        portDisplay?: 'all' | 'ports' | 'none';
        connectionDisplay?: 'summary' | 'all' | 'none';
        showPortText?: boolean;
        showConnectionText?: boolean;
        /**
         * Which wall each boundary port straddles, by port id. Unlike
         * `nodes[].ports`, this is a constraint rather than geometry: automatic
         * layout still places and orders the port, it just does so on the
         * declared wall. It therefore survives a layout reset, which clears
         * hand-authored positions but not the drawing's intent.
         */
        portWalls?: Record<string, 'top' | 'bottom' | 'left' | 'right'>;
        /** Model enum that classifies blocks for this view's legend. */
        legend?: {
            enum: string;
            /** Element attribute carrying one literal of `enum`. */
            attribute: string;
            /** Literal → author-chosen colour. No renderer palette is implied. */
            colors: Record<string, string>;
        };
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

/**
 * Client → Server: one turn of a multi-turn model conversation.
 *
 * `history` is the transcript returned by the previous turn, tool calls and
 * all — the server holds no per-conversation state.
 */
export interface LlmChatMessage {
    type: 'llm:chat';
    payload: {
        requestId: string;
        question: string;
        history?: ChatMessage[];
        /** Let the model stage edits. Read-only when absent or false. */
        allowEdits?: boolean;
    };
}

/** Server → Client: assistant reply plus any changes staged for approval */
export interface LlmChatResultMessage {
    type: 'llm:chat:result';
    payload: {
        requestId: string;
        answer?: string;
        proposedChanges?: ProposedChange[];
        /** Updated transcript to send back as `history` on the next turn. */
        messages?: ChatMessage[];
        truncated?: boolean;
        error?: string;
    };
}

/** Client → Server: apply the changes the user approved */
export interface LlmApplyMessage {
    type: 'llm:chat:apply';
    payload: { requestId: string; changes: ProposedChange[] };
}

/** Server → Client: per-change outcome of an apply */
export interface LlmApplyResultMessage {
    type: 'llm:chat:apply:result';
    payload: {
        requestId: string;
        applied?: string[];
        failed?: Array<{ id: string; error: string }>;
        error?: string;
    };
}

/** Server → Client: current LLM settings. Never includes the API key itself. */
export interface LlmSettingsMessage {
    type: 'llm:settings';
    payload: { settings: LlmSettingsStatus };
}

/**
 * Client → Server: update LLM settings.
 *
 * `apiKey` is written to the user's credentials file outside the project;
 * provider/model/baseUrl go to project settings. Omitted fields are left alone;
 * an empty `apiKey` string clears the stored key.
 */
export interface LlmSettingsSaveMessage {
    type: 'llm:settings:save';
    payload: {
        requestId: string;
        provider?: LLMProviderName;
        model?: string;
        baseUrl?: string;
        apiKey?: string;
    };
}

/** Server → Client: settings after the save, or why it failed */
export interface LlmSettingsSaveResultMessage {
    type: 'llm:settings:save:result';
    payload: { requestId: string; settings?: LlmSettingsStatus; error?: string };
}

/** Client → Server: generate SysML v2 from a natural language description */
export interface LlmGenerateMessage {
    type: 'llm:generate';
    payload: { requestId: string; description: string };
}

/** Server → Client: generated SysML v2 code */
export interface LlmGenerateResultMessage {
    type: 'llm:generate:result';
    payload: {
        requestId: string;
        sysml?: string;
        /** Original draft; used by the client to make the repair diff visible. */
        initialSysml?: string;
        explanation?: string;
        suggestedFile?: string;
        attempts?: number;
        diagnostics?: import('../toolchain/diagnostic.js').Diagnostic[];
        changeRecord?: {
            guidanceVersion: string;
            compiler: { id: string; version?: string };
            libraries: Record<string, string>;
        };
        error?: string;
    };
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

/**
 * Server → Client: whether the project source currently compiles.
 *
 * Invalid source in the working tree is a normal state, not a fault: the
 * compiler reports it and the editor keeps working. While `coherent` is false
 * the server withholds the degraded model, so every client keeps the last
 * successfully compiled scene on screen and hangs these diagnostics off it.
 * The next coherent rebuild clears the condition on its own — a source typo is
 * never a reason to restart the runtime.
 *
 * This is deliberately *not* a `RestartRequiredMessage`. That one means the
 * frozen semantic environment is stale (the ontology moved under us), which
 * only a fresh process can resolve.
 */
export interface SourceCoherenceMessage {
    type: 'source:coherence';
    payload: {
        coherent: boolean;
        /** Files that failed to parse, the first-error file first. Empty when coherent. */
        files: string[];
        /** Diagnostics from the failed parse. Empty when coherent. */
        diagnostics: Array<{ file: string; message: string; line?: number; column?: number }>;
        /** Revision of the model the client is still showing — the last good one. */
        lastGoodRevision: number;
    };
}

/** Server → Client: ontology changed on disk — client must reload after server restart */
export interface RestartRequiredMessage {
    type: 'app:restart-required';
    reason: 'ontology-source-changed' | 'ontology-selection-changed'
        | 'dependency-closure-uncomputable' | 'transaction-independence-uncomputable';
    changedFile: string;
    instruction: string;
}

// ─── DHF Workbench Documents ─────────────────────────────────────────────────

/** A DHF workbench document persisted as markdown in the project's dhf/documents/ */
export interface DhfDocDTO {
    id: string;
    title: string;
    group: string;
    /**
     * Element id of the system this document belongs to.
     *
     * A design history file is per-device, and a system-of-systems project has
     * more than one device in it. Absent means the document is project-wide —
     * the workbench files those under "Global" rather than under a system.
     */
    systemId?: string;
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

/** Client → Server: add a reusable project template under dhf/templates. */
export interface DhfTemplateSaveMessage {
    type: 'dhf:template:save';
    payload: { requestId: string; title: string; content: string };
}

/** Server → Client: project template persistence result. */
export interface DhfTemplateSaveResultMessage {
    type: 'dhf:template:save:result';
    payload: { requestId: string; path?: string; error?: string };
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
