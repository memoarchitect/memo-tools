// ─── Adapter: MEMO's own compiler and packager ───────────────────────────────
//
// The internal tool is a plugin like any other. It gets no early return, no
// `if (provider === …)` shortcut, and no privileges the registry does not give
// every descriptor. The only thing it does claim is `isDefault`, which is a
// declaration made here in the adapter rather than a `?? 'internal'` written
// into core code — that is the whole difference between "the default" and "the
// special case".
//
// Its transport is `in-process` today. §1.2.1 replaces that with a spawned
// `sysmlc` speaking the same interface; when it does, only this file changes.
// ─────────────────────────────────────────────────────────────────────────────

import { existsSync } from 'node:fs';
import { defaultSeverityForDomain, type Diagnostic, type DiagnosticDomain } from '../diagnostic.js';
import { findSysmlFiles } from '../../model/sysml-files.js';
import { parseFiles } from '../../model/parser-utils.js';
import type { ParseError } from '../../model/semantic.js';
import { writeInternalKpar } from './internal-kpar.js';
import type {
    Availability,
    LoweringDescriptor,
    LoweringRunResult,
    PackageDescriptor,
    ProviderContext,
    ProviderRunResult,
    ValidatorDescriptor,
} from '../registry.js';

/** The one place this string is written. Everything else reads it from here. */
export const INTERNAL_PROVIDER_ID = 'internal';

const CAPABILITIES = ['check', 'lower', 'emit-ir'] as const;

/** MEMO's own version, reported the way an external tool reports `--version`. */
function internalVersion(): string | undefined {
    return process.env.MEMO_VERSION;
}

function available(): Availability {
    return { available: true, transport: 'in-process', version: internalVersion() };
}

function toDiagnostics(errors: readonly ParseError[], domain: DiagnosticDomain): Diagnostic[] {
    return errors.map(error => ({
        domain,
        provider: INTERNAL_PROVIDER_ID,
        providerVersion: internalVersion(),
        severity: defaultSeverityForDomain(domain),
        message: error.message,
        file: error.file,
        range: error.line !== undefined
            ? { start: { line: error.line, column: error.column ?? 1 } }
            : undefined,
    }));
}

async function parseProject(context: ProviderContext) {
    const files = findSysmlFiles(context.projectDir);
    return parseFiles(files, `${context.projectDir}/`);
}

/**
 * Validator role — "is this valid SysML?" answered by MEMO's Langium grammar.
 *
 * The grammar is a MEMO subset, so this answers a narrower question than
 * `syside` does. That is exactly why the roles are separate and why a failure
 * here, when another validator accepted the file, is an ingest problem rather
 * than a SysML error.
 */
export const internalValidatorDescriptor: ValidatorDescriptor = {
    id: INTERNAL_PROVIDER_ID,
    role: 'validator',
    capabilities: ['check'],
    isDefault: true,
    probe: available,
    create(context: ProviderContext) {
        return {
            id: INTERNAL_PROVIDER_ID,
            role: 'validator' as const,
            transport: 'in-process' as const,
            invocation: () => undefined,
            async run(): Promise<ProviderRunResult> {
                const { errors } = await parseProject(context);
                return {
                    provider: INTERNAL_PROVIDER_ID,
                    providerVersion: internalVersion(),
                    transport: 'in-process',
                    accepted: errors.length === 0,
                    diagnostics: toDiagnostics(errors, 'sysml'),
                };
            },
        };
    },
};

/**
 * Lowering role — "what can MEMO ingest from this revision?"
 *
 * Its diagnostics are `memo-ingest` by construction: this step is MEMO reading
 * the source, so anything it cannot read is MEMO's limitation to report, not a
 * verdict on the source. When MEMO is also the validator the caller collapses
 * the duplicate, so one failure is still reported once.
 */
export const internalLoweringDescriptor: LoweringDescriptor = {
    id: INTERNAL_PROVIDER_ID,
    role: 'lowering',
    capabilities: [...CAPABILITIES],
    isDefault: true,
    probe: available,
    create(context: ProviderContext) {
        return {
            id: INTERNAL_PROVIDER_ID,
            role: 'lowering' as const,
            transport: 'in-process' as const,
            invocation: () => undefined,
            async run(): Promise<LoweringRunResult> {
                const { documents, errors } = await parseProject(context);
                return {
                    provider: INTERNAL_PROVIDER_ID,
                    providerVersion: internalVersion(),
                    transport: 'in-process',
                    accepted: errors.length === 0,
                    diagnostics: toDiagnostics(errors, 'memo-ingest'),
                    documents,
                    parseErrors: errors,
                };
            },
        };
    },
};

/** Package role — the built-in gzip-tar KPAR writer. */
export const internalPackageDescriptor: PackageDescriptor = {
    id: INTERNAL_PROVIDER_ID,
    role: 'package',
    capabilities: ['pack'],
    isDefault: true,
    probe: available,
    create(context: ProviderContext) {
        return {
            id: INTERNAL_PROVIDER_ID,
            role: 'package' as const,
            transport: 'in-process' as const,
            invocation: () => undefined,
            async run(): Promise<ProviderRunResult> {
                const outputPath = context.outputPath;
                if (!outputPath) throw new Error('Packaging requires an output path.');
                await writeInternalKpar(
                    context.projectDir, outputPath, context.config.projectName || 'memo-project');
                if (!existsSync(outputPath)) {
                    throw new Error(`${INTERNAL_PROVIDER_ID} completed but did not create ${outputPath}.`);
                }
                return {
                    provider: INTERNAL_PROVIDER_ID,
                    providerVersion: internalVersion(),
                    transport: 'in-process',
                    accepted: true,
                    diagnostics: [],
                };
            },
        };
    },
};
