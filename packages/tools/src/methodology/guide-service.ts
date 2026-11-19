import { functionalDisplayIds, functionalScope } from '../model/functional-scope.js';
// ─── The Guide for one workspace, from a built project ───────────────────────
//
// The steps come from the methodologies in the effective chain (read from the handoff), the findings from
// validation scoped to the workspace as `memo validate --workspace` scopes it, and the evaluation is
// `evaluateGuide`. Used by the server's `guide:evaluate` and by tests; nothing here writes.
// ─────────────────────────────────────────────────────────────────────────────

import type { BuilderRegistries } from '../model/complete-model.js';
import { modelToDTO, type MemoModel } from '../model/semantic.js';
import { computeWorkspaceMembership, selectWorkspace, workspaceMembershipToDTO } from '../model/workspace-membership.js';
import { readGuideSources, type GuideLayer, type GuideRoleView } from '../stage2/guide-from-api.js';
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
    /** The rows of the method map, base methodology first. */
    layers: GuideLayer[];
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
    const base: GuideResult = { steps: [], methodologies: [...packages], layers: sources.layers, roleViews: sources.roleViews };
    if (sources.steps.length === 0) return { ...base, error: 'The method has no steps: no methodology in the chain declares a MethodologyWorkflowStep.' };

    let workspace;
    if (input.workspace) {
        const membership = computeWorkspaceMembership(model, registries);
        const selection = selectWorkspace(model, membership, input.workspace);
        if (!selection.ok) return { ...base, error: selection.message };
        const dto = modelToDTO(model, {
            registries: { kinds: registries.kindRegistry?.toDefinitionDTOs() ?? [], relationships: registries.relationshipRegistry?.toDefinitionDTOs() ?? [] },
            workspaceMembership: workspaceMembershipToDTO(membership, model),
        });
        const scope = functionalScope(dto, selection.scope.root);
        const subjects = functionalDisplayIds(dto, selection.scope.root, selection.scope.subjects);
        // Context preserves a drawing's path, but is not this team's own work for completion checks.
        for (const id of scope.context) subjects.delete(id);
        workspace = { ...selection.scope, subjects, foreign: new Set([...model.elements.keys()].filter(id => !subjects.has(id))) };
    }
    const validation = validateModel(model, [...constraints], registries.kindRegistry, undefined, undefined, workspace, undefined, registries.relationshipRegistry);
    const evaluation = evaluateGuide({
        steps: sources.steps, model, kinds: registries.kindRegistry, violations: validation.violations,
        workspace: workspace ? { subjects: workspace.subjects, scope: workspace.scope } : undefined,
        rules: constraints.map(c => ({ id: c.id, typeName: c.typeName, appliesToKind: c.appliesToKind })),
    });
    return { ...base, ...evaluation, workspace: workspace?.name, scope: workspace?.scope };
}
