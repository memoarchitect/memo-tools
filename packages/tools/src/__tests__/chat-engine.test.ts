// ─── Chat Engine Tests ───────────────────────────────────────────────────────
//
// Covers the tool loop, the read tools, and — most importantly — that the write
// tools stage proposals instead of touching the model.
// ─────────────────────────────────────────────────────────────────────────────

import { describe, it, expect, vi } from 'vitest';
import { runChatTurn } from '../llm/chat-engine.js';
import { acceptsSamplingParams } from '../llm/llm-provider.js';
import type { LLMProvider, CompletionOptions, CompletionResult, ChatMessage } from '../llm/llm-provider.js';
import type { QueryContext } from '../dhf/query-engine.js';
import type { MemoElement, MemoRelationship } from '../model/semantic.js';

// ─── Fixtures ────────────────────────────────────────────────────────────────

const elements: MemoElement[] = [
    { id: 'haz-001', name: 'OverPressure', kind: 'Hazard', construct: 'part', layer: 'risk', file: 'risk.sysml', attributes: { severity: 'S4' } },
    { id: 'req-001', name: 'PressureLimit', kind: 'SystemRequirement', construct: 'requirement', layer: 'requirements', file: 'reqs.sysml', attributes: {} },
];

const relationships: MemoRelationship[] = [
    { id: 'rel-001', type: 'mitigates', sourceId: 'req-001', sourceEnd: 'control', targetId: 'haz-001', targetEnd: 'hazard', file: 'risk.sysml' },
];

function createContext(): QueryContext {
    return {
        projectName: 'TestDevice',
        allElements: () => elements,
        elementsByKind: (kind: string) => elements.filter(e => e.kind === kind),
        elementsByKinds: (kinds: string[]) => elements.filter(e => kinds.includes(e.kind)),
        elementsByLayer: (layer: string) => elements.filter(e => e.layer === layer),
        element: (id: string) => elements.find(e => e.id === id),
        elementName: (id: string) => elements.find(e => e.id === id)?.name ?? id,
        allRelationships: () => relationships,
        relationshipsByType: (type: string) => relationships.filter(r => r.type === type),
        related: () => [],
        outgoing: (id: string) => relationships.filter(r => r.sourceId === id),
        incoming: (id: string) => relationships.filter(r => r.targetId === id),
        violationsFor: () => [],
        violationsBySeverity: () => [],
        unmitigatedCount: () => 0,
        untracedRequirements: () => [],
        errorCount: () => 0,
        warningCount: () => 0,
        totalElements: () => elements.length,
        totalRelationships: () => relationships.length,
        layerCount: () => 2,
        overallCompleteness: () => 80,
        layerSummary: () => [{ id: 'risk', label: 'Risk', count: 1, completeness: 80, color: '#f00' }],
        traceChain: () => [{ element: elements[0], relationship: relationships[0], depth: 1 }],
    } as QueryContext;
}

// The vocabulary the chat tools validate against. It used to be read off a
// MEMOConfig; kinds and relationships come from the resolved ontology now.
const ontology = {
    kinds: {
        Hazard: { label: 'Hazard', layer: 'risk', sysmlConstruct: 'part def' as const },
        SystemRequirement: { label: 'System Requirement', layer: 'requirements', sysmlConstruct: 'requirement def' as const },
    },
    relationshipTypes: [
        { name: 'mitigates', label: 'Mitigates', layer: 'risk', color: '#E74C3C' },
    ],
};

/** A provider that replays a scripted sequence of completions. */
function scriptedProvider(script: CompletionResult[]): LLMProvider & { calls: CompletionOptions[] } {
    const calls: CompletionOptions[] = [];
    let i = 0;
    return {
        name: 'mock/scripted',
        calls,
        complete: vi.fn(async (opts: CompletionOptions) => {
            calls.push(opts);
            return script[Math.min(i++, script.length - 1)];
        }),
    } as LLMProvider & { calls: CompletionOptions[] };
}

// ─── Plain answers ───────────────────────────────────────────────────────────

