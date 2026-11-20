// ─── Model Chat Engine ───────────────────────────────────────────────────────
//
// Multi-turn conversation over the MEMO model with tool calling.
//
// Two classes of tool:
//   Read tools  — executed here, against the in-memory QueryContext.
//   Write tools — never applied. They validate the request and return a
//                 *proposed change* for the user to approve in the workbench.
//
// Nothing in this file mutates the model. That separation is deliberate: the
// SysML source is the regulated record, so every edit an LLM suggests passes
// through explicit human approval before it reaches a file.
// ─────────────────────────────────────────────────────────────────────────────

import type { QueryContext } from '../dhf/query-engine.js';
import type { MEMOConfig } from '../model/config.js';
import { EMPTY_ONTOLOGY_VIEW, type OntologyView } from '../model/kind-registry.js';
import type { LLMProvider, ChatMessage, ToolDefinition, ToolCall } from './llm-provider.js';
import { serializeModelContext, type ContextOptions } from './model-context.js';
import { readTools, runReadTool, type ToolServices } from '../mcp/tools.js';
import { validateRelationshipMutation, type OntologyRegistriesDTO } from '../model/relationship-legality.js';
import { usageKeyword } from '../model/semantic.js';

// ─── Proposed changes ────────────────────────────────────────────────────────

export interface ProposedElementCreate {
    kind: 'create-element';
    id: string;
    elementId: string;
    name: string;
    elementKind: string;
    layer?: string;
    attributes?: Record<string, string>;
    doc?: string;
    summary: string;
}

export interface ProposedElementUpdate {
    kind: 'update-element';
    id: string;
    elementId: string;
    /** Only the fields the model asked to change. */
    changes: { name?: string; attributes?: Record<string, string>; doc?: string };
    /** Current values for the same fields, so the UI can render a diff. */
    before: { name?: string; attributes?: Record<string, string>; doc?: string };
    summary: string;
}

export interface ProposedRelationshipCreate {
    kind: 'create-relationship';
    id: string;
    relationshipType: string;
    sourceId: string;
    targetId: string;
    summary: string;
}

export interface ProposedRelationshipDelete {
    kind: 'delete-relationship';
    id: string;
    relationshipId: string;
    sourceId: string;
    targetId: string;
    relationshipType: string;
    summary: string;
}

export type ProposedChange =
    | ProposedElementCreate
    | ProposedElementUpdate
    | ProposedRelationshipCreate
    | ProposedRelationshipDelete;

// ─── Turn result ─────────────────────────────────────────────────────────────

export interface ChatTurnResult {
    /** The assistant's final prose for this turn. */
    answer: string;
    /** Changes awaiting approval. Empty when the turn was read-only. */
    proposedChanges: ProposedChange[];
    /**
     * The full message history including this turn, ready to be sent back on
     * the next call. Tool calls and results are included — the model needs
     * them to stay coherent across turns.
     */
    messages: ChatMessage[];
    usage?: { promptTokens: number; completionTokens: number; totalTokens: number };
    /** True when the loop hit `maxIterations` before the model finished. */
    truncated?: boolean;
}

export interface ChatTurnOptions {
    /** The user's new message. */
    question: string;
    /** Prior conversation, excluding the system prompt. */
    history?: ChatMessage[];
    ctx: QueryContext;
    provider: LLMProvider;
    /** The kinds and relationships the resolved ontology declares. */
    ontology?: OntologyView;
    /** Allow the model to propose edits. Read-only when false. */
    allowEdits?: boolean;
    /**
     * The ontology's kind and relationship definitions, ends included. With them a proposed
     * relationship is checked the way a hand edit is (`validateRelationshipMutation`): its ends'
     * kinds and constructs, self-links and multiplicity, before the engineer sees it.
     */
    registries?: OntologyRegistriesDTO;
    /** Links, the Guide and change impact, for the read tools that use them. */
    services?: ToolServices;
    /** Receives the answer's text as the model writes it. */
    onText?: (delta: string) => void;
    contextOptions?: ContextOptions;
    /** Cap on tool round-trips per turn. */
    maxIterations?: number;
}

const DEFAULT_MAX_ITERATIONS = 8;

