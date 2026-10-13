// ─── Workspace membership ────────────────────────────────────────────────────
//
// A workspace (one system, or the system of systems) is not declared. It is the
// closure of what is linked to its root, and this module computes it
// (plans/memo-model-product-project-structure.md, T2).
//
// Roots are DEFINITIONS of a System-kind or SystemOfSystems-kind, and a root's
// top-level usage joins it (`part epLab : ElectrophysiologyLab`). From each root,
// to a fixpoint:
//
//   ownership   a member's owned elements join it (which places ports, steps and
//               nested parts), downward only
//   typing      a member usage reaches its definition, never the reverse; so a
//               definition two systems use is reached by both. A feature an
//               element owns counts the same way: an action's parameter types
//               and a port's directed features are types the element reaches.
//   relations   every other relation goes through the ontology's table
//               (`registry.workspaceMembership()`): `sourceFollowsTarget` puts
//               the source in whenever the target is in, `targetFollowsSource`
//               the reverse, `neither` places nothing
//   typed link  a link typed by a definition (`interface electrogramFeed :
//               RecordingToMappingIcd connect a to b`) places that definition
//               when BOTH ends are in the workspace, which is how an interface
//               control document lands in the system of systems and in no system
//
// A system is a boundary. The system of systems holds its constituent systems as
// parts (ownership) but never absorbs a system's definition; and a system's
// workspace never reaches another system, or the system of systems. Only
// ownership and the seeded top-level usage may bring a System-kind or
// SystemOfSystems-kind element in.
//
// A feature a port DEFINITION owns (`out item electrogram : Electrogram` in
// `port def ElectrogramPort`) is not an element, so its type is not read here;
// the same item definitions are reached through the functions that move them.
//
// A model is required to declare at least one System, and there is no implicit
// workspace: with none, `missingSystem` is set and everything is Unassigned
// (measured on gpca, which types its parts by ontology kinds and declares none).
//
// What this module does not do is decide. Direction is the ontology's, kind
// derivation is the kind registry's, and the two names below are the structural
// roots those derivations start from: the ontology says what a System is, not
// that a workspace is rooted at one.
// ─────────────────────────────────────────────────────────────────────────────

import type { BuilderRegistries } from './complete-model.js';
import type { KindRegistry } from './kind-registry.js';
import type { MemoElement, MemoModel, MemoRelationship } from './semantic.js';

/** The ontology kinds a workspace is rooted at: a System, and a SystemOfSystems. */
const SYSTEM_KIND = 'System';
const SOS_KIND = 'SystemOfSystems';

/** The layer of the elements that describe how the model is worked on, which no workspace holds. */
const METHODOLOGY_LAYER = 'methodology';

export interface Workspace {
    /** The root definition's element id. */
    root: string;
    scope: 'system' | 'sos';
    members: ReadonlySet<string>;
}

/** A type an element names that could not be resolved to exactly one definition. */
export interface UnresolvedWorkspaceType {
    elementId: string;
    type: string;
    /** The definitions that carry the name; empty when none does. */
    candidates: readonly string[];
}

export interface WorkspaceMembership {
    workspaces: readonly Workspace[];
    /** Element id to the ids of the systems whose workspace holds it. */
    systems: ReadonlyMap<string, readonly string[]>;
    /** Element id to the ids of the systems of systems whose workspace holds it. */
    sos: ReadonlyMap<string, readonly string[]>;
    /** Elements reached from two or more systems. Reaching the system of systems too does not count. */
    shared: readonly string[];
    /** Elements no workspace holds, methodology-layer elements excluded: a diagnostic. */
    unassigned: readonly string[];
    unresolvedTypes: readonly UnresolvedWorkspaceType[];
    /** A usage's id to the id of the definition it is typed by, as the closure resolved it. */
    definitionOf: ReadonlyMap<string, string>;
    /** True when no system workspace exists: a model is required to declare at least one System. */
    missingSystem: boolean;
}

type Direction = 'sourceFollowsTarget' | 'targetFollowsSource' | 'neither';

/** Whether `kind` is `root` or specializes it, through the kind registry's chain (every supertype). */
function derivesFrom(kinds: KindRegistry, kind: string, root: string): boolean {
    const seen = new Set<string>();
    const queue = [kind];
    for (let next = queue.pop(); next !== undefined; next = queue.pop()) {
        if (next === root) return true;
        if (seen.has(next)) continue;
        seen.add(next);
        const entry = kinds.getKind(next);
        if (!entry) continue;
        for (const up of [entry.superType, ...(entry.additionalSuperTypes ?? [])]) {
            if (up) queue.push(up.split('::').pop()!);
        }
    }
    return false;
}

