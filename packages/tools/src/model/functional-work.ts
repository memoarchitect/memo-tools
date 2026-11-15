import type { MemoModelDTO } from './semantic.js';
import { indexKinds, kindConformsTo } from './relationship-legality.js';
import { functionalScope } from './functional-scope.js';

export interface FunctionalStepInput { stepId?: string; functionId: string }
export interface FunctionalWriteContext {
    workspace: string;
    operation?: 'root' | 'system-function' | 'component-function' | 'link-realization' | 'flow' | 'update-flow';
    parentFunctionId?: string;
    systemFunctionId?: string;
    componentFunctionId?: string;
    componentId?: string;
    componentSourceHash?: string;
    flowId?: string;
    steps?: FunctionalStepInput[];
}
export function canonicalFunctionId(model: MemoModelDTO, id: string): string {
    const visited = new Set<string>();
    while (!visited.has(id)) {
        visited.add(id);
        const target = model.relationships.find(edge => edge.type === 'subsets' && edge.sourceId === id)?.targetId;
        if (!target || !model.elements[target]) break;
        id = target;
    }
    return id;
}
export function functionalCatalog(model: MemoModelDTO, workspace: string | null, kind = 'SystemFunction') {
    const registry = indexKinds(model.registries?.kinds ?? []);
    const scope = workspace ? functionalScope(model, workspace) : undefined;
    const insideFlow = (id: string) => {
        const seen = new Set<string>();
        let owner = model.elements[id]?.parentAction ?? model.elements[id]?.owner;
        while (owner && !seen.has(owner)) {
            seen.add(owner); const parent = model.elements[owner]; if (!parent) break;
            if (kindConformsTo(parent.kind, 'FunctionalFlow', registry) || kindConformsTo(parent.kind, 'OperativeScenario', registry)) return true;
            owner = parent.parentAction ?? parent.owner;
        }
        return false;
    };
    const belongs = (id: string) => {
        if (!scope || scope.members.has(id)) return true;
        if (kindConformsTo(model.elements[id]?.kind ?? '', 'MemoFunction', registry)) return false;
        const seen = new Set<string>();
        let owner: string | undefined = id;
        while (owner && !seen.has(owner)) {
            seen.add(owner); if (scope.members.has(owner)) return true;
            const element: MemoModelDTO['elements'][string] | undefined = model.elements[owner]; owner = element?.parentAction ?? element?.owner;
        }
        return !!model.workspaceMembership?.membership[id]?.includes(workspace!);
    };
    return Object.values(model.elements).filter(element => !element.isDefinition
        && kindConformsTo(element.kind, kind, registry) && belongs(element.id)
        && canonicalFunctionId(model, element.id) === element.id
        && !insideFlow(element.id));
}
export function functionalFlowSteps(model: MemoModelDTO, flowId: string) {
    const steps = Object.values(model.elements).filter(element => (element.parentAction ?? element.owner) === flowId && element.construct === 'action'
        && !['InitialNodeUsage', 'ActionFinalNodeUsage', 'ForkNode', 'JoinNode', 'DecisionNode', 'MergeNode'].includes(element.kind));
    const ids = new Set(steps.map(step => step.id));
    const edges = model.relationships.filter(edge => edge.type === 'succession' && ids.has(edge.sourceId) && ids.has(edge.targetId));
    const branching = model.relationships.some(edge => edge.type === 'succession' && (ids.has(edge.sourceId) || ids.has(edge.targetId)) && edge.sourceEnd?.startsWith('[')) || [...ids].some(id => edges.filter(edge => edge.sourceId === id).length > 1 || edges.filter(edge => edge.targetId === id).length > 1)
        || Object.values(model.elements).some(element => (element.parentAction ?? element.owner) === flowId && /Fork|Join|Decision|Merge/.test(element.kind));
    const ordered: typeof steps = []; const remaining = new Map(steps.map(step => [step.id, step]));
    let next = steps.find(step => !edges.some(edge => edge.targetId === step.id));
    while (next && remaining.has(next.id)) {
        ordered.push(next); remaining.delete(next.id);
        next = remaining.get(edges.find(edge => edge.sourceId === next!.id)?.targetId ?? '');
    }
    const cyclic = remaining.size > 0 && edges.length > 0;
    ordered.push(...remaining.values());
    return { branching: branching || cyclic, steps: ordered.map(step => ({ step, functionId: canonicalFunctionId(model, step.id) !== step.id ? canonicalFunctionId(model, step.id) : undefined })) };
}
export function realizingFunctions(model: MemoModelDTO, systemFunctionId: string, implementationKind = 'ComponentFunction') {
    const registry = indexKinds(model.registries?.kinds ?? []);
    return model.relationships.filter(edge => edge.type === 'realizes' && edge.targetId === systemFunctionId)
        .flatMap(edge => { const element = model.elements[edge.sourceId]; return element && kindConformsTo(element.kind, implementationKind, registry) ? [{ element,
            components: model.relationships.filter(allocation => allocation.type === 'allocatedTo' && allocation.sourceId === element.id).flatMap(allocation => model.elements[allocation.targetId] ? [model.elements[allocation.targetId]] : []) }] : []; });
}
