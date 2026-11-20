import type { MemoModelDTO } from './semantic.js';
import { functionalScope, functionalScopes } from './functional-scope.js';
import { canonicalFunctionId } from './functional-work.js';
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

/**
 * Every function tree in the model: each top system function (one no other function contains), its size,
 * its depth, and the systems whose functions it already is. A tree no system has is what a system with no
 * functions can take as its own.
 */
export function functionTrees(model: MemoModelDTO) {
    const registry = indexKinds(model.registries?.kinds ?? []);
    const scopes = functionalScopes(model);
    const systemFunctions = [...scopes.functions].filter(id => {
        const element = model.elements[id];
        return !!element && !element.isDefinition && element.attributes?.isDefinition !== 'true'
            && kindConformsTo(element.kind, 'SystemFunction', registry) && canonicalFunctionId(model, id) === id;
    });
    const children = new Map<string, string[]>();
    for (const id of systemFunctions) for (const parent of scopes.parents.get(id) ?? []) children.set(parent, [...(children.get(parent) ?? []), id]);
    const measure = (id: string) => {
        let size = 0, depth = 0; const seen = new Set<string>(); const queue: [string, number][] = [[id, 1]];
        for (let i = 0; i < queue.length; i++) {
            const [next, level] = queue[i]; if (seen.has(next)) continue; seen.add(next);
            size++; depth = Math.max(depth, level);
            for (const child of children.get(next) ?? []) queue.push([child, level + 1]);
        }
        return { size, depth };
    };
    return systemFunctions.filter(id => !(scopes.parents.get(id)?.size)).map(id => ({
        root: model.elements[id], ...measure(id), systems: [...(scopes.roots.get(id) ?? [])],
    }));
}
