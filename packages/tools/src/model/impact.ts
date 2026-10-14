// ─── What a change reaches ───────────────────────────────────────────────────
//
// The change is the working model against the commit it branched from: the model as the server holds it, edits
// that are not committed included, and `git merge-base <target> HEAD` built with `buildAt` (T5). The merge-base
// and not the target's tip, because diffing against the tip would show everything that landed on the target since
// the branch point as if the branch had reverted it. With the default target, HEAD, the merge-base is HEAD
// itself, and the question is the everyday one: what do my uncommitted edits affect. A release's commit as the
// target asks for everything since that release.
//
// From what changed (elements added, removed or changed, and both ends of every link added or removed) the
// reach is the one traversal `analysis/impact.ts` has, over every relation but containment, two steps out
// (a function, its requirement, that requirement's test), never passing through a system or system of
// systems. Removed elements are expanded in the base model, the rest in the working one. Layers come from the
// ontology, so requirements, risk and tests are separate groups without a kind list here. The systems are the
// workspaces that hold the changed and reached elements; the releases are the records of those systems, or of
// the elements themselves, and every record that contains them; the devices are those that cover them; and
// a step is reopened when it is done at the base and not at the head.
//
// Two limits. A rename is a removal plus an addition, because an id is a qualified name. And two steps is a
// number, not a judgement: a longer reach is a bigger answer, and the model is connected enough that without
// a bound the answer would be all of it.
// ─────────────────────────────────────────────────────────────────────────────

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { traverseImpact, type ImpactGraph } from '../analysis/impact.js';
import { evaluateWorkspaceGuide } from '../methodology/guide-service.js';
import type { ApiModel } from '../stage2/api-model.js';
import type { CompiledConstraint } from '../validator/constraint-eval.js';
import { collectApiConstraints } from '../validator/constraint-loader-api.js';
import type { BuilderRegistries } from './complete-model.js';
import { computeModelDiff, diffInputOf } from './model-diff.js';
import { buildAt, resolveCommit, type BuildOptions } from './pinned.js';
import type { MemoElement, MemoModel } from './semantic.js';
import { computeWorkspaceMembership } from './workspace-membership.js';

const git = promisify(execFile);

/** How far from a change the reach goes. */
export const IMPACT_DEPTH = 2;

/** The working model the change is judged on: what the server holds. */
export interface ImpactHead {
    model: MemoModel;
    registries: BuilderRegistries;
    api: ApiModel;
    constraints: readonly CompiledConstraint[];
    /** The packages declaring the method, for the Guide. */
    packages: readonly string[];
}

export interface ImpactItem { id: string; name: string; kind: string; layer: string; via?: string; depth: number }

export interface ImpactReport {
    target: string;
    /** The commit the change is measured from. */
    base: { commit: string; ref: string };
    head: 'working tree';
    changed: { added: number; removed: number; changed: number; addedLinks: number; removedLinks: number; elements: ImpactItem[] };
    /** What the change reaches, by the layer each element is in. */
    reached: Record<string, ImpactItem[]>;
    /** The systems and systems of systems that hold anything changed or reached. */
    systems: { id: string; name: string; scope: 'sos' | 'system' }[];
    releases: { id: string; name: string; status: string; commit: string; needsNewRelease: boolean }[];
    devices: { id: string; name: string; jurisdiction: string }[];
    reopened: { workspace: string; step: string; label: string }[];
    limits: string[];
}

async function mergeBase(projectRoot: string, target: string): Promise<string> {
    const sha = await resolveCommit(projectRoot, target);
    try {
        return (await git('git', ['-C', projectRoot, 'merge-base', sha, 'HEAD'])).stdout.trim();
    } catch {
        throw new Error(`"${target}" and HEAD have no common commit, so there is no point to measure the change from.`);
    }
}

const graphOf = (model: MemoModel): ImpactGraph => ({
    element: id => {
        const e = model.elements.get(id);
        return e ? { name: e.shortName ?? e.name, kind: e.kind, layer: e.layer } : undefined;
    },
    links: model.relationships,
});
const item = (e: MemoElement, depth: number, via?: string): ImpactItem =>
    ({ id: e.id, name: e.shortName ?? e.name, kind: e.kind, layer: e.layer, via, depth });

