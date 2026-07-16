// @memo/tools — public API

// ─── Language (generated parser + AST) ──────────────────────────────────────
export * from './language/generated/ast.js';
export * from './language/generated/module.js';
export * from './language/memo-sysml-module.js';

// ─── Model (config, semantic, builder) ──────────────────────────────────────
// Re-export config types selectively to avoid name collision with AST's
// ViewpointDefinition (generated from grammar) vs config's ViewpointDefinition.
export {
    type ProjectType,
    type ArchLayer,
    type RelationshipType,
    type SysMLConstruct,
    type KindDefinition,
    type ViewpointDefinition as MEMOViewpointDefinition,
    type WorkflowStep,
    type WorkflowDefinition,
    type FirstRunConfig,
    type OntologyReference,
    type DiagramType,
    type DiagramDefinition,
    type MEMOConfig,
} from './model/config.js';
export * from './model/config-loader.js';
export * from './model/semantic.js';
export * from './model/short-id.js';
export * from './model/parser-utils.js';
export * from './model/builder.js';
export * from './model/layer-resolver.js';
export * from './model/kind-registry.js';
export * from './model/view-deriver.js';
export * from './model/view-kinds.js';
export * from './model/relationship-registry.js';
export * from './model/ontology-loader.js';
export * from './model/manifest.js';
export * from './model/content-store.js';
export * from './model/toolchain.js';
export * from './model/methodology-loader.js';
export * from './model/paths.js';
export * from './model/dimension-filter.js';

// ─── Validation + Completeness ──────────────────────────────────────────────
export * from './validator/types.js';
export * from './validator/rule-engine.js';
export * from './validator/behavior-validator.js';
export * from './validator/view-validator.js';
export * from './validator/rule-registry.js';
export * from './validator/constraint-eval.js';
export * from './validator/constraint-loader.js';
export * from './completeness/tracker.js';

// ─── Analysis ────────────────────────────────────────────────────────────────
export * from './analysis/impact.js';
export * from './analysis/dsm.js';

// ─── Serializer (CSV import/export, SysML generation) ───────────────────────
export * from './serializer/csv-io.js';
export * from './serializer/sysml-generator.js';

// ─── Import (recipes, column-mapper, diff) ───────────────────────────────────
export * from './import/recipes.js';
export * from './import/column-mapper.js';
export * from './import/import-diff.js';

// ─── Importers (EA, Cameo, SysAnd, OWL/JSON-LD) ────────────────────────────
export * from './importer/index.js';

// ─── DHF (Design History File workbench) ────────────────────────────────────
export * from './dhf/index.js';

// ─── LLM (AI-assisted modeling & document drafting) ─────────────────────────
export * from './llm/index.js';

// ─── Plugin System ──────────────────────────────────────────────────────────
export * from './plugin/index.js';

// ─── Protocol (WebSocket messages) ──────────────────────────────────────────
export * from './protocol/messages.js';

// ─── OWL Export ─────────────────────────────────────────────────────────────
export * from './ontology/owl-exporter.js';

// ─── Project runtime + CLI-shared operations ───────────────────────────────
export * from './operations/index.js';