describe('runChatTurn — plain answers', () => {
    it('returns the assistant answer when no tools are called', async () => {
        const provider = scriptedProvider([{ content: 'There are 2 elements.', stopReason: 'end_turn' }]);
        const result = await runChatTurn({ question: 'How many elements?', ctx: createContext(), provider, ontology });
        expect(result.answer).toBe('There are 2 elements.');
        expect(result.proposedChanges).toEqual([]);
    });

    it('embeds the model summary on the first turn only', async () => {
        const provider = scriptedProvider([{ content: 'ok', stopReason: 'end_turn' }]);
        const first = await runChatTurn({ question: 'Q1', ctx: createContext(), provider, ontology });
        expect(provider.calls[0].messages.some(m => m.content.includes('# Model: TestDevice'))).toBe(true);

        await runChatTurn({ question: 'Q2', history: first.messages, ctx: createContext(), provider, ontology });
        const secondTurnUserMsg = provider.calls[1].messages.at(-1);
        expect(secondTurnUserMsg?.content).toBe('Q2');
    });

    it('returns a transcript that can be replayed as history', async () => {
        const provider = scriptedProvider([{ content: 'first', stopReason: 'end_turn' }]);
        const result = await runChatTurn({ question: 'Q1', ctx: createContext(), provider, ontology });
        expect(result.messages.at(-1)).toEqual({ role: 'assistant', content: 'first' });
    });
});

// ─── Read tools ──────────────────────────────────────────────────────────────

describe('runChatTurn — read tools', () => {
    it('executes a tool call and feeds the result back', async () => {
        const provider = scriptedProvider([
            { content: '', stopReason: 'tool_use', toolCalls: [{ id: 'c1', name: 'search_elements', input: { kind: 'Hazard' } }] },
            { content: 'Found OverPressure.', stopReason: 'end_turn' },
        ]);
        const result = await runChatTurn({ question: 'List hazards', ctx: createContext(), provider, ontology });

        expect(result.answer).toBe('Found OverPressure.');
        const toolMsg = provider.calls[1].messages.find(m => m.role === 'tool');
        expect(toolMsg?.toolCallId).toBe('c1');
        expect(toolMsg?.content).toContain('haz-001');
    });

    it('answers every call in a parallel batch', async () => {
        const provider = scriptedProvider([
            {
                content: '', stopReason: 'tool_use', toolCalls: [
                    { id: 'c1', name: 'get_element', input: { id: 'haz-001' } },
                    { id: 'c2', name: 'get_element', input: { id: 'req-001' } },
                ],
            },
            { content: 'done', stopReason: 'end_turn' },
        ]);
        await runChatTurn({ question: 'Compare them', ctx: createContext(), provider, ontology });

        const toolMsgs = provider.calls[1].messages.filter(m => m.role === 'tool');
        expect(toolMsgs.map(m => m.toolCallId)).toEqual(['c1', 'c2']);
    });

    it('reports a bad element id as a recoverable tool error', async () => {
        const provider = scriptedProvider([
            { content: '', stopReason: 'tool_use', toolCalls: [{ id: 'c1', name: 'get_element', input: { id: 'nope' } }] },
            { content: 'That element does not exist.', stopReason: 'end_turn' },
        ]);
        await runChatTurn({ question: 'Describe nope', ctx: createContext(), provider, ontology });

        const toolMsg = provider.calls[1].messages.find(m => m.role === 'tool');
        expect(toolMsg?.isError).toBe(true);
        expect(toolMsg?.content).toContain('No element with id "nope"');
    });

    it('stops at maxIterations rather than looping forever', async () => {
        const provider = scriptedProvider([
            { content: '', stopReason: 'tool_use', toolCalls: [{ id: 'c', name: 'layer_summary', input: {} }] },
        ]);
        const result = await runChatTurn({
            question: 'Loop', ctx: createContext(), provider, ontology, maxIterations: 3,
        });
        expect(result.truncated).toBe(true);
        expect(provider.complete).toHaveBeenCalledTimes(3);
    });
});

// ─── Write tools stage, never apply ──────────────────────────────────────────

