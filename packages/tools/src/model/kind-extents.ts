import type { MemoModel } from './semantic.js';
import type { KindRegistry } from './kind-registry.js';

/**
 * Add inherited kind extents for the duration of constraint evaluation. The
 * canonical model keeps exact-kind indexes; the evaluator's type extent uses
 * SysML specialization semantics, including kinds supplied by user ontology
 * extensions.
 */
export function withSpecializationExtents(model: MemoModel, kindRegistry: KindRegistry): MemoModel {
    const elementsByKind = new Map(model.elementsByKind);
    for (const base of kindRegistry.entries()) {
        const names = new Set<string>();
        const queue = [base.name];
        while (queue.length > 0) {
            const name = queue.pop()!;
            if (names.has(name)) continue;
            names.add(name);
            for (const derived of kindRegistry.getKind(name)?.derivedBy ?? []) queue.push(derived);
        }
        const extent = [...names].flatMap(name => model.elementsByKind.get(name) ?? []);
        if (extent.length > 0) elementsByKind.set(base.name, [...new Map(extent.map(el => [el.id, el])).values()]);
    }
    return { ...model, elementsByKind };
}
