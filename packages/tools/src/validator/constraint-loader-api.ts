// ─── Rule loader over stage 1's API JSON ─────────────────────────────────────
//
// Reads the rule definitions `collectNativeConstraints` reads from MEMO's own
// parse — `constraint def`s and `requirement def`s carrying an authored id —
// from the API JSON a stage 1 compiler wrote instead, so a project compiled by
// SysIDE or OpenSysML needs no MEMO parser to know its rules
// (plans/memo-compiler-stages-opensysml.md). Both loaders compile through
// `compileRuleDefinition`.
//
// The ontology's rules state their predicate as `predicateExpression`, with a
// portable `constraint { true }` body. That body is read here; any other body
// expression is MEMO's grammar's to compile, so a rule stating one is reported
// as not loaded rather than silently skipped or evaluated as `true`.
// ─────────────────────────────────────────────────────────────────────────────

import type { ApiElement, ApiModel } from '../stage2/api-model.js';
import { apiDefinitionFacts } from '../stage2/build-from-api.js';
import { absoluteHandoffFile } from '../stage2/handoff-files.js';
import type { CompiledConstraint, ConstraintNode } from './constraint-eval.js';
import { compileRuleDefinition, type ConstraintDiagnostic } from './constraint-loader.js';

const RULE_DEFINITIONS = ['ConstraintDefinition', 'RequirementDefinition'];

/**
 * Attributes valued by an enumeration literal. The API reader spells one as
 * `Kind::member`, MEMO's parse as the bare member, which is what the rule
 * compiler reads.
 */
const ENUMERATION_VALUED = ['severity', 'tailoring'];

/**
 * Every rule the handoff's definitions state, library and project alike.
 *
 * The handoff names files relative to their root, where rule activation keys
 * on the absolute files project resolution read (`filePackages`: file →
 * package). Given those, each rule's file is mapped back to its absolute path,
 * so a rule is activated under the package it is declared in.
 */
export function collectApiConstraints(
    api: ApiModel,
    diagnostics?: ConstraintDiagnostic[],
    filePackages?: ReadonlyMap<string, string>,
): CompiledConstraint[] {
    const byId = new Map<string, CompiledConstraint>();
    const sourceById = new Map<string, string>();
    for (const metaclass of RULE_DEFINITIONS) {
        for (const definition of api.ofType(metaclass)) {
            const file = absoluteHandoffFile(api.source(definition['@id'])?.file ?? '', api.qualifiedName(definition['@id']), filePackages);
            const { attributes, doc } = apiDefinitionFacts(api, definition);
            const attrs = withBareEnumerations(attributes);
            const ruleId = attrs['providedId'] || attrs['id'];
            if (!ruleId) continue;
            let compiled: CompiledConstraint | undefined;
            try {
                compiled = compileRuleDefinition({
                    typeName: api.name(definition['@id']) ?? '',
                    attrs,
                    doc,
                    file,
                    body: ruleBody(api, definition),
                });
            } catch (error) {
                diagnostics?.push({
                    kind: 'compile-failed',
                    ruleId,
                    file,
                    message: error instanceof Error ? error.message : String(error),
                });
                continue;
            }
            if (!compiled) continue;
            // One model holds each declaration once, so two definitions sharing
            // an id are two rules: a defect, reported as the parse loader does.
            const previous = sourceById.get(compiled.id);
            if (previous !== undefined) {
                diagnostics?.push({
                    kind: 'duplicate-id',
                    ruleId: compiled.id,
                    file,
                    message: `Rule id ${compiled.id} is declared in both ${previous} and ${file}. `
                        + 'Rule ids must be unique; which definition wins currently depends on load order.',
                });
            }
            sourceById.set(compiled.id, file);
            byId.set(compiled.id, compiled);
        }
    }
    return [...byId.values()];
}

function withBareEnumerations(attributes: Record<string, string>): Record<string, string> {
    const attrs = { ...attributes };
    for (const key of ENUMERATION_VALUED) {
        const value = attrs[key];
        if (value !== undefined && value.includes('::')) attrs[key] = value.slice(value.lastIndexOf('::') + 2);
    }
    return attrs;
}

/**
 * The boolean body of a rule definition: the result expression of the first
 * constraint it states (`constraint { true }`, `require constraint { … }`), or
 * undefined when it states none. Only a literal is read; any other expression
 * is refused, since evaluating it as anything else would change the rule.
 */
function ruleBody(api: ApiModel, definition: ApiElement): ConstraintNode | undefined {
    for (const member of api.ownedMembers(definition['@id'])) {
        if (member['@type'] !== 'ConstraintUsage') continue;
        const membership = api.ownedRelationships(member['@id'])
            .find(r => r['@type'] === 'ResultExpressionMembership');
        if (!membership) continue;
        const resultId = refsOf(membership.ownedRelatedElement)[0];
        const result = resultId ? api.element(resultId) : undefined;
        if (result?.['@type'] === 'LiteralBoolean') return { kind: 'bool', value: result.value === true };
        throw new Error(`its constraint body is a ${result?.['@type'] ?? 'missing'} expression, which only MEMO's own `
            + 'parser compiles into a rule; state the predicate as `predicateExpression` with a `constraint { true }` body.');
    }
    return undefined;
}

function refsOf(value: unknown): string[] {
    const isRef = (v: unknown): v is { '@id': string } =>
        typeof v === 'object' && v !== null && typeof (v as { '@id'?: unknown })['@id'] === 'string';
    return Array.isArray(value) ? value.filter(isRef).map(r => r['@id']) : isRef(value) ? [value['@id']] : [];
}
