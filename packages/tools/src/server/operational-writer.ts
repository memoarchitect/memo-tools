import { readFileSync, realpathSync } from 'node:fs';
import { resolve, relative, sep } from 'node:path';
import type { MemoModelDTO } from '../model/semantic.js';
import { operationalConforms as conforms, operationalWorkLevel, wouldIncludeCycle, type OperationalWriteContext } from '../model/operational-work.js';
import { functionalCatalog, functionalFlowsInScope, functionalFlowSteps } from '../model/functional-work.js';
import { layoutBlindRevision } from '../model/view-layout-block.js';
import { bodyMembers, outlineNodes, type OutlineNode, type SourceOutline } from '../authoring/source-outline.js';
import type { OutlineSource } from '../authoring/outline-source.js';
import { elementPath } from '../serializer/element-reference.js';
import { appendMembers } from './source-members.js';
import { rewriteActionSequence } from './action-sequence.js';
import { commitSource } from './persistor.js';
type Result = { success: boolean; elementId?: string; filePath: string; sourceFiles?: string[]; error?: string };
const fieldsFor: Record<string, readonly string[]> = {
    'use-case': ['goalStatement', 'trigger', 'preCondition', 'successOutcome', 'failureOutcome', 'postCondition'],
    workflow: [], scenario: ['trigger', 'preCondition', 'postCondition', 'expectedResult', 'pathSummary'], step: ['taskGoal', 'trigger', 'preCondition', 'postCondition'], context: ['responsibility', 'operationalDomain'],
};

