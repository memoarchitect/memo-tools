// ─── The Guide: where a model stands against its method ──────────────────────
//
// Pure. Teams work each layer independently and link their work as the other side appears, so a step is
// judged on its own, never held back by the step before it. Its state comes from two parts:
//
//   own work  every output kind has an element in the workspace, and every rule the step is `#DoneWhen`
//             has a subject there and no finding on any subject. A rule with nothing to judge is not
//             satisfied, it has not run.
//   links     every rule the step is `#LinkedWhen`, each one of
//               linked   no finding;
//               ready    a finding on a subject: an element that is there and not linked yet;
//               waiting  no subject yet. When another step produces the rule's subject kind, that is another
//                        team's work, not this one's; when this step does, its missing output already says so;
//               unknown  the rule is not in the rule set, so it can never be satisfied.
//
//   done          own work done and every link linked;
//   open          own work not done, or a link ready or unknown: there is something this team can do;
//   waiting       own work done, and every link that is not linked is waiting on another step;
//   no criterion  the step names no output kind and no rule: it is never reported as done.
//
// `predecessors` (`first … then …`) is the recommended order and says which step feeds which; it is reported,
// never used to hold a step back.
//
// An imported element (one that carries `@ExternalSource`) counts toward an output only when it is traced:
// it has at least one link other than the containment of its own package, so an import nobody relates to
// anything does not complete a step.
//
// The caller gives the findings already scoped to the workspace (`validateModel(…, workspace)`): filtering a
// whole-model result afterwards would lose the rule that a trace to another system's element is not evidence,
// and a pump test would then complete a generator's step.
// ─────────────────────────────────────────────────────────────────────────────

import type { KindRegistry } from '../model/kind-registry.js';
import type { MemoModel } from '../model/semantic.js';
import { derivesFrom } from '../model/workspace-membership.js';
import type { GuideStep } from '../stage2/guide-from-api.js';
import type { Violation } from '../validator/types.js';

export type StepState = 'done' | 'open' | 'waiting' | 'no-criterion';
export type LinkState = 'linked' | 'ready' | 'waiting' | 'unknown';

export interface OutputStatus {
    kind: string;
    /** Elements of the kind in the workspace that count. */
    count: number;
    /** Imported elements of the kind that do not count, for want of a trace. */
    untracedImports: number;
}

export interface RuleStatus {
    /** The rule def's name, as the step names it. */
    rule: string;
    /** False when the rule is not in the resolved rule set: it cannot be satisfied. */
    known: boolean;
    /** Elements of the rule's subject kind in the workspace. */
    subjects: number;
    violations: number;
}

export interface LinkStatus extends RuleStatus {
    state: LinkState;
    /** For a waiting link: the steps that produce the rule's subject kind, by id. Empty when no step does. */
    waitingFor: string[];
    /** For a ready link: the elements with a finding, the ones not linked yet, by id. */
    unlinked: string[];
}

export interface StepStatus extends GuideStep {
    state: StepState;
    outputs: OutputStatus[];
    /** The `#DoneWhen` rules: part of the step's own work. */
    rules: RuleStatus[];
    /** The `#LinkedWhen` rules: links to another layer's work. */
    links: LinkStatus[];
    /** What this team can do, in words: missing own work, and links that are ready or cannot be judged. */
    reasons: string[];
    /** What waits on other teams, in words. */
    waiting: string[];
}

export interface GuideEvaluation {
    steps: StepStatus[];
    /** The first step that is open, in the method's order. */
    next?: string;
}

/** The rule facts the evaluation needs: the def's name, its id (what findings carry) and the kind it judges. */
export interface GuideRule {
    id: string;
    typeName?: string;
    appliesToKind: string;
}

export interface GuideInput {
    steps: readonly GuideStep[];
    model: MemoModel;
    kinds?: KindRegistry;
    /** A workspace: its elements, and whether it is the system of systems' or a system's. Absent: the whole model. */
    workspace?: { subjects: ReadonlySet<string>; scope: 'sos' | 'system' };
    /** Findings already scoped to the workspace. */
    violations: readonly Violation[];
    rules: readonly GuideRule[];
}

const IMPORTED = 'externalReference.identifier';
const LEVEL_OF_SCOPE = { sos: 'systemOfSystems', system: 'system' } as const;

