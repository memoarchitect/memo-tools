// ─── Adapter: MEMO's own compiler and packager ───────────────────────────────
//
// The internal tool is a plugin like any other. It gets no early return, no
// `if (provider === …)` shortcut, and no privileges the registry does not give
// every descriptor. The only thing it does claim is `isDefault`, which is a
// declaration made here in the adapter rather than a `?? 'internal'` written
// into core code — that is the whole difference between "the default" and "the
// special case".
//
// §1.2.1 removed the last asymmetry: MEMO's compiler ships as its own tool,
// `@memoarchitect/sysmlc`, and this adapter can reach it over the same protocol
// a third party's compiler would speak. Two transports, one interface:
//
//   in-process   call `lowerProject` directly. The fast path, and the default,
//                because it is what a clean install with an empty PATH has.
//   process      spawn `sysmlc serve --stdio` and speak the protocol. Slower to
//                start, and the only transport that proves the contract is real
//                — over a pipe you cannot pass an object by reference or skip
//                serialization. CI runs this one.
//
// Both call the same `lowerProject`, which is why they can be byte-identical
// rather than merely intended to agree.
// ─────────────────────────────────────────────────────────────────────────────

import { existsSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defaultSeverityForDomain, type Diagnostic, type DiagnosticDomain } from '../diagnostic.js';
import { checkProject, lowerProject } from '../lowering.js';
import type { MemoIr } from '../protocol.js';
import type { ParseError } from '../../model/semantic.js';
import { findBundledExecutable, probeVersion, resolveExecutable, whichExecutable } from '../process.js';
import { getSysmlcClient } from '../sysmlc-client.js';
import { writeInternalKpar } from './internal-kpar.js';
import type {
    Availability,
    LoweringDescriptor,
    LoweringRunResult,
    PackageDescriptor,
    ProviderContext,
    ProviderRunResult,
    Transport,
    ToolchainSchemaLeaf,
    ValidatorDescriptor,
} from '../registry.js';
import { providerSettings } from '../effective.js';

/** The one place this string is written. Everything else reads it from here. */
export const INTERNAL_PROVIDER_ID = 'internal';

/** The binary this adapter speaks to when the transport is `process`. */
export const SYSMLC_COMMAND = 'sysmlc';

const CAPABILITIES = ['check', 'lower', 'emit-ir'] as const;

/**
 * The transport used when the project configures none.
 *
 * Measured on GPCA (`scripts/measure-transport-latency.mjs`, 2026-08-02):
 * a warm refresh costs 298 ms in-process and 332 ms over the pipe, against a
 * 500 ms refresh budget — so the process transport **makes** budget, and §2.1's
 * "keep in-process if it misses" clause was not triggered.
 *
 * It stays the default anyway, for the cost the warm number hides: the first
 * request pays 632 ms for spawn and handshake, which a one-shot `memo validate`
 * pays in full and never amortises. In-process is strictly cheaper for the
 * commands that run once, and is what a clean install with an empty PATH has.
 * CI exercises the other one, so switching is a config change rather than a
 * project — and this constant is the whole of the switch.
 */
const DEFAULT_TRANSPORT: Transport = 'in-process';

export interface InternalToolConfig {
    /** `in-process` (default) or `process`. */
    transport?: Transport;
    /** Path to a `sysmlc` binary. Defaults to the bundled one, then PATH. */
    executable?: string;
}

const TRANSPORTS: readonly Transport[] = ['in-process', 'process'];

const SETTINGS_SCHEMA: readonly ToolchainSchemaLeaf[] = [
    {
        path: `${INTERNAL_PROVIDER_ID}.transport`,
        type: 'enum',
        values: TRANSPORTS,
        description:
            `How MEMO's own compiler is reached. \`process\` spawns \`${SYSMLC_COMMAND} serve --stdio\` `
            + `and speaks the versioned protocol; \`in-process\` calls it directly. Defaults to `
            + `${DEFAULT_TRANSPORT}.`,
    },
    {
        path: `${INTERNAL_PROVIDER_ID}.executable`,
        type: 'string',
        description:
            `Path to a \`${SYSMLC_COMMAND}\` binary, for the \`process\` transport. Defaults to the `
            + 'bundled one, and then to PATH.',
    },
];

function settings(context: ProviderContext): InternalToolConfig {
    return providerSettings<InternalToolConfig>(context.config, INTERNAL_PROVIDER_ID) ?? {};
}

