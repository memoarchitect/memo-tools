// ─── The steps of a method, from a stage 1 handoff ───────────────────────────
//
// A methodology's steps are the `MethodologyWorkflowStep` usages in the package that declares it; its role
// views are the `RoleView` usages there. Read from the handoff, not from the built model: the default
// method is library content, which is never built into the model, and a family method's package is read
// the same way so there is one reader. Order is `first <step> then <step>;`. A dependency from a step to a
// rule def under `#DoneWhen` says what finishes its own work, one under `#LinkedWhen` what links it to
// another layer's. A step is read by its `@MemoIdentity` label. The rows of the method map are the
// `MethodLayer` usages there, in declaration order; a row holds the steps whose stage it names.
// ─────────────────────────────────────────────────────────────────────────────

import { UsageReader } from './project-from-api.js';
import { apiDefinitionFacts } from './build-from-api.js';
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
    /** The rule defs that must have a subject and no finding, by name: the step's own work. */
    doneWhen: string[];
    /** The rule defs that link the step's work to another layer's, by name. */
    linkedWhen: string[];
    objective?: string;
    entryCriteria?: string;
    exitCriteria?: string;
    /** The steps that come first, by id. */
    predecessors: string[];
    /** The package that declares the methodology the step belongs to. */
    methodology: string;
}

export interface GuideLayerViewpoint {
    /** The viewpoint's qualified name, used when authoring a native view. */
    id: string;
    name: string;
    label: string;
    /** The standard SysML v2 view kind it resolves to by default (`general`, `interconnection`, …). */
    viewKind?: string;
}

/** A row of the method map: an architecture layer or an assurance discipline. */
export interface GuideLayer {
    /** The row's qualified name. */
    id: string;
    name: string;
    /** What the map calls it ("Logical"). */
    label: string;
    /** The question it answers, from its doc. */
    purpose?: string;
    axis?: string;
    /** The stages whose steps it holds. */
    stages: string[];
    /** Kinds worked in the layer, including specializations, independent of step completion. */
    elementKinds?: string[];
    /** The viewpoints its views are made in, in order: the name each is written with, its label and its view kind. */
    viewpoints: GuideLayerViewpoint[];
    standardReference?: string;
    linkDescription?: string;
    /** Its work is often imported from another tool. */
    importable: boolean;
    methodology: string;
}

export interface GuideRoleView {
    stakeholder: string;
    viewpoints: string[];
    methodology: string;
}

export interface GuideSources {
    steps: GuideStep[];
    layers: GuideLayer[];
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
    const layers: GuideLayer[] = [];
    const roleViews: GuideRoleView[] = [];
    const byId = new Map<string, GuideStep>();
    const marked: { client: string; rules: string[]; marker: 'doneWhen' | 'linkedWhen' }[] = [];
    const successions: { from: string; to: string }[] = [];

    const typedBy = (usage: ApiElement, metaclass: string, definition: string) => {
        if (usage['@type'] !== metaclass) return false;
        const type = api.types(usage['@id'])[0];
        return !!type && (api.name(type['@id']) === definition
            || api.superclassifiers(type['@id']).some(s => api.name(s['@id']) === definition));
    };
    const isStep = (usage: ApiElement) => typedBy(usage, 'ActionUsage', 'MethodologyWorkflowStep');
    const isLayer = (usage: ApiElement) => typedBy(usage, 'PartUsage', 'MethodLayer');
    const endsOf = (connector: ApiElement) => api.ownedMembers(connector['@id'])
        .filter(m => m.isEnd === true || api.ownedRelationships(m['@id']).some(r => r['@type'] === 'ReferenceSubsetting'));