export function computeWorkspaceMembership(
    model: MemoModel,
    registries: BuilderRegistries,
): WorkspaceMembership {
    const { kindRegistry: kinds, relationshipRegistry } = registries;
    if (!kinds || !relationshipRegistry) throw new Error('workspace membership needs the ontology registries the model was built with');
    const table = relationshipRegistry.workspaceMembership();
    const elements = model.elements;
    const unresolved = new Map<string, UnresolvedWorkspaceType>();

    const scopeOf = (element: MemoElement): 'system' | 'sos' | undefined =>
        derivesFrom(kinds, element.kind, SOS_KIND) ? 'sos'
            : derivesFrom(kinds, element.kind, SYSTEM_KIND) ? 'system' : undefined;

    /** The definition a short or qualified type name names, if exactly one does. */
    const definitionNamed = (owner: MemoElement, type: string): string | undefined => {
        const exact = elements.get(type);
        if (exact?.isDefinition) return exact.id;
        const candidates = elements.idsNamed(type.split('::').pop()!).filter(id => elements.get(id)?.isDefinition);
        if (candidates.length === 1) return candidates[0];
        // An ontology kind is a type but not an element of the model: nothing to place.
        if (candidates.length === 0 && kinds.has(type)) return undefined;
        unresolved.set(`${owner.id}|${type}`, { elementId: owner.id, type, candidates });
        return undefined;
    };

    /** What an element is typed by: the classifier the builder resolved, else the type name it wrote. */
    const typeOf = (element: MemoElement): string | undefined => {
        const classifier = element.provenance?.classifier?.qualifiedName;
        if (classifier && elements.has(classifier)) return classifier;
        const written = element.attributes.usageType ?? element.portSpec?.type;
        return written ? definitionNamed(element, written) : undefined;
    };

    /** The definitions the features an element owns are typed by (an action's parameters, a port's flows). */
    const featureTypesOf = (element: MemoElement): string[] =>
        (element.parameters ?? []).flatMap(parameter => {
            const id = parameter.type ? definitionNamed(element, parameter.type) : undefined;
            return id ? [id] : [];
        });

    const children = new Map<string, string[]>();
    for (const element of elements.values()) {
        const parent = element.owner ?? element.parentAction;
        if (parent) children.set(parent, [...(children.get(parent) ?? []), element.id]);
    }
    const incident = new Map<string, MemoRelationship[]>();
    for (const relationship of model.relationships) {
        for (const end of new Set([relationship.sourceId, relationship.targetId])) {
            incident.set(end, [...(incident.get(end) ?? []), relationship]);
        }
    }

    const closure = (root: MemoElement, scope: 'system' | 'sos'): Workspace => {
        const members = new Set<string>();
        const queue: string[] = [];
        const join = (id: string | undefined, via: 'root' | 'owner' | 'reach') => {
            if (!id || members.has(id)) return;
            const element = elements.get(id);
            if (!element) return;
            // A system is a boundary: only structure brings another one in.
            if (via === 'reach' && id !== root.id && scopeOf(element)) return;
            members.add(id);
            queue.push(id);
        };

        join(root.id, 'root');
        for (const element of elements.values()) {
            if (!element.isDefinition && !element.owner && typeOf(element) === root.id) join(element.id, 'root');
        }

        for (let id = queue.shift(); id !== undefined; id = queue.shift()) {
            const element = elements.get(id)!;
            for (const child of children.get(id) ?? []) join(child, 'owner');
            join(typeOf(element), 'reach');
            for (const type of featureTypesOf(element)) join(type, 'reach');
            for (const relationship of incident.get(id) ?? []) {
                const direction = (table.get(relationship.type) ?? 'neither') as Direction;
                if (direction === 'sourceFollowsTarget' && relationship.targetId === id) join(relationship.sourceId, 'reach');
                if (direction === 'targetFollowsSource' && relationship.sourceId === id) join(relationship.targetId, 'reach');
                if (relationship.kind && members.has(relationship.sourceId) && members.has(relationship.targetId)) {
                    join(definitionNamed(elements.get(relationship.sourceId)!, relationship.kind), 'reach');
                }
            }
        }
        return { root: root.id, scope, members };
    };

    const workspaces: Workspace[] = [];
    for (const element of elements.values()) {
        if (!element.isDefinition) continue;
        const scope = scopeOf(element);
        if (scope) workspaces.push(closure(element, scope));
    }

    const systems = new Map<string, string[]>();
    const sos = new Map<string, string[]>();
    for (const workspace of workspaces) {
        const into = workspace.scope === 'system' ? systems : sos;
        for (const id of workspace.members) into.set(id, [...(into.get(id) ?? []), workspace.root]);
    }

    const definitionOf = new Map<string, string>();
    for (const element of elements.values()) {
        if (element.isDefinition) continue;
        const type = typeOf(element);
        if (type && type !== element.id) definitionOf.set(element.id, type);
    }

    return {
        workspaces,
        definitionOf,
        systems,
        sos,
        shared: [...systems].filter(([, roots]) => roots.length >= 2).map(([id]) => id),
        unassigned: [...elements.values()]
            .filter(element => !systems.has(element.id) && !sos.has(element.id) && element.layer !== METHODOLOGY_LAYER)
            .map(element => element.id),
        unresolvedTypes: [...unresolved.values()],
        missingSystem: !workspaces.some(workspace => workspace.scope === 'system'),
    };
}

