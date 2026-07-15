// ─── MEMO Plugin System — Type Definitions ──────────────────────────────────
//
// Inspired by EventCatalog's generator pattern: plugins are simple async
// functions with metadata. Supports four extension points:
// - export: Custom DHF export formats (PDF, LaTeX, XLSX, etc.)
// - analysis: Custom analysis tools (beyond DSM and impact)
// - validation: Custom validation rules beyond closure rules
// - generator: Pre-build content generators (EventCatalog-style)
// ─────────────────────────────────────────────────────────────────────────────

import type { MemoModel, MemoModelDTO } from '../model/semantic.js';
import type { MEMOConfig } from '../model/config.js';
import type { ValidationResult, Violation, CompletenessReport } from '../validator/types.js';
import type { DhfDocument } from '../dhf/document-ir.js';
import type { QueryContext } from '../dhf/query-engine.js';

// ─── Plugin types ───────────────────────────────────────────────────────────

export type PluginType = 'export' | 'analysis' | 'validation' | 'generator';

/** Base plugin metadata — all plugins carry this */
export interface PluginMeta {
    /** Unique identifier (e.g., "pdf-exporter", "fmea-analysis") */
    id: string;
    /** Human-readable display name */
    name: string;
    /** Semver version */
    version: string;
    /** Plugin type */
    type: PluginType;
    /** Brief description */
    description?: string;
}

// ─── Plugin context — what plugins receive ──────────────────────────────────

/** Context passed to all plugin invocations */
export interface PluginContext {
    /** Semantic model */
    model: MemoModel;
    /** Resolved configuration */
    config: MEMOConfig;
    /** Validation results */
    validation: ValidationResult;
    /** Completeness report */
    completeness: CompletenessReport;
    /** Query context (same as DHF templates use) */
    query: QueryContext;
    /** Project directory path */
    projectDir: string;
}

// ─── Export plugin ──────────────────────────────────────────────────────────

/** Result of an export plugin */
export interface ExportResult {
    /** File content (string for text, Buffer for binary) */
    content: string | Buffer;
    /** Suggested file extension (e.g., ".pdf", ".xlsx") */
    extension: string;
    /** MIME type */
    mimeType: string;
}

/** Export plugin — renders DHF documents to custom formats */
export interface ExportPlugin extends PluginMeta {
    type: 'export';
    /** File extension this plugin produces (e.g., ".pdf") */
    extension: string;
    /** MIME type this plugin produces */
    mimeType: string;
    /** Render a DHF document to the target format */
    render(doc: DhfDocument, ctx: PluginContext, options?: Record<string, unknown>): Promise<ExportResult>;
}

// ─── Analysis plugin ────────────────────────────────────────────────────────

/** Result of an analysis plugin */
export interface AnalysisResult {
    /** Plugin ID */
    toolId: string;
    /** Human-readable title */
    title: string;
    /** Analysis output — structure defined by each plugin */
    data: unknown;
    /** Optional text summary for CLI output */
    summary?: string;
}

/** Analysis plugin — custom model analysis tools */
export interface AnalysisPlugin extends PluginMeta {
    type: 'analysis';
    /** Run the analysis */
    analyse(ctx: PluginContext, options?: Record<string, unknown>): Promise<AnalysisResult>;
}

// ─── Validation plugin ──────────────────────────────────────────────────────

/** Validation plugin — custom validation rules beyond closure rules */
export interface ValidationPlugin extends PluginMeta {
    type: 'validation';
    /** Run custom validation, return violations */
    validate(ctx: PluginContext, options?: Record<string, unknown>): Promise<Violation[]>;
}

// ─── Generator plugin ───────────────────────────────────────────────────────

/** Generator plugin — EventCatalog-style pre-build content generation */
export interface GeneratorPlugin extends PluginMeta {
    type: 'generator';
    /** Generate content (write files, modify model, etc.) */
    generate(ctx: PluginContext, options?: Record<string, unknown>): Promise<void>;
}

// ─── Union type ─────────────────────────────────────────────────────────────

/** Any MEMO plugin */
export type MemoPlugin = ExportPlugin | AnalysisPlugin | ValidationPlugin | GeneratorPlugin;

// ─── Plugin configuration (from memo.plugins.yaml or config) ────────────────

/** A single plugin entry in config */
export interface PluginEntry {
    /** Module path — npm package name or local path (prefix with ./ for local) */
    module: string;
    /** Plugin-specific options passed to the plugin */
    options?: Record<string, unknown>;
    /** Whether this plugin is enabled (default: true) */
    enabled?: boolean;
}

/** Plugin manifest file (memo.plugin.yaml in plugin packages) */
export interface PluginManifest {
    /** Plugin ID */
    id: string;
    /** Plugin name */
    name: string;
    /** Version */
    version: string;
    /** Plugin type */
    type: PluginType;
    /** Brief description */
    description?: string;
    /** Entry point (relative to package root) */
    entrypoint: string;
    /** Author */
    author?: string;
    /** License */
    license?: string;
    /** Tags for discovery */
    tags?: string[];
}
