// ─── memo element ────────────────────────────────────────────────────────────
//
// The CLI half of authoring write-back.
//
// Write-back moved onto the IR in Session 7 and got a server protocol handler,
// but no command — so the one operation Architect uses to change a model was
// reachable only from the UI. Plan §1.2.2 rule 2 says a capability that exists
// only in the server is a defect, and this closes it: the same
// `operations/authoring.ts` implementation, the same identity addressing, the
// same lowering provider.
//
//   memo element identities  — what to quote when addressing an element
//   memo element write       — edit one declaration and recompile
//
// `identities` is not a convenience. An update is addressed by IR identity, and
// an identity is minted by a lowering — so without a command that prints them,
// `write` could create but never update, and the CLI surface would be a
// different capability wearing the same name as the server's.
// ─────────────────────────────────────────────────────────────────────────────

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import chalk from 'chalk';
import { loadProjectSettings } from '../model/config-loader.js';
import { recompileProject, writeElement, type AuthoringContext } from '../operations/authoring.js';
import type { ElementWriteRequest } from '../server/persistor.js';

export interface ElementCliOptions extends Record<string, unknown> {
    format?: 'text' | 'json';
}

export interface ElementIdentitiesOptions extends ElementCliOptions {
    /** Restrict output to one element ID. */
    id?: string;
}

export interface ElementWriteOptions extends ElementCliOptions {
    id?: string;
    name?: string;
    kind?: string;
    construct?: string;
    layer?: string;
    doc?: string;
    file?: string;
    /** `key=value`, repeatable. */
    attribute?: string[];
    irIdentity?: string;
    renamedFrom?: string;
    /** A JSON file holding a whole `ElementWriteRequest`. */
    request?: string;
    /**
     * Resolve the identity from the element ID instead of quoting one.
     *
     * Convenience with a real cost: it recompiles, looks the element up by ID,
     * and writes against whatever it found — so it cannot detect that the
     * caller was working from a stale view. Fine at a shell prompt, wrong for a
     * script that read the model earlier, which should quote `--ir-identity`.
     */
    byId?: boolean;
}

function contextFor(dir: string): AuthoringContext {
    const projectDir = resolve(dir);
    return { projectDir, config: loadProjectSettings(projectDir) };
}

/** `k=v` pairs; a repeated key is a mistake worth naming rather than merging. */
function parseAttributes(pairs: readonly string[] | undefined): Record<string, string> {
    const attributes: Record<string, string> = {};
    for (const pair of pairs ?? []) {
        const equals = pair.indexOf('=');
        if (equals <= 0) throw new Error(`--attribute expects key=value, got "${pair}".`);
        const key = pair.slice(0, equals);
        if (key in attributes) throw new Error(`--attribute ${key} was given twice.`);
        attributes[key] = pair.slice(equals + 1);
    }
    return attributes;
}

/**
 * Every declaration the last lowering produced, addressable or not.
 *
 * Listing `byMemoElement` alone would have been the obvious thing and would
 * have been wrong. MEMO's projection is flat — an element is keyed by its bare
 * ID — so two declarations named `pump` in different packages project to *one*
 * Memo element, and a Memo-keyed table can name only one of them. The IR keeps
 * both, and a write is addressed by IR identity rather than by Memo element, so
 * the second is perfectly writable; it just has no row in the Memo-keyed table.
 * Listing the IR side means the command can address everything the write path
 * can, and the `element` column is simply empty where the projection dropped
 * the declaration.
 */
function identityRows(revision: Awaited<ReturnType<typeof recompileProject>>): { identity: string; element?: string; metaclass: string }[] {
    return [...revision.index.byIdentity.values()]
        .map(entry => ({ identity: entry.identity.id, element: entry.memoElementId, metaclass: entry.identity.metaclass }))
        .sort((a, b) => (a.identity < b.identity ? -1 : a.identity > b.identity ? 1 : 0));
}

