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

import { loadProject, type LoadedProject } from './model-loader.js';
import { evaluateWorkspaceGuide } from '../methodology/guide-service.js';
import { computeChangeImpact } from '../model/impact.js';
import { architectAddress } from './architect-address.js';
import type { QueryContext } from '../dhf/query-engine.js';
import type { OntologyView } from '../model/kind-registry.js';
import { stageProposal, writeTools } from '../llm/chat-engine.js';
import type { GuideResult } from '../methodology/guide-service.js';
import type { ImpactReport } from '../model/impact.js';
import type { MemoElement } from '../model/semantic.js';
import type { OntologyRegistriesDTO } from '../model/relationship-legality.js';
import { appendProposals, readProposalQueue } from '../llm/proposal-queue.js';

/** An MCP tool as advertised in `tools/list`. */
export interface McpTool {
    name: string;
    description: string;
    inputSchema: Record<string, unknown>;
}

/**
 * What the caller can do beyond reading the model it holds. Each is optional: a tool that needs one the
 * caller lacks says so instead of answering from less.
 */
export interface ToolServices {
    /** Where an element opens in MEMO Architect. */
    link?: (element: { id: string; shortId?: string; idFamily?: string }) => string;
    /** Where the model stands against its method, for the workspace the context is scoped to. */
    guide?: () => GuideResult;
    /** What the working tree's change reaches, measured from where it branched from `target`. */
    impact?: (target?: string) => Promise<ImpactReport>;
    /** The systems and systems of systems the model declares, and the one the answers are scoped to. */
    systems?: () => { systems: { id: string; name: string; scope: 'system' | 'sos' }[]; selected?: string };
}

/** What a read tool sees: the loaded model and its ontology, nothing on disk. */
export interface ReadToolContext {
    ctx: QueryContext;
    /** Kinds and relationships from the resolved ontology. */
    ontology: OntologyView;
    /** The ontology's definitions, ends and SysML constructs included. */
    registries?: OntologyRegistriesDTO;
    services?: ToolServices;
}

/** An element as the tools report it: what identifies it, and where it opens in Architect. */
function brief(element: MemoElement, services?: ToolServices): Record<string, unknown> {
    return {
        id: element.id, shortId: element.shortId, name: element.name, kind: element.kind, layer: element.layer,
        ...(services?.link ? { link: services.link(element) } : {}),
    };
}

function unavailable(what: string): never {
    throw new Error(`${what} is not available from this caller.`);
}

/**
 * The SysML construct a relationship is written with: a typed usage's (`allocation def`, `interface def`,
 * `flow def`), or the language statement's (`allocate` is an allocation). Read from each definition in the
 * ontology, never from a list of relationship names here.
 */
function constructOfDefinition(def: { sysmlConstruct?: string; nativeKeyword?: string }): string | undefined {
    if (def.sysmlConstruct) return def.sysmlConstruct;
    return def.nativeKeyword === 'allocate' ? 'allocation def' : undefined;
}

/** The relationships touching an element (or a feature of it, such as a port) written with the given constructs. */
function relationsByConstruct(context: ReadToolContext, id: string, constructs: readonly string[]) {
    const { ctx, registries } = context;
    if (!registries) unavailable('The ontology\'s relationship definitions');
    const constructOf = new Map(registries.relationships.map(def => [def.name, constructOfDefinition(def)]));
    const touches = (end: string) => end === id || end.startsWith(`${id}::`);
    const element = ctx.element(id);
    if (!element) throw new Error(`No element with id "${id}". Use memo_search_elements to find it.`);
    return ctx.allRelationships()
        .filter(rel => constructs.includes(constructOf.get(rel.type) ?? '') && (touches(rel.sourceId) || touches(rel.targetId)))
        .map(rel => {
            const outgoing = touches(rel.sourceId);
            const other = outgoing ? rel.targetId : rel.sourceId;
            const otherElement = ctx.element(other);
            return {
                relationshipId: rel.id, type: rel.type, construct: constructOf.get(rel.type),
                direction: outgoing ? 'outgoing' : 'incoming',
                end: outgoing ? rel.sourceId : rel.targetId,
                other: otherElement ? brief(otherElement, context.services) : { id: other },
            };
        });
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
}, (_input, { ctx, services }) => ({
    project: ctx.modelName,
    elements: ctx.totalElements(),
    relationships: ctx.totalRelationships(),
    completeness: ctx.overallCompleteness(),
    errors: ctx.errorCount(),
    warnings: ctx.warningCount(),
    unmitigatedHazards: ctx.unmitigatedCount(),
    ...(services?.systems?.().selected ? { scopedTo: services.systems!().selected } : {}),
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
}, (input, { ctx, services }) => {
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
        results: elements.slice(0, limit).map(e => ({ ...brief(e, services), file: e.file })),
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
}, (input, { ctx, services }) => {
    const id = String(input.id);
    const el = ctx.element(id);
    if (!el) throw new Error(`No element with id "${id}". Use memo_search_elements to find it.`);
    return {
        ...brief(el, services),
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
}, (input, { ctx, services }) => {
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
            ...brief(step.element, services),
        })),
    };
});

