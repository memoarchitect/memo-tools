// ─── MEMO MCP Tools ──────────────────────────────────────────────────────────
//
// The tool surface exposed to MCP clients (Cursor, Claude Code, Windsurf, …),
// and the read tools of Architect's Model Assistant: one registry, so an IDE
// agent and the assistant answer the same question the same way.
//
// Read tools are always available. Proposal tools appear only when the server is
// started with `--write`, and even then a proposal is never applied here: the
// engineer applies it in Architect.
// ─────────────────────────────────────────────────────────────────────────────

import { loadProject } from './model-loader.js';
import type { QueryContext } from '../dhf/query-engine.js';
import type { OntologyView } from '../model/kind-registry.js';
import { stageProposal, writeTools } from '../llm/chat-engine.js';
import { appendProposals, readProposalQueue } from '../llm/proposal-queue.js';

/** An MCP tool as advertised in `tools/list`. */
export interface McpTool {
    name: string;
    description: string;
    inputSchema: Record<string, unknown>;
}

/** What a read tool sees: the loaded model and its ontology, nothing on disk. */
export interface ReadToolContext {
    ctx: QueryContext;
    /** Kinds and relationships from the resolved ontology. */
    ontology: OntologyView;
}

interface Registered {
    tool: McpTool;
    handler: (input: Record<string, any>, context: ReadToolContext) => unknown;
}

const registry: Registered[] = [];

function define(tool: McpTool, handler: (input: Record<string, any>, context: ReadToolContext) => unknown): void {
    registry.push({ tool, handler });
}

// ─── Read tools ──────────────────────────────────────────────────────────────

define({
    name: 'memo_project_summary',
    description: 'Overview of the MEMO model: project name, element and relationship counts, per-layer completeness, and validation error/warning totals. Call this first to orient yourself in an unfamiliar project.',
    inputSchema: { type: 'object', properties: {} },
}, (_input, { ctx }) => ({
    project: ctx.modelName,
    elements: ctx.totalElements(),
    relationships: ctx.totalRelationships(),
    completeness: ctx.overallCompleteness(),
    errors: ctx.errorCount(),
    warnings: ctx.warningCount(),
    unmitigatedHazards: ctx.unmitigatedCount(),
    layers: ctx.layerSummary().map(l => ({
        id: l.id, label: l.label, elements: l.count, completeness: l.completeness,
    })),
}));

define({
    name: 'memo_search_elements',
    description: 'Search model elements by name/id substring, kind, or layer. Use this to find the exact element id before calling memo_get_element.',
    inputSchema: {
        type: 'object',
        properties: {
            query: { type: 'string', description: 'Case-insensitive substring matched against element id and name.' },
            kind: { type: 'string', description: 'Restrict to one ontology kind, e.g. "Hazard".' },
            layer: { type: 'string', description: 'Restrict to one architecture layer, e.g. "risk".' },
            limit: { type: 'number', description: 'Maximum results (default 50).' },
        },
    },
}, (input, { ctx }) => {
    const limit = typeof input.limit === 'number' ? input.limit : 50;
    const query = typeof input.query === 'string' ? input.query.toLowerCase() : undefined;
    let elements = input.kind ? ctx.elementsByKind(input.kind) : ctx.allElements();
    if (input.layer) elements = elements.filter(e => e.layer === input.layer);
    if (query) {
        elements = elements.filter(e =>
            e.id.toLowerCase().includes(query) || e.name.toLowerCase().includes(query));
    }
    return {
        total: elements.length,
        results: elements.slice(0, limit).map(e => ({
            id: e.id, shortId: e.shortId, name: e.name, kind: e.kind, layer: e.layer, file: e.file,
        })),
    };
});

define({
    name: 'memo_get_element',
    description: 'Full detail for one element: attributes, documentation, source file, every incoming and outgoing relationship, and its validation violations.',
    inputSchema: {
        type: 'object',
        properties: { id: { type: 'string', description: 'The element id.' } },
        required: ['id'],
    },
}, (input, { ctx }) => {
    const id = String(input.id);
    const el = ctx.element(id);
    if (!el) throw new Error(`No element with id "${id}". Use memo_search_elements to find it.`);
    return {
        id: el.id,
        shortId: el.shortId,
        name: el.name,
        kind: el.kind,
        layer: el.layer,
        construct: el.construct,
        file: el.file,
        package: el.package,
        attributes: el.attributes,
        doc: el.doc,
        outgoing: ctx.outgoing(id).map(r => ({
            relationshipId: r.id, type: r.type, target: r.targetId, targetName: ctx.elementName(r.targetId),
        })),
        incoming: ctx.incoming(id).map(r => ({
            relationshipId: r.id, type: r.type, source: r.sourceId, sourceName: ctx.elementName(r.sourceId),
        })),
        violations: ctx.violationsFor(id).map(v => ({
            severity: v.severity, rule: v.ruleId, description: v.description,
        })),
    };
});

