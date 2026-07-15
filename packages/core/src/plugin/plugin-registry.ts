// ─── MEMO Plugin Registry ────────────────────────────────────────────────────
//
// Central registry for all MEMO plugins. Supports registration, lookup by
// ID or type, and lifecycle management (initialize/cleanup).
// ─────────────────────────────────────────────────────────────────────────────

import type {
    MemoPlugin,
    PluginType,
    ExportPlugin,
    AnalysisPlugin,
    ValidationPlugin,
    GeneratorPlugin,
    PluginContext,
    AnalysisResult,
    ExportResult,
} from './plugin-types.js';
import type { DhfDocument } from '../dhf/document-ir.js';
import type { Violation } from '../validator/types.js';

/** Plugin registry — manages all registered plugins */
export class PluginRegistry {
    private plugins = new Map<string, MemoPlugin>();

    /** Number of registered plugins */
    get size(): number {
        return this.plugins.size;
    }

    /** Register a plugin. Overwrites any existing plugin with the same ID. */
    register(plugin: MemoPlugin): void {
        this.plugins.set(plugin.id, plugin);
    }

    /** Unregister a plugin by ID */
    unregister(id: string): boolean {
        return this.plugins.delete(id);
    }

    /** Get a plugin by ID */
    get(id: string): MemoPlugin | undefined {
        return this.plugins.get(id);
    }

    /** Get a typed plugin by ID */
    getExport(id: string): ExportPlugin | undefined {
        const p = this.plugins.get(id);
        return p?.type === 'export' ? p as ExportPlugin : undefined;
    }

    getAnalysis(id: string): AnalysisPlugin | undefined {
        const p = this.plugins.get(id);
        return p?.type === 'analysis' ? p as AnalysisPlugin : undefined;
    }

    getValidation(id: string): ValidationPlugin | undefined {
        const p = this.plugins.get(id);
        return p?.type === 'validation' ? p as ValidationPlugin : undefined;
    }

    getGenerator(id: string): GeneratorPlugin | undefined {
        const p = this.plugins.get(id);
        return p?.type === 'generator' ? p as GeneratorPlugin : undefined;
    }

    /** List all plugins, optionally filtered by type */
    list(type?: PluginType): MemoPlugin[] {
        const all = Array.from(this.plugins.values());
        return type ? all.filter(p => p.type === type) : all;
    }

    /** List export plugins */
    listExports(): ExportPlugin[] {
        return this.list('export') as ExportPlugin[];
    }

    /** List analysis plugins */
    listAnalysis(): AnalysisPlugin[] {
        return this.list('analysis') as AnalysisPlugin[];
    }

    /** List validation plugins */
    listValidation(): ValidationPlugin[] {
        return this.list('validation') as ValidationPlugin[];
    }

    /** List generator plugins */
    listGenerators(): GeneratorPlugin[] {
        return this.list('generator') as GeneratorPlugin[];
    }

    /** Check if a plugin is registered */
    has(id: string): boolean {
        return this.plugins.has(id);
    }

    /** Clear all registered plugins */
    clear(): void {
        this.plugins.clear();
    }

    // ─── Convenience execution methods ──────────────────────────────────

    /** Run an export plugin by ID */
    async runExport(
        id: string,
        doc: DhfDocument,
        ctx: PluginContext,
        options?: Record<string, unknown>,
    ): Promise<ExportResult> {
        const plugin = this.getExport(id);
        if (!plugin) throw new Error(`Export plugin not found: ${id}`);
        return plugin.render(doc, ctx, options);
    }

    /** Run an analysis plugin by ID */
    async runAnalysis(
        id: string,
        ctx: PluginContext,
        options?: Record<string, unknown>,
    ): Promise<AnalysisResult> {
        const plugin = this.getAnalysis(id);
        if (!plugin) throw new Error(`Analysis plugin not found: ${id}`);
        return plugin.analyse(ctx, options);
    }

    /** Run a validation plugin by ID, returns violations */
    async runValidation(
        id: string,
        ctx: PluginContext,
        options?: Record<string, unknown>,
    ): Promise<Violation[]> {
        const plugin = this.getValidation(id);
        if (!plugin) throw new Error(`Validation plugin not found: ${id}`);
        return plugin.validate(ctx, options);
    }

    /** Run all validation plugins, returns combined violations */
    async runAllValidation(
        ctx: PluginContext,
        options?: Record<string, unknown>,
    ): Promise<Violation[]> {
        const violations: Violation[] = [];
        for (const plugin of this.listValidation()) {
            const results = await plugin.validate(ctx, options);
            violations.push(...results);
        }
        return violations;
    }

    /** Run a generator plugin by ID */
    async runGenerator(
        id: string,
        ctx: PluginContext,
        options?: Record<string, unknown>,
    ): Promise<void> {
        const plugin = this.getGenerator(id);
        if (!plugin) throw new Error(`Generator plugin not found: ${id}`);
        return plugin.generate(ctx, options);
    }

    /** Run all generator plugins in sequence */
    async runAllGenerators(
        ctx: PluginContext,
        options?: Record<string, unknown>,
    ): Promise<string[]> {
        const ran: string[] = [];
        for (const plugin of this.listGenerators()) {
            await plugin.generate(ctx, options);
            ran.push(plugin.id);
        }
        return ran;
    }
}

/** Global plugin registry instance */
export const globalPluginRegistry = new PluginRegistry();
