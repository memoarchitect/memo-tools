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
import type { LLMProvider, ChatMessage, ToolDefinition, ToolCall } from './llm-provider.js';
import { serializeModelContext, type ContextOptions } from './model-context.js';

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
    config?: MEMOConfig;
    /** Allow the model to propose edits. Read-only when false. */
    allowEdits?: boolean;
    contextOptions?: ContextOptions;
    /** Cap on tool round-trips per turn. */
    maxIterations?: number;
}

const DEFAULT_MAX_ITERATIONS = 8;

const SYSTEM_PROMPT = `You are MEMO Model Analyst, an expert in medical device systems engineering, SysML v2 modeling, and regulatory compliance (ISO 14971, IEC 62304, ISO 13485).

You are working with a live medical device architecture model. A summary of it is provided below, and you have tools to look up anything the summary omits.

Guidelines:
- Reference specific element names and IDs when relevant.
- Prefer calling a tool over guessing. The summary is truncated; the tools see the whole model.
- When asked about traceability, follow relationship chains with the trace tool.
- Use tables for structured data when appropriate.
- Be precise — never invent elements or relationships that are not in the model.
- If the model does not contain enough information to answer, say so clearly.

Proposing changes:
- The edit tools do NOT modify the model. They stage a proposal that the engineer reviews and approves in the workbench.
- After staging proposals, briefly describe what you staged and why. Do not claim the model has been changed.
- Propose the smallest change that satisfies the request. Do not add elements or relationships the engineer did not ask for.`;

// ─── Tool definitions ────────────────────────────────────────────────────────

const READ_TOOLS: ToolDefinition[] = [
    {
        name: 'search_elements',
        description: 'Search model elements by name/id substring, kind, or layer. Use this whenever you need elements the summary does not list.',
        inputSchema: {
            type: 'object',
            properties: {
                query: { type: 'string', description: 'Case-insensitive substring matched against element id and name.' },
                kind: { type: 'string', description: 'Restrict to one kind, e.g. "Hazard".' },
                layer: { type: 'string', description: 'Restrict to one architecture layer, e.g. "risk".' },
                limit: { type: 'number', description: 'Maximum results (default 50).' },
            },
        },
    },
    {
        name: 'get_element',
        description: 'Get one element in full: attributes, documentation, and every incoming and outgoing relationship.',
        inputSchema: {
            type: 'object',
            properties: { id: { type: 'string', description: 'The element id.' } },
            required: ['id'],
        },
    },
    {
        name: 'trace',
        description: 'Follow the relationship chain out of an element, for traceability questions such as requirement-to-verification coverage.',
        inputSchema: {
            type: 'object',
            properties: {
                id: { type: 'string', description: 'The element id to trace from.' },
                maxDepth: { type: 'number', description: 'How many hops to follow (default 3).' },
            },
            required: ['id'],
        },
    },
    {
        name: 'list_gaps',
        description: 'List validation violations — the compliance and completeness gaps in the model.',
        inputSchema: {
            type: 'object',
            properties: {
                severity: { type: 'string', enum: ['error', 'warning', 'info'], description: 'Filter by severity.' },
                limit: { type: 'number', description: 'Maximum results (default 50).' },
            },
        },
    },
    {
        name: 'layer_summary',
        description: 'Element counts and completeness percentage for every architecture layer.',
        inputSchema: { type: 'object', properties: {} },
    },
];