define({
    name: 'memo_trace',
    description: 'Follow relationship chains from an element, for traceability questions — requirement to verification, hazard to risk control, and so on. A relationship points one way in the source, so ask for "upstream" (edges into the element, e.g. what verifies or satisfies it) or "both" when "downstream" finds nothing.',
    inputSchema: {
        type: 'object',
        properties: {
            id: { type: 'string', description: 'Element id to trace from.' },
            maxDepth: { type: 'number', description: 'Hops to follow (default 3).' },
            direction: {
                type: 'string', enum: ['downstream', 'upstream', 'both'],
                description: 'downstream follows edges out of the element, upstream edges into it (default both).',
            },
        },
        required: ['id'],
    },
}, (input, { ctx }) => {
    const id = String(input.id);
    if (!ctx.element(id)) throw new Error(`No element with id "${id}". Use memo_search_elements to find it.`);
    const depth = typeof input.maxDepth === 'number' ? input.maxDepth : 3;
    const direction = input.direction === 'downstream' || input.direction === 'upstream' ? input.direction : 'both';
    return {
        from: id,
        direction,
        chain: ctx.traceChain(id, depth, direction).map(step => ({
            depth: step.depth,
            direction: step.direction,
            via: step.relationship.type,
            to: step.element.id,
            name: step.element.name,
            kind: step.element.kind,
        })),
    };
});

define({
    name: 'memo_validate',
    description: 'Run the ontology closure rules and return every violation — the compliance and completeness gaps in the model. Call this after editing SysML to check your work.',
    inputSchema: {
        type: 'object',
        properties: {
            severity: { type: 'string', enum: ['error', 'warning', 'info'], description: 'Filter by severity. Omit for errors and warnings.' },
            limit: { type: 'number', description: 'Maximum results (default 100).' },
        },
    },
}, (input, { ctx }) => {
    const limit = typeof input.limit === 'number' ? input.limit : 100;
    const severities: Array<'error' | 'warning' | 'info'> = input.severity
        ? [input.severity]
        : ['error', 'warning'];
    const violations = severities.flatMap(s => ctx.violationsBySeverity(s));
    return {
        total: violations.length,
        errors: ctx.errorCount(),
        warnings: ctx.warningCount(),
        violations: violations.slice(0, limit).map(v => ({
            severity: v.severity,
            rule: v.ruleId,
            description: v.description,
            element: v.elementId,
            elementKind: v.elementKind,
            layer: v.layer,
        })),
    };
});

define({
    name: 'memo_ontology',
    description: 'The vocabulary this project models in: every legal element kind with its SysML v2 construct and layer, and every legal relationship type. Read this before writing or editing any .sysml file so you use terms the ontology actually defines.',
    inputSchema: { type: 'object', properties: {} },
}, (_input, { ontology }) => ({
    kinds: Object.entries(ontology.kinds).map(([name, def]) => ({
        name, label: def.label, layer: def.layer, construct: def.sysmlConstruct,
    })),
    relationshipTypes: ontology.relationshipTypes.map(r => ({
        name: r.name, label: r.label, layer: r.layer,
    })),
}));

// ─── Proposal tools (only with --write) ──────────────────────────────────────
//
// The Model Assistant's proposal tools (`writeTools` in llm/chat-engine.ts), so an IDE agent proposes
// a change exactly as the assistant does. A proposal is not applied: it waits in
// `memo.ai-proposals.json` until the engineer applies it in Architect (AI Tools › Pending changes).

function proposalTools(): McpTool[] {
    return writeTools().map(tool => ({
        name: tool.name,
        description: `${tool.description} The change waits for the engineer to apply it in MEMO Architect (AI Tools › Pending changes); it is not written to the model.`,
        inputSchema: tool.inputSchema,
    }));
}

// ─── Registry access ─────────────────────────────────────────────────────────

export function listTools(allowWrites: boolean): McpTool[] {
    const read = registry.map(r => r.tool);
    return allowWrites ? [...read, ...proposalTools()] : read;
}

/** The read tools, which any caller holding a loaded model can run. */
export function readTools(): McpTool[] {
    return registry.map(r => r.tool);
}

/**
 * Run one read tool against a model the caller already holds. Returns undefined
 * when `name` is not a read tool, so a caller can try its own tools next.
 */
export async function runReadTool(
    name: string,
    input: Record<string, any>,
    context: ReadToolContext,
): Promise<unknown> {
    const entry = registry.find(r => r.tool.name === name);
    if (!entry) return undefined;
    return entry.handler(input ?? {}, context);
}

/** Run one tool against a freshly-loaded project. */
export async function callTool(
    name: string,
    input: Record<string, any>,
    projectRoot: string,
    allowWrites: boolean,
    client?: string,
): Promise<unknown> {
    const entry = registry.find(r => r.tool.name === name);
    const proposes = !entry && proposalTools().some(tool => tool.name === name);
    if (!entry && !proposes) throw new Error(`Unknown tool "${name}".`);
    if (proposes && !allowWrites) {
        throw new Error(`Tool "${name}" proposes a model change and this server is read-only. Turn on "Let AI tools propose edits" in MEMO Architect (Settings › Assistant), or start it with \`memo-architect mcp --write\`.`);
    }
    const { ctx, ontology, registries } = await loadProject(projectRoot);
    if (entry) return entry.handler(input ?? {}, { ctx, ontology });

    const staged = stageProposal(name, input ?? {}, { ctx, ontology, registries, waiting: readProposalQueue(projectRoot) });
    if (!staged) throw new Error(`Unknown tool "${name}".`);
    if (staged.isError) throw new Error(staged.message);
    const queue = appendProposals(projectRoot, staged.added, client);
    return {
        proposed: staged.added.map(change => change.summary),
        waiting: queue.length,
        note: 'Not applied. The engineer reviews and applies it in MEMO Architect under AI Tools › Pending changes.',
    };
}