define({
    name: 'memo_validate',
    description: 'Run the project\'s rules, the set memo validate and Architect run, and return the violations: the compliance, traceability and coverage gaps. Filter to one element to see what it still lacks (a requirement with no verification, a hazard with no control), or to one rule. Call this after editing SysML to check your work.',
    inputSchema: {
        type: 'object',
        properties: {
            severity: { type: 'string', enum: ['error', 'warning', 'info'], description: 'Filter by severity. Omit for errors and warnings.' },
            element: { type: 'string', description: 'Only the findings about this element id.' },
            rule: { type: 'string', description: 'Only the findings of this rule id.' },
            limit: { type: 'number', description: 'Maximum results (default 100).' },
        },
    },
}, (input, { ctx, services }) => {
    const limit = typeof input.limit === 'number' ? input.limit : 100;
    const severities: Array<'error' | 'warning' | 'info'> = input.severity
        ? [input.severity]
        : input.element ? ['error', 'warning', 'info'] : ['error', 'warning'];
    const violations = severities.flatMap(s => ctx.violationsBySeverity(s))
        .filter(v => !input.element || v.elementId === input.element)
        .filter(v => !input.rule || v.ruleId === input.rule);
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
            ...(services?.link && ctx.element(v.elementId) ? { link: services.link(ctx.element(v.elementId)!) } : {}),
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

define({
    name: 'memo_allocation',
    description: 'What is allocated to an element and what it is allocated to: every allocation the model holds that touches it, read from the ontology\'s allocation definitions. Use it for function-to-component, requirement-to-element and similar questions.',
    inputSchema: {
        type: 'object',
        properties: { id: { type: 'string', description: 'The element id.' } },
        required: ['id'],
    },
}, (input, context) => {
    const id = String(input.id);
    const allocations = relationsByConstruct(context, id, ['allocation def']);
    return {
        element: id,
        allocatedTo: allocations.filter(a => a.direction === 'outgoing'),
        allocatedFrom: allocations.filter(a => a.direction === 'incoming'),
    };
});

define({
    name: 'memo_interfaces',
    description: 'The interfaces and flows of an element and its ports: every connection the ontology defines as an interface or a flow, with the element at the other end. Use it to see what a part exchanges and with whom.',
    inputSchema: {
        type: 'object',
        properties: { id: { type: 'string', description: 'The element id, usually a part.' } },
        required: ['id'],
    },
}, (input, context) => {
    const id = String(input.id);
    const connections = relationsByConstruct(context, id, ['interface def', 'flow def']);
    return {
        element: id,
        interfaces: connections.filter(c => c.construct === 'interface def'),
        flows: connections.filter(c => c.construct === 'flow def'),
    };
});

define({
    name: 'memo_guide',
    description: 'Where the model stands against its method, layer by layer: each step\'s objective, entry and exit criteria, the element kinds it uses and produces, the rules that mark it done and linked to other layers, and what is still open or waiting. Read this before working on a layer, and again afterwards to see what your change completed.',
    inputSchema: {
        type: 'object',
        properties: { stage: { type: 'string', description: 'Only the steps of this stage (layer), as the method names it.' } },
    },
}, (input, { ontology, services }) => {
    const result = services?.guide ? services.guide() : unavailable('The method guide');
    if (result.error) throw new Error(result.error);
    const stage = typeof input.stage === 'string' ? input.stage.toLowerCase() : undefined;
    const steps = result.steps.filter(step => !stage || step.stage?.toLowerCase() === stage
        || step.label?.toLowerCase() === stage || step.name.toLowerCase() === stage);
    if (stage && steps.length === 0) {
        throw new Error(`No step of stage "${input.stage}". Stages: ${[...new Set(result.steps.map(s => s.stage).filter(Boolean))].join(', ')}.`);
    }
    const kind = (name: string) => ({ kind: name, label: ontology.kinds[name]?.label, layer: ontology.kinds[name]?.layer });
    return {
        scopedTo: result.workspace,
        next: result.next,
        layers: result.layers
            .filter(layer => !stage || layer.stages.some(s => steps.some(step => step.stage === s)))
            .map(layer => ({ label: layer.label, purpose: layer.purpose, stages: layer.stages })),
        steps: steps.map(step => ({
            id: step.id, label: step.label ?? step.name, stage: step.stage, level: step.level, state: step.state,
            objective: step.objective, entryCriteria: step.entryCriteria, exitCriteria: step.exitCriteria,
            uses: step.inputKinds.map(kind), produces: step.outputKinds.map(kind),
            outputs: step.outputs, doneWhen: step.rules, linkedWhen: step.links.map(link => ({
                rule: link.rule, state: link.state, waitingFor: link.waitingFor, unlinked: link.unlinked,
            })),
            todo: step.reasons, waiting: step.waiting, after: step.predecessors,
        })),
    };
});

define({
    name: 'memo_change_impact',
    description: 'What the uncommitted change in this model reaches, measured from where it branched from a git ref (default: the main branch): the elements changed, the elements reached in each layer, interface contracts broken, the systems touched, releases that need a new release, and method steps it reopens. Call it after editing to see what else needs attention.',
    inputSchema: {
        type: 'object',
        properties: { target: { type: 'string', description: 'The git ref the change is measured from.' } },
    },
}, async (input, { ctx, services }) => {
    const report = services?.impact ? await services.impact(typeof input.target === 'string' ? input.target : undefined) : unavailable('Change impact');
    // A removed element is no longer in the model, so only the ones still there get a link.
    const items = (list: { id: string }[]) => list.map(item => {
        const element = ctx.element(item.id);
        return { ...item, ...(element && services?.link ? { link: services.link(element) } : {}) };
    });
    return {
        base: report.base,
        changed: { ...report.changed, elements: items(report.changed.elements) },
        contract: report.contract,
        reached: Object.fromEntries(Object.entries(report.reached).map(([layer, list]) => [layer, items(list)])),
        systems: report.systems,
        releases: report.releases,
        reopened: report.reopened,
        limits: report.limits,
    };
});

define({
    name: 'memo_systems',
    description: 'The systems and systems of systems this model declares, and the one your answers are scoped to, if any. Each is a workspace a team works in.',
    inputSchema: { type: 'object', properties: {} },
}, (_input, { services }) => (services?.systems ? services.systems() : unavailable('The list of systems')));

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

/**
 * The tool that scopes this server's answers to one system, which it keeps for the rest of the
 * session. Not in the registry: only a long-lived MCP session has a choice to keep.
 */
const SELECT_SYSTEM: McpTool = {
    name: 'memo_select_system',
    description: 'Scope every later answer in this session to one system or system of systems, by id, short id or name (memo_systems lists them): searches list its elements and validation judges its elements only. Pass no system to go back to the whole model.',
    inputSchema: { type: 'object', properties: { system: { type: 'string', description: 'The system; omit for the whole model.' } } },
};

/** What one MCP session keeps between calls. */
export interface McpSession {
    /** The system the answers are scoped to, as asked for. */
    system?: string;
}

export function listTools(allowWrites: boolean): McpTool[] {
    const read = [...registry.map(r => r.tool), SELECT_SYSTEM];
    return allowWrites ? [...read, ...proposalTools()] : read;
}

/** Where an element opens in the MEMO Architect at `base`, for answers to carry. */
export function architectLink(base: string) {
    const root = base.replace(/\/$/, '');
    return (element: { id: string; shortId?: string; idFamily?: string }) =>
        `${root}/catalog/${encodeURIComponent(element.idFamily ?? '_')}/${encodeURIComponent(element.shortId ?? element.id)}`;
}

/** The services a loaded project gives the tools: links, the Guide and change impact, scoped as the project is. */
export function projectServices(project: LoadedProject): ToolServices {
    const head = {
        model: project.model.model, registries: project.model.registries ?? {}, api: project.model.api,
        constraints: project.constraints, packages: project.methodologyPackages,
    };
    return {
        // The Architect running on this project, read per answer: it may have started after this session.
        link: element => architectLink(architectAddress(project.projectRoot))(element),
        guide: () => evaluateWorkspaceGuide({
            api: project.model.api, model: project.model.model, registries: project.model.registries ?? {},
            constraints: project.constraints, packages: project.methodologyPackages, workspace: project.workspace?.id,
        }),
        impact: target => computeChangeImpact({
            projectRoot: project.projectRoot, target, head, build: { config: { toolchain: project.config.toolchain } },
        }),
        systems: () => ({ systems: project.systems, selected: project.workspace?.name }),
    };
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

/** Run one tool against a freshly-loaded project, scoped as the session asked. */
export async function callTool(
    name: string,
    input: Record<string, any>,
    projectRoot: string,
    allowWrites: boolean,
    client?: string,
    session: McpSession = {},
): Promise<unknown> {
    if (name === SELECT_SYSTEM.name) {
        const system = typeof input?.system === 'string' && input.system.trim() ? input.system.trim() : undefined;
        // Loading it is what checks the name; a wrong one is refused and the scope stays as it was.
        const scoped = await loadProject(projectRoot, system);
        session.system = system;
        return { scopedTo: scoped.workspace ?? 'the whole model', elements: scoped.ctx.totalElements() };
    }
    const entry = registry.find(r => r.tool.name === name);
    const proposes = !entry && proposalTools().some(tool => tool.name === name);
    if (!entry && !proposes) throw new Error(`Unknown tool "${name}".`);
    if (proposes && !allowWrites) {
        throw new Error(`Tool "${name}" proposes a model change and this server is read-only. Turn on "Let AI tools propose edits" in MEMO Architect (Settings › Jupyter and AI tools), or start it with \`memo-architect mcp --write\`.`);
    }
    const project = await loadProject(projectRoot, session.system);
    const { ctx, ontology, registries } = project;
    if (entry) return entry.handler(input ?? {}, { ctx, ontology, registries, services: projectServices(project) });

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
