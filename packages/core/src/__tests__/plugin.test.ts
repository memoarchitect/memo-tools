import { describe, it, expect, beforeEach } from 'vitest';
import {
    PluginRegistry,
    loadPluginConfig,
    scaffoldPlugin,
} from '../plugin/index.js';
import type {
    ExportPlugin,
    AnalysisPlugin,
    ValidationPlugin,
    GeneratorPlugin,
    PluginContext,
    MemoPlugin,
    PluginEntry,
} from '../plugin/plugin-types.js';
import type { MemoModel, MemoElement, MemoRelationship } from '../model/semantic.js';
import type { MEMOConfig } from '../model/config.js';
import type { ValidationResult, CompletenessReport, Violation } from '../validator/types.js';
import type { QueryContext } from '../dhf/query-engine.js';
import type { DhfDocument } from '../dhf/document-ir.js';

// ─── Test helpers ───────────────────────────────────────────────────────────

function createMockContext(): PluginContext {
    const elements: MemoElement[] = [
        { id: 'el-1', name: 'TestElement', kind: 'Hazard', construct: 'part', layer: 'risk', file: 'test.sysml', attributes: {} },
    ];
    const model = {
        elements: new Map(elements.map(e => [e.id, e])),
        relationships: [] as MemoRelationship[],
        errors: [],
        elementsByKind: new Map([['Hazard', elements]]),
        elementsByLayer: new Map([['risk', elements]]),
        relationshipsByType: new Map(),
        outgoing: new Map(),
        incoming: new Map(),
    } as MemoModel;

    const config: MEMOConfig = {
        projectName: 'Test',
        projectType: 'device',
        architectureLayers: [],
        viewpoints: [],
        workflows: [],
    };

    const validation: ValidationResult = {
        violations: [],
        rulesEvaluated: 0,
        rulesPassed: 0,
        timestamp: Date.now(),
    };

    const completeness: CompletenessReport = {
        layers: [],
        overall: 100,
        totalElements: 1,
        completeElements: 1,
        elementStatus: { 'el-1': 'complete' },
    };

    const query: QueryContext = {
        projectName: 'Test',
        allElements: () => elements,
        elementsByKind: () => [],
        elementsByKinds: () => [],
        elementsByLayer: () => [],
        element: (id) => elements.find(e => e.id === id),
        elementName: (id) => elements.find(e => e.id === id)?.name || id,
        allRelationships: () => [],
        relationshipsByType: () => [],
        related: () => [],
        outgoing: () => [],
        incoming: () => [],
        violationsFor: () => [],
        violationsBySeverity: () => [],
        unmitigatedCount: () => 0,
        untracedRequirements: () => [],
        errorCount: () => 0,
        warningCount: () => 0,
        totalElements: () => 1,
        totalRelationships: () => 0,
        layerCount: () => 1,
        overallCompleteness: () => 100,
        layerSummary: () => [],
        traceChain: () => [],
    };

    return { model, config, validation, completeness, query, projectDir: '/tmp/test' };
}

function createMockExportPlugin(): ExportPlugin {
    return {
        id: 'test-exporter',
        name: 'Test Exporter',
        version: '1.0.0',
        type: 'export',
        extension: '.txt',
        mimeType: 'text/plain',
        render: async (doc, ctx) => ({
            content: `Exported: ${doc.frontmatter.title}`,
            extension: '.txt',
            mimeType: 'text/plain',
        }),
    };
}

function createMockAnalysisPlugin(): AnalysisPlugin {
    return {
        id: 'test-analysis',
        name: 'Test Analysis',
        version: '1.0.0',
        type: 'analysis',
        analyse: async (ctx) => ({
            toolId: 'test-analysis',
            title: 'Test Analysis',
            data: { elements: ctx.query.totalElements() },
            summary: 'Ran test analysis.',
        }),
    };
}

function createMockValidationPlugin(): ValidationPlugin {
    return {
        id: 'test-validator',
        name: 'Test Validator',
        version: '1.0.0',
        type: 'validation',
        validate: async (ctx) => {
            const violations: Violation[] = [];
            for (const el of ctx.query.allElements()) {
                if (!el.doc) {
                    violations.push({
                        ruleId: 'test-001',
                        description: `${el.name} missing doc`,
                        severity: 'warning',
                        elementId: el.id,
                        elementKind: el.kind,
                        elementName: el.name,
                        layer: el.layer,
                    });
                }
            }
            return violations;
        },
    };
}