const SYSTEM_PROMPT = `You are MEMO Model Analyst, an expert in medical device systems engineering, SysML v2 modeling, and regulatory compliance (ISO 14971, IEC 62304, ISO 13485).

You are working with a live medical device architecture model. A summary of it is provided below, and you have tools to look up anything the summary omits.

Guidelines:
- Reference specific element names and IDs when relevant. When a tool gives an element's link, write the element as a markdown link, [name](link), so the engineer can open it.
- Prefer calling a tool over guessing. The summary is truncated; the tools see the whole model.
- When asked about traceability, follow relationship chains with memo_trace; use direction "upstream" to find what points at an element (what verifies or satisfies it).
- Use tables for structured data when appropriate.
- Be precise — never invent elements or relationships that are not in the model.
- If the model does not contain enough information to answer, say so clearly.

Proposing changes:
- The edit tools do NOT modify the model. They stage a proposal that the engineer reviews and approves in the workbench.
- After staging proposals, briefly describe what you staged and why. Do not claim the model has been changed.
- Propose the smallest change that satisfies the request. Do not add elements or relationships the engineer did not ask for.`;

// ─── Tool definitions ────────────────────────────────────────────────────────

/**
 * The read tools are the MCP server's (`mcp/tools.ts`), so the assistant and an
 * IDE agent answer one question the same way. Read lazily: the registry module
 * is part of an import cycle through the package index.
 */
function readToolDefinitions(): ToolDefinition[] {
    return readTools();
}

function writeTools(ontology: OntologyView = EMPTY_ONTOLOGY_VIEW): ToolDefinition[] {
    const kindNames = Object.keys(ontology.kinds);
    const relNames = ontology.relationshipTypes.map(r => r.name);

    // Listing the legal vocabulary in the description keeps the model inside the
    // ontology instead of inventing plausible-sounding kinds.
    const kindHint = kindNames.length ? ` Must be one of: ${kindNames.join(', ')}.` : '';
    const relHint = relNames.length ? ` Must be one of: ${relNames.join(', ')}.` : '';

    return [
        {
            name: 'propose_create_element',
            description: 'Stage a new element for the engineer to approve. Does not modify the model.',
            inputSchema: {
                type: 'object',
                properties: {
                    id: { type: 'string', description: 'Unique element id (SysML usage name), e.g. "HAZ_OverInfusion".' },
                    name: { type: 'string', description: 'Human-readable name.' },
                    kind: { type: 'string', description: `The ontology kind.${kindHint}` },
                    layer: { type: 'string', description: 'Architecture layer. Defaults to the kind\'s own layer.' },
                    attributes: { type: 'object', description: 'Attribute key/value pairs.', additionalProperties: { type: 'string' } },
                    doc: { type: 'string', description: 'Documentation comment.' },
                    rationale: { type: 'string', description: 'One sentence on why this element is needed.' },
                },
                required: ['id', 'name', 'kind'],
            },
        },
        {
            name: 'propose_update_element',
            description: 'Stage a change to an existing element for the engineer to approve. Does not modify the model. Only include fields you want to change.',
            inputSchema: {
                type: 'object',
                properties: {
                    id: { type: 'string', description: 'The id of the element to change.' },
                    name: { type: 'string' },
                    attributes: { type: 'object', description: 'Attributes to set or overwrite.', additionalProperties: { type: 'string' } },
                    doc: { type: 'string' },
                    rationale: { type: 'string', description: 'One sentence on why this change is needed.' },
                },
                required: ['id'],
            },
        },
        {
            name: 'propose_create_relationship',
            description: 'Stage a new relationship between two existing elements for the engineer to approve. Does not modify the model.',
            inputSchema: {
                type: 'object',
                properties: {
                    type: { type: 'string', description: `Relationship type.${relHint}` },
                    sourceId: { type: 'string', description: 'Source element id.' },
                    targetId: { type: 'string', description: 'Target element id.' },
                    rationale: { type: 'string', description: 'One sentence on why this relationship is needed.' },
                },
                required: ['type', 'sourceId', 'targetId'],
            },
        },
        {
            name: 'propose_delete_relationship',
            description: 'Stage the removal of an existing relationship for the engineer to approve. Does not modify the model.',
            inputSchema: {
                type: 'object',
                properties: {
                    id: { type: 'string', description: 'The relationship id, as returned by memo_get_element.' },
                    rationale: { type: 'string', description: 'One sentence on why this relationship should go.' },
                },
                required: ['id'],
            },
        },
    ];
}

