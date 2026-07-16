// ─── DHF Module ──────────────────────────────────────────────────────────────
//
// Design History File workbench: document registry, template engine,
// query engine, export plugins, configuration, and redline/snapshot.
// ─────────────────────────────────────────────────────────────────────────────

export * from './document-registry.js';
export * from './document-ir.js';
export * from './query-engine.js';
export * from './template-engine.js';
export * from './dhf-config.js';
export * from './export-plugin.js';
export * from './snapshot.js';

// ─── V2: Markdown-first DHF pipeline ─────────────────────────────────────────
export * from './directive-parser.js';
export * from './query-executor.js';
export * from './script-runner.js';
export * from './template-resolver.js';
export * from './document-compiler.js';
export * from './dhf-config-v2.js';
export * from './markdown-to-ir.js';
