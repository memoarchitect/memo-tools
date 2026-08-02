// ─── MEMO MCP Tools ──────────────────────────────────────────────────────────
//
// The tool surface exposed to MCP clients (Cursor, Claude Code, Windsurf, …).
//
// Read tools are always available. Write tools appear only when the server is
// started with `--write`: an IDE agent editing a regulated SysML model is a
// deliberate choice, not a default.
// ─────────────────────────────────────────────────────────────────────────────

import { loadProject } from './model-loader.js';
import { saveElementToFile } from '../server/persistor.js';
import type { QueryContext } from '../dhf/query-engine.js';
import type { OntologyView } from '../model/kind-registry.js';
import type { MEMOConfig } from '../model/config.js';

/** An MCP tool as advertised in `tools/list`. */
export interface McpTool {
    name: string;
    description: string;
    inputSchema: Record<string, unknown>;
}

export interface McpToolContext {
    projectRoot: string;
    ctx: QueryContext;
    config: MEMOConfig;
    /** Kinds and relationships from the resolved ontology. */
    ontology: OntologyView;
}

export type McpToolHandler = (
    input: Record<string, any>,
    context: McpToolContext,
) => Promise<unknown> | unknown;

interface Registered {
    tool: McpTool;
    handler: McpToolHandler;
    write: boolean;
}

const registry: Registered[] = [];

function define(tool: McpTool, handler: McpToolHandler, write = false): void {
    registry.push({ tool, handler, write });
}

// ─── Read tools ──────────────────────────────────────────────────────────────

define({
    name: 'memo_project_summary',
    description: 'Overview of the MEMO model: project name, element and relationship counts, per-layer completeness, and validation error/warning totals. Call this first to orient yourself in an unfamiliar project.',
    inputSchema: { type: 'object', properties: {} },
}, (_input, { ctx }) => ({
    project: ctx.projectName,
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
    description: 'Follow the relationship chain out of an element. Use this for traceability questions — requirement to verification, hazard to risk control, and so on.',
    inputSchema: {
        type: 'object',
        properties: {
            id: { type: 'string', description: 'Element id to trace from.' },
            maxDepth: { type: 'number', description: 'Hops to follow (default 3).' },
        },
        required: ['id'],
    },
}, (input, { ctx }) => {
    const id = String(input.id);
    if (!ctx.element(id)) throw new Error(`No element with id "${id}".`);
    const depth = typeof input.maxDepth === 'number' ? input.maxDepth : 3;
    return {
        from: id,
        chain: ctx.traceChain(id, depth).map(step => ({
            depth: step.depth,
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

// ─── Write tools (only with --write) ─────────────────────────────────────────

define({
    name: 'memo_create_element',
    description: 'Create a new element and write it to the project SysML source. Only kinds defined by the ontology are accepted — call memo_ontology first if unsure.',
    inputSchema: {
        type: 'object',
        properties: {
            id: { type: 'string', description: 'Unique element id (SysML usage name).' },
            name: { type: 'string', description: 'Human-readable name.' },
            kind: { type: 'string', description: 'Ontology kind, as listed by memo_ontology.' },
            layer: { type: 'string', description: 'Architecture layer. Defaults to the kind\'s layer.' },
            attributes: { type: 'object', description: 'Attribute key/value pairs.', additionalProperties: { type: 'string' } },
            doc: { type: 'string', description: 'Documentation comment.' },
            file: { type: 'string', description: 'Project-relative .sysml file to write into. Defaults to model/generated.sysml.' },
        },
        required: ['id', 'name', 'kind'],
    },
}, (input, { ctx, ontology, projectRoot }) => {
    const id = String(input.id).trim();
    const kind = String(input.kind).trim();
    if (ctx.element(id)) throw new Error(`Element "${id}" already exists.`);

    const kinds = ontology.kinds;
    if (Object.keys(kinds).length > 0 && !kinds[kind]) {
        throw new Error(`"${kind}" is not a kind in this ontology. Valid kinds: ${Object.keys(kinds).join(', ')}`);
    }

    const result = saveElementToFile(projectRoot, {
        id,
        name: String(input.name),
        kind,
        construct: kinds[kind]?.sysmlConstruct ?? 'part',
        layer: input.layer ?? kinds[kind]?.layer ?? '',
        doc: input.doc ?? '',
        attributes: input.attributes ?? {},
        file: input.file,
    });
    if (!result.success) throw new Error(result.error ?? 'Failed to write the element.');
    return { created: id, file: result.filePath };
}, true);

// ─── Registry access ─────────────────────────────────────────────────────────

export function listTools(allowWrites: boolean): McpTool[] {
    return registry.filter(r => allowWrites || !r.write).map(r => r.tool);
}

/** Run one tool against a freshly-loaded project. */
export async function callTool(
    name: string,
    input: Record<string, any>,
    projectRoot: string,
    allowWrites: boolean,
): Promise<unknown> {
    const entry = registry.find(r => r.tool.name === name);
    if (!entry) throw new Error(`Unknown tool "${name}".`);
    if (entry.write && !allowWrites) {
        throw new Error(`Tool "${name}" modifies the model and this server is read-only. Restart it with \`memo mcp --write\` to enable edits.`);
    }
    const { ctx, config, ontology } = await loadProject(projectRoot);
    return entry.handler(input ?? {}, { projectRoot, ctx, config, ontology });
}