// ─── Tool execution ──────────────────────────────────────────────────────────

/** A tool either answers the model, or fails in a way the model can recover from. */
interface ToolOutcome {
    content: string;
    isError?: boolean;
}

function ok(value: unknown): ToolOutcome {
    return { content: typeof value === 'string' ? value : JSON.stringify(value, null, 2) };
}

function fail(message: string): ToolOutcome {
    return { content: message, isError: true };
}

/**
 * The part of the model a relationship check reads: the two ends, as they are or as staged this
 * turn, and the relationships already there.
 */
function legalityModel(
    ctx: QueryContext,
    ontology: OntologyView,
    staged: ProposedChange[],
    ids: string[],
): Parameters<typeof validateRelationshipMutation>[1] {
    const elements: Record<string, any> = {};
    for (const id of ids) {
        const existing = ctx.element(id);
        if (existing) { elements[id] = existing; continue; }
        const create = staged.find(c => c.kind === 'create-element' && c.elementId === id) as ProposedElementCreate | undefined;
        if (create) {
            elements[id] = {
                id, name: create.name, kind: create.elementKind,
                construct: usageKeyword(ontology.kinds[create.elementKind]?.sysmlConstruct),
                layer: create.layer ?? '', attributes: create.attributes ?? {},
            };
        }
    }
    return { elements, relationships: ctx.allRelationships() } as Parameters<typeof validateRelationshipMutation>[1];
}

/** Staged proposals double as lookup state — later calls may reference earlier ones. */
function pendingElementIds(changes: ProposedChange[]): Set<string> {
    const ids = new Set<string>();
    for (const c of changes) {
        if (c.kind === 'create-element') ids.add(c.elementId);
    }
    return ids;
}

