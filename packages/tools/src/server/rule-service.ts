// ─── Rule service ────────────────────────────────────────────────────────────
//
// What the dev server does when a browser asks to preview or write a rule of
// the user's. It lives apart from the socket so it is one function of a
// context and a request, and a test can call it without a server.
//
// Preview and write take the same request and run the same checks, so the
// answer a person sees before saving is the answer the saved rule gives. The
// write goes through `commitSource`: a rule the compiler rejects never reaches
// the file, and a file changed since the form loaded is refused, not
// overwritten. (plans/memo-rules-domain-trace-and-editor.md)
// ─────────────────────────────────────────────────────────────────────────────

import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { selectedOutlineSource } from '../authoring/outline-source.js';
import type { MEMOConfig } from '../model/config.js';
import type { KindRegistry } from '../model/kind-registry.js';
import type { MemoModel } from '../model/semantic.js';
import type { CompiledConstraint } from '../validator/constraint-eval.js';
import type { ClauseFact } from '../validator/rule-clauses.js';
import { commitSource } from './persistor.js';
import {
    checkNewRule, conditionExpression, dryRunRule, insertRule,
    type ConditionSpec, type DryRunResult, type NewRuleRequest,
} from './rule-writer.js';

/** The project as the server last built it. */
export interface RuleServiceContext {
    projectRoot: string;
    config: MEMOConfig;
    model: MemoModel;
    kindRegistry?: KindRegistry;
    constraints: readonly CompiledConstraint[];
    clauses: readonly ClauseFact[];
    /** Absolute paths of the project's own `.sysml` files: the only ones a rule may be written into. */
    projectFiles: ReadonlySet<string>;
}

/** A rule as a form states it. */
export interface RuleFormRequest extends Omit<NewRuleRequest, 'predicateExpression'> {
    condition: ConditionSpec;
    /** The revision of `file` the form was loaded from; a write against another is refused. */
    baseRevision?: string;
}

export type RulePreview =
    | ({
        success: true; predicateExpression: string;
        /** The revision of the target file now; the write is refused if the file has moved on. */
        baseRevision?: string;
    } & DryRunResult)
    | { success: false; code: string; error: string };

export type RuleWrite =
    | { success: true; revision: string; text: string }
    | { success: false; code?: string; error: string; conflict?: boolean; revision?: string };

export function revisionOf(text: string): string {
    return createHash('sha256').update(text).digest('hex').slice(0, 16);
}

/** The checked request a form stands for, or the reason it does not. */
function prepare(context: RuleServiceContext, form: RuleFormRequest):
    { request: NewRuleRequest } | { code: string; error: string } {
    let predicateExpression: string;
    try {
        predicateExpression = conditionExpression(form.condition);
    } catch (error) {
        return { code: 'invalid-predicate', error: error instanceof Error ? error.message : String(error) };
    }
    const { condition: _condition, baseRevision: _base, ...rest } = form;
    const request: NewRuleRequest = { ...rest, predicateExpression };
    const refusal = checkNewRule(request, {
        existingIds: new Set(context.constraints.map(c => c.id)),
        existingTypeNames: new Set(context.constraints.map(c => c.typeName).filter((n): n is string => Boolean(n))),
        kindNames: context.kindRegistry ? new Set(context.kindRegistry.kindNames()) : undefined,
        clauses: context.clauses,
    });
    if (refusal) return { code: refusal.code, error: refusal.message };
    return { request };
}

/** What the rule would flag in the model as it stands. Writes nothing. */
export function previewRule(context: RuleServiceContext, form: RuleFormRequest): RulePreview {
    const prepared = prepare(context, form);
    if ('error' in prepared) return { success: false, ...prepared };
    try {
        const path = resolve(context.projectRoot, prepared.request.file);
        return {
            success: true, predicateExpression: prepared.request.predicateExpression,
            ...(context.projectFiles.has(path) && existsSync(path) ? { baseRevision: revisionOf(readFileSync(path, 'utf8')) } : {}),
            ...dryRunRule(prepared.request, context.model, context.kindRegistry),
        };
    } catch (error) {
        return { success: false, code: 'invalid-predicate', error: error instanceof Error ? error.message : String(error) };
    }
}

/** Write the rule into a file of the project, if it is sound and the file is as the form saw it. */
export async function createRule(context: RuleServiceContext, form: RuleFormRequest): Promise<RuleWrite> {
    const prepared = prepare(context, form);
    if ('error' in prepared) return { success: false, ...prepared };
    const { request } = prepared;

    const path = resolve(context.projectRoot, request.file);
    if (!context.projectFiles.has(path)) {
        return {
            success: false, code: 'bad-file',
            error: `${request.file} is not one of this project's source files. A methodology runs only the rules of the packages it includes, so a rule belongs in a file the project already has.`,
        };
    }
    if (!existsSync(path)) return { success: false, code: 'bad-file', error: `${request.file} does not exist.` };
    const onDisk = readFileSync(path, 'utf8');
    const revision = revisionOf(onDisk);
    if (form.baseRevision !== undefined && form.baseRevision !== revision) {
        return { success: false, conflict: true, revision, error: `${request.file} changed on disk; no write was made.` };
    }
    const updated = insertRule(onDisk, request);
    if (updated === undefined) {
        return { success: false, code: 'bad-file', error: `${request.file} declares no package to put the rule in.` };
    }
    const committed = await commitSource(path, request.file.replaceAll('\\', '/'), updated, selectedOutlineSource(context.projectRoot, context.config));
    if (!committed.success) return { success: false, error: committed.error ?? 'The rule was not accepted.' };
    return { success: true, revision: revisionOf(updated), text: updated };
}
