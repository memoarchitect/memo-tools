import type { MemoModelDTO } from './semantic.js';
import { functionalScope } from './functional-scope.js';
import { indexKinds, kindConformsTo } from './relationship-legality.js';

/** The distinguished root and existing top-level responsibilities, without inventing ownership. */
export function functionalStructure(model: MemoModelDTO, workspace: string) {
    const registry = indexKinds(model.registries?.kinds ?? []);
    const isFunction = (id: string, base: string) => !!model.elements[id] && kindConformsTo(model.elements[id].kind, base, registry);
    const scope = functionalScope(model, workspace);
    const local = new Set([...scope.members].filter(id => scope.roots.get(id)?.size === 1));
    const roots = model.relationships.filter(edge => edge.type === 'functionalRoot' && edge.sourceId === workspace);
    const candidates = Object.values(model.elements).filter(element => isFunction(element.id, 'SystemFunction')
        && element.isDefinition !== true && element.attributes?.isDefinition !== 'true' && local.has(element.id)
        && ![...(scope.parents.get(element.id) ?? [])].some(parent => local.has(parent)));
    const root = roots.length === 1 ? model.elements[roots[0].targetId] : undefined;
    const adoptable = candidates.length === 1 && !model.relationships.some(edge => edge.type === 'functionalRoot' && edge.targetId === candidates[0].id && edge.sourceId !== workspace) ? candidates[0] : undefined;
    return { roots, root, candidates, adoptable, home: root ?? adoptable ?? model.elements[workspace] };
}
