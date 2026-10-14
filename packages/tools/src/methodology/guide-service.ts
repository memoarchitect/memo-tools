// ─── The Guide for one workspace, from a built project ───────────────────────
//
// The steps come from the methodologies in the effective chain (read from the handoff), the findings from
// validation scoped to the workspace as `memo validate --workspace` scopes it, and the evaluation is
// `evaluateGuide`. Used by the server's `guide:evaluate` and by tests; nothing here writes.
// ─────────────────────────────────────────────────────────────────────────────

import type { BuilderRegistries } from '../model/complete-model.js';
import type { MemoModel } from '../model/semantic.js';
import { computeWorkspaceMembership, selectWorkspace } from '../model/workspace-membership.js';
import { readGuideSources, type GuideRoleView } from '../stage2/guide-from-api.js';
import type { ApiModel } from '../stage2/api-model.js';
import type { CompiledConstraint } from '../validator/constraint-eval.js';
import { validateModel } from '../validator/rule-engine.js';
import { evaluateGuide, type GuideEvaluation } from './guide.js';

export interface GuideResult extends GuideEvaluation {
    /** The workspace evaluated: a system's or the system of systems' name; absent for the whole model. */
    workspace?: string;
    scope?: 'sos' | 'system';
    /** The packages whose methodologies the steps come from, base first. */
    methodologies: string[];
    roleViews: GuideRoleView[];
    /** Set when nothing could be evaluated, and why. */
    error?: string;
}

export interface GuideServiceInput {
    api: ApiModel;
    model: MemoModel;
    registries: BuilderRegistries;
    constraints: readonly CompiledConstraint[];
    /** The packages declaring the effective methodology chain, base first. */
    packages: readonly string[];
    /** A system or system of systems by name or id; absent for the whole model. */
    workspace?: string;
}

export function evaluateWorkspaceGuide(input: GuideServiceInput): GuideResult {
    const { api, model, registries, constraints, packages } = input;
    const sources = readGuideSources(api, packages);
    const base: GuideResult = { steps: [], methodologies: [...packages], roleViews: sources.roleViews };
    if (sources.steps.length === 0) return { ...base, error: 'The method has no steps: no methodology in the chain declares a MethodologyWorkflowStep.' };

    let workspace;
    if (input.workspace) {
        const selection = selectWorkspace(model, computeWorkspaceMembership(model, registries), input.workspace);
        if (!selection.ok) return { ...base, error: selection.message };
        workspace = selection.scope;
    }
    const validation = validateModel(model, [...constraints], registries.kindRegistry, undefined, undefined, workspace);
    const evaluation = evaluateGuide({
        steps: sources.steps, model, kinds: registries.kindRegistry, violations: validation.violations,
        workspace: workspace ? { subjects: workspace.subjects, scope: workspace.scope } : undefined,
        rules: constraints.map(c => ({ id: c.id, typeName: c.typeName, appliesToKind: c.appliesToKind })),
    });
    return { ...base, ...evaluation, workspace: workspace?.name, scope: workspace?.scope };
}
