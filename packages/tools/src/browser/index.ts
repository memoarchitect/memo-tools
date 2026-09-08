// Browser-safe @memoarchitect/tools surface. Keep this entrypoint free of parser,
// filesystem, server, and other Node-only dependencies.
export * from '../model/naming.js';
export * from '../model/semantic.js';
export * from '../model/source-affinity.js';
export * from '../model/relationship-legality.js';
export * from '../model/activity-notation.js';
// The SysML metaclass names, generated from SysML.ecore. A consumer asking
// "is this kind SysML, or is it undefined entirely?" needs the vocabulary the
// standard declares, not a list someone typed. The names-only module is here
// on purpose: `sysml-metamodel.js` answers the same question and costs every
// metaclass descriptor to do it.
export * from '../sysml-ir/generated/sysml-metaclass-names.js';
export * from '../model/view-deriver.js';
export * from '../model/view-kinds.js';
export * from '../analysis/dsm.js';
export * from '../analysis/impact.js';
export * from '../import/recipes.js';
export * from '../import/column-mapper.js';
export type * from '../validator/types.js';
export type * from '../protocol/messages.js';
export type { StandardsReport } from '../dhf/standards-report.js';
export type { MethodologyDescriptor } from '../model/methodology-loader.js';
export type { OntologyPackageInfo } from '../model/ontology-loader.js';

// LLM types only. These modules reach for node:fs and fetch, but `export type`
// is erased at compile time, so nothing Node-only reaches the bundle.
export type { ChatMessage, ToolCall, LLMProviderName } from '../llm/llm-provider.js';
export type {
    ProposedChange,
    ProposedElementCreate,
    ProposedElementUpdate,
    ProposedRelationshipCreate,
    ProposedRelationshipDelete,
} from '../llm/chat-engine.js';
export type { LlmSettingsStatus, LlmSettingsOrigin } from '../llm/llm-settings.js';