function writeTools(config?: MEMOConfig): ToolDefinition[] {
    const kindNames = config?.kinds ? Object.keys(config.kinds) : [];
    const relNames = config?.relationshipTypes?.map(r => r.name) ?? [];

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
                    id: { type: 'string', description: 'The relationship id, as returned by get_element.' },
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

function describeElement(ctx: QueryContext, id: string): unknown {
    const el = ctx.element(id);
    if (!el) return undefined;
    return {
        id: el.id,
        shortId: el.shortId,
        name: el.name,
        kind: el.kind,
        layer: el.layer,
        construct: el.construct,
        file: el.file,
        attributes: el.attributes,
        doc: el.doc,
        outgoing: ctx.outgoing(id).map(r => ({
            relationshipId: r.id, type: r.type, target: r.targetId, targetName: ctx.elementName(r.targetId),
        })),
        incoming: ctx.incoming(id).map(r => ({
            relationshipId: r.id, type: r.type, source: r.sourceId, sourceName: ctx.elementName(r.sourceId),
        })),
        violations: ctx.violationsFor(id).map(v => ({ severity: v.severity, rule: v.ruleId, description: v.description })),
    };
}

function executeReadTool(name: string, input: Record<string, any>, ctx: QueryContext): ToolOutcome | undefined {
    switch (name) {
        case 'search_elements': {
            const limit = typeof input.limit === 'number' ? input.limit : 50;
            const query = typeof input.query === 'string' ? input.query.toLowerCase() : undefined;
            let elements = input.kind ? ctx.elementsByKind(input.kind) : ctx.allElements();
            if (input.layer) elements = elements.filter(e => e.layer === input.layer);
            if (query) {
                elements = elements.filter(e =>
                    e.id.toLowerCase().includes(query) || e.name.toLowerCase().includes(query));
            }
            const total = elements.length;
            const results = elements.slice(0, limit).map(e => ({
                id: e.id, name: e.name, kind: e.kind, layer: e.layer,
            }));
            return ok({ total, returned: results.length, results });
        }
        case 'get_element': {
            const detail = describeElement(ctx, String(input.id));
            return detail ? ok(detail) : fail(`No element with id "${input.id}". Use search_elements to find the right id.`);
        }
        case 'trace': {
            const id = String(input.id);
            if (!ctx.element(id)) return fail(`No element with id "${id}".`);
            const depth = typeof input.maxDepth === 'number' ? input.maxDepth : 3;
            const chain = ctx.traceChain(id, depth).map(step => ({
                depth: step.depth,
                via: step.relationship.type,
                to: step.element.id,
                name: step.element.name,
                kind: step.element.kind,
            }));
            return ok({ from: id, steps: chain.length, chain });
        }
        case 'list_gaps': {
            const limit = typeof input.limit === 'number' ? input.limit : 50;
            const severities: Array<'error' | 'warning' | 'info'> = input.severity
                ? [input.severity]
                : ['error', 'warning'];
            const violations = severities.flatMap(s => ctx.violationsBySeverity(s));
            return ok({
                total: violations.length,
                returned: Math.min(violations.length, limit),
                violations: violations.slice(0, limit).map(v => ({
                    severity: v.severity,
                    rule: v.ruleId,
                    description: v.description,
                    element: v.elementId,
                    elementKind: v.elementKind,
                })),
            });
        }
        case 'layer_summary':
            return ok(ctx.layerSummary().map(l => ({
                id: l.id, label: l.label, elements: l.count, completeness: l.completeness,
            })));
        default:
            return undefined;
    }
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
    config: MEMOConfig | undefined,
    staged: ProposedChange[],
    nextId: () => string,
): ToolOutcome | undefined {
    const knownKinds = config?.kinds ? new Set(Object.keys(config.kinds)) : undefined;
    const knownRels = config?.relationshipTypes ? new Set(config.relationshipTypes.map(r => r.name)) : undefined;

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
                : config?.kinds?.[elementKind]?.layer;
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
            if (!el) return fail(`No element with id "${id}". Use search_elements to find the right id.`);

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
                    return fail(`No element with id "${endpoint}" for the ${label}. Use search_elements to find the right id.`);
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
            if (!rel) return fail(`No relationship with id "${relId}". Use get_element to list an element's relationship ids.`);
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
        question, history = [], ctx, provider, config,
        allowEdits = false, contextOptions,
        maxIterations = DEFAULT_MAX_ITERATIONS,
    } = options;

    const tools = allowEdits ? [...READ_TOOLS, ...writeTools(config)] : READ_TOOLS;

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
            maxTokens: 4096,
            tools,
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
                messages: [...conversation, { role: 'assistant', content: answer }],
                usage: totals.totalTokens ? totals : undefined,
            };
        }

        conversation.push({ role: 'assistant', content: result.content, toolCalls: calls });

        // Every call must get a result, in the same batch — dropping one leaves
        // the conversation malformed for both providers.
        for (const call of calls) {
            const outcome = runTool(call, ctx, config, allowEdits, proposedChanges, nextId);
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

function runTool(
    call: ToolCall,
    ctx: QueryContext,
    config: MEMOConfig | undefined,
    allowEdits: boolean,
    staged: ProposedChange[],
    nextId: () => string,
): ToolOutcome {
    try {
        const input = (call.input ?? {}) as Record<string, any>;
        const read = executeReadTool(call.name, input, ctx);
        if (read) return read;

        if (call.name.startsWith('propose_') && !allowEdits) {
            return fail('Editing is disabled for this conversation. Answer using the read-only tools instead.');
        }

        const write = executeWriteTool(call.name, input, ctx, config, staged, nextId);
        if (write) return write;

        return fail(`Unknown tool "${call.name}".`);
    } catch (e: any) {
        return fail(`Tool "${call.name}" failed: ${e?.message ?? String(e)}`);
    }
}

/** The tool names this engine exposes — used by tests and the MCP server. */
export function chatToolNames(allowEdits = true): string[] {
    return (allowEdits ? [...READ_TOOLS, ...writeTools()] : READ_TOOLS).map(t => t.name);
}

export { READ_TOOLS, writeTools };
