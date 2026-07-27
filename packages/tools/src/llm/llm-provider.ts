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
}

/** Result of an LLM completion */
export interface CompletionResult {
    content: string;
    /** Tool calls requested by the model, if any. */
    toolCalls?: ToolCall[];
    stopReason?: StopReason;
    usage?: {
        promptTokens: number;
        completionTokens: number;
        totalTokens: number;
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

function createAnthropicProvider(config: LLMConfig): LLMProvider {
    const baseUrl = config.baseUrl || 'https://api.anthropic.com';

    return {
        name: `anthropic/${config.model}`,
        async complete(options: CompletionOptions): Promise<CompletionResult> {
            const systemMsg = options.messages.find(m => m.role === 'system');

            const body: Record<string, unknown> = {
                model: config.model,
                messages: toAnthropicMessages(options.messages),
                max_tokens: options.maxTokens ?? 4096,
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

            const data = await response.json() as any;
            const blocks: any[] = Array.isArray(data.content) ? data.content : [];

            const content = blocks
                .filter(b => b.type === 'text')
                .map(b => b.text)
                .join('');

            const toolCalls: ToolCall[] = blocks
                .filter(b => b.type === 'tool_use')
                .map(b => ({ id: b.id, name: b.name, input: (b.input ?? {}) as Record<string, unknown> }));

            return {
                content,
                toolCalls: toolCalls.length ? toolCalls : undefined,
                stopReason: anthropicStopReason(data.stop_reason),
                usage: data.usage ? {
                    promptTokens: data.usage.input_tokens,
                    completionTokens: data.usage.output_tokens,
                    totalTokens: data.usage.input_tokens + data.usage.output_tokens,
                } : undefined,
            };
        },
    };
}

export { DEFAULT_MODELS };
export type { LLMProviderName };
