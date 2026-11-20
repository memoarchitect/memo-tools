// ─── LLM Provider Abstraction ────────────────────────────────────────────────
//
// Provider-agnostic interface for LLM calls. Supports OpenAI-compatible APIs
// (OpenAI, Azure, local models) and Anthropic Claude, including tool calling.
//
// Deliberately provider-neutral and SDK-free: both providers are driven over
// native fetch so the package stays dependency-light and neither vendor's SDK
// dictates the message shape. Messages and tool calls use MEMO's own types and
// are translated to each wire format at the edge.
// ─────────────────────────────────────────────────────────────────────────────

import { resolveLlmSettings, DEFAULT_MODELS, type LLMProviderName } from './llm-settings.js';

/** A tool call the model asked for, in provider-neutral form. */
export interface ToolCall {
    /** Provider-assigned id — must be echoed back on the matching result. */
    id: string;
    name: string;
    input: Record<string, unknown>;
}

/** A single message in a chat conversation */
export interface ChatMessage {
    role: 'system' | 'user' | 'assistant' | 'tool';
    content: string;
    /** Set on assistant messages that requested tools. */
    toolCalls?: ToolCall[];
    /** Set on `tool` messages — the id of the call being answered. */
    toolCallId?: string;
    /** Set on `tool` messages when the tool failed, so the model can recover. */
    isError?: boolean;
    /**
     * An assistant turn exactly as the provider returned it (Anthropic's content blocks, thinking
     * included), sent back unchanged on the next request: a model that thinks between tool calls
     * expects its own blocks back, and a rebuilt turn would lose them.
     */
    providerContent?: unknown[];
}

/** A tool the model may call. `inputSchema` is JSON Schema. */
export interface ToolDefinition {
    name: string;
    description: string;
    inputSchema: Record<string, unknown>;
}

/** Why the model stopped generating. */
export type StopReason = 'end_turn' | 'tool_use' | 'max_tokens' | 'refusal' | 'other';

/** Options for an LLM completion request */
export interface CompletionOptions {
    messages: ChatMessage[];
    temperature?: number;
    maxTokens?: number;
    /** Tools the model may call this turn. */
    tools?: ToolDefinition[];
    /** Receives the answer's text as it is written, for a provider that streams. */
    onText?: (delta: string) => void;
}

/** Result of an LLM completion */
export interface CompletionResult {
    content: string;
    /** The assistant turn as the provider returned it, to send back unchanged (see ChatMessage). */
    providerContent?: unknown[];
    /** Tool calls requested by the model, if any. */
    toolCalls?: ToolCall[];
    stopReason?: StopReason;
    usage?: {
        promptTokens: number;
        completionTokens: number;
        totalTokens: number;
        /** Prompt tokens read from the provider's cache, when it reports them. */
        cachedPromptTokens?: number;
    };
}

/** LLM provider interface */
export interface LLMProvider {
    readonly name: string;
    complete(options: CompletionOptions): Promise<CompletionResult>;
}

/** Provider configuration resolved from environment */
export interface LLMConfig {
    provider: LLMProviderName;
    apiKey: string;
    model: string;
    baseUrl?: string;
}

/**
 * Resolve LLM config from the environment, a project `.env`, project settings,
 * and stored user credentials — see `llm-settings.ts` for the precedence order.
 *
 * `projectRoot` is optional so existing callers that only ever used real
 * environment variables keep working unchanged.
 */
export function resolveLLMConfig(projectRoot?: string): LLMConfig | undefined {
    const settings = resolveLlmSettings(projectRoot);
    if (!settings.configured || !settings.apiKey || !settings.provider) return undefined;
    return {
        provider: settings.provider,
        apiKey: settings.apiKey,
        model: settings.model,
        baseUrl: settings.baseUrl,
    };
}

/**
 * Create an LLM provider from config.
 * Uses native fetch — no SDK dependencies required.
 */
export function createProvider(config: LLMConfig): LLMProvider {
    if (config.provider === 'anthropic') {
        return createAnthropicProvider(config);
    }
    return createOpenAIProvider(config);
}

// ─── OpenAI-compatible provider ─────────────────────────────────────────────

function toOpenAIMessages(messages: ChatMessage[]): unknown[] {
    return messages.map(m => {
        if (m.role === 'tool') {
            return { role: 'tool', tool_call_id: m.toolCallId, content: m.content };
        }
        if (m.role === 'assistant' && m.toolCalls?.length) {
            return {
                role: 'assistant',
                content: m.content || null,
                tool_calls: m.toolCalls.map(c => ({
                    id: c.id,
                    type: 'function',
                    function: { name: c.name, arguments: JSON.stringify(c.input) },
                })),
            };
        }
        return { role: m.role, content: m.content };
    });
}

function openAIStopReason(finish: string | undefined, hasToolCalls: boolean): StopReason {
    if (hasToolCalls || finish === 'tool_calls') return 'tool_use';
    if (finish === 'stop') return 'end_turn';
    if (finish === 'length') return 'max_tokens';
    if (finish === 'content_filter') return 'refusal';
    return 'other';
}