/**
 * The membership as it travels in the model DTO: plain JSON, with no Sets.
 *
 * `membership` maps an element id to the roots of the workspaces that hold it, so a client
 * filters by a chosen workspace (`membership[id]?.includes(root)`) without recomputing the
 * closure; `shared` and `unassigned` are listed because the client shows them as groups.
 */
export interface WorkspaceMembershipDTO {
    workspaces: { root: string; scope: 'system' | 'sos'; name: string }[];
    membership: Record<string, string[]>;
    shared: string[];
    unassigned: string[];
    /** A usage's id to the definition it is typed by, resolved by the closure (never by name in a client). */
    definitionOf: Record<string, string>;
    missingSystem: boolean;
}

export function workspaceMembershipToDTO(result: WorkspaceMembership, model: MemoModel): WorkspaceMembershipDTO {
    const membership: Record<string, string[]> = {};
    for (const workspace of result.workspaces) {
        for (const id of workspace.members) (membership[id] ??= []).push(workspace.root);
    }
    return {
        workspaces: result.workspaces.map(workspace => ({
            root: workspace.root,
            scope: workspace.scope,
            name: model.elements.get(workspace.root)?.name ?? workspace.root,
        })),
        membership,
        shared: [...result.shared],
        unassigned: [...result.unassigned],
        definitionOf: Object.fromEntries(result.definitionOf),
        missingSystem: result.missingSystem,
    };
}

/**
 * A workspace chosen to validate against (`memo validate --workspace`).
 *
 * `subjects` are the elements rules run ON. `foreign` are the elements that belong to some other
 * system's workspace and not to this one: a trace edge that touches one is not evidence for this
 * workspace. Elements no workspace holds, the system of systems' own and the shared ones are never
 * foreign, so a gap in the closure cannot turn into a false finding. The graph itself stays whole.
 */
export interface WorkspaceScope {
    root: string;
    scope: 'system' | 'sos';
    name: string;
    subjects: ReadonlySet<string>;
    foreign: ReadonlySet<string>;
}

export type WorkspaceSelection = { ok: true; scope: WorkspaceScope } | { ok: false; message: string };

/** Choose a workspace by its root's id, name or short id. An unknown or ambiguous request lists the candidates. */
export function selectWorkspace(
    model: MemoModel,
    membership: WorkspaceMembership,
    requested: string,
): WorkspaceSelection {
    const describe = (root: string) => `${model.elements.get(root)?.name ?? root} (${membership.workspaces.find(w => w.root === root)!.scope})`;
    const all = membership.workspaces.map(workspace => workspace.root);
    if (membership.missingSystem) {
        return { ok: false, message: `this model declares no System, so it has no workspace to validate; declare a part def that specializes System.` };
    }
    const names = (root: string): string[] => {
        const element = model.elements.get(root);
        return [root, element?.name, element?.shortId].filter((s): s is string => !!s).map(s => s.toLowerCase());
    };
    const wanted = requested.toLowerCase();
    const exact = all.filter(root => names(root).includes(wanted));
    const hits = exact.length > 0 ? exact : all.filter(root => names(root).some(name => name.split('::').pop() === wanted));
    if (hits.length !== 1) {
        const list = (hits.length > 1 ? hits : all).map(describe).join(', ');
        return { ok: false, message: `${hits.length > 1 ? `"${requested}" names more than one workspace` : `no workspace is named "${requested}"`}; choose one of: ${list}.` };
    }
    const workspace = membership.workspaces.find(w => w.root === hits[0])!;
    const foreign = new Set<string>();
    if (workspace.scope === 'system') {
        for (const [id, roots] of membership.systems) {
            if (!roots.includes(workspace.root) && !membership.sos.has(id)) foreign.add(id);
        }
    }
    return {
        ok: true,
        scope: {
            root: workspace.root,
            scope: workspace.scope,
            name: model.elements.get(workspace.root)?.name ?? workspace.root,
            // The system of systems' workspace is where the whole picture is, so the elements no
            // workspace holds are judged here: a finding about an orphan must not read as clean.
            subjects: workspace.scope === 'sos' ? new Set([...workspace.members, ...membership.unassigned]) : workspace.members,
            foreign,
        },
    };
}