function transport(context: ProviderContext): Transport {
    const configured = settings(context).transport;
    return configured && TRANSPORTS.includes(configured) ? configured : DEFAULT_TRANSPORT;
}

/** MEMO's own version, reported the way an external tool reports `--version`. */
function internalVersion(): string | undefined {
    return process.env.MEMO_VERSION;
}

/**
 * Where `sysmlc` is, without the user having been asked to do anything.
 *
 * Configured path first, then the binary bundled beside this install, then
 * PATH. The middle step is the one that matters: Architect depends on the
 * compiler package, so an Architect install already has it — resolving it is
 * MEMO's job, not the user's.
 */
export function resolveSysmlcCommand(context: ProviderContext): string {
    const configured = settings(context).executable;
    if (configured) return resolveExecutable(configured, SYSMLC_COMMAND, context.projectDir);
    const bundled = findBundledExecutable(SYSMLC_COMMAND, [
        context.projectDir,
        dirname(fileURLToPath(import.meta.url)),
    ]);
    return bundled ?? SYSMLC_COMMAND;
}

function client(context: ProviderContext) {
    return getSysmlcClient({
        command: resolveSysmlcCommand(context),
        projectDir: context.projectDir,
        providerId: INTERNAL_PROVIDER_ID,
    });
}

function probeFor(context: ProviderContext): Availability {
    if (transport(context) === 'in-process') {
        return { available: true, transport: 'in-process', version: internalVersion() };
    }
    const command = resolveSysmlcCommand(context);
    const executable = whichExecutable(command);
    if (!executable) {
        return {
            available: false,
            transport: 'process',
            detail: `"${command}" was not found on PATH or bundled with this install.`,
        };
    }
    return {
        available: true,
        transport: 'process',
        executable,
        version: probeVersion(executable) ?? internalVersion(),
    };
}

/**
 * Normalize parse errors into the caller's domain.
 *
 * `providerVersion` is this process's, never the server's, so the same defect
 * reads identically whichever transport found it. The version of the compiler
 * is worth knowing, and `memo toolchain probe` is where it is reported; a
 * diagnostic list that changed shape with the transport would make the
 * byte-identity test a test of nothing.
 */
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

async function ir(context: ProviderContext): Promise<MemoIr> {
    return transport(context) === 'process'
        ? client(context).emitIr()
        : lowerProject(context.projectDir, context.registries);
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
    settingsSchema: SETTINGS_SCHEMA,
    probe: probeFor,
    create(context: ProviderContext) {
        const mode = transport(context);
        return {
            id: INTERNAL_PROVIDER_ID,
            role: 'validator' as const,
            transport: mode,
            invocation: () => mode === 'process'
                ? { command: resolveSysmlcCommand(context), args: ['serve', '--stdio'], provider: INTERNAL_PROVIDER_ID }
                : undefined,
            async run(): Promise<ProviderRunResult> {
                // Checking needs parse errors and nothing else. Over the process
                // transport it rides on `memo/emitIr` rather than earning a
                // second custom request — the server answers a repeat request
                // for an unchanged revision from cache, so a snapshot that runs
                // both roles still compiles once.
                const { parseErrors } = mode === 'process'
                    ? await client(context).emitIr()
                    : await checkProject(context.projectDir);
                return {
                    provider: INTERNAL_PROVIDER_ID,
                    providerVersion: internalVersion(),
                    transport: mode,
                    accepted: parseErrors.length === 0,
                    diagnostics: toDiagnostics(parseErrors, 'sysml'),
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
    settingsSchema: SETTINGS_SCHEMA,
    probe: probeFor,
    create(context: ProviderContext) {
        const mode = transport(context);
        return {
            id: INTERNAL_PROVIDER_ID,
            role: 'lowering' as const,
            transport: mode,
            invocation: () => mode === 'process'
                ? { command: resolveSysmlcCommand(context), args: ['serve', '--stdio'], provider: INTERNAL_PROVIDER_ID }
                : undefined,
            async run(): Promise<LoweringRunResult> {
                const payload = await ir(context);
                return {
                    provider: INTERNAL_PROVIDER_ID,
                    providerVersion: internalVersion(),
                    transport: mode,
                    accepted: payload.accepted,
                    diagnostics: toDiagnostics(payload.parseErrors, 'memo-ingest'),
                    ir: payload,
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
    probe: () => ({ available: true, transport: 'in-process', version: internalVersion() }),
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
