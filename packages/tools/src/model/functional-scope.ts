import type { MemoModelDTO } from './semantic.js';
import { indexKinds, kindConformsTo } from './relationship-legality.js';

interface FunctionalScopes {
    functions: Set<string>;
    parents: Map<string, Set<string>>;
    owners: Map<string, Set<string>>;
    roots: Map<string, Set<string>>;
}
const cache = new WeakMap<MemoModelDTO, FunctionalScopes>();

/** Functional allocation overrides inherited allocation; general workspace closure remains unchanged. */
export function functionalScopes(model: MemoModelDTO): FunctionalScopes {
    const cached = cache.get(model); if (cached) return cached;
    const registry = indexKinds(model.registries?.kinds ?? []);
    const functions = new Set(Object.values(model.elements).filter(element => kindConformsTo(element.kind, 'MemoFunction', registry)).map(element => element.id));
    if (!functions.size) {
        const empty = { functions, parents: new Map<string, Set<string>>(), owners: new Map<string, Set<string>>(), roots: new Map<string, Set<string>>() };
        cache.set(model, empty); return empty;
    }
    const workspaces = model.workspaceMembership?.workspaces ?? [];
    const systemRoots = new Set(workspaces.map(workspace => workspace.root));
    const definitionOf = model.workspaceMembership?.definitionOf ?? {};
    const children = new Map<string, Set<string>>();
    const owners = new Map<string, Set<string>>();
    const link = (parent: string, child: string) => {
        if (!children.has(parent)) children.set(parent, new Set()); children.get(parent)!.add(child);
        if (!owners.has(child)) owners.set(child, new Set()); owners.get(child)!.add(parent);
    };
    for (const element of Object.values(model.elements)) if (element.owner ?? element.parentAction) link((element.owner ?? element.parentAction)!, element.id);
    for (const edge of model.relationships) if (edge.type === 'composes') link(edge.sourceId, edge.targetId);
    const structural = new Map<string, Set<string>>();
    for (const workspace of workspaces) {
        const seen = new Set<string>(); const queue = [workspace.root, ...Object.keys(definitionOf).filter(id => definitionOf[id] === workspace.root)];
        for (let i = 0; i < queue.length; i++) {
            const id = queue[i]; if (seen.has(id) || !model.elements[id]) continue;
            seen.add(id);
            if (!structural.has(id)) structural.set(id, new Set()); structural.get(id)!.add(workspace.root);
            queue.push(...(children.get(id) ?? []));
            const type = definitionOf[id];
            if (type && (!systemRoots.has(type) || type === workspace.root)) queue.push(type);
        }
    }
    const allocationRoots = (target: string) => {
        // A system usage means that system, even when another system of systems owns the usage.
        if (systemRoots.has(target)) return new Set([target]);
        if (systemRoots.has(definitionOf[target])) return new Set([definitionOf[target]]);
        return structural.get(target) ?? new Set<string>();
    };
    const explicit = new Map<string, Set<string>>();
    for (const edge of model.relationships) {
        const id = edge.type === 'allocatedTo' ? edge.sourceId : edge.type === 'functionalRoot' ? edge.targetId : undefined;
        if (!id || !functions.has(id)) continue;
        if (!explicit.has(id)) explicit.set(id, new Set());
        for (const root of edge.type === 'functionalRoot' ? [edge.sourceId] : allocationRoots(edge.targetId)) explicit.get(id)!.add(root);
    }
    const parents = new Map<string, Set<string>>();
    for (const id of functions) {
        const found = new Set<string>(); const seen = new Set<string>(); const queue = [...(owners.get(id) ?? [])];
        for (let i = 0; i < queue.length; i++) {
            const parent = queue[i]; if (seen.has(parent)) continue; seen.add(parent);
            if (functions.has(parent)) found.add(parent); else queue.push(...(owners.get(parent) ?? []));
        }
        parents.set(id, found);
    }
    const roots = new Map<string, Set<string>>();
    for (const id of functions) roots.set(id, new Set(explicit.get(id) ?? (!parents.get(id)!.size ? structural.get(id) ?? model.workspaceMembership?.membership[id] ?? [] : [])));
    // A fixed point handles multiple parents and cycles without recursive overflow.
    let changed = true;
    while (changed) {
        changed = false;
        for (const id of functions) {
            if (explicit.has(id)) continue;
            for (const parent of parents.get(id) ?? []) for (const root of roots.get(parent) ?? []) {
                if (!roots.get(id)!.has(root)) { roots.get(id)!.add(root); changed = true; }
            }
        }
    }
    const answer = { functions, parents, owners, roots }; cache.set(model, answer); return answer;
}

export function functionalScope(model: MemoModelDTO, workspace: string) {
    const scopes = functionalScopes(model);
    const members = new Set([...scopes.functions].filter(id => scopes.roots.get(id)?.has(workspace)));
    const shared = new Set([...members].filter(id => (scopes.roots.get(id)?.size ?? 0) > 1));
    const context = new Set<string>(); const queue = [...members];
    const visited = new Set(queue);
    for (let i = 0; i < queue.length; i++) for (const parent of scopes.parents.get(queue[i]) ?? []) {
        if (!members.has(parent)) context.add(parent);
        if (!visited.has(parent)) { visited.add(parent); queue.push(parent); }
    }
    const visible = new Set([...members, ...context]);
    return { ...scopes, members, shared, context, visible };
}

/** Refine a display workspace without changing its authored allocation or membership data. */
export function functionalDisplayIds(model: MemoModelDTO, workspace: string, ids: ReadonlySet<string>): Set<string> {
    const scope = functionalScope(model, workspace);
    const admitted = (id: string) => {
        if (scope.functions.has(id)) return scope.visible.has(id);
        const queue = [...(scope.owners.get(id) ?? [])]; const seen = new Set<string>();
        let foundFunction = false;
        for (let i = 0; i < queue.length; i++) {
            const parent = queue[i]; if (seen.has(parent)) continue; seen.add(parent);
            if (scope.functions.has(parent)) { foundFunction = true; if (scope.visible.has(parent)) return true; }
            else queue.push(...(scope.owners.get(parent) ?? []));
        }
        return !foundFunction;
    };
    return new Set([...ids, ...scope.context].filter(admitted));
}
