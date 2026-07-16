// ─── LLM Provider Abstraction ────────────────────────────────────────────────
//
// Provider-agnostic interface for LLM calls. Supports OpenAI-compatible APIs
// (OpenAI, Azure, local models) and Anthropic Claude. Configured via env vars.
// ─────────────────────────────────────────────────────────────────────────────

/** A single message in a chat conversation */
export interface ChatMessage {
    role: 'system' | 'user' | 'assistant';
    content: string;
}

/** Options for an LLM completion request */
export interface CompletionOptions {
    messages: ChatMessage[];
    temperature?: number;
    maxTokens?: number;
}

/** Result of an LLM completion */
export interface CompletionResult {
    content: string;
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
    provider: 'openai' | 'anthropic';
    apiKey: string;
    model: string;
    baseUrl?: string;
}

/** Resolve LLM config from environment variables */
export function resolveLLMConfig(): LLMConfig | undefined {
    // Anthropic takes priority if both are set
    if (process.env.ANTHROPIC_API_KEY) {
        return {
            provider: 'anthropic',
            apiKey: process.env.ANTHROPIC_API_KEY,
            model: process.env.MEMO_LLM_MODEL || 'claude-sonnet-4-20250514',
            baseUrl: process.env.ANTHROPIC_BASE_URL,
        };
    }
    if (process.env.OPENAI_API_KEY) {
        return {
            provider: 'openai',
            apiKey: process.env.OPENAI_API_KEY,
            model: process.env.MEMO_LLM_MODEL || 'gpt-4o',
            baseUrl: process.env.OPENAI_BASE_URL,
        };
    }
    return undefined;
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

function createOpenAIProvider(config: LLMConfig): LLMProvider {
    const baseUrl = config.baseUrl || 'https://api.openai.com/v1';

    return {
        name: `openai/${config.model}`,
        async complete(options: CompletionOptions): Promise<CompletionResult> {
            const response = await fetch(`${baseUrl}/chat/completions`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${config.apiKey}`,
                },
                body: JSON.stringify({
                    model: config.model,
                    messages: options.messages,
                    temperature: options.temperature ?? 0.3,
                    max_tokens: options.maxTokens ?? 4096,
                }),
            });

            if (!response.ok) {
                const text = await response.text();
                throw new Error(`OpenAI API error ${response.status}: ${text}`);
            }

            const data = await response.json() as any;
            return {
                content: data.choices[0].message.content,
                usage: data.usage ? {
                    promptTokens: data.usage.prompt_tokens,
                    completionTokens: data.usage.completion_tokens,
                    totalTokens: data.usage.total_tokens,
                } : undefined,
            };
        },
    };
}

// ─── Anthropic provider ─────────────────────────────────────────────────────

function createAnthropicProvider(config: LLMConfig): LLMProvider {
    const baseUrl = config.baseUrl || 'https://api.anthropic.com';

    return {
        name: `anthropic/${config.model}`,
        async complete(options: CompletionOptions): Promise<CompletionResult> {
            // Separate system message from user/assistant messages
            const systemMsg = options.messages.find(m => m.role === 'system');
            const chatMessages = options.messages
                .filter(m => m.role !== 'system')
                .map(m => ({ role: m.role as 'user' | 'assistant', content: m.content }));

            const body: any = {
                model: config.model,
                messages: chatMessages,
                temperature: options.temperature ?? 0.3,
                max_tokens: options.maxTokens ?? 4096,
            };
            if (systemMsg) {
                body.system = systemMsg.content;
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
            const content = data.content
                .filter((b: any) => b.type === 'text')
                .map((b: any) => b.text)
                .join('');

            return {
                content,
                usage: data.usage ? {
                    promptTokens: data.usage.input_tokens,
                    completionTokens: data.usage.output_tokens,
                    totalTokens: data.usage.input_tokens + data.usage.output_tokens,
                } : undefined,
            };
        },
    };
}