describe('runChatTurn — proposed changes', () => {
    const stageOne = (name: string, input: Record<string, unknown>) => scriptedProvider([
        { content: '', stopReason: 'tool_use', toolCalls: [{ id: 'c1', name, input }] },
        { content: 'Staged.', stopReason: 'end_turn' },
    ]);

    it('hides the write tools unless edits are allowed', async () => {
        const provider = scriptedProvider([{ content: 'ok', stopReason: 'end_turn' }]);
        await runChatTurn({ question: 'Q', ctx: createContext(), provider, ontology });
        const names = (provider.calls[0].tools ?? []).map(t => t.name);
        expect(names.some(n => n.startsWith('propose_'))).toBe(false);
    });

    it('offers the write tools when edits are allowed', async () => {
        const provider = scriptedProvider([{ content: 'ok', stopReason: 'end_turn' }]);
        await runChatTurn({ question: 'Q', ctx: createContext(), provider, ontology, allowEdits: true });
        const names = (provider.calls[0].tools ?? []).map(t => t.name);
        expect(names).toContain('propose_create_element');
        expect(names).toContain('propose_create_relationship');
    });

    it('refuses a write tool when edits are disabled, even if the model calls it', async () => {
        const provider = stageOne('propose_create_element', { id: 'x', name: 'X', kind: 'Hazard' });
        const result = await runChatTurn({ question: 'Add X', ctx: createContext(), provider, ontology, allowEdits: false });

        expect(result.proposedChanges).toEqual([]);
        const toolMsg = provider.calls[1].messages.find(m => m.role === 'tool');
        expect(toolMsg?.isError).toBe(true);
        expect(toolMsg?.content).toContain('Editing is disabled');
    });

    it('stages an element creation without applying it', async () => {
        const provider = stageOne('propose_create_element', {
            id: 'haz-002', name: 'UnderPressure', kind: 'Hazard', rationale: 'Symmetric hazard is missing.',
        });
        const result = await runChatTurn({ question: 'Add it', ctx: createContext(), provider, ontology, allowEdits: true });

        expect(result.proposedChanges).toHaveLength(1);
        const change = result.proposedChanges[0];
        expect(change.kind).toBe('create-element');
        expect(change).toMatchObject({ elementId: 'haz-002', summary: 'Symmetric hazard is missing.' });
        // The tool result must not let the model believe the model changed.
        const toolMsg = provider.calls[1].messages.find(m => m.role === 'tool');
        expect(toolMsg?.content).toContain('Not yet applied');
    });

    it('defaults a created element to its kind\'s layer', async () => {
        const provider = stageOne('propose_create_element', { id: 'haz-002', name: 'X', kind: 'Hazard' });
        const result = await runChatTurn({ question: 'Add', ctx: createContext(), provider, ontology, allowEdits: true });
        expect(result.proposedChanges[0]).toMatchObject({ layer: 'risk' });
    });

    it('rejects a kind the ontology does not define', async () => {
        const provider = stageOne('propose_create_element', { id: 'x', name: 'X', kind: 'Sandwich' });
        const result = await runChatTurn({ question: 'Add', ctx: createContext(), provider, ontology, allowEdits: true });

        expect(result.proposedChanges).toEqual([]);
        const toolMsg = provider.calls[1].messages.find(m => m.role === 'tool');
        expect(toolMsg?.isError).toBe(true);
        expect(toolMsg?.content).toContain('not a kind in this ontology');
    });

    it('rejects creating an element that already exists', async () => {
        const provider = stageOne('propose_create_element', { id: 'haz-001', name: 'X', kind: 'Hazard' });
        const result = await runChatTurn({ question: 'Add', ctx: createContext(), provider, ontology, allowEdits: true });
        expect(result.proposedChanges).toEqual([]);
        expect(provider.calls[1].messages.find(m => m.role === 'tool')?.content).toContain('already exists');
    });

    it('captures before-values on an update so the UI can show a diff', async () => {
        const provider = stageOne('propose_update_element', {
            id: 'haz-001', attributes: { severity: 'S5' },
        });
        const result = await runChatTurn({ question: 'Raise severity', ctx: createContext(), provider, ontology, allowEdits: true });

        expect(result.proposedChanges[0]).toMatchObject({
            kind: 'update-element',
            elementId: 'haz-001',
            before: { attributes: { severity: 'S4' } },
            changes: { attributes: { severity: 'S5' } },
        });
    });

    it('rejects an update with no fields to change', async () => {
        const provider = stageOne('propose_update_element', { id: 'haz-001' });
        const result = await runChatTurn({ question: 'Update', ctx: createContext(), provider, ontology, allowEdits: true });
        expect(result.proposedChanges).toEqual([]);
        expect(provider.calls[1].messages.find(m => m.role === 'tool')?.content).toContain('No changes given');
    });

    it('rejects a relationship type the ontology does not define', async () => {
        const provider = stageOne('propose_create_relationship', {
            type: 'befriends', sourceId: 'req-001', targetId: 'haz-001',
        });
        const result = await runChatTurn({ question: 'Relate', ctx: createContext(), provider, ontology, allowEdits: true });
        expect(result.proposedChanges).toEqual([]);
        expect(provider.calls[1].messages.find(m => m.role === 'tool')?.content).toContain('not a relationship type');
    });

    it('rejects a relationship to an element that does not exist', async () => {
        const provider = stageOne('propose_create_relationship', {
            type: 'mitigates', sourceId: 'req-001', targetId: 'ghost',
        });
        const result = await runChatTurn({ question: 'Relate', ctx: createContext(), provider, ontology, allowEdits: true });
        expect(result.proposedChanges).toEqual([]);
        expect(provider.calls[1].messages.find(m => m.role === 'tool')?.content).toContain('for the target');
    });

    it('accepts a relationship endpoint staged earlier in the same turn', async () => {
        const provider = scriptedProvider([
            {
                content: '', stopReason: 'tool_use', toolCalls: [
                    { id: 'c1', name: 'propose_create_element', input: { id: 'req-002', name: 'New', kind: 'SystemRequirement' } },
                    { id: 'c2', name: 'propose_create_relationship', input: { type: 'mitigates', sourceId: 'req-002', targetId: 'haz-001' } },
                ],
            },
            { content: 'Staged both.', stopReason: 'end_turn' },
        ]);
        const result = await runChatTurn({ question: 'Add and link', ctx: createContext(), provider, ontology, allowEdits: true });
        expect(result.proposedChanges).toHaveLength(2);
        expect(result.proposedChanges[1].kind).toBe('create-relationship');
    });

    it('rejects deleting a relationship that does not exist', async () => {
        const provider = stageOne('propose_delete_relationship', { id: 'rel-999' });
        const result = await runChatTurn({ question: 'Remove', ctx: createContext(), provider, ontology, allowEdits: true });
        expect(result.proposedChanges).toEqual([]);
    });

    it('stages a relationship deletion with both endpoints for review', async () => {
        const provider = stageOne('propose_delete_relationship', { id: 'rel-001' });
        const result = await runChatTurn({ question: 'Remove', ctx: createContext(), provider, ontology, allowEdits: true });
        expect(result.proposedChanges[0]).toMatchObject({
            kind: 'delete-relationship',
            relationshipId: 'rel-001',
            sourceId: 'req-001',
            targetId: 'haz-001',
            relationshipType: 'mitigates',
        });
    });

    it('gives every staged change a distinct id', async () => {
        const provider = scriptedProvider([
            {
                content: '', stopReason: 'tool_use', toolCalls: [
                    { id: 'c1', name: 'propose_create_element', input: { id: 'a', name: 'A', kind: 'Hazard' } },
                    { id: 'c2', name: 'propose_create_element', input: { id: 'b', name: 'B', kind: 'Hazard' } },
                ],
            },
            { content: 'ok', stopReason: 'end_turn' },
        ]);
        const result = await runChatTurn({ question: 'Add two', ctx: createContext(), provider, ontology, allowEdits: true });
        const ids = result.proposedChanges.map(c => c.id);
        expect(new Set(ids).size).toBe(2);
    });
});

// ─── Sampling-parameter compatibility ────────────────────────────────────────

describe('acceptsSamplingParams', () => {
    it('excludes models that removed the sampling parameters', () => {
        // These return a 400 if temperature is sent.
        for (const model of ['claude-opus-5', 'claude-opus-4-7', 'claude-opus-4-8', 'claude-sonnet-5', 'claude-fable-5']) {
            expect(acceptsSamplingParams(model)).toBe(false);
        }
    });

    it('still allows sampling parameters on older models', () => {
        for (const model of ['claude-opus-4-6', 'claude-sonnet-4-6', 'claude-haiku-4-5', 'claude-3-5-sonnet-20241022']) {
            expect(acceptsSamplingParams(model)).toBe(true);
        }
    });
});
