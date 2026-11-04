// ─── The operational level of an element ─────────────────────────────────────
//
// A use case and a workflow are declared at a level by their type (`ClinicalUseCase`,
// `SystemUseCase`, `ClinicalWorkflow`, `SystemWorkflow`). A scenario, a step or a resource has no
// type of its own for it: it is at the level of the workflow it sits in, reached the way the
// level rules reach it (CR-ONT-094..097), by `composes` and by what a composed scenario
// `performs`. This is the one place that walk is written; the rules state it in their predicates
// and every client reads the answer from the model DTO.
//
// Nothing here is a kind list beyond the four level types, which are the ontology's own: the
// types are read through the kind registry, so a project's specialization of one is at its level.
// An element reached from both levels is at neither, and an element reachable from no workflow
// (a user, an operational entity, a platform part) has no level.
// ─────────────────────────────────────────────────────────────────────────────

import type { MemoModel } from './semantic.js';
import type { KindRegistry } from './kind-registry.js';
import { withSpecializationExtents } from './kind-extents.js';

export type OperationalLevel = 'clinical' | 'system';

const LEVEL_TYPES: readonly [string, OperationalLevel][] = [
    ['ClinicalUseCase', 'clinical'], ['ClinicalWorkflow', 'clinical'],
    ['SystemUseCase', 'system'], ['SystemWorkflow', 'system'],
];

export function operationalLevels(model: MemoModel, kindRegistry: KindRegistry): Record<string, OperationalLevel> {
    const extended = withSpecializationExtents(model, kindRegistry);
    const found = new Map<string, Set<OperationalLevel>>();
    const note = (id: string, level: OperationalLevel) => {
        const levels = found.get(id) ?? new Set<OperationalLevel>();
        levels.add(level);
        found.set(id, levels);
    };

    const targets = (id: string, type: string): string[] =>
        (model.outgoing.get(id) ?? []).filter(rel => rel.type.toLowerCase() === type).map(rel => rel.targetId);
    const composedBelow = (root: string): Set<string> => {
        const seen = new Set<string>();
        const queue = [root];
        while (queue.length > 0) {
            const id = queue.pop()!;
            for (const child of targets(id, 'composes')) if (!seen.has(child)) { seen.add(child); queue.push(child); }
        }
        return seen;
    };

    for (const [typeName, level] of LEVEL_TYPES) {
        for (const element of extended.elementsByKind.get(typeName) ?? []) {
            note(element.id, level);
            if (!typeName.endsWith('Workflow')) continue;
            const inside = composedBelow(element.id);
            for (const id of inside) {
                note(id, level);
                // A step declared once and used in a scenario is reached by `perform`, with what it composes.
                for (const performed of targets(id, 'performs')) {
                    note(performed, level);
                    for (const part of composedBelow(performed)) note(part, level);
                }
            }
        }
    }

    const out: Record<string, OperationalLevel> = {};
    for (const [id, levels] of found) if (levels.size === 1) out[id] = [...levels][0];
    return out;
}
