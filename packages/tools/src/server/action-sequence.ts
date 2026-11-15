import type { MemoModelDTO } from '../model/semantic.js';
import { functionalFlowSteps } from '../model/functional-work.js';
import { outlineNodes, bodyMembers, type SourceOutline } from '../authoring/source-outline.js';
import { appendMembers } from './source-members.js';

/** Reorder native action members while retaining their declarations, parameters and local evidence. */
export function rewriteActionSequence(source: string, outline: SourceOutline, model: MemoModelDTO, actionId: string, requested: readonly string[], added?: { id: string; name: string; declaration: string }): string {
    const current = functionalFlowSteps(model, actionId);
    if (current.branching) throw new Error('This scenario contains branching or cyclic behavior. Use its diagram editor.');
    const node = [...outlineNodes(outline)].find(node => node.key === actionId);
    if (!node) throw new Error('The scenario source could not be located.');
    const members = bodyMembers(node);
    const successions = members.filter(member => member.metaclass === 'SuccessionAsUsage');
    if (members.some(member => /Transition|Fork|Join|Decision|Merge/.test(member.metaclass)) || successions.some(member => !/^\s*(?:succession\s+)?first\s+[\w:.']+\s+then\s+[\w:.']+\s*;\s*$/.test(source.slice(member.start, member.end)))) throw new Error('Use the diagram editor to preserve this scenario’s guarded or named transitions.');
    const stepNodes = current.steps.map(({ step }) => { const member = members.find(member => member.key === step.id); if (!member?.name) throw new Error('A step source could not be located.'); return member; });
    if (new Set(requested).size !== requested.length || requested.some(id => id !== added?.id && !stepNodes.some(member => member.key === id))) throw new Error('The scenario steps changed; reload before editing.');
    const declarations = requested.map(id => id === added?.id ? added.declaration : source.slice(stepNodes.find(member => member.key === id)!.start, stepNodes.find(member => member.key === id)!.end));
    const names = requested.map(id => id === added?.id ? added.name : stepNodes.find(member => member.key === id)!.name!);
    const ordering = names.length ? ['start', ...names].map((from, index) => `first ${from} then ${[...names, 'done'][index]};`).join('\n') : '';
    const block = [...declarations, ordering].filter(Boolean).join('\n');
    if (!node.body) {
        const proposed = appendMembers(source, outline, new Map([[actionId, block]]));
        if (proposed === undefined) throw new Error('The scenario cannot hold steps.'); return proposed;
    }
    let body = source.slice(node.body.open, node.body.close);
    for (const cut of [...stepNodes, ...successions].sort((a, b) => b.start - a.start)) body = body.slice(0, cut.start - node.body.open) + body.slice(cut.end - node.body.open);
    return source.slice(0, node.body.open) + body.trimEnd() + '\n' + block.split('\n').map(line => `    ${line}`).join('\n') + '\n' + source.slice(node.body.close);
}
