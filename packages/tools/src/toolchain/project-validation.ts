// ─── Validate a loaded project with its effective rule set ───────────────────
//
// The rules a project is judged by are the ontology's and the project's own rule definitions,
// activated by its methodology's scope and tailored by its policies (`resolveProjectRules`), run on
// the elements that scope selects. `memo validate`, `memo validate --rules` and the dev server each
// assemble that set; a caller that only has a loaded project (the MCP server, `memo ask`, the DHF
// drafter) asks here, so an agent checking its work sees the findings Architect shows.
//
// Rule resolution never takes the caller down: a bad policy is returned as a diagnostic, and the
// project's rule definitions still run, untailored.
// ─────────────────────────────────────────────────────────────────────────────

import { loadMethodologyDescriptor } from '../model/methodology-loader.js';
import { isRulePackageInScope, resolveProjectRules, scopedSubjectIds } from '../model/effective-scope.js';
import { computeWorkspaceMembership, type WorkspaceScope } from '../model/workspace-membership.js';
import { isProjectSource } from '../stage2/project-from-api.js';
import { validateModel } from '../validator/rule-engine.js';
import type { ValidationResult } from '../validator/types.js';
import type { EffectiveRule } from '../model/methodology-resolver.js';
import { projectConstraints, type ProjectModel } from './project-model.js';

export interface ProjectValidation {
    validation: ValidationResult;
    /** The effective rules, with their dispositions; empty when resolution failed. */
    rules: EffectiveRule[];
    /** Why the effective rule set is not the one the methodology describes, if it is not. */
    diagnostics: string[];
}

export async function validateProject(
    projectRoot: string,
    project: ProjectModel,
    options: { workspace?: WorkspaceScope } = {},
): Promise<ProjectValidation> {
    const { model, registries, resolution } = project;
    const kindRegistry = registries?.kindRegistry;
    const relationshipRegistry = registries?.relationshipRegistry;
    const constraints = projectConstraints(project);
    const membership = kindRegistry && relationshipRegistry
        ? computeWorkspaceMembership(model, registries!)
        : undefined;
    const filePackages = resolution?.filePackages ?? new Map<string, string>();
    const kindSourceFile = (kind: string) => kindRegistry?.getKind(kind)?.sourceFile;

    try {
        const descriptor = await loadMethodologyDescriptor(projectRoot, resolution, project.api);
        const { rules: resolved, scope } = resolveProjectRules({
            constraints,
            effective: descriptor.effective,
            filePackages,
            kindSourceFile,
            isOwnFile: resolution ? isProjectSource(resolution) : undefined,
        });
        // Scope decides which elements rules RUN ON, never the model they navigate.
        const inScope = scope && scope.mode !== 'allAvailable'
            ? scopedSubjectIds(model, kind => {
                const sourceFile = kindSourceFile(kind);
                const declaringPackage = sourceFile ? filePackages.get(sourceFile) : undefined;
                return !declaringPackage || isRulePackageInScope(scope, declaringPackage);
            })
            : undefined;
        const validation = validateModel(
            model, resolved.activeConstraints, kindRegistry, resolved.rules,
            inScope && (element => inScope.has(element.id)), options.workspace, membership, relationshipRegistry);
        return {
            validation,
            rules: resolved.rules,
            diagnostics: resolved.diagnostics.map(d => `${d.code}${d.ruleId ? ` [${d.ruleId}]` : ''}: ${d.message}`),
        };
    } catch (error) {
        const validation = validateModel(
            model, constraints, kindRegistry, undefined, undefined, options.workspace, membership, relationshipRegistry);
        return {
            validation,
            rules: [],
            diagnostics: [`resolution-failed: ${error instanceof Error ? error.message : String(error)}`],
        };
    }
}