function createOpenAIProvider(config: LLMConfig): LLMProvider {
    const baseUrl = config.baseUrl || 'https://api.openai.com/v1';

    return {
        name: `openai/${config.model}`,
        async complete(options: CompletionOptions): Promise<CompletionResult> {
            const body: Record<string, unknown> = {
                model: config.model,
                messages: toOpenAIMessages(options.messages),
                temperature: options.temperature ?? 0.3,
                max_tokens: options.maxTokens ?? 4096,
            };
            if (options.tools?.length) {
                body.tools = options.tools.map(t => ({
                    type: 'function',
                    function: { name: t.name, description: t.description, parameters: t.inputSchema },
                }));
            }

            const response = await fetch(`${baseUrl}/chat/completions`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${config.apiKey}`,
                },
                body: JSON.stringify(body),
            });

            if (!response.ok) {
                const text = await response.text();
                throw new Error(`OpenAI API error ${response.status}: ${text}`);
            }

            const data = await response.json() as any;
            const choice = data.choices?.[0];
            const message = choice?.message ?? {};

            const toolCalls: ToolCall[] = (message.tool_calls ?? [])
                .filter((c: any) => c?.function?.name)
                .map((c: any) => ({
                    id: c.id,
                    name: c.function.name,
                    input: safeParseJson(c.function.arguments),
                }));

            return {
                content: message.content ?? '',
                toolCalls: toolCalls.length ? toolCalls : undefined,
                stopReason: openAIStopReason(choice?.finish_reason, toolCalls.length > 0),
                usage: data.usage ? {
                    promptTokens: data.usage.prompt_tokens,
                    completionTokens: data.usage.completion_tokens,
                    totalTokens: data.usage.total_tokens,
                } : undefined,
            };
        },
    };
}

/** Tool arguments arrive as a JSON string; a malformed one must not crash the loop. */
function safeParseJson(raw: unknown): Record<string, unknown> {
    if (typeof raw !== 'string') return (raw as Record<string, unknown>) ?? {};
    try {
        const parsed = JSON.parse(raw);
        return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
        return {};
    }
}

// ─── Anthropic provider ─────────────────────────────────────────────────────

/**
 * Current-generation Claude models reject `temperature` / `top_p` / `top_k`
 * with a 400 — the sampling parameters were removed starting with Opus 4.7.
 * Sending the old default of 0.3 to any of them fails the request outright,
 * so the parameter is only included for models known to still accept it.
 */
const MODELS_REJECTING_SAMPLING_PARAMS = [
    'claude-opus-5',
    'claude-opus-4-7',
    'claude-opus-4-8',
    'claude-sonnet-5',
    'claude-haiku-5',
    'claude-fable-5',
    'claude-mythos-5',
];

export function acceptsSamplingParams(model: string): boolean {
    return !MODELS_REJECTING_SAMPLING_PARAMS.some(prefix => model.startsWith(prefix));
}

/**
 * Translate MEMO messages into Anthropic's content-block format.
 *
 * Anthropic has no `tool` role: results are `tool_result` blocks inside a user
 * message, and consecutive results must be merged into one message so parallel
 * tool calls are answered in a single turn.
 */
function toAnthropicMessages(messages: ChatMessage[]): unknown[] {
    const out: { role: 'user' | 'assistant'; content: unknown[] }[] = [];

    for (const m of messages) {
        if (m.role === 'system') continue; // hoisted to the top-level `system` field

        if (m.role === 'tool') {
            const block = {
                type: 'tool_result',
                tool_use_id: m.toolCallId,
                content: m.content,
                ...(m.isError ? { is_error: true } : {}),
            };
            const last = out[out.length - 1];
            if (last?.role === 'user' && last.content.every(b => (b as any).type === 'tool_result')) {
                last.content.push(block);
            } else {
                out.push({ role: 'user', content: [block] });
            }
            continue;
        }

        if (m.role === 'assistant' && m.providerContent?.length) {
            out.push({ role: 'assistant', content: m.providerContent });
            continue;
        }

        if (m.role === 'assistant' && m.toolCalls?.length) {
            const content: unknown[] = [];
            if (m.content) content.push({ type: 'text', text: m.content });
            for (const c of m.toolCalls) {
                content.push({ type: 'tool_use', id: c.id, name: c.name, input: c.input });
            }
            out.push({ role: 'assistant', content });
            continue;
        }

        out.push({ role: m.role, content: [{ type: 'text', text: m.content }] });
    }

    return out;
}

function anthropicStopReason(raw: string | undefined): StopReason {
    switch (raw) {
        case 'tool_use': return 'tool_use';
        case 'end_turn': return 'end_turn';
        case 'max_tokens': return 'max_tokens';
        case 'refusal': return 'refusal';
        default: return 'other';
    }
}

/**
 * Read an Anthropic streaming response into the message it describes: each content block put together
 * from its deltas (text, tool input, thinking and its signature), the stop reason, and the usage.
 * Text is handed to `onText` as it arrives.
 */
async function readAnthropicStream(response: Response, onText?: (delta: string) => void): Promise<any> {
    const message: any = { content: [], usage: {} };
    const partialJson = new Map<number, string>();
    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    const handle = (event: any) => {
        switch (event.type) {
            case 'message_start':
                Object.assign(message, { ...event.message, content: [] });
                message.usage = { ...(event.message?.usage ?? {}) };
                break;
            case 'content_block_start':
                message.content[event.index] = { ...event.content_block };
                if (event.content_block?.type === 'tool_use') partialJson.set(event.index, '');
                break;
            case 'content_block_delta': {
                const block = message.content[event.index];
                const delta = event.delta ?? {};
                if (delta.type === 'text_delta') {
                    block.text = (block.text ?? '') + delta.text;
                    onText?.(delta.text);
                } else if (delta.type === 'input_json_delta') {
                    partialJson.set(event.index, (partialJson.get(event.index) ?? '') + delta.partial_json);
                } else if (delta.type === 'thinking_delta') {
                    block.thinking = (block.thinking ?? '') + delta.thinking;
                } else if (delta.type === 'signature_delta') {
                    block.signature = delta.signature;
                }
                break;
            }
            case 'content_block_stop':
                if (partialJson.has(event.index)) {
                    const json = partialJson.get(event.index)!;
                    message.content[event.index].input = json ? JSON.parse(json) : {};
                }
                break;
            case 'message_delta':
                if (event.delta?.stop_reason) message.stop_reason = event.delta.stop_reason;
                Object.assign(message.usage, event.usage ?? {});
                break;
            case 'error':
                throw new Error(`Anthropic API error: ${event.error?.message ?? JSON.stringify(event.error)}`);
        }
    };
    for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let boundary: number;
        while ((boundary = buffer.indexOf('\n\n')) >= 0) {
            const frame = buffer.slice(0, boundary);
            buffer = buffer.slice(boundary + 2);
            const data = frame.split('\n').filter(line => line.startsWith('data:')).map(line => line.slice(5).trim()).join('');
            if (data) handle(JSON.parse(data));
        }
    }
    message.content = message.content.filter(Boolean);
    return message;
}

function createAnthropicProvider(config: LLMConfig): LLMProvider {
    const baseUrl = config.baseUrl || 'https://api.anthropic.com';

    return {
        name: `anthropic/${config.model}`,
        async complete(options: CompletionOptions): Promise<CompletionResult> {
            const systemMsg = options.messages.find(m => m.role === 'system');

            const body: Record<string, unknown> = {
                model: config.model,
                messages: toAnthropicMessages(options.messages),
                // Room for the model's thinking as well as its answer: on current models both count.
                max_tokens: options.maxTokens ?? 16000,
                // Cache the conversation's prefix (tools, system prompt, model summary, earlier turns),
                // which every turn of a chat repeats.
                cache_control: { type: 'ephemeral' },
                // Streamed always: long answers would otherwise wait on one response.
                stream: true,
            };
            if (acceptsSamplingParams(config.model)) {
                body.temperature = options.temperature ?? 0.3;
            }
            if (systemMsg) {
                body.system = systemMsg.content;
            }
            if (options.tools?.length) {
                body.tools = options.tools.map(t => ({
                    name: t.name,
                    description: t.description,
                    input_schema: t.inputSchema,
                }));
            }

            const response = await fetch(`${baseUrl}/v1/messages`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'x-api-key': config.apiKey,
                    'anthropic-version': '2023-06-01',
                },
                body: JSON.stringify(body),
            });

            if (!response.ok) {
                const text = await response.text();
                throw new Error(`Anthropic API error ${response.status}: ${text}`);
            }

            const streamed = (response.headers?.get?.('content-type') ?? '').includes('text/event-stream');
            const data = streamed ? await readAnthropicStream(response, options.onText) : await response.json() as any;
            const blocks: any[] = Array.isArray(data.content) ? data.content : [];

            const content = blocks
                .filter(b => b.type === 'text')
                .map(b => b.text)
                .join('');
            // A non-streamed answer has not been shown yet.
            if (!streamed && content) options.onText?.(content);

            const toolCalls: ToolCall[] = blocks
                .filter(b => b.type === 'tool_use')
                .map(b => ({ id: b.id, name: b.name, input: (b.input ?? {}) as Record<string, unknown> }));

            const input = (data.usage?.input_tokens ?? 0) + (data.usage?.cache_read_input_tokens ?? 0) + (data.usage?.cache_creation_input_tokens ?? 0);
            return {
                content,
                providerContent: blocks,
                toolCalls: toolCalls.length ? toolCalls : undefined,
                stopReason: anthropicStopReason(data.stop_reason),
                usage: data.usage ? {
                    promptTokens: input,
                    completionTokens: data.usage.output_tokens ?? 0,
                    totalTokens: input + (data.usage.output_tokens ?? 0),
                    ...(data.usage.cache_read_input_tokens !== undefined ? { cachedPromptTokens: data.usage.cache_read_input_tokens } : {}),
                } : undefined,
            };
        },
    };
}

export { DEFAULT_MODELS };
export type { LLMProviderName };
