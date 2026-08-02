// @memoarchitect/tools — public API

// ─── Language (generated parser + AST) ──────────────────────────────────────
export * from './language/generated/ast.js';
export * from './language/generated/module.js';
export * from './language/memo-sysml-module.js';

// ─── Model (config, semantic, builder) ──────────────────────────────────────
// Re-export config types selectively to avoid name collision with AST's
// ViewpointDefinition (generated from grammar) vs config's ViewpointDefinition.
export {
    type SysMLConstruct,
    type DiagramType,
    type MEMOConfig,
    type ToolchainConfig,
} from './model/config.js';
export * from './model/native-project.js';
export * from './model/project-conversion.js';
export * from './server/rule-policy-writer.js';
export * from './server/conflict-policy.js';
export * from './validator/builtin-rules.js';
export * from './model/methodology-resolver.js';
export * from './model/effective-scope.js';
export * from './model/settings-boundary.js';
export * from './model/config-loader.js';
export * from './model/semantic.js';
export * from './model/source-graph.js';
export * from './model/source-provenance.js';
export * from './model/short-id.js';
export * from './model/parser-utils.js';
export * from './model/builder.js';
export * from './model/layer-resolver.js';
export * from './model/kind-registry.js';
export * from './model/view-deriver.js';
export * from './model/view-kinds.js';
export * from './model/relationship-registry.js';
export * from './model/relationship-legality.js';
export * from './model/ontology-loader.js';
export * from './model/manifest.js';
export * from './model/content-store.js';
export * from './model/toolchain.js';
export * from './model/methodology-loader.js';
export * from './model/paths.js';

// ─── Validation + Completeness ──────────────────────────────────────────────
export * from './validator/types.js';
export * from './validator/rule-engine.js';
export * from './validator/behavior-validator.js';
export * from './validator/architecture-validator.js';
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

// The MCP server is intentionally NOT re-exported here. It depends on
// server/persistor, which imports this module by package name — routing it
// through the public index would close a runtime import cycle. `memo mcp`
// imports src/mcp/server.js directly instead.

// ─── Protocol (WebSocket messages) ──────────────────────────────────────────
export * from './protocol/messages.js';

// ─── OWL Export ─────────────────────────────────────────────────────────────
export * from './ontology/owl-exporter.js';

// ─── Project runtime + CLI-shared operations ───────────────────────────────
export * from './operations/index.js';