/** Native operational ownership and traces, in one compiler-checked source transaction. */
export async function writeOperationalWork(projectRoot: string, model: MemoModelDTO, context: OperationalWriteContext, name: string, outlines: OutlineSource, expectedFile: string): Promise<Result> {
    const fail = (error: string): Result => ({ success: false, filePath: expectedFile, error });
    try {
        if (!['clinical', 'operational'].includes(context.level)) return fail('Choose clinical or operational work.');
        const op = context.operation; const prefix = context.level === 'clinical' ? 'Clinical' : 'Operational';
        const useCase = context.useCaseId ? model.elements[context.useCaseId] : undefined;
        const workflow = context.workflowId ? model.elements[context.workflowId] : undefined;
        const scenario = context.scenarioId ? model.elements[context.scenarioId] : undefined;
        const sourceElement = context.sourceId ? model.elements[context.sourceId] : undefined;
        const target = context.targetId ? model.elements[context.targetId] : undefined;
        const parentStep = context.parentStepId ? model.elements[context.parentStepId] : undefined;
        const subject = context.subjectId ? model.elements[context.subjectId] : undefined;
        const system = context.workspace ? model.elements[context.workspace] : undefined;
        const inScope = (id: string) => !context.workspace || model.workspaceMembership?.membership[id]?.includes(context.workspace) || id === context.workspace;
        const atLevel = (id: string, kind: string) => conforms(model, id, kind) && !model.elements[id].isDefinition && operationalWorkLevel(model, id) === context.level;
        if (context.level === 'operational' && !model.workspaceMembership?.workspaces.some(root => root.root === context.workspace)) return fail('Choose one system or system of systems first.');
        if (useCase && (!atLevel(useCase.id, `${prefix}UseCase`) || context.level === 'operational' && !inScope(useCase.id))) return fail('Choose a use case at this level and in the current system.');
        if (workflow && (!atLevel(workflow.id, `${prefix}Workflow`) || context.level === 'operational' && !inScope(workflow.id))) return fail('Choose a workflow at this level and in the current system.');
        if (scenario && (!atLevel(scenario.id, 'OperativeScenario') || context.level === 'operational' && !inScope(scenario.id))) return fail('Choose a scenario owned by a workflow at this level.');
        if (parentStep && (!atLevel(parentStep.id, 'OperativeAction') || context.level === 'operational' && !inScope(parentStep.id))) return fail('Choose an activity in this workflow.');
        const home = sourceElement ?? parentStep ?? scenario ?? workflow ?? useCase ?? (subject?.file === expectedFile ? subject : undefined) ?? model.elements[context.homeId ?? ''] ?? system;
        if (!home?.package || home.file !== expectedFile || home.provenance?.declaration.writable === false) return fail('Choose a writable source in this project.');
        if (['context', 'use-case', 'workflow', 'scenario', 'step'].includes(op) && !name.trim()) return fail('Give the new work a name.');
        const edits = new Map<string, { source: string; outline: SourceOutline; members: Map<string, string>; replacement?: string }>();
        const fileEdit = async (file: string) => {
            if (edits.has(file)) return edits.get(file)!;
            const absolute = realpathSync(resolve(projectRoot, file)); const rel = relative(realpathSync(projectRoot), absolute);
            if (rel === '..' || rel.startsWith(`..${sep}`)) throw new Error('The source is outside this project.');
            const source = readFileSync(absolute, 'utf8');
            if (file !== expectedFile && (!context.relatedSourceHashes?.[file] || layoutBlindRevision(source) !== context.relatedSourceHashes[file])) throw new Error('A related source changed; reload before linking it.');
            const edit: { source: string; outline: SourceOutline; members: Map<string, string>; replacement?: string } = { source, outline: await outlines.outline(file, source), members: new Map<string, string>() }; edits.set(file, edit); return edit;
        };
        const edit = await fileEdit(home.file);
        const add = async (file: string, container: string, text: string) => { const entry = await fileEdit(file); entry.members.set(container, [entry.members.get(container), text].filter(Boolean).join('\n')); };
        const unique = (container: string, requested: string) => { const stem = requested.replace(/[^a-zA-Z0-9_]/g, '_').replace(/^([^a-zA-Z_])/, '_$1') || 'work'; let next = stem; for (let i = 2; model.elements[`${container}::${next}`]; i++) next = `${stem}${i}`; return next; };
        const attributes = op === 'fields' ? '' : Object.entries(context.fields ?? {}).map(([key, value]) => { if (!fieldsFor[op]?.includes(key)) throw new Error(`This task cannot write ${key}.`); return `attribute :>> ${key} = ${JSON.stringify(value)};`; }).join('\n');
        const identity = `@memo_core_common::MemoIdentity { :>> label = ${JSON.stringify(name.trim())}; }`;
        const refinement = (from: string, to: string) => `#ModelingMetadata::Refinement dependency from ${from} to ${to};`;
        const featuring = (id: string) => { let owner = model.elements[id]?.owner ?? model.elements[id]?.parentAction; const seen = new Set<string>(); while (owner && !seen.has(owner)) { seen.add(owner); const element = model.elements[owner]; if (!element) break; if (element.isDefinition) return element; owner = element.owner ?? element.parentAction; } return undefined; };
        const linkWorkflow = async (from: string, to: string) => {
            if (model.relationships.some(edge => edge.type === 'realizesUseCase' && edge.sourceId === from && edge.targetId === to)) return;
            const owner = featuring(from) ?? featuring(to); const path = (id: string) => { const qualified = elementPath(id, model); return owner && qualified.startsWith(`${owner.id}::`) ? qualified.slice(owner.id.length + 2) : qualified; };
            if (owner?.provenance?.declaration.writable === false) throw new Error('The owning definition is read-only.');
            await add(owner?.file ?? home.file, owner?.id ?? home.package!, `connection : memo_architecture_operational_workflows::RealizesUseCase connect ${path(from)} to ${path(to)};`);
        };
        let resultId = home.id;
        if (op === 'context') {
            const declared = unique(home.package, name.trim()); resultId = `${home.package}::${declared}`;
            await add(home.file, home.package, `part ${declared} : memo_architecture_operational_structure::OperationalEntity {\n${identity}\n${attributes}\n}`);
        } else if (op === 'use-case') {
            if (!subject || !conforms(model, subject.id, context.level === 'clinical' ? 'OperationalEntity' : 'System') && !conforms(model, subject.id, context.level === 'clinical' ? 'OperationalEntity' : 'SystemOfSystems')) return fail('Choose a subject appropriate for this level.');
            if (context.level === 'operational' && !useCase && subject.id !== context.workspace && model.workspaceMembership?.definitionOf[subject.id] !== context.workspace) return fail('Create system goals in their own workspace, or explicitly include a child-system use case.');
            const declared = unique(home.package, name.trim()); resultId = `${home.package}::${declared}`;
            await add(home.file, home.package, `use case ${declared} : memo_architecture_operational_use_cases::${prefix}UseCase {\n${identity}\n${attributes}\nattribute :>> useCaseKind = memo_architecture_operational_use_cases::UseCaseKind::care;\nsubject :>> supportingSystem ${subject.isDefinition ? ':' : '='} ${elementPath(subject.id, model)};\n}`);
            if (useCase) await add(home.file, useCase.id, `include ${resultId};`);
        } else if (op === 'workflow') {
            if (!useCase) return fail('Choose the use case this workflow realizes.');
            const declared = unique(home.package, name.trim()); resultId = `${home.package}::${declared}`;
            await add(home.file, home.package, `part ${declared} : memo_architecture_operational_workflows::${prefix}Workflow {\n${identity}\n${attributes}\n}`);
            await linkWorkflow(resultId, useCase.id);
        } else if (op === 'scenario') {
            if (!workflow || !['nominal', 'alternate'].includes(context.scenarioKind ?? 'nominal')) return fail('Choose a workflow and a nominal or alternate path.');
            const declared = unique(workflow.id, name.trim()); resultId = `${workflow.id}::${declared}`;
            await add(home.file, workflow.id, `action ${declared} : memo_architecture_operational_scenarios::OperativeScenario {\n${identity}\n${attributes}\nattribute :>> scenarioKind = memo_architecture_operational_scenarios::ScenarioKind::${context.scenarioKind ?? 'nominal'};\n}`);
        } else if (op === 'step' || op === 'reuse-step') {
            const parent = parentStep ?? scenario; if (!parent) return fail('Choose a scenario or one of its activities.');
            if (op === 'reuse-step' && (!target || !conforms(model, target.id, 'OperativeAction') || operationalWorkLevel(model, target.id) !== context.level)) return fail('Choose an existing step at this level.');
            if (op === 'reuse-step') {
                const seen = new Set<string>(); const queue = [target!.id];
                while (queue.length) { const id = queue.pop()!; if (id === parent.id) return fail('This reuse would make the step perform itself recursively.'); if (seen.has(id)) continue; seen.add(id);
                    queue.push(...Object.values(model.elements).filter(element => (element.owner ?? element.parentAction) === id).map(element => element.id), ...model.relationships.filter(edge => edge.sourceId === id && ['performs', 'subsets'].includes(edge.type) && conforms(model, edge.targetId, 'OperativeAction')).map(edge => edge.targetId)); }
            }
            const declared = unique(parent.id, op === 'reuse-step' ? target!.name : name.trim()); resultId = `${parent.id}::${declared}`;
            const declaration = op === 'reuse-step' ? `perform action ${declared} : memo_architecture_operational_activities::OperativeAction :> ${elementPath(target!.id, model)} { ${identity.replace(JSON.stringify(name.trim()), JSON.stringify(target!.name))} }`
                : `action ${declared} : memo_architecture_operational_activities::OperativeAction {\n${identity}\n${attributes}\n}`;
            edit.replacement = rewriteActionSequence(edit.source, edit.outline, model, parent.id, [...functionalFlowSteps(model, parent.id).steps.map(item => item.step.id), resultId], { id: resultId, name: declared, declaration });
        } else if (op === 'sequence') {
            if (!scenario && !parentStep) return fail('Choose a scenario to edit its sequence.');
            edit.replacement = rewriteActionSequence(edit.source, edit.outline, model, (parentStep ?? scenario)!.id, context.stepIds ?? []);
        } else if (op === 'include') {
            if (!sourceElement || !target || !atLevel(sourceElement.id, `${prefix}UseCase`) || !atLevel(target.id, `${prefix}UseCase`) || context.level === 'operational' && !inScope(sourceElement.id)) return fail('Choose two use cases at the same level.');
            if (wouldIncludeCycle(model, sourceElement.id, target.id)) return fail('This inclusion would create a cycle.');
            if (!model.relationships.some(edge => edge.type === 'includesStep' && edge.sourceId === sourceElement.id && edge.targetId === target.id)) await add(home.file, sourceElement.id, `include ${target.id};`);
        } else if (op === 'link-workflow') {
            if (!useCase || !workflow) return fail('Choose a workflow and a matching use case.');
            await linkWorkflow(workflow.id, useCase.id); resultId = workflow.id;
        } else if (op === 'refine') {
            const family = ['UseCase', 'Workflow', 'OperativeScenario', 'OperativeAction'].find(kind => sourceElement && target && conforms(model, sourceElement.id, kind) && conforms(model, target.id, kind));
            if (context.level !== 'operational' || !family || !sourceElement || !target || operationalWorkLevel(model, sourceElement.id) !== 'operational' || operationalWorkLevel(model, target.id) !== 'clinical' || !inScope(sourceElement.id)) return fail('Choose matching system and clinical work to refine.');
            if (!model.relationships.some(edge => edge.type === 'realizes' && edge.sourceId === sourceElement.id && edge.targetId === target.id)) await add(home.file, home.package, refinement(sourceElement.id, target.id));
        } else if (op === 'realize-flow') {
            if (context.level !== 'operational' || !sourceElement || !target || !atLevel(sourceElement.id, 'OperativeAction') && !atLevel(sourceElement.id, 'OperativeScenario') || !inScope(sourceElement.id) || !functionalFlowsInScope(model, context.workspace ?? null).some(flow => flow.id === target.id)) return fail('Choose a functional flow and a system activity, or explicitly a whole system scenario.');
            if (!model.relationships.some(edge => edge.type === 'realizes' && edge.sourceId === target.id && edge.targetId === sourceElement.id)) await add(home.file, home.package, refinement(target.id, sourceElement.id));
        } else if (op === 'perform-function') {
            if (context.level !== 'operational' || !sourceElement || !atLevel(sourceElement.id, 'OperativeAction') || !inScope(sourceElement.id) || !target || !functionalCatalog(model, context.workspace ?? null).some(fn => fn.id === target.id)) return fail('Choose a system activity and a canonical system function.');
            if (!model.relationships.some(edge => edge.type === 'performs' && edge.sourceId === sourceElement.id && edge.targetId === target.id)) await add(home.file, sourceElement.id, `perform ${elementPath(target.id, model)};`);
        } else if (op === 'performer') {
            const performer = model.elements[context.performerId ?? ''];
            if (!sourceElement || !atLevel(sourceElement.id, 'OperativeAction') || context.level === 'operational' && !inScope(sourceElement.id) || !performer || !['User', 'OperationalEntity', 'System', 'SystemOfSystems'].some(kind => conforms(model, performer.id, kind)) || context.level === 'clinical' && (conforms(model, performer.id, 'System') || conforms(model, performer.id, 'SystemOfSystems'))) return fail('Choose an appropriate performer for this step.');
            if (performer.provenance?.declaration.writable === false) return fail('The performer source is read-only.');
            if (!model.relationships.some(edge => edge.type === 'performs' && edge.sourceId === performer.id && edge.targetId === sourceElement.id)) await add(performer.file, performer.id, `perform ${elementPath(sourceElement.id, model)};`);
        } else if (op === 'actor') {
            if (!sourceElement || !atLevel(sourceElement.id, `${prefix}UseCase`) || context.level === 'operational' && !inScope(sourceElement.id)) return fail('Choose a use case at this level.');
            if (!target || target.isDefinition || !conforms(model, target.id, 'OperationalParticipant')) return fail('Choose an actor: a user or an actor in the model.');
            if (!model.relationships.some(edge => edge.type === 'participatesIn' && edge.sourceId === target.id && edge.targetId === sourceElement.id)) {
                await add(home.file, sourceElement.id, `actor ${unique(sourceElement.id, target.id.split('::').at(-1)!)} = ${elementPath(target.id, model)};`);
            }
        } else if (op === 'unlink') {
            // Remove one actor or include line from the use case's own body. A link declared elsewhere is not guessed at.
            if (!sourceElement || !target || !atLevel(sourceElement.id, `${prefix}UseCase`) || context.level === 'operational' && !inScope(sourceElement.id)) return fail('Choose a use case at this level.');
            const keyword = context.relation === 'participatesIn' ? 'actor' : context.relation === 'includesStep' ? 'include' : undefined;
            if (!keyword) return fail('Choose an actor or an included use case to remove.');
            const node = [...outlineNodes(edit.outline)].find(candidate => candidate.key === sourceElement.id);
            const names = new Set([elementPath(target.id, model), target.id, target.id.split('::').at(-1)!]);
            const pattern = keyword === 'actor' ? /^actor\b[^=;{]*=\s*([^;\s{]+)/ : /^include\s+(?:use\s+case\s+)?([^;\s{]+)/;
            const line = node ? bodyMembers(node).find(member => {
                // The member's span starts after a membership keyword such as `actor`, so its whole line is matched.
                const reference = pattern.exec(edit.source.slice(edit.source.lastIndexOf('\n', member.start - 1) + 1, member.end).trim())?.[1];
                return !!reference && (names.has(reference) || names.has(reference.split(/::|\./).at(-1)!));
            }) : undefined;
            if (!line) return fail('That link is not written in this use case. Remove it where it is declared.');
            const start = edit.source.lastIndexOf('\n', line.start - 1) + 1; const end = edit.source.indexOf('\n', line.end);
            edit.replacement = edit.source.slice(0, start) + edit.source.slice(end < 0 ? line.end : end + 1);
        } else if (op === 'fields') {
            // Edit a use case's, a scenario's or a step's own fields in place: each named attribute line and the doc
            // comment is replaced, added or removed, and nothing else in the declaration is touched.
            const element = sourceElement;
            const kind = element && atLevel(element.id, `${prefix}UseCase`) ? 'use-case' : element && atLevel(element.id, 'OperativeScenario') ? 'scenario' : element && atLevel(element.id, 'OperativeAction') ? 'step' : undefined;
            if (!element || !kind || context.level === 'operational' && !inScope(element.id)) return fail('Choose a use case, a scenario or a step at this level.');
            const requested = Object.entries(context.fields ?? {});
            if (!requested.length) return fail('Nothing to save.');
            const unknown = requested.find(([key]) => key !== 'doc' && !fieldsFor[kind].includes(key)); if (unknown) return fail(`A ${kind.replace('-', ' ')} has no field ${unknown[0]}.`);
            const node = [...outlineNodes(edit.outline)].find(candidate => candidate.key === element.id);
            if (!node?.body) return fail('The source of this work could not be located.');
            edit.replacement = replaceFields(edit.source, node, requested);
        } else return fail('This operational action is not supported.');
        const proposed = new Map<string, string>();
        for (const [file, entry] of edits) { const text = entry.replacement ?? appendMembers(entry.source, entry.outline, entry.members); if (text === undefined) return fail('A source container could not be located.'); proposed.set(file, text); }
        const absolute = resolve(projectRoot, home.file);
        const committed = await commitSource(absolute, home.file, proposed.get(home.file)!, outlines, new Map([...proposed].filter(([file]) => file !== home.file).map(([file, text]) => [resolve(projectRoot, file), text])), projectRoot, new Map([...edits].map(([file, entry]) => [resolve(projectRoot, file), entry.source])));
        return committed.success ? { success: true, elementId: resultId, filePath: home.file, sourceFiles: [...proposed.keys()] } : fail(committed.error ?? 'The compiler refused the operational edit.');
    } catch (error) { return fail(error instanceof Error ? error.message : String(error)); }
}

/** A use case's, scenario's or step's fields rewritten in its own body: the lines that state them are replaced or removed, new ones follow its identity. */
function replaceFields(source: string, node: OutlineNode, fields: readonly [string, string][]): string {
    const members = bodyMembers(node);
    const lineStart = (offset: number) => source.lastIndexOf('\n', offset - 1) + 1;
    const indent = members.length ? source.slice(lineStart(members[0].start), members[0].start) : `${source.slice(lineStart(node.start), node.start).replace(/\S.*$/, '')}    `;
    const edits: { start: number; end: number; text: string }[] = [];
    const added: string[] = [];
    for (const [key, value] of fields) {
        const text = !value.trim() ? '' : key === 'doc' ? `doc /* ${value.replace(/\*\//g, '* /')} */` : `attribute :>> ${key} = ${JSON.stringify(value)};`;
        const existing = members.find(member => key === 'doc' ? member.role === 'doc' : member.role === 'attribute' && (member.name === key || member.key.endsWith(`::${key}`)));
        if (existing && text) edits.push({ start: existing.start, end: existing.end, text });
        else if (existing) {
            const end = source.indexOf('\n', existing.end);
            edits.push({ start: lineStart(existing.start), end: end < 0 ? existing.end : end + 1, text: '' });
        } else if (text) added.push(text);
    }
    if (added.length) {
        const after = [...members].reverse().find(member => member.role === 'metadata' || member.role === 'attribute' || member.role === 'doc');
        const at = after ? after.end : node.body!.open;
        edits.push({ start: at, end: at, text: added.map(line => `\n${indent}${line}`).join('') });
    }
    return edits.sort((a, b) => b.start - a.start).reduce((text, change) => text.slice(0, change.start) + change.text + text.slice(change.end), source);
}
