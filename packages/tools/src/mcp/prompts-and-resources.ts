// ─── MCP prompts and resources ───────────────────────────────────────────────
//
// Prompts: one per step of the model's method, so the person using an AI coding tool can pick "work
// this step" instead of writing the instructions. Each is written from the step as the method
// declares it (objective, entry and exit criteria, the kinds it uses and produces, the rules that say
// it is done), never from text kept here, and ends by checking the work with memo_validate and
// memo_guide.
//
// Resources: the ontology, the guide, the systems and each element, read through the same handlers as
// the tools, so a resource and the tool that answers the same question cannot disagree.
// ─────────────────────────────────────────────────────────────────────────────

import { loadProject } from './model-loader.js';
import { projectServices, runReadTool, type McpSession } from './tools.js';
import type { StepStatus } from '../methodology/guide.js';

export interface McpPrompt {
    name: string;
    title?: string;
    description?: string;
    arguments?: { name: string; description?: string; required?: boolean }[];
}

async function guideFor(projectRoot: string, session: McpSession, system?: string) {
    const project = await loadProject(projectRoot, system ?? session.system);
    const result = projectServices(project).guide!();
    if (result.error) throw new Error(result.error);
    return { project, result };
}

/** The prompt's name for a step: its declared name, which the method keeps unique within its package. */
const promptName = (step: { name: string }) => step.name;

export async function listPrompts(projectRoot: string, session: McpSession): Promise<McpPrompt[]> {
    const { result } = await guideFor(projectRoot, session);
    return result.steps.map(step => ({
        name: promptName(step),
        title: `${step.label ?? step.name}${step.stage ? ` (${step.stage})` : ''}`,
        description: step.objective ?? `Work the method step ${step.label ?? step.name}.`,
        arguments: [{ name: 'system', description: 'The system to work in, by id, short id or name (memo_systems lists them). Omit for the scope already chosen.' }],
    }));
}

function list(label: string, items: readonly string[]): string[] {
    return items.length ? [`${label}: ${items.join(', ')}.`] : [];
}

/** The instructions for one step, from what the method says about it and where the model stands. */
export function stepInstructions(step: StepStatus, system: string | undefined, allowWrites: boolean): string {
    return [
        `Work the MEMO method step "${step.label ?? step.name}"${step.stage ? ` of the ${step.stage} stage` : ''}${system ? ` for the system ${system}` : ''}.`,
        ...(step.objective ? [`Objective: ${step.objective}`] : []),
        ...(step.entryCriteria ? [`Entry criteria: ${step.entryCriteria}`] : []),
        ...(step.exitCriteria ? [`Exit criteria: ${step.exitCriteria}`] : []),
        ...list('It uses elements of the kinds', step.inputKinds),
        ...list('It produces elements of the kinds', step.outputKinds),
        ...list('It is done when these rules have subjects and no findings', step.rules.map(rule => rule.rule)),
        ...list('It is linked to other layers when these rules hold', step.links.map(link => link.rule)),
        `Where it stands now: ${step.state}.`,
        ...list('Still to do', step.reasons),
        ...list('Waiting on other teams', step.waiting),
        '',
        'How to work it:',
        ...(system ? [`1. Call memo_select_system with "${system}".`] : ['1. If the work is for one system, call memo_select_system first.']),
        `2. Call memo_guide${step.stage ? ` with stage "${step.stage}"` : ''} to see what is open, and memo_ontology for the kinds and relationships you may use.`,
        '3. Find what exists with memo_search_elements, memo_get_element and memo_trace before adding anything.',
        allowWrites
            ? '4. Propose each change with the propose_* tools. They wait for the engineer to apply them in MEMO Architect; say what you proposed and never claim the model changed.'
            : '4. Edit the .sysml source for each change, using only the kinds and relationships memo_ontology lists.',
        '5. Call memo_validate and memo_guide again, and report what the step now has, what is still open, and what waits on other layers.',
    ].join('\n');
}

export async function getPrompt(
    projectRoot: string, name: string, args: Record<string, unknown>, session: McpSession, allowWrites: boolean,
): Promise<{ description?: string; messages: { role: 'user'; content: { type: 'text'; text: string } }[] }> {
    const system = typeof args?.system === 'string' && args.system.trim() ? args.system.trim() : undefined;
    const { project, result } = await guideFor(projectRoot, session, system);
    const scoped = result.steps.find(candidate => promptName(candidate) === name);
    // A step of another level (the system of systems') is not in one system's guide: it is the whole
    // model's work, so it is worked there, and the prompt says so.
    const whole = scoped ? undefined : (await guideFor(projectRoot, {}, undefined)).result.steps.find(candidate => promptName(candidate) === name);
    const step = scoped ?? whole;
    if (!step) throw new Error(`No prompt "${name}". prompts/list names the method's steps.`);
    const scope = scoped ? project.workspace?.name ?? system : undefined;
    const note = whole && project.workspace
        ? `\nNote: this step is not part of ${project.workspace.name}'s own work (its level is ${step.level ?? 'another'}), so it is worked on the whole model: call memo_select_system with no system first.`
        : '';
    return {
        description: step.objective,
        messages: [{ role: 'user', content: { type: 'text', text: stepInstructions(step, scope, allowWrites) + note } }],
    };
}

// ─── Resources ───────────────────────────────────────────────────────────────

const RESOURCES = [
    { uri: 'memo://ontology', name: 'ontology', title: 'Ontology', description: 'Every element kind and relationship type the model may use.', tool: 'memo_ontology' },
    { uri: 'memo://guide', name: 'guide', title: 'Method guide', description: 'Where the model stands against its method, step by step.', tool: 'memo_guide' },
    { uri: 'memo://systems', name: 'systems', title: 'Systems', description: 'The systems and systems of systems the model declares.', tool: 'memo_systems' },
    { uri: 'memo://summary', name: 'summary', title: 'Project summary', description: 'Counts, completeness and validation totals.', tool: 'memo_project_summary' },
] as const;

const ELEMENT_TEMPLATE = {
    uriTemplate: 'memo://element/{id}', name: 'element', title: 'Element',
    description: 'One element in full: attributes, documentation, relationships and findings. The id is its qualified name or short id.',
    mimeType: 'application/json',
};

export function listResources() {
    return RESOURCES.map(({ tool: _tool, ...resource }) => ({ ...resource, mimeType: 'application/json' }));
}

export function listResourceTemplates() {
    return [ELEMENT_TEMPLATE];
}

export async function readResource(projectRoot: string, uri: string, session: McpSession) {
    const project = await loadProject(projectRoot, session.system);
    const context = { ctx: project.ctx, ontology: project.ontology, registries: project.registries, services: projectServices(project), views: project.views };
    let value: unknown;
    const fixed = RESOURCES.find(resource => resource.uri === uri);
    if (fixed) {
        value = await runReadTool(fixed.tool, {}, context);
    } else if (uri.startsWith('memo://element/')) {
        const key = decodeURIComponent(uri.slice('memo://element/'.length));
        const element = project.ctx.element(key) ?? project.ctx.allElements().find(candidate => candidate.shortId === key);
        if (!element) throw new Error(`No element "${key}".`);
        value = await runReadTool('memo_get_element', { id: element.id }, context);
    } else {
        throw new Error(`No resource "${uri}". resources/list names them; memo://element/{id} reads one element.`);
    }
    return { contents: [{ uri, mimeType: 'application/json', text: JSON.stringify(value, null, 2) }] };
}