function createMockGeneratorPlugin(): GeneratorPlugin {
    let ran = false;
    return {
        id: 'test-generator',
        name: 'Test Generator',
        version: '1.0.0',
        type: 'generator',
        generate: async () => { ran = true; },
        get _ran() { return ran; },
    } as GeneratorPlugin & { _ran: boolean };
}

// ─── PluginRegistry tests ───────────────────────────────────────────────────

describe('PluginRegistry', () => {
    let registry: PluginRegistry;

    beforeEach(() => {
        registry = new PluginRegistry();
    });

    it('starts empty', () => {
        expect(registry.size).toBe(0);
        expect(registry.list()).toEqual([]);
    });

    it('registers and retrieves plugins', () => {
        const plugin = createMockExportPlugin();
        registry.register(plugin);
        expect(registry.size).toBe(1);
        expect(registry.get('test-exporter')).toBe(plugin);
        expect(registry.has('test-exporter')).toBe(true);
    });

    it('unregisters plugins', () => {
        registry.register(createMockExportPlugin());
        expect(registry.unregister('test-exporter')).toBe(true);
        expect(registry.size).toBe(0);
        expect(registry.has('test-exporter')).toBe(false);
    });

    it('overwrites plugins with the same ID', () => {
        const p1 = createMockExportPlugin();
        const p2 = { ...createMockExportPlugin(), version: '2.0.0' };
        registry.register(p1);
        registry.register(p2);
        expect(registry.size).toBe(1);
        expect(registry.get('test-exporter')?.version).toBe('2.0.0');
    });

    it('filters plugins by type', () => {
        registry.register(createMockExportPlugin());
        registry.register(createMockAnalysisPlugin());
        registry.register(createMockValidationPlugin());
        registry.register(createMockGeneratorPlugin());

        expect(registry.list().length).toBe(4);
        expect(registry.list('export').length).toBe(1);
        expect(registry.list('analysis').length).toBe(1);
        expect(registry.list('validation').length).toBe(1);
        expect(registry.list('generator').length).toBe(1);
    });

    it('provides typed accessors', () => {
        registry.register(createMockExportPlugin());
        registry.register(createMockAnalysisPlugin());

        expect(registry.getExport('test-exporter')).toBeDefined();
        expect(registry.getAnalysis('test-analysis')).toBeDefined();
        // Wrong type returns undefined
        expect(registry.getExport('test-analysis')).toBeUndefined();
        expect(registry.getAnalysis('test-exporter')).toBeUndefined();
    });

    it('convenience list methods work', () => {
        registry.register(createMockExportPlugin());
        registry.register(createMockAnalysisPlugin());
        registry.register(createMockValidationPlugin());
        registry.register(createMockGeneratorPlugin());

        expect(registry.listExports()).toHaveLength(1);
        expect(registry.listAnalysis()).toHaveLength(1);
        expect(registry.listValidation()).toHaveLength(1);
        expect(registry.listGenerators()).toHaveLength(1);
    });

    it('clears all plugins', () => {
        registry.register(createMockExportPlugin());
        registry.register(createMockAnalysisPlugin());
        registry.clear();
        expect(registry.size).toBe(0);
    });
});

// ─── Plugin execution tests ─────────────────────────────────────────────────