    // A `#DoneWhen` or `#LinkedWhen` dependency stated beside a step or inside its body.
    const MARKERS = { DoneWhen: 'doneWhen', LinkedWhen: 'linkedWhen' } as const;
    const collectMarked = (dependency: ApiElement) => {
        const names = api.ownedRelationships(dependency['@id']).filter(r => r['@type'] === 'Annotation').map(annotation => {
            const metadata = api.ownedMembers(annotation['@id'])[0]
                ?? ((annotation.ownedRelatedElement as { '@id': string }[] | undefined) ?? []).map(x => api.element(x['@id'])).find(Boolean);
            const type = metadata ? api.types(metadata['@id'])[0] : undefined;
            return type ? api.name(type['@id']) : undefined;
        });
        const marker = names.map(name => MARKERS[name as keyof typeof MARKERS]).find(Boolean);
        if (!marker) return;
        const ids = (key: string) => ((dependency[key] as { '@id': string }[] | undefined) ?? []).map(r => api.element(r['@id'])).filter(Boolean) as ApiElement[];
        for (const client of ids('client')) {
            marked.push({ client: api.qualifiedName(client['@id']) ?? '', rules: ids('supplier').map(s => api.name(s['@id']) ?? '').filter(Boolean), marker });
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
                    label: apiDefinitionFacts(api, member).attributes.label ?? humanize(name),
                    stage: reader.attr(member, 'stage'), level: reader.attr(member, 'level'),
                    role: reader.refQualified(member, 'role') ? lastSegment(reader.refQualified(member, 'role')!) : undefined,
                    guideViewpoint: reader.refQualified(member, 'guideViewpoint') ? lastSegment(reader.refQualified(member, 'guideViewpoint')!) : undefined,
                    inputKinds: reader.attrList(member, 'inputKinds'), outputKinds: reader.attrList(member, 'outputKinds'),
                    doneWhen: [], linkedWhen: [], objective: reader.attr(member, 'objectiveDescription'),
                    entryCriteria: reader.attr(member, 'entryCriteria'), exitCriteria: reader.attr(member, 'exitCriteria'),
                    predecessors: [], methodology: packageName,
                };
                steps.push(step);
                byId.set(id, step);
                for (const inner of api.ownedMembers(member['@id'])) if (inner['@type'] === 'Dependency') collectMarked(inner);
            } else if (isLayer(member)) {
                const name = api.declaredName(member['@id']) ?? lastSegment(id);
                const facts = apiDefinitionFacts(api, member);
                layers.push({
                    id, name, label: facts.attributes.label ?? name, purpose: facts.doc,
                    axis: reader.attr(member, 'axis'), stages: reader.attrList(member, 'stages').map(lastSegment),
                    elementKinds: reader.attrList(member, 'elementKinds'),
                    viewpoints: reader.refList(member, 'layerViewpoints').map(qualified => {
                        const viewpoint = api.resolve(qualified);
                        const name = lastSegment(qualified);
                        return {
                            id: qualified,
                            name, label: (viewpoint && apiDefinitionFacts(api, viewpoint).attributes.label) || name,
                            viewKind: viewpoint ? reader.attr(viewpoint, 'defaultViewKind') : undefined,
                        };
                    }),
                    standardReference: reader.attr(member, 'standardReference'),
                    linkDescription: reader.attr(member, 'linkDescription'), importable: reader.attr(member, 'importable') === 'true',
                    methodology: packageName,
                });
            } else if (member['@type'] === 'SuccessionAsUsage') {
                const [from, to] = endsOf(member).map(end => api.referenced(end['@id'])[0]).map(f => f ? api.qualifiedName(f['@id']) : undefined);
                if (from && to) successions.push({ from, to });
            } else if (member['@type'] === 'Dependency') {
                collectMarked(member);
            } else if (member['@type'] === 'PartUsage' && reader.typeName(member) === 'RoleView') {
                const stakeholder = reader.refQualified(member, 'forStakeholder');
                if (stakeholder) roleViews.push({
                    stakeholder: lastSegment(stakeholder),
                    viewpoints: reader.refList(member, 'shownViewpoint').map(lastSegment), methodology: packageName,
                });
            }
        }
    }
    for (const dependency of marked) byId.get(dependency.client)?.[dependency.marker].push(...dependency.rules);
    for (const { from, to } of successions) byId.get(to)?.predecessors.push(from);
    return { steps, layers, roleViews };
}
