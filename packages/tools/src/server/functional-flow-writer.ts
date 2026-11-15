import { readFileSync, realpathSync } from 'node:fs';
import { resolve, relative, sep } from 'node:path';
import type { MemoModelDTO } from '../model/semantic.js';
import { functionalCatalog, functionalFlowSteps, type FunctionalWriteContext } from '../model/functional-work.js';
import { functionalStructure } from '../model/functional-structure.js';
import { indexKinds, kindConformsTo } from '../model/relationship-legality.js';
import { outlineNodes, bodyMembers } from '../authoring/source-outline.js';
import type { OutlineSource } from '../authoring/outline-source.js';
import { elementPath } from '../serializer/element-reference.js';
import { appendMembers } from './source-members.js';
import { commitSource } from './persistor.js';

/** A flow owns performances of catalog functions; it never copies their declarations. */
export async function writeFunctionalFlow(projectRoot: string, model: MemoModelDTO, context: FunctionalWriteContext, name: string, outlines: OutlineSource, expectedFile: string): Promise<{ success: boolean; elementId?: string; filePath: string; sourceFiles?: string[]; error?: string }> {
    const fail = (error: string) => ({ success: false, filePath: expectedFile, error });
    try {
        const root = functionalStructure(model, context.workspace).root;
        if (!root) return fail('Set up the system parent function first.');
        const flow = context.flowId ? model.elements[context.flowId] : undefined;
        if (context.operation === 'update-flow' && !flow) return fail('Choose an existing functional flow.');
        if (flow && (flow.isDefinition || !kindConformsTo(flow.kind, 'FunctionalFlow', indexKinds(model.registries?.kinds ?? [])) || !functionalCatalog(model, context.workspace, 'FunctionalFlow').some(candidate => candidate.id === flow.id))) return fail('Choose a functional flow in this system.');
        const home = flow ?? root;
        if (home.file !== expectedFile || (home.provenance && !home.provenance.declaration.writable)) return fail('Reload the writable flow source before editing.');
        if (!flow && !name.trim()) return fail('Name the functional flow.');
        const requested = context.steps ?? [];
        if (!requested.length) return fail('Choose at least one system function.');
        const catalog = new Map(functionalCatalog(model, context.workspace).filter(fn => fn.id !== root.id).map(fn => [fn.id, fn]));
        if (requested.some(step => !catalog.has(step.functionId))) return fail('Every step must reference a system function in this system.');
        const absolute = realpathSync(resolve(projectRoot, home.file));
        const rel = relative(realpathSync(projectRoot), absolute);
        if (rel === '..' || rel.startsWith(`..${sep}`)) return fail('Flow source is outside the project.');
        const source = readFileSync(absolute, 'utf8');
        const outline = await outlines.outline(home.file, source);
        const stem = name.trim().replace(/[^a-zA-Z0-9_]/g, '_').replace(/^([^a-zA-Z_])/, '_$1') || 'functionalFlow';
        let flowName = stem;
        for (let suffix = 2; model.elements[`${root.id}::${flowName}`]; suffix++) flowName = `${stem}${suffix}`;
        const flowId = flow?.id ?? `${root.id}::${flowName}`;
        const current = flow ? functionalFlowSteps(model, flow.id) : undefined;
        if (current?.branching) return fail('This flow has branching or cyclic behavior. Use its full diagram editor to preserve that behavior.');
        const node = flow ? [...outlineNodes(outline)].find(node => node.key === flow.id) : undefined;
        if (flow && !node?.body) return fail('The flow body could not be located.');
        const members = node ? bodyMembers(node) : [];
        const stepNodes = new Map((current?.steps ?? []).map(({ step }) => [step.id, members.find(member => member.key === step.id)]));
        if (current?.steps.some(({ step }) => !stepNodes.get(step.id))) return fail('A flow step could not be located.');
        // Preserve richer behavior. Only plain, anonymous successions are safe to reorder here.
        const successions = members.filter(member => member.metaclass === 'SuccessionAsUsage');
        if (members.some(member => /Transition|Fork|Join|Decision|Merge/.test(member.metaclass)) || successions.some(member => !/^\s*(?:succession\s+)?first\s+[\w:.']+\s+then\s+[\w:.']+\s*;\s*$/.test(source.slice(member.start, member.end)))) return fail('This flow has guarded or named transitions. Use its full diagram editor.');
        const retained = new Set<string>();
        const usedNames = new Set(members.map(member => member.name).filter(Boolean));
        const declarations: string[] = [];
        const sequence: string[] = [];
        for (const input of requested) {
            if (input.stepId) {
                const existing = current?.steps.find(({ step }) => step.id === input.stepId);
                const oldNode = stepNodes.get(input.stepId);
                if (!existing || existing.functionId !== input.functionId || !oldNode?.name || retained.has(input.stepId)) return fail('A retained flow step changed. Reload the flow.');
                retained.add(input.stepId); sequence.push(oldNode.name);
                declarations.push(source.slice(oldNode.start, oldNode.end));
            } else {
                let next = 1; while (usedNames.has(`step${next}`)) next++;
                const stepName = `step${next}`; usedNames.add(stepName); sequence.push(stepName);
                const fn = catalog.get(input.functionId)!;
                declarations.push(`perform action ${stepName} : memo_architecture_functional_functions::SystemFunction :> ${elementPath(fn.id, model)} {\n    @memo_core_common::MemoIdentity { :>> label = ${JSON.stringify(fn.name)}; }\n}`);
            }
        }
        const ordering = ['start', ...sequence, 'done'].slice(0, -1).map((from, index) => `first ${from} then ${[...sequence, 'done'][index]};`).join('\n');
        const block = [...declarations, ordering].join('\n');
        let proposed: string | undefined;
        if (node?.body) {
            let body = source.slice(node.body.open, node.body.close);
            const cuts = [...stepNodes.values()].filter(member => !!member).concat(successions).sort((a, b) => b!.start - a!.start);
            for (const cut of cuts) body = body.slice(0, cut!.start - node.body.open) + body.slice(cut!.end - node.body.open);
            proposed = source.slice(0, node.body.open) + body.trimEnd() + '\n' + block.split('\n').map(line => `    ${line}`).join('\n') + '\n' + source.slice(node.body.close);
        } else {
            proposed = appendMembers(source, outline, new Map([[root.id, `action ${flowName} : memo_architecture_functional_functions::FunctionalFlow {\n    @memo_core_common::MemoIdentity { :>> label = ${JSON.stringify(name.trim())}; }\n${block.split('\n').map(line => `    ${line}`).join('\n')}\n}`]]));
        }
        if (proposed === undefined) return fail('The parent function could not be located.');
        const result = await commitSource(absolute, home.file, proposed, outlines, undefined, projectRoot, new Map([[absolute, source]]));
        return result.success ? { success: true, elementId: flowId, filePath: home.file, sourceFiles: [home.file] } : fail(result.error ?? 'The compiler refused the flow.');
    } catch (error) { return fail(error instanceof Error ? error.message : String(error)); }
}