export function evaluateGuide(input: GuideInput): GuideEvaluation {
    const { model, kinds, workspace } = input;
    const inScope = (id: string) => !workspace || workspace.subjects.has(id);
    const elements = [...model.elements.values()].filter(e => inScope(e.id));
    const conforms = (kind: string, root: string) => kind === root || (kinds !== undefined && derivesFrom(kinds, kind, root));
    const traced = (id: string) => [...(model.outgoing.get(id) ?? []), ...(model.incoming.get(id) ?? [])].some(r => r.type !== 'composes');

    // A workspace is worked at one level; the whole model has both.
    const wanted = workspace ? LEVEL_OF_SCOPE[workspace.scope] : undefined;
    const steps = input.steps.filter(step => !wanted || !step.level || step.level === wanted);

    const label = (step: GuideStep) => step.label ?? step.name;
    const ruleStatus = (name: string): RuleStatus & { id?: string; appliesToKind?: string } => {
        const rule = input.rules.find(r => r.typeName === name);
        if (!rule) return { rule: name, known: false, subjects: 0, violations: 0 };
        const subjects = elements.filter(e => conforms(e.kind, rule.appliesToKind)).length;
        const violations = input.violations.filter(v => v.ruleId === rule.id && inScope(v.elementId)).length;
        return { rule: name, known: true, subjects, violations, id: rule.id, appliesToKind: rule.appliesToKind };
    };
    // The steps whose outputs are a rule's subjects: the work a link waits for. A step that produces them itself
    // waits on nobody: its missing output is already its own work.
    const produces = (step: GuideStep, kind: string) => step.outputKinds.some(out => conforms(kind, out) || conforms(out, kind));
    const producers = (kind: string, self: GuideStep) =>
        produces(self, kind) ? [] : steps.filter(other => other !== self && produces(other, kind)).map(other => other.id);

    const byId = new Map(steps.map(s => [s.id, s]));
    const ordered = steps.map((step): StepStatus => {
        const reasons: string[] = [];
        const waiting: string[] = [];
        const outputs: OutputStatus[] = step.outputKinds.map(kind => {
            const ofKind = elements.filter(e => conforms(e.kind, kind));
            const counted = ofKind.filter(e => !e.attributes?.[IMPORTED] || traced(e.id));
            return { kind, count: counted.length, untracedImports: ofKind.length - counted.length };
        });
        for (const output of outputs.filter(o => o.count === 0)) {
            reasons.push(output.untracedImports > 0
                ? `${output.untracedImports} imported ${output.kind} element(s) are not traced to anything`
                : `no ${output.kind} yet`);
        }
        const rules: RuleStatus[] = step.doneWhen.map(name => {
            const { id: _id, appliesToKind: _kind, ...rule } = ruleStatus(name);
            return rule;
        });
        for (const rule of rules) {
            if (!rule.known) reasons.push(`the rule ${rule.rule} is not in the rule set`);
            else if (rule.subjects === 0) reasons.push(`${rule.rule} has nothing to judge yet`);
            else if (rule.violations > 0) reasons.push(`${rule.rule}: ${rule.violations} finding(s)`);
        }
        const links: LinkStatus[] = step.linkedWhen.map(name => {
            const { id, appliesToKind, ...rule } = ruleStatus(name);
            if (!rule.known) return { ...rule, state: 'unknown', waitingFor: [], unlinked: [] };
            if (rule.subjects === 0) return { ...rule, state: 'waiting', waitingFor: producers(appliesToKind!, step), unlinked: [] };
            if (rule.violations === 0) return { ...rule, state: 'linked', waitingFor: [], unlinked: [] };
            const unlinked = [...new Set(input.violations.filter(v => v.ruleId === id && inScope(v.elementId)).map(v => v.elementId))];
            return { ...rule, state: 'ready', waitingFor: [], unlinked };
        });
        for (const link of links) {
            if (link.state === 'unknown') reasons.push(`the rule ${link.rule} is not in the rule set`);
            else if (link.state === 'ready') reasons.push(`${link.rule}: ${link.unlinked.length} not linked yet`);
            else if (link.state === 'waiting' && !(link.waitingFor.length === 0 && produces(step, input.rules.find(r => r.typeName === link.rule)!.appliesToKind))) {
                waiting.push(link.waitingFor.length > 0
                    ? `${link.rule} waits for ${link.waitingFor.map(id => label(byId.get(id)!)).join(', ')}`
                    : `${link.rule} has nothing to judge yet`);
            }
        }
        const criterion = step.outputKinds.length > 0 || step.doneWhen.length > 0 || step.linkedWhen.length > 0;
        const state: StepState = !criterion ? 'no-criterion' : reasons.length > 0 ? 'open' : waiting.length > 0 ? 'waiting' : 'done';
        return { ...step, state, outputs, rules, links, reasons, waiting };
    });
    return { steps: ordered, next: ordered.find(step => step.state === 'open')?.id };
}
