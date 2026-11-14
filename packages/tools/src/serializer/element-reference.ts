import type { MemoModelDTO } from '../model/semantic.js';
import { shortNameOf } from '../model/element-index.js';

/** An authored feature path uses namespace qualification for its outer element and dots through owned features. */
export function elementPath(elementId: string, model: Pick<MemoModelDTO, 'elements'>): string {
    const named = (id: string) => model.elements[id]?.shortName ?? shortNameOf(id);
    const nested = [] as string[];
    let outermost = elementId;
    const visited = new Set([elementId]);
    let owner = (model.elements[elementId]?.owner ?? model.elements[elementId]?.parentAction);
    while (owner && !visited.has(owner) && model.elements[owner]) {
        nested.unshift(named(outermost));
        // A definition is a namespace, not a feature value to chain through.
        if (model.elements[owner].isDefinition || model.elements[owner].construct === 'package') {
            return [`${owner}::${nested.shift()}`, ...nested].join('.');
        }
        outermost = owner;
        visited.add(owner);
        owner = (model.elements[owner]?.owner ?? model.elements[owner]?.parentAction);
    }
    return [outermost, ...nested].join('.');
}
