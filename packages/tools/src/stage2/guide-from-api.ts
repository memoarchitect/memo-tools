// ─── The steps of a method, from a stage 1 handoff ───────────────────────────
//
// A methodology's steps are the `MethodologyWorkflowStep` usages in the package that declares it; its role
// views are the `RoleView` usages there. Read from the handoff, not from the built model: the default
// method is library content, which is never built into the model, and a family method's package is read
// the same way so there is one reader. Order is `first <step> then <step>;`, a dependency from a step to a
// rule def under `#DoneWhen` says what finishes it.
// ─────────────────────────────────────────────────────────────────────────────

import { UsageReader } from './project-from-api.js';
import type { ApiElement, ApiModel } from './api-model.js';

export interface GuideStep {
    /** The step's qualified name. */
    id: string;
    name: string;
    label?: string;
    stage?: string;
    level?: string;
    role?: string;
    /** The viewpoint that opens the step, by the name it is written with. */
    guideViewpoint?: string;
    inputKinds: string[];
    outputKinds: string[];
    /** The rule defs that must have a subject and no finding, by name. */
    doneWhen: string[];
    objective?: string;
    entryCriteria?: string;
    exitCriteria?: string;
    /** The steps that come first, by id. */
    predecessors: string[];
    /** The package that declares the methodology the step belongs to. */
    methodology: string;
}

export interface GuideRoleView {
    stakeholder: string;
    viewpoints: string[];
    methodology: string;
}

export interface GuideSources {
    steps: GuideStep[];
    roleViews: GuideRoleView[];
}

const lastSegment = (name: string) => name.slice(name.lastIndexOf('::') + 2);

/** `stepSysRisk` as words: `Sys Risk`. */
const humanize = (name: string) => name.replace(/^step/, '').replace(/([a-z0-9])([A-Z])/g, '$1 $2');

/**
 * The steps and role views of the methodologies declared in `packages`, base first, in declaration order.
 * A step's predecessors come from any succession in any of the packages, so a family step may follow a base's.
 */
export function readGuideSources(api: ApiModel, packages: readonly string[]): GuideSources {
    const reader = new UsageReader(api);
    const steps: GuideStep[] = [];
    const roleViews: GuideRoleView[] = [];
    const byId = new Map<string, GuideStep>();
    const doneWhen: { client: string; rules: string[] }[] = [];
    const successions: { from: string; to: string }[] = [];

    const isStep = (usage: ApiElement) => {
        if (usage['@type'] !== 'ActionUsage') return false;
        const type = api.types(usage['@id'])[0];
        return !!type && (api.name(type['@id']) === 'MethodologyWorkflowStep'
            || api.superclassifiers(type['@id']).some(s => api.name(s['@id']) === 'MethodologyWorkflowStep'));
    };
    const endsOf = (connector: ApiElement) => api.ownedMembers(connector['@id'])
        .filter(m => m.isEnd === true || api.ownedRelationships(m['@id']).some(r => r['@type'] === 'ReferenceSubsetting'));

    // A `#DoneWhen` dependency stated beside a step or inside its body.
    const collectDoneWhen = (dependency: ApiElement) => {
        const named = api.ownedRelationships(dependency['@id']).filter(r => r['@type'] === 'Annotation').some(annotation => {
            const metadata = api.ownedMembers(annotation['@id'])[0]
                ?? ((annotation.ownedRelatedElement as { '@id': string }[] | undefined) ?? []).map(x => api.element(x['@id'])).find(Boolean);
            const type = metadata ? api.types(metadata['@id'])[0] : undefined;
            return type !== undefined && api.name(type['@id']) === 'DoneWhen';
        });
        if (!named) return;
        const ids = (key: string) => ((dependency[key] as { '@id': string }[] | undefined) ?? []).map(r => api.element(r['@id'])).filter(Boolean) as ApiElement[];
        for (const client of ids('client')) {
            doneWhen.push({ client: api.qualifiedName(client['@id']) ?? '', rules: ids('supplier').map(s => api.name(s['@id']) ?? '').filter(Boolean) });
        }
    };

    for (const packageName of packages) {
        const pkg = api.resolve(packageName);
        if (!pkg) continue;
        for (const member of api.ownedMembers(pkg['@id'])) {
            const id = api.qualifiedName(member['@id']) ?? '';
            if (isStep(member)) {
                const name = api.declaredName(member['@id']) ?? lastSegment(id);
                const step: GuideStep = {
                    id, name,
                    label: humanize(name),
                    stage: reader.attr(member, 'stage'), level: reader.attr(member, 'level'),
                    role: reader.refQualified(member, 'role') ? lastSegment(reader.refQualified(member, 'role')!) : undefined,
                    guideViewpoint: reader.refQualified(member, 'guideViewpoint') ? lastSegment(reader.refQualified(member, 'guideViewpoint')!) : undefined,
                    inputKinds: reader.attrList(member, 'inputKinds'), outputKinds: reader.attrList(member, 'outputKinds'),
                    doneWhen: [], objective: reader.attr(member, 'objectiveDescription'),
                    entryCriteria: reader.attr(member, 'entryCriteria'), exitCriteria: reader.attr(member, 'exitCriteria'),
                    predecessors: [], methodology: packageName,
                };
                steps.push(step);
                byId.set(id, step);
                for (const inner of api.ownedMembers(member['@id'])) if (inner['@type'] === 'Dependency') collectDoneWhen(inner);
            } else if (member['@type'] === 'SuccessionAsUsage') {
                const [from, to] = endsOf(member).map(end => api.referenced(end['@id'])[0]).map(f => f ? api.qualifiedName(f['@id']) : undefined);
                if (from && to) successions.push({ from, to });
            } else if (member['@type'] === 'Dependency') {
                collectDoneWhen(member);
            } else if (member['@type'] === 'PartUsage' && reader.typeName(member) === 'RoleView') {
                const stakeholder = reader.refQualified(member, 'forStakeholder');
                if (stakeholder) roleViews.push({
                    stakeholder: lastSegment(stakeholder),
                    viewpoints: reader.refList(member, 'shownViewpoint').map(lastSegment), methodology: packageName,
                });
            }
        }
    }
    for (const dependency of doneWhen) byId.get(dependency.client)?.doneWhen.push(...dependency.rules);
    for (const { from, to } of successions) byId.get(to)?.predecessors.push(from);
    return { steps, roleViews };
}