export async function elementIdentitiesCommand(dir: string, options: ElementIdentitiesOptions = {}): Promise<void> {
    const revision = await recompileProject(contextFor(dir));
    const rows = identityRows(revision).filter(row => !options.id || row.element === options.id);

    if (options.format === 'json') {
        console.log(JSON.stringify({
            provider: revision.provider,
            // Memo-keyed, for a caller that holds an element ID. Lossy where
            // two declarations share a name; `declarations` is not.
            identities: options.id
                ? Object.fromEntries(Object.entries(revision.index.byMemoElement).filter(([id]) => id === options.id))
                : revision.index.byMemoElement,
            declarations: rows,
        }, null, 2));
        return;
    }

    if (options.id && rows.length === 0) {
        // Distinguishing the two is worth a sentence: an element that exists
        // but did not project has no Memo-keyed row, and the fix for that is
        // not the fix for a typo in the ID.
        const known = revision.ir.model.elements?.[options.id] !== undefined;
        console.error(chalk.red(known
            ? `"${options.id}" is in the model but the projection did not map it to a declaration.`
            : `No element "${options.id}" in this project.`));
        process.exit(1);
        return;
    }

    const width = Math.max(7, ...rows.map(row => (row.element ?? '').length));
    console.log('');
    console.log(chalk.dim(`lowering provider: ${revision.provider}`));
    console.log('');
    console.log(`${'element'.padEnd(width)}  ir-identity`);
    for (const row of rows) {
        const label = row.element ?? chalk.dim(`(${row.metaclass})`);
        console.log(`${label.padEnd(width + (row.element ? 0 : 10))}  ${row.identity}`);
    }
    console.log('');
    const unmapped = rows.filter(row => !row.element).length;
    console.log(chalk.dim(
        `${rows.length} addressable declaration(s)`
        + (unmapped > 0 ? `; ${unmapped} not projected to a Memo element` : ''),
    ));
}

export async function elementWriteCommand(dir: string, options: ElementWriteOptions = {}): Promise<void> {
    const context = contextFor(dir);
    let request: ElementWriteRequest;
    try {
        request = options.request
            ? JSON.parse(readFileSync(resolve(options.request), 'utf8')) as ElementWriteRequest
            : {
                id: options.id ?? '',
                ...(options.name !== undefined ? { name: options.name } : {}),
                ...(options.kind !== undefined ? { kind: options.kind } : {}),
                ...(options.construct !== undefined ? { construct: options.construct } : {}),
                ...(options.layer !== undefined ? { layer: options.layer } : {}),
                ...(options.doc !== undefined ? { doc: options.doc } : {}),
                ...(options.file !== undefined ? { file: options.file } : {}),
                ...(options.irIdentity !== undefined ? { irIdentity: options.irIdentity } : {}),
                ...(options.renamedFrom !== undefined ? { renamedFrom: options.renamedFrom } : {}),
                attributes: parseAttributes(options.attribute),
            };
        if (!request.id) throw new Error('An element write needs --id (or a --request file that carries one).');
    } catch (error) {
        console.error(chalk.red(error instanceof Error ? error.message : String(error)));
        process.exit(1);
        return;
    }

    // The index the write resolves against. The server holds one because it is
    // long-lived; a command has to compile for it, which is also what makes
    // `--by-id` possible at all.
    const before = await recompileProject(context);
    if (options.byId && !request.irIdentity) {
        const identity = before.index.byMemoElement[request.id];
        if (identity) request.irIdentity = identity;
    }

    const result = await writeElement({ ...context, irIndex: before.index }, request);

    if (options.format === 'json') {
        console.log(JSON.stringify({
            success: result.success,
            sourceFile: result.filePath,
            replaced: result.replaced ?? false,
            stale: result.stale ?? false,
            ...(result.warnings ? { warnings: result.warnings } : {}),
            ...(result.error ? { error: result.error } : {}),
            ...(result.revision ? {
                provider: result.revision.provider,
                irIdentity: result.revision.index.byMemoElement[request.id],
                diagnostics: result.revision.diagnostics.length,
            } : {}),
        }, null, 2));
        if (!result.success) process.exit(1);
        return;
    }

    if (!result.success) {
        console.error(chalk.red(result.error ?? 'The write failed.'));
        // A stale address is not a malformed request, and the remedy differs:
        // re-read the identities and repeat the edit.
        if (result.stale) console.error(chalk.dim('Run `memo element identities` for the current addresses.'));
        process.exit(1);
        return;
    }

    console.log(chalk.green(`${result.replaced ? 'Updated' : 'Created'} ${request.id}`), chalk.dim(`in ${result.filePath}`));
    for (const warning of result.warnings ?? []) console.log(chalk.yellow(`  ${warning.code}: ${warning.message}`));
    if (result.revision) {
        const identity = result.revision.index.byMemoElement[request.id];
        console.log(chalk.dim(`  recompiled by ${result.revision.provider}; ${result.revision.diagnostics.length} diagnostic(s)`));
        if (identity) console.log(chalk.dim(`  ir-identity: ${identity}`));
    }
}