function executeWriteTool(
    name: string,
    input: Record<string, any>,
    ctx: QueryContext,
    ontology: OntologyView,
    staged: ProposedChange[],
    nextId: () => string,
    registries?: OntologyRegistriesDTO,
): ToolOutcome | undefined {
    const knownKinds = Object.keys(ontology.kinds).length > 0 ? new Set(Object.keys(ontology.kinds)) : undefined;
    const knownRels = ontology.relationshipTypes.length > 0
        ? new Set(ontology.relationshipTypes.map(r => r.name))
        : undefined;

    switch (name) {
        case 'propose_create_element': {
            const id = String(input.id ?? '').trim();
            const elementKind = String(input.kind ?? '').trim();
            if (!id) return fail('An element id is required.');
            if (ctx.element(id)) return fail(`Element "${id}" already exists. Use propose_update_element to change it.`);
            if (pendingElementIds(staged).has(id)) return fail(`Element "${id}" is already staged in this turn.`);
            if (knownKinds && !knownKinds.has(elementKind)) {
                return fail(`"${elementKind}" is not a kind in this ontology. Valid kinds: ${[...knownKinds].join(', ')}`);
            }
            const layer = typeof input.layer === 'string' && input.layer
                ? input.layer
                : ontology.kinds[elementKind]?.layer;
            const change: ProposedElementCreate = {
                kind: 'create-element',
                id: nextId(),
                elementId: id,
                name: String(input.name ?? id),
                elementKind,
                layer,
                attributes: input.attributes && typeof input.attributes === 'object' ? input.attributes : undefined,
                doc: typeof input.doc === 'string' ? input.doc : undefined,
                summary: typeof input.rationale === 'string' && input.rationale
                    ? input.rationale
                    : `Create ${elementKind} ${id}`,
            };
            staged.push(change);
            return ok(`Staged for approval: create ${elementKind} "${id}". Not yet applied to the model.`);
        }

        case 'propose_update_element': {
            const id = String(input.id ?? '').trim();
            const el = ctx.element(id);
            if (!el) return fail(`No element with id "${id}". Use memo_search_elements to find the right id.`);

            const changes: ProposedElementUpdate['changes'] = {};
            if (typeof input.name === 'string') changes.name = input.name;
            if (input.attributes && typeof input.attributes === 'object') changes.attributes = input.attributes;
            if (typeof input.doc === 'string') changes.doc = input.doc;
            if (Object.keys(changes).length === 0) {
                return fail('No changes given. Provide at least one of name, attributes, or doc.');
            }

            const before: ProposedElementUpdate['before'] = {};
            if (changes.name !== undefined) before.name = el.name;
            if (changes.doc !== undefined) before.doc = el.doc;
            if (changes.attributes) {
                before.attributes = Object.fromEntries(
                    Object.keys(changes.attributes).map(k => [k, el.attributes[k] ?? '']),
                );
            }

            staged.push({
                kind: 'update-element',
                id: nextId(),
                elementId: id,
                changes,
                before,
                summary: typeof input.rationale === 'string' && input.rationale
                    ? input.rationale
                    : `Update ${el.kind} ${id}`,
            });
            return ok(`Staged for approval: update "${id}". Not yet applied to the model.`);
        }

        case 'propose_create_relationship': {
            const type = String(input.type ?? '').trim();
            const sourceId = String(input.sourceId ?? '').trim();
            const targetId = String(input.targetId ?? '').trim();
            if (knownRels && !knownRels.has(type)) {
                return fail(`"${type}" is not a relationship type in this ontology. Valid types: ${[...knownRels].join(', ')}`);
            }
            // An element staged earlier in the same turn is a legal endpoint —
            // it will exist by the time the batch is applied.
            const pending = pendingElementIds(staged);
            for (const [label, endpoint] of [['source', sourceId], ['target', targetId]] as const) {
                if (!ctx.element(endpoint) && !pending.has(endpoint)) {
                    return fail(`No element with id "${endpoint}" for the ${label}. Use memo_search_elements to find the right id.`);
                }
            }
            if (registries) {
                const legality = validateRelationshipMutation(
                    { requestId: 'chat', type, sourceId, targetId, direction: 'outgoing' },
                    legalityModel(ctx, ontology, staged, [sourceId, targetId]),
                    registries,
                );
                const errors = legality.diagnostics.filter(d => d.severity === 'error');
                if (errors.length > 0) {
                    return fail(`Not a legal ${type}: ${errors.map(d => d.message).join('; ')}. Check the relationship's direction and its end kinds with memo_ontology.`);
                }
            }
            staged.push({
                kind: 'create-relationship',
                id: nextId(),
                relationshipType: type,
                sourceId,
                targetId,
                summary: typeof input.rationale === 'string' && input.rationale
                    ? input.rationale
                    : `Relate ${sourceId} —${type}→ ${targetId}`,
            });
            return ok(`Staged for approval: ${sourceId} —${type}→ ${targetId}. Not yet applied to the model.`);
        }

        case 'propose_delete_relationship': {
            const relId = String(input.id ?? '').trim();
            const rel = ctx.allRelationships().find(r => r.id === relId);
            if (!rel) return fail(`No relationship with id "${relId}". Use memo_get_element to list an element's relationship ids.`);
            staged.push({
                kind: 'delete-relationship',
                id: nextId(),
                relationshipId: relId,
                sourceId: rel.sourceId,
                targetId: rel.targetId,
                relationshipType: rel.type,
                summary: typeof input.rationale === 'string' && input.rationale
                    ? input.rationale
                    : `Remove ${rel.sourceId} —${rel.type}→ ${rel.targetId}`,
            });
            return ok(`Staged for approval: remove relationship "${relId}". Not yet applied to the model.`);
        }

        default:
            return undefined;
    }
}

// ─── The turn loop ───────────────────────────────────────────────────────────

/**
 * Run one conversational turn, looping until the model stops calling tools.
 *
 * The returned `messages` include every tool call and result, so passing them
 * straight back as `history` on the next turn keeps the model coherent.
 */