export async function computeChangeImpact(options: {
    projectRoot: string;
    head: ImpactHead;
    /** A ref or commit; default HEAD. */
    target?: string;
    build?: BuildOptions;
}): Promise<ImpactReport> {
    const { head, projectRoot } = options;
    const target = options.target?.trim() || 'HEAD';
    const baseCommit = await mergeBase(projectRoot, target);
    const base = (await buildAt(projectRoot, baseCommit, options.build)).project;
    if (!base.registries) throw new Error('the base model was built without the ontology registries');

    const diff = computeModelDiff(diffInputOf(base.model), diffInputOf(head.model));
    const headMembership = computeWorkspaceMembership(head.model, head.registries);
    const baseMembership = computeWorkspaceMembership(base.model, base.registries);

    // Roots, each in the model that has it: the removed in the base, everything else in the working model.
    const headRoots = new Set<string>();
    const baseRoots = new Set<string>();
    for (const e of diff.added) headRoots.add(e.id);
    for (const c of diff.changed) headRoots.add(c.element.id);
    for (const e of diff.removed) baseRoots.add(e.id);
    for (const r of diff.addedRels) for (const id of [r.sourceId, r.targetId]) if (head.model.elements.has(id)) headRoots.add(id);
    for (const r of diff.removedRels) for (const id of [r.sourceId, r.targetId]) if (base.model.elements.has(id)) baseRoots.add(id);

    // Never through a system or system of systems: everything reaches the one it belongs to.
    const traverse = (model: MemoModel, membership: typeof headMembership, roots: Set<string>) =>
        traverseImpact(graphOf(model), [...roots].filter(id => model.elements.has(id)), {
            direction: 'both', maxDepth: IMPACT_DEPTH, skipTypes: new Set(['composes']),
            stopAt: new Set(membership.workspaces.map(w => w.root)),
        }).nodes;
    const reachedHead = traverse(head.model, headMembership, headRoots);
    const reachedBase = traverse(base.model, baseMembership, baseRoots);

    const changedIds = new Set([...headRoots, ...baseRoots]);
    const reached = new Map<string, ImpactItem>();
    for (const node of [...reachedHead, ...reachedBase]) {
        if (changedIds.has(node.elementId) || reached.has(node.elementId)) continue;
        reached.set(node.elementId, { id: node.elementId, name: node.name, kind: node.kind, layer: node.layer, via: node.viaRelType, depth: node.depth });
    }
    const byLayer: Record<string, ImpactItem[]> = {};
    for (const entry of [...reached.values()].sort((a, b) => a.depth - b.depth || a.name.localeCompare(b.name))) {
        (byLayer[entry.layer || 'unplaced'] ??= []).push(entry);
    }

    // The systems that hold what changed or was reached; head membership for what is in the head, base for what was removed.
    const nameOf = (id: string) => head.model.elements.get(id)?.shortName ?? base.model.elements.get(id)?.shortName ?? id;
    const systems = new Map<string, { id: string; name: string; scope: 'sos' | 'system' }>();
    const place = (membership: typeof headMembership, id: string) => {
        for (const root of [...(membership.systems.get(id) ?? []), ...(membership.sos.get(id) ?? [])]) {
            const w = membership.workspaces.find(x => x.root === root);
            if (w) systems.set(root, { id: root, name: nameOf(root), scope: w.scope });
        }
        // A changed element that is itself a system or system of systems is that workspace.
        const own = membership.workspaces.find(w => w.root === id);
        if (own) systems.set(id, { id, name: nameOf(id), scope: own.scope });
    };
    for (const id of headRoots) place(headMembership, id);
    for (const id of baseRoots) place(baseMembership, id);
    for (const id of reached.keys()) place(head.model.elements.has(id) ? headMembership : baseMembership, id);

    // Releases: the records of an affected system or element, and every record that contains one, transitively.
    const affected = new Set<string>([...systems.keys(), ...changedIds, ...reached.keys()]);
    const links = (type: string) => head.model.relationships.filter(r => r.type === type);
    const records = new Set<string>(links('releaseOf').filter(r => affected.has(r.targetId)).map(r => r.sourceId));
    for (let grew = true; grew;) {
        grew = false;
        for (const r of links('contains')) if (records.has(r.targetId) && !records.has(r.sourceId)) { records.add(r.sourceId); grew = true; }
    }
    const releases = [...records].map(id => {
        const e = head.model.elements.get(id)!;
        const status = (e.attributes?.status ?? '').replace(/^.*::/, '');
        return { id, name: e.shortName ?? e.name, status, commit: (e.attributes?.modelCommit ?? '').slice(0, 7), needsNewRelease: status === 'approved' || status === 'released' };
    }).sort((a, b) => a.name.localeCompare(b.name));
    const devices = [...new Set(links('covers').filter(r => records.has(r.targetId)).map(r => r.sourceId))].map(id => {
        const e = head.model.elements.get(id)!;
        return { id, name: e.shortName ?? e.name, jurisdiction: (e.attributes?.jurisdiction ?? '').replace(/^.*::/, '') };
    }).sort((a, b) => a.name.localeCompare(b.name));

    // A step is reopened when it was done at the base and is not at the head, in each affected workspace.
    const reopened: ImpactReport['reopened'] = [];
    for (const workspace of systems.values()) {
        const at = (project: { api: ApiModel; model: MemoModel; registries: BuilderRegistries; constraints: readonly CompiledConstraint[] }) =>
            evaluateWorkspaceGuide({ ...project, packages: head.packages, workspace: workspace.id });
        const before = at({ api: base.api, model: base.model, registries: base.registries, constraints: collectApiConstraints(base.api) });
        const after = at(head);
        const done = new Set(before.steps.filter(s => s.state === 'done').map(s => s.id));
        for (const step of after.steps) {
            if (done.has(step.id) && step.state !== 'done') reopened.push({ workspace: workspace.name, step: step.id, label: step.label ?? step.name });
        }
    }

    return {
        target, base: { commit: baseCommit, ref: target }, head: 'working tree',
        changed: {
            added: diff.summary.added, removed: diff.summary.removed, changed: diff.summary.changed,
            addedLinks: diff.summary.addedRels, removedLinks: diff.summary.removedRels,
            elements: [
                ...diff.added.map(e => ({ ...item(head.model.elements.get(e.id)!, 0), via: 'added' })),
                ...diff.changed.map(c => ({ ...item(head.model.elements.get(c.element.id)!, 0), via: 'changed' })),
                ...diff.removed.map(e => ({ ...item(base.model.elements.get(e.id)!, 0), via: 'removed' })),
            ],
        },
        reached: byLayer, systems: [...systems.values()].sort((a, b) => a.name.localeCompare(b.name)), releases, devices, reopened,
        limits: [
            'A rename shows as a removal and an addition: an element is known by its qualified name.',
            `The reach is ${IMPACT_DEPTH} steps from a change, over every relation but containment, and stops at a system.`,
        ],
    };
}
