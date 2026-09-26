// ─── Validator exceptions — a provider's known gaps, excepted case by case ───
//
// The OMG SysML v2 specification defines valid SysML; a validator provider is
// a check of compatibility with it. Where a provider rejects what the
// specification admits, the source keeps the specification's form and the
// disagreement is written down, one case at a time, in a register beside the
// sources it covers:
//
//   validator-exceptions.json
//   { "exceptions": [ { id, provider, file, code, spec, providerVersion, board, note } ] }
//
// An entry excuses one diagnostic CODE from one PROVIDER in one FILE, the path
// relative to the project directory. Matching is by code, never by message
// text, for the reason diagnostic.ts gives: an exception has to survive a
// provider upgrade that rewords its messages. `note` says in words what the
// provider reports; `spec` names the BNF production (file:line) or the
// constraint that makes the source valid — the reason this is the provider's
// gap and not the model's; `board` names the KANBAN row tracking it.
//
// Entries are scoped to their provider, so switching `toolchain.validator`
// neither applies one engine's exceptions to another nor reports them stale.
// For the provider that ran, an entry that matched nothing IS stale — the
// provider was fixed or the source changed — and must be deleted, so the
// register cannot outlive the gaps it records. Nothing is excepted by code
// alone or by directory.
// ─────────────────────────────────────────────────────────────────────────────

import { existsSync, readFileSync } from 'node:fs';
import { isAbsolute, relative, resolve } from 'node:path';
import type { Diagnostic } from './diagnostic.js';

export const VALIDATOR_EXCEPTIONS_FILE = 'validator-exceptions.json';

export interface ValidatorException {
    id: string;
    provider: string;
    file: string;
    code: string;
    spec: string;
    providerVersion: string;
    board: string;
    note: string;
}

const REQUIRED: readonly (keyof ValidatorException)[] = [
    'id', 'provider', 'file', 'code', 'spec', 'providerVersion', 'board', 'note',
];

/** Reads and validates a register. A missing file is an empty register. */
export function readValidatorExceptions(path: string): ValidatorException[] {
    if (!existsSync(path)) return [];
    const parsed = JSON.parse(readFileSync(path, 'utf-8')) as { exceptions?: Partial<ValidatorException>[] };
    const exceptions = parsed.exceptions ?? [];
    for (const exception of exceptions) {
        const missing = REQUIRED.filter(field => typeof exception[field] !== 'string' || exception[field] === '');
        if (missing.length > 0) {
            throw new Error(`${path}: exception ${exception.id ?? '(no id)'} lacks ${missing.join(', ')}`);
        }
    }
    const ids = exceptions.map(exception => exception.id);
    const repeated = ids.filter((id, index) => ids.indexOf(id) !== index);
    if (repeated.length > 0) throw new Error(`${path}: duplicate exception id ${repeated.join(', ')}`);
    return exceptions as ValidatorException[];
}

export interface ExceptionOutcome {
    excepted: { diagnostic: Diagnostic; exception: ValidatorException }[];
    remaining: Diagnostic[];
    /** Entries for the provider that ran which matched nothing. */
    stale: ValidatorException[];
}

/** A diagnostic's file relative to the project, which is how entries name it. */
export function projectRelative(file: string | undefined, projectDir: string): string | undefined {
    if (!file) return undefined;
    return isAbsolute(file) ? relative(projectDir, file) : relative(projectDir, resolve(projectDir, file));
}

export function applyValidatorExceptions(
    diagnostics: readonly Diagnostic[],
    exceptions: readonly ValidatorException[],
    provider: string,
    projectDir: string,
): ExceptionOutcome {
    const applicable = exceptions.filter(exception => exception.provider === provider);
    const used = new Set<string>();
    const excepted: ExceptionOutcome['excepted'] = [];
    const remaining: Diagnostic[] = [];
    for (const diagnostic of diagnostics) {
        const file = projectRelative(diagnostic.file, projectDir);
        const exception = diagnostic.code === undefined || file === undefined
            ? undefined
            : applicable.find(candidate => candidate.file === file && candidate.code === diagnostic.code);
        if (exception) {
            used.add(exception.id);
            excepted.push({ diagnostic, exception });
        } else {
            remaining.push(diagnostic);
        }
    }
    return { excepted, remaining, stale: applicable.filter(exception => !used.has(exception.id)) };
}