export async function runChatTurn(options: ChatTurnOptions): Promise<ChatTurnResult> {
    const {
        question, history = [], ctx, provider, ontology = EMPTY_ONTOLOGY_VIEW,
        allowEdits = false, contextOptions, registries, services, onText,
        maxIterations = DEFAULT_MAX_ITERATIONS,
    } = options;

    const tools = allowEdits ? [...readToolDefinitions(), ...writeTools(ontology)] : readToolDefinitions();

    // The model summary is only re-sent when the conversation is new; on later
    // turns it is already in the history and repeating it wastes the window.
    const conversation: ChatMessage[] = history.length > 0
        ? [...history, { role: 'user', content: question }]
        : [
            { role: 'user', content: `Here is the current model state:\n\n${serializeModelContext(ctx, contextOptions)}\n\n---\n\nQuestion: ${question}` },
        ];

    const proposedChanges: ProposedChange[] = [];
    let changeCounter = 0;
    const nextId = () => `chg-${Date.now().toString(36)}-${changeCounter++}`;

    const totals = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };
    let answer = '';
    let truncated = false;

    for (let iteration = 0; iteration < maxIterations; iteration++) {
        const result = await provider.complete({
            messages: [{ role: 'system', content: SYSTEM_PROMPT }, ...conversation],
            temperature: 0.2,
            maxTokens: 16000,
            tools,
            onText,
        });

        if (result.usage) {
            totals.promptTokens += result.usage.promptTokens;
            totals.completionTokens += result.usage.completionTokens;
            totals.totalTokens += result.usage.totalTokens;
        }

        if (result.content) answer = result.content;

        const calls = result.toolCalls ?? [];
        if (calls.length === 0) {
            return {
                answer,
                proposedChanges,
                messages: [...conversation, { role: 'assistant', content: answer, providerContent: result.providerContent }],
                usage: totals.totalTokens ? totals : undefined,
            };
        }

        conversation.push({ role: 'assistant', content: result.content, toolCalls: calls, providerContent: result.providerContent });

        // Every call must get a result, in the same batch — dropping one leaves
        // the conversation malformed for both providers.
        for (const call of calls) {
            const outcome = await runTool(call, ctx, ontology, allowEdits, proposedChanges, nextId, registries, services);
            conversation.push({
                role: 'tool',
                toolCallId: call.id,
                content: outcome.content,
                isError: outcome.isError,
            });
        }

        if (iteration === maxIterations - 1) truncated = true;
    }

    return {
        answer: answer || 'I stopped after reaching the tool-call limit for this turn. Ask again to continue.',
        proposedChanges,
        messages: conversation,
        usage: totals.totalTokens ? totals : undefined,
        truncated,
    };
}

async function runTool(
    call: ToolCall,
    ctx: QueryContext,
    ontology: OntologyView,
    allowEdits: boolean,
    staged: ProposedChange[],
    nextId: () => string,
    registries?: OntologyRegistriesDTO,
    services?: ToolServices,
): Promise<ToolOutcome> {
    try {
        const input = (call.input ?? {}) as Record<string, any>;
        const read = await runReadTool(call.name, input, { ctx, ontology, registries, services });
        if (read !== undefined) return ok(read);

        if (call.name.startsWith('propose_') && !allowEdits) {
            return fail('Editing is disabled for this conversation. Answer using the read-only tools instead.');
        }

        const write = executeWriteTool(call.name, input, ctx, ontology, staged, nextId, registries);
        if (write) return write;

        return fail(`Unknown tool "${call.name}".`);
    } catch (e: any) {
        return fail(`Tool "${call.name}" failed: ${e?.message ?? String(e)}`);
    }
}

/**
 * Stage one proposal outside a chat turn: the MCP server's write tools, which an AI coding tool calls.
 * The same checks as the assistant's (`executeWriteTool`), against the proposals already waiting, so
 * a relationship may end on an element proposed earlier. Undefined when `name` is not a proposal tool.
 */
export function stageProposal(
    name: string,
    input: Record<string, any>,
    options: {
        ctx: QueryContext;
        ontology?: OntologyView;
        registries?: OntologyRegistriesDTO;
        /** Proposals already waiting for the engineer. */
        waiting?: readonly ProposedChange[];
    },
): { added: ProposedChange[]; message: string; isError?: boolean } | undefined {
    const staged = [...(options.waiting ?? [])];
    const before = staged.length;
    // Ids are unique across processes: two clients may propose at once.
    const nextId = () => `chg-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    const outcome = executeWriteTool(name, input ?? {}, options.ctx, options.ontology ?? EMPTY_ONTOLOGY_VIEW, staged, nextId, options.registries);
    if (!outcome) return undefined;
    return { added: staged.slice(before), message: outcome.content, isError: outcome.isError };
}

/** The tool names this engine exposes — used by tests and the MCP server. */
export function chatToolNames(allowEdits = true): string[] {
    return (allowEdits ? [...readToolDefinitions(), ...writeTools()] : readToolDefinitions()).map(t => t.name);
}

export { writeTools };
