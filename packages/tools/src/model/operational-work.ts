import type { MemoModelDTO } from './semantic.js';
import { indexKinds, kindConformsTo } from './relationship-legality.js';
export type OperationalWorkLevel = 'clinical' | 'operational';
export interface OperationalWriteContext {
    operation: 'context' | 'use-case' | 'workflow' | 'scenario' | 'step' | 'reuse-step' | 'sequence' | 'include' | 'link-workflow' | 'refine' | 'realize-flow' | 'perform-function' | 'performer' | 'fields' | 'actor' | 'unlink';
    level: OperationalWorkLevel;
    workspace?: string | null;
    homeId?: string;
    subjectId?: string;
    useCaseId?: string;
    workflowId?: string;
    scenarioId?: string;
    parentStepId?: string;
    sourceId?: string;
    targetId?: string;
    performerId?: string;
    scenarioKind?: 'nominal' | 'alternate';
    fields?: Record<string, string>;
    stepIds?: string[];
    /** For `unlink`: which link of the use case to remove, its actor or an included use case. */
    relation?: 'participatesIn' | 'includesStep';
    relatedSourceHashes?: Record<string, string>;
}
const kindIndexes = new WeakMap<MemoModelDTO, ReturnType<typeof indexKinds>>();
function kindsOf(model: MemoModelDTO) { let index = kindIndexes.get(model); if (!index) { index = indexKinds(model.registries?.kinds ?? []); kindIndexes.set(model, index); } return index; }
export function operationalConforms(model: MemoModelDTO, id: string, kind: string): boolean {
    return !!model.elements[id] && kindConformsTo(model.elements[id].kind, kind, kindsOf(model));
}
export function operationalWorkLevel(model: MemoModelDTO, id: string): OperationalWorkLevel | undefined {
    const declared = model.operationalLevels?.[id]; if (declared) return declared;
    const seen = new Set<string>(); let at: string | undefined = id;
    while (at && !seen.has(at)) {
        seen.add(at);
        if (operationalConforms(model, at, 'ClinicalUseCase') || operationalConforms(model, at, 'ClinicalWorkflow')) return 'clinical';
        if (operationalConforms(model, at, 'OperationalUseCase') || operationalConforms(model, at, 'OperationalWorkflow')) return 'operational';
        const element: MemoModelDTO['elements'][string] | undefined = model.elements[at];
        at = element?.owner ?? element?.parentAction;
    }
    return undefined;
}
export function operationalCatalog(model: MemoModelDTO, kind: string, workspace: string | null = null) {
    const registry = kindsOf(model);
    return Object.values(model.elements).filter(element => !element.isDefinition && kindConformsTo(element.kind, kind, registry)
        && (!workspace || model.workspaceMembership?.membership[element.id]?.includes(workspace)));
}
export function operationalChildren(model: MemoModelDTO, id: string) {
    return Object.values(model.elements).filter(element => (element.owner ?? element.parentAction) === id);
}
export function includedUseCases(model: MemoModelDTO, id: string) {
    return model.relationships.filter(edge => edge.type === 'includesStep' && edge.sourceId === id)
        .flatMap(edge => operationalConforms(model, edge.targetId, 'UseCase') ? [model.elements[edge.targetId]] : []);
}
export function workflowCases(model: MemoModelDTO, id: string) {
    return model.relationships.filter(edge => edge.type === 'realizesUseCase' && edge.sourceId === id).map(edge => edge.targetId);
}
export function wouldIncludeCycle(model: MemoModelDTO, parent: string, child: string): boolean {
    const seen = new Set<string>(); const queue = [child];
    while (queue.length) { const id = queue.pop()!; if (id === parent) return true; if (seen.has(id)) continue; seen.add(id); queue.push(...includedUseCases(model, id).map(useCase => useCase.id)); }
    return false;
}
