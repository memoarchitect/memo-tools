// ─── Model Q&A Engine (M72) ──────────────────────────────────────────────────
//
// Context-aware RAG over model elements. Answers questions like:
// - "What hazards have no risk controls?"
// - "Show trace from REQ-001 to verification."
// - "Which layers are least complete?"
// ─────────────────────────────────────────────────────────────────────────────

import type { QueryContext } from '../dhf/query-engine.js';
import type { LLMProvider, ChatMessage } from './llm-provider.js';
import { serializeModelContext, type ContextOptions } from './model-context.js';

/** Result of a model Q&A query */
export interface AskResult {
    answer: string;
    usage?: {
        promptTokens: number;
        completionTokens: number;
        totalTokens: number;
    };
}

const SYSTEM_PROMPT = `You are MEMO Model Analyst, an expert in medical device systems engineering, SysML v2 modeling, and regulatory compliance (ISO 14971, IEC 62304, ISO 13485).

You are given a model context that describes a medical device architecture with elements, relationships, and validation status. Answer questions about the model accurately and concisely.

Guidelines:
- Reference specific element names and IDs when relevant.
- When asked about traceability, follow relationship chains.
- When asked about gaps or compliance, reference specific validation violations.
- When asked about completeness, reference layer-level metrics.
- Use tables for structured data when appropriate.
- Be precise — do not invent elements or relationships that are not in the context.
- If the model does not contain enough information to answer, say so clearly.`;

/**
 * Ask a question about the model using LLM.
 */
export async function askModel(
    question: string,
    ctx: QueryContext,
    provider: LLMProvider,
    contextOptions?: ContextOptions,
): Promise<AskResult> {
    const modelContext = serializeModelContext(ctx, contextOptions);

    const messages: ChatMessage[] = [
        { role: 'system', content: SYSTEM_PROMPT },
        {
            role: 'user',
            content: `Here is the current model state:\n\n${modelContext}\n\n---\n\nQuestion: ${question}`,
        },
    ];

    const result = await provider.complete({
        messages,
        temperature: 0.2,
        maxTokens: 4096,
    });

    return {
        answer: result.content,
        usage: result.usage,
    };
}
