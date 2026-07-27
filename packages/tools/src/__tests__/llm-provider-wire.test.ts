// ─── Provider Wire-Format Tests ──────────────────────────────────────────────
//
// The two providers speak different shapes for the same conversation. These
// tests pin the translation, because a mistake here fails only against the live
// API — where it costs a request to find out.
// ─────────────────────────────────────────────────────────────────────────────

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createProvider } from '../llm/llm-provider.js';
import type { ChatMessage, ToolDefinition } from '../llm/llm-provider.js';

const originalFetch = globalThis.fetch;

/** Capture the request body and reply with a canned response. */
function stubFetch(response: unknown) {
    const calls: { url: string; body: any }[] = [];
    globalThis.fetch = vi.fn(async (url: any, init: any) => {
        calls.push({ url: String(url), body: JSON.parse(init.body) });
        return {
            ok: true,
            json: async () => response,
            text: async () => JSON.stringify(response),
        } as Response;
    }) as unknown as typeof fetch;
    return calls;
}

beforeEach(() => { globalThis.fetch = originalFetch; });
afterEach(() => { globalThis.fetch = originalFetch; });

const TOOLS: ToolDefinition[] = [{
    name: 'search_elements',
    description: 'Search elements.',
    inputSchema: { type: 'object', properties: { query: { type: 'string' } } },
}];

/** A conversation that has already been through one tool round-trip. */
const CONVERSATION: ChatMessage[] = [
    { role: 'system', content: 'You are an analyst.' },
    { role: 'user', content: 'Find hazards' },
    { role: 'assistant', content: 'Looking.', toolCalls: [{ id: 'call_1', name: 'search_elements', input: { query: 'haz' } }] },
    { role: 'tool', toolCallId: 'call_1', content: '{"total":1}' },
];

// ─── Anthropic ───────────────────────────────────────────────────────────────

describe('Anthropic provider', () => {
    const config = { provider: 'anthropic' as const, apiKey: 'sk-ant', model: 'claude-opus-5' };

    it('omits temperature on models that reject sampling parameters', async () => {
        const calls = stubFetch({ content: [{ type: 'text', text: 'hi' }], stop_reason: 'end_turn' });
        await createProvider(config).complete({ messages: [{ role: 'user', content: 'hi' }] });
        expect(calls[0].body).not.toHaveProperty('temperature');
    });

    it('sends temperature on older models that still accept it', async () => {
        const calls = stubFetch({ content: [{ type: 'text', text: 'hi' }], stop_reason: 'end_turn' });
        await createProvider({ ...config, model: 'claude-sonnet-4-6' })
            .complete({ messages: [{ role: 'user', content: 'hi' }], temperature: 0.5 });
        expect(calls[0].body.temperature).toBe(0.5);
    });

    it('hoists the system message to the top-level system field', async () => {
        const calls = stubFetch({ content: [], stop_reason: 'end_turn' });
        await createProvider(config).complete({ messages: CONVERSATION });
        expect(calls[0].body.system).toBe('You are an analyst.');
        expect(calls[0].body.messages.some((m: any) => m.role === 'system')).toBe(false);
    });

    it('renders assistant tool calls as tool_use blocks', async () => {
        const calls = stubFetch({ content: [], stop_reason: 'end_turn' });
        await createProvider(config).complete({ messages: CONVERSATION });
        const assistant = calls[0].body.messages.find((m: any) => m.role === 'assistant');
        expect(assistant.content).toEqual([
            { type: 'text', text: 'Looking.' },
            { type: 'tool_use', id: 'call_1', name: 'search_elements', input: { query: 'haz' } },
        ]);
    });

    it('renders tool results as tool_result blocks in a user message', async () => {
        const calls = stubFetch({ content: [], stop_reason: 'end_turn' });
        await createProvider(config).complete({ messages: CONVERSATION });
        const last = calls[0].body.messages.at(-1);
        expect(last.role).toBe('user');
        expect(last.content[0]).toMatchObject({ type: 'tool_result', tool_use_id: 'call_1' });
    });

    it('merges parallel tool results into one user message', async () => {
        const calls = stubFetch({ content: [], stop_reason: 'end_turn' });
        await createProvider(config).complete({
            messages: [
                { role: 'user', content: 'go' },
                { role: 'assistant', content: '', toolCalls: [
                    { id: 'a', name: 'search_elements', input: {} },
                    { id: 'b', name: 'search_elements', input: {} },
                ] },
                { role: 'tool', toolCallId: 'a', content: '1' },
                { role: 'tool', toolCallId: 'b', content: '2' },
            ],
        });
        const last = calls[0].body.messages.at(-1);
        expect(last.content).toHaveLength(2);
        expect(calls[0].body.messages.filter((m: any) => m.role === 'user')).toHaveLength(2);
    });

    it('marks a failed tool result with is_error', async () => {
        const calls = stubFetch({ content: [], stop_reason: 'end_turn' });
        await createProvider(config).complete({
            messages: [
                { role: 'user', content: 'go' },
                { role: 'assistant', content: '', toolCalls: [{ id: 'a', name: 'search_elements', input: {} }] },
                { role: 'tool', toolCallId: 'a', content: 'nope', isError: true },
            ],
        });
        expect(calls[0].body.messages.at(-1).content[0].is_error).toBe(true);
    });

    it('sends tools with input_schema', async () => {
        const calls = stubFetch({ content: [], stop_reason: 'end_turn' });
        await createProvider(config).complete({ messages: [{ role: 'user', content: 'x' }], tools: TOOLS });
        expect(calls[0].body.tools[0]).toMatchObject({ name: 'search_elements', input_schema: TOOLS[0].inputSchema });
    });

    it('parses tool_use blocks out of the response', async () => {
        stubFetch({
            content: [
                { type: 'text', text: 'Let me look.' },
                { type: 'tool_use', id: 'tu_1', name: 'search_elements', input: { query: 'x' } },
            ],
            stop_reason: 'tool_use',
            usage: { input_tokens: 10, output_tokens: 5 },
        });
        const result = await createProvider(config).complete({ messages: [{ role: 'user', content: 'x' }] });
        expect(result.content).toBe('Let me look.');
        expect(result.stopReason).toBe('tool_use');
        expect(result.toolCalls).toEqual([{ id: 'tu_1', name: 'search_elements', input: { query: 'x' } }]);
        expect(result.usage).toEqual({ promptTokens: 10, completionTokens: 5, totalTokens: 15 });
    });

    it('surfaces a refusal stop reason', async () => {
        stubFetch({ content: [], stop_reason: 'refusal' });
        const result = await createProvider(config).complete({ messages: [{ role: 'user', content: 'x' }] });
        expect(result.stopReason).toBe('refusal');
    });

    it('throws with the API body on a non-ok response', async () => {
        globalThis.fetch = vi.fn(async () => ({
            ok: false, status: 400, text: async () => '{"error":"bad model"}',
        })) as unknown as typeof fetch;
        await expect(createProvider(config).complete({ messages: [{ role: 'user', content: 'x' }] }))
            .rejects.toThrow(/Anthropic API error 400.*bad model/);
    });
});

