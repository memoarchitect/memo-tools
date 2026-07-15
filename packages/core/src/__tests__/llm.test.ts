import { describe, it, expect, vi, afterEach } from 'vitest';
import {
    resolveLLMConfig,
    serializeModelContext,
    serializeOntologyContext,
    askModel,
    generateSysml,
    draftDocument,
} from '../llm/index.js';
import type { LLMProvider, CompletionResult, ChatMessage, CompletionOptions } from '../llm/llm-provider.js';
import type { QueryContext } from '../dhf/query-engine.js';
import type { MEMOConfig } from '../model/config.js';
import type { DhfDocumentType } from '../dhf/document-registry.js';
import type { MemoElement, MemoRelationship } from '../model/semantic.js';

// ─── Mock provider ──────────────────────────────────────────────────────────

function createMockProvider(responseContent: string): LLMProvider {
    return {
        name: 'mock/test',
        complete: vi.fn(async (_opts: CompletionOptions): Promise<CompletionResult> => ({
            content: responseContent,
            usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 },
        })),
    };
}

// ─── Mock query context ─────────────────────────────────────────────────────

function createMockContext(): QueryContext {
    const elements: MemoElement[] = [
        { id: 'haz-001', name: 'OverPressure', kind: 'Hazard', construct: 'part', layer: 'risk', file: 'risk.sysml', attributes: { severity: 'S4' } },
        { id: 'req-001', name: 'PressureLimit', kind: 'SystemRequirement', construct: 'requirement', layer: 'requirements', file: 'reqs.sysml', attributes: {} },
        { id: 'rc-001', name: 'PressureRelief', kind: 'RiskControl', construct: 'part', layer: 'risk', file: 'risk.sysml', attributes: {} },
    ];
    const relationships: MemoRelationship[] = [
        { id: 'rel-001', type: 'mitigates', sourceId: 'rc-001', sourceEnd: 'control', targetId: 'haz-001', targetEnd: 'hazard', file: 'risk.sysml' },
    ];
    const byKind: Record<string, MemoElement[]> = {
        Hazard: [elements[0]],
        SystemRequirement: [elements[1]],
        RiskControl: [elements[2]],
    };

    return {
        projectName: 'TestDevice',
        allElements: () => elements,
        elementsByKind: (kind: string) => byKind[kind] || [],
        elementsByKinds: (kinds: string[]) => kinds.flatMap((k: string) => byKind[k] || []),
        elementsByLayer: () => [],
        element: (id: string) => elements.find(e => e.id === id),
        elementName: (id: string) => elements.find(e => e.id === id)?.name || id,
        allRelationships: () => relationships,
        relationshipsByType: () => [],
        related: () => [],
        outgoing: () => [],
        incoming: () => [],
        violationsFor: () => [],
        violationsBySeverity: () => [],
        unmitigatedCount: () => 0,
        untracedRequirements: () => [],
        errorCount: () => 0,
        warningCount: () => 1,
        totalElements: () => 3,
        totalRelationships: () => 1,
        layerCount: () => 2,
        overallCompleteness: () => 85,
        layerSummary: () => [
            { id: 'risk', label: 'Risk', count: 2, completeness: 100, color: '#E53E3E' },
            { id: 'requirements', label: 'Requirements', count: 1, completeness: 70, color: '#4A90D9' },
        ],
        traceChain: () => [],
    };
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('resolveLLMConfig', () => {
    const originalEnv = { ...process.env };

    afterEach(() => {
        process.env = { ...originalEnv };
    });

    it('returns undefined when no API key is set', () => {
        delete process.env.ANTHROPIC_API_KEY;
        delete process.env.OPENAI_API_KEY;
        expect(resolveLLMConfig()).toBeUndefined();
    });

    it('detects Anthropic key', () => {
        process.env.ANTHROPIC_API_KEY = 'sk-ant-test';
        const config = resolveLLMConfig();
        expect(config?.provider).toBe('anthropic');
        expect(config?.apiKey).toBe('sk-ant-test');
    });

    it('detects OpenAI key', () => {
        delete process.env.ANTHROPIC_API_KEY;
        process.env.OPENAI_API_KEY = 'sk-test';
        const config = resolveLLMConfig();
        expect(config?.provider).toBe('openai');
    });

    it('prefers Anthropic when both are set', () => {
        process.env.ANTHROPIC_API_KEY = 'sk-ant-test';
        process.env.OPENAI_API_KEY = 'sk-test';
        expect(resolveLLMConfig()?.provider).toBe('anthropic');
    });

    it('respects MEMO_LLM_MODEL override', () => {
        process.env.OPENAI_API_KEY = 'sk-test';
        process.env.MEMO_LLM_MODEL = 'gpt-4-turbo';
        expect(resolveLLMConfig()?.model).toBe('gpt-4-turbo');
    });
});

describe('serializeModelContext', () => {
    it('produces a non-empty string with project name', () => {
        const ctx = createMockContext();
        const text = serializeModelContext(ctx);
        expect(text).toContain('# Model: TestDevice');
        expect(text).toContain('Elements: 3');
        expect(text).toContain('Relationships: 1');
    });

    it('includes element details grouped by kind', () => {
        const ctx = createMockContext();
        const text = serializeModelContext(ctx);
        expect(text).toContain('### Hazard');
        expect(text).toContain('OverPressure');
    });

    it('includes relationship details', () => {
        const ctx = createMockContext();
        const text = serializeModelContext(ctx);
        expect(text).toContain('### mitigates');
        expect(text).toContain('PressureRelief');
    });

    it('includes layer summary', () => {
        const ctx = createMockContext();
        const text = serializeModelContext(ctx);
        expect(text).toContain('Risk (risk)');
        expect(text).toContain('Requirements (requirements)');
    });

    it('filters by kind when filterKinds is specified', () => {
        const ctx = createMockContext();
        const text = serializeModelContext(ctx, { filterKinds: ['Hazard'] });
        expect(text).toContain('OverPressure');
        expect(text).not.toContain('PressureLimit');
    });
});

describe('serializeOntologyContext', () => {
    it('includes available kinds', () => {
        const config: MEMOConfig = {
            projectName: 'Test',
            projectType: 'device',
            kinds: {
                Hazard: { label: 'Hazard', layer: 'risk', sysmlConstruct: 'part def' },
                SystemRequirement: { label: 'System Requirement', layer: 'requirements', sysmlConstruct: 'requirement def' },
            },
            architectureLayers: [{ id: 'risk', label: 'Risk', color: '#E53E3E' }],
            viewpoints: [],
            workflows: [],
        };
        const text = serializeOntologyContext(config);
        expect(text).toContain('Hazard');
        expect(text).toContain('part def');
        expect(text).toContain('## Architecture Layers');
    });
});

describe('askModel', () => {
    it('sends model context and question to LLM', async () => {
        const ctx = createMockContext();
        const provider = createMockProvider('The OverPressure hazard is mitigated by PressureRelief.');

        const result = await askModel('What mitigates OverPressure?', ctx, provider);

        expect(result.answer).toContain('OverPressure');
        expect(result.usage?.totalTokens).toBe(150);
        expect(provider.complete).toHaveBeenCalledTimes(1);

        // Verify the prompt contains model context
        const call = (provider.complete as any).mock.calls[0][0];
        expect(call.messages.some((m: ChatMessage) => m.content.includes('TestDevice'))).toBe(true);
        expect(call.messages.some((m: ChatMessage) => m.content.includes('What mitigates OverPressure'))).toBe(true);
    });
});

describe('generateSysml', () => {
    it('returns parsed SysML from LLM response', async () => {
        const config: MEMOConfig = {
            projectName: 'Test',
            projectType: 'device',
            kinds: { Hazard: { label: 'Hazard', layer: 'risk', sysmlConstruct: 'part def' } },
            architectureLayers: [],
            viewpoints: [],
            workflows: [],
        };

        const provider = createMockProvider(
            '```sysml\npackage RiskModel {\n    part hazOverdose : Hazard {\n        attribute redefines severity = "S4";\n    }\n}\n```\n\n**Explanation:** Created a hazard for overdose.\n\n**Suggested file:** risk/overdose.sysml',
        );

        const result = await generateSysml('Create a hazard for overdose', config, provider);

        expect(result.sysml).toContain('part hazOverdose : Hazard');
        expect(result.explanation).toContain('hazard');
        expect(result.suggestedFile).toBe('risk/overdose.sysml');
    });

    it('handles response without code block markers', async () => {
        const config: MEMOConfig = {
            projectName: 'Test',
            projectType: 'device',
            architectureLayers: [],
            viewpoints: [],
            workflows: [],
        };

        const provider = createMockProvider('part sensor : PressureSensor { }');
        const result = await generateSysml('Add sensor', config, provider);
        expect(result.sysml).toContain('PressureSensor');
    });
});

describe('draftDocument', () => {
    it('drafts content for empty sections', async () => {
        const ctx = createMockContext();
        const docType: DhfDocumentType = {
            id: 'rmp',
            title: 'Risk Management Plan',
            standards: ['ISO 14971:2019 §4.4'],
            layers: ['risk'],
            relevantKinds: ['Hazard', 'RiskControl'],
            relevantRelationships: ['mitigates'],
            group: 'risk',
            sections: [
                { id: 'scope', title: 'Scope', required: true },
                { id: 'criteria', title: 'Risk Acceptability Criteria', required: true },
            ],
        };

        const provider = createMockProvider(
            '=== SECTION: scope ===\nThis document defines the risk management process for the TestDevice.\n\n=== SECTION: criteria ===\nRisk acceptability is evaluated per ISO 14971.',
        );

        const result = await draftDocument(ctx, provider, { documentType: docType });

        expect(result.draftedSections).toContain('scope');
        expect(result.draftedSections).toContain('criteria');
        expect(result.document.sections).toHaveLength(2);
        expect(result.document.sections[0].blocks.length).toBeGreaterThan(0);
    });

    it('skips sections that already have content', async () => {
        const ctx = createMockContext();
        const docType: DhfDocumentType = {
            id: 'rmp',
            title: 'Risk Management Plan',
            standards: ['ISO 14971:2019'],
            layers: ['risk'],
            relevantKinds: ['Hazard'],
            relevantRelationships: ['mitigates'],
            group: 'risk',
            sections: [
                { id: 'scope', title: 'Scope', required: true },
                { id: 'criteria', title: 'Criteria', required: true },
            ],
        };

        const existingDoc: any = {
            frontmatter: { documentId: 'rmp', title: 'RMP', version: '1.0', standards: [], generatedAt: '' },
            sections: [
                { id: 'scope', title: 'Scope', blocks: [{ type: 'paragraph', content: [{ type: 'text', value: 'Existing' }] }], status: 'complete' },
                { id: 'criteria', title: 'Criteria', blocks: [], status: 'empty' },
            ],
            status: 'partial',
            totalElements: 0,
            totalGaps: 0,
        };

        const provider = createMockProvider('=== SECTION: criteria ===\nCriteria content here.');

        const result = await draftDocument(ctx, provider, {
            documentType: docType,
            existingDocument: existingDoc,
        });

        expect(result.draftedSections).toEqual(['criteria']);
        expect(result.draftedSections).not.toContain('scope');
    });

    it('returns empty when no sections need drafting', async () => {
        const ctx = createMockContext();
        const docType: DhfDocumentType = {
            id: 'rmp',
            title: 'Risk Management Plan',
            standards: ['ISO 14971:2019'],
            layers: ['risk'],
            relevantKinds: ['Hazard'],
            relevantRelationships: ['mitigates'],
            group: 'risk',
            sections: [
                { id: 'scope', title: 'Scope', required: true },
            ],
        };

        const existingDoc: any = {
            frontmatter: { documentId: 'rmp', title: 'RMP', version: '1.0', standards: [], generatedAt: '' },
            sections: [
                { id: 'scope', title: 'Scope', blocks: [{ type: 'paragraph', content: [] }], status: 'complete' },
            ],
            status: 'complete',
            totalElements: 0,
            totalGaps: 0,
        };

        const provider = createMockProvider('');
        const result = await draftDocument(ctx, provider, {
            documentType: docType,
            existingDocument: existingDoc,
        });

        expect(result.draftedSections).toEqual([]);
        expect(result.summary).toContain('No sections needed');
    });
});