describe('Plugin execution', () => {
    let registry: PluginRegistry;
    let ctx: PluginContext;

    beforeEach(() => {
        registry = new PluginRegistry();
        ctx = createMockContext();
    });

    it('runs export plugin', async () => {
        registry.register(createMockExportPlugin());
        const doc: DhfDocument = {
            frontmatter: { documentId: 'test', title: 'Test Doc', version: '1.0', standards: [], generatedAt: '' },
            sections: [],
            status: 'empty',
            totalElements: 0,
            totalGaps: 0,
        };
        const result = await registry.runExport('test-exporter', doc, ctx);
        expect(result.content).toBe('Exported: Test Doc');
        expect(result.extension).toBe('.txt');
    });

    it('runs analysis plugin', async () => {
        registry.register(createMockAnalysisPlugin());
        const result = await registry.runAnalysis('test-analysis', ctx);
        expect(result.toolId).toBe('test-analysis');
        expect((result.data as any).elements).toBe(1);
    });

    it('runs validation plugin', async () => {
        registry.register(createMockValidationPlugin());
        const violations = await registry.runValidation('test-validator', ctx);
        expect(violations.length).toBe(1);
        expect(violations[0].ruleId).toBe('test-001');
        expect(violations[0].elementName).toBe('TestElement');
    });

    it('runs all validation plugins', async () => {
        registry.register(createMockValidationPlugin());
        const v2: ValidationPlugin = {
            ...createMockValidationPlugin(),
            id: 'test-validator-2',
            validate: async () => [{
                ruleId: 'test-002', description: 'Another rule', severity: 'error' as const,
                elementId: 'el-1', elementKind: 'Hazard', elementName: 'TestElement', layer: 'risk',
            }],
        };
        registry.register(v2);
        const violations = await registry.runAllValidation(ctx);
        expect(violations.length).toBe(2);
    });

    it('runs generator plugin', async () => {
        const gen = createMockGeneratorPlugin();
        registry.register(gen);
        await registry.runGenerator('test-generator', ctx);
        // Generator ran without error
        expect(registry.has('test-generator')).toBe(true);
    });

    it('runs all generators in sequence', async () => {
        registry.register(createMockGeneratorPlugin());
        const ran = await registry.runAllGenerators(ctx);
        expect(ran).toEqual(['test-generator']);
    });

    it('throws for missing plugin', async () => {
        await expect(registry.runAnalysis('nonexistent', ctx)).rejects.toThrow('not found');
    });
});

// ─── Scaffold tests ─────────────────────────────────────────────────────────

describe('scaffoldPlugin', () => {
    it('scaffolds an export plugin', () => {
        const files = scaffoldPlugin({ name: 'pdf-exporter', type: 'export' });
        expect(files.length).toBeGreaterThanOrEqual(4);

        const manifest = files.find(f => f.path === 'memo.plugin.yaml');
        expect(manifest?.content).toContain('type: export');
        expect(manifest?.content).toContain('pdf-exporter');

        const source = files.find(f => f.path === 'src/index.ts');
        expect(source?.content).toContain('ExportPlugin');
        expect(source?.content).toContain('render');

        const pkg = files.find(f => f.path === 'package.json');
        expect(pkg?.content).toContain('memo-plugin-pdf-exporter');
    });

    it('scaffolds an analysis plugin', () => {
        const files = scaffoldPlugin({ name: 'my-analysis', type: 'analysis' });
        const source = files.find(f => f.path === 'src/index.ts');
        expect(source?.content).toContain('AnalysisPlugin');
        expect(source?.content).toContain('analyse');
    });

    it('scaffolds a validation plugin', () => {
        const files = scaffoldPlugin({ name: 'doc-check', type: 'validation' });
        const source = files.find(f => f.path === 'src/index.ts');
        expect(source?.content).toContain('ValidationPlugin');
        expect(source?.content).toContain('validate');
    });

    it('scaffolds a generator plugin', () => {
        const files = scaffoldPlugin({ name: 'summary-gen', type: 'generator' });
        const source = files.find(f => f.path === 'src/index.ts');
        expect(source?.content).toContain('GeneratorPlugin');
        expect(source?.content).toContain('generate');
    });

    it('generates test file', () => {
        const files = scaffoldPlugin({ name: 'my-plugin', type: 'export' });
        const test = files.find(f => f.path === 'src/__tests__/plugin.test.ts');
        expect(test?.content).toContain('has correct metadata');
    });
});

// ─── Plugin config loading tests ────────────────────────────────────────────

describe('loadPluginConfig', () => {
    it('returns empty array for non-existent config', () => {
        const entries = loadPluginConfig('/tmp/nonexistent-dir-' + Date.now());
        expect(entries).toEqual([]);
    });
});