// ─── OpenAI ──────────────────────────────────────────────────────────────────

describe('OpenAI provider', () => {
    const config = { provider: 'openai' as const, apiKey: 'sk-oai', model: 'gpt-4o' };

    it('keeps the system message inline', async () => {
        const calls = stubFetch({ choices: [{ message: { content: 'hi' }, finish_reason: 'stop' }] });
        await createProvider(config).complete({ messages: CONVERSATION });
        expect(calls[0].body.messages[0]).toEqual({ role: 'system', content: 'You are an analyst.' });
    });

    it('renders tool calls with JSON-stringified arguments', async () => {
        const calls = stubFetch({ choices: [{ message: { content: '' }, finish_reason: 'stop' }] });
        await createProvider(config).complete({ messages: CONVERSATION });
        const assistant = calls[0].body.messages.find((m: any) => m.role === 'assistant');
        expect(assistant.tool_calls[0]).toEqual({
            id: 'call_1', type: 'function',
            function: { name: 'search_elements', arguments: '{"query":"haz"}' },
        });
    });

    it('renders tool results as tool-role messages', async () => {
        const calls = stubFetch({ choices: [{ message: { content: '' }, finish_reason: 'stop' }] });
        await createProvider(config).complete({ messages: CONVERSATION });
        expect(calls[0].body.messages.at(-1)).toEqual({
            role: 'tool', tool_call_id: 'call_1', content: '{"total":1}',
        });
    });

    it('wraps tools in the function envelope', async () => {
        const calls = stubFetch({ choices: [{ message: { content: '' }, finish_reason: 'stop' }] });
        await createProvider(config).complete({ messages: [{ role: 'user', content: 'x' }], tools: TOOLS });
        expect(calls[0].body.tools[0]).toEqual({
            type: 'function',
            function: { name: 'search_elements', description: 'Search elements.', parameters: TOOLS[0].inputSchema },
        });
    });

    it('parses tool calls and their JSON arguments', async () => {
        stubFetch({
            choices: [{
                message: {
                    content: null,
                    tool_calls: [{ id: 'tc_1', type: 'function', function: { name: 'search_elements', arguments: '{"query":"x"}' } }],
                },
                finish_reason: 'tool_calls',
            }],
        });
        const result = await createProvider(config).complete({ messages: [{ role: 'user', content: 'x' }] });
        expect(result.stopReason).toBe('tool_use');
        expect(result.toolCalls).toEqual([{ id: 'tc_1', name: 'search_elements', input: { query: 'x' } }]);
        expect(result.content).toBe('');
    });

    it('survives malformed tool arguments rather than throwing', async () => {
        stubFetch({
            choices: [{
                message: { content: null, tool_calls: [{ id: 'tc_1', function: { name: 'search_elements', arguments: '{oops' } }] },
                finish_reason: 'tool_calls',
            }],
        });
        const result = await createProvider(config).complete({ messages: [{ role: 'user', content: 'x' }] });
        expect(result.toolCalls?.[0].input).toEqual({});
    });

    it('maps finish_reason length to max_tokens', async () => {
        stubFetch({ choices: [{ message: { content: 'cut off' }, finish_reason: 'length' }] });
        const result = await createProvider(config).complete({ messages: [{ role: 'user', content: 'x' }] });
        expect(result.stopReason).toBe('max_tokens');
    });

    it('honours a custom baseUrl for OpenAI-compatible servers', async () => {
        const calls = stubFetch({ choices: [{ message: { content: 'hi' }, finish_reason: 'stop' }] });
        await createProvider({ ...config, baseUrl: 'http://localhost:1234/v1' })
            .complete({ messages: [{ role: 'user', content: 'x' }] });
        expect(calls[0].url).toBe('http://localhost:1234/v1/chat/completions');
    });
});
