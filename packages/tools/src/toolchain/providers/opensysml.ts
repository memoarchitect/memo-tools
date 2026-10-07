// ─── OpenSysML as a validator ────────────────────────────────────────────────
//
// `toolchain.validator: opensysml` checks the project with OpenSysML's service,
// reached through its Node client (`@openmbee/opensysml`), which starts one
// `sysml-grpc` child per MEMO process or connects to one already running
// (`opensysml.service`, `$OPENSYSML_SERVICE`). The project and its library
// roots are parsed as one model (`ParseSources`), and every document's
// diagnostics come back located (plans/memo-compiler-stages-opensysml.md).
//
// The service caches a parsed model by content, so a long-lived one (memo dev,
// Architect) re-parses only when a file changes.
//
// The client is the pinned `@openmbee/opensysml` dependency. `opensysml.client`
// may name a built checkout's `dist/node/index.js` instead, to try a client
// ahead of its release. With no `opensysml.binary` the client finds the
// `sysml-grpc` its platform package installs beside it (an optional
// dependency, `@openmbee/opensysml-sysml-grpc-<platform>-<arch>`), else one on
// `$PATH`; it downloads a release only when asked to.
// ─────────────────────────────────────────────────────────────────────────────

import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { MEMOConfig } from '../../model/config.js';
import { findSysmlFiles } from '../../model/sysml-files.js';
import type { Diagnostic, DiagnosticSeverity } from '../diagnostic.js';
import { providerSettings } from '../effective.js';
import { OPENSYSML_DISPLAY_NAME, OPENSYSML_ENV, OPENSYSML_NPM_PACKAGE, OPENSYSML_PROVIDER_ID } from './opensysml-names.js';
import type {
    Availability,
    ProviderContext,
    ProviderRunResult,
    ToolchainSchemaLeaf,
    ValidatorDescriptor,
} from '../registry.js';

export { OPENSYSML_PROVIDER_ID };

interface OpenSysMLConfig {
    client?: string;
    binary?: string;
    service?: string;
}

const SETTINGS_SCHEMA: readonly ToolchainSchemaLeaf[] = [
    {
        path: `${OPENSYSML_PROVIDER_ID}.client`,
        type: 'string',
        scope: 'user',
        description: `Module the Node client is imported from: a built \`dist/node/index.js\`, or \`${OPENSYSML_NPM_PACKAGE}\` (the default).`,
    },
    {
        path: `${OPENSYSML_PROVIDER_ID}.binary`,
        type: 'string',
        scope: 'user',
        description: `The \`sysml-grpc\` executable the client starts. Defaults to \`$${OPENSYSML_ENV.binary}\`.`,
    },
    {
        path: `${OPENSYSML_PROVIDER_ID}.service`,
        type: 'string',
        scope: 'user',
        description: `Address of a running \`sysml-grpc\` to use instead of starting one. Defaults to \`$${OPENSYSML_ENV.service}\`.`,
    },
];

function settings(config: MEMOConfig): OpenSysMLConfig {
    return providerSettings<OpenSysMLConfig>(config, OPENSYSML_PROVIDER_ID) ?? {};
}

function clientModule(config: MEMOConfig): string {
    const spec = settings(config).client ?? process.env[OPENSYSML_ENV.client] ?? OPENSYSML_NPM_PACKAGE;
    return spec.startsWith('.') || spec.startsWith('/') ? pathToFileURL(resolve(spec)).href : spec;
}

function binary(config: MEMOConfig): string | undefined {
    return settings(config).binary ?? process.env[OPENSYSML_ENV.binary];
}

function address(config: MEMOConfig): string | undefined {
    return settings(config).service ?? process.env[OPENSYSML_ENV.service];
}

/** The part of the client's connection the OpenSysML providers use. */
/**
 * One document of a parse: a file the service reads, or text the caller holds,
 * indexed under `name` — so text that is not on disk yet is reported, and
 * resolved against, as the file it will become.
 */
export type SourceDocumentRequest =
    | { source: { case: 'filePath'; value: string } }
    | { source: { case: 'content'; value: string }; name: string };

export interface OpenSysMLConnection {
    info?: { version?: string; has?(capability: string): boolean };
    rpc: {
        parseSources(request: {
            documents: SourceDocumentRequest[];
            /** The model hash of a model the caller holds results of; needs `parse_sources_affected` to be answered. */
            baseModelHash?: string;
        }): Promise<{
            modelHash: string; diagnostics: ServiceDiagnostic[]; error?: string;
            /** The documents whose results may differ from the base's; every one when the service cannot relate the base. */
            affected?: string[];
        }>;
        convert(request: {
            source: { case: 'modelHash'; value: string };
            toFormat: string;
            /** Only these documents are written; needs the `convert_documents` capability. */
            documents?: string[];
            /** The compact document in place of the element array; needs `convert_compact`. */
            compact?: boolean;
            /** With `compact`: derived properties are left out except `keepDerived`. */
            omitDerived?: boolean;
            keepDerived?: string[];
        }): Promise<{ content: string; error?: string; diagnostics: ServiceDiagnostic[] }>;
    };
    close(): Promise<void>;
}

/** The part of the client this provider uses. */
interface OpenSysMLClient {
    connect(options?: { address?: string }): Promise<OpenSysMLConnection>;
}

export interface ServiceDiagnostic {
    severity: string;
    message: string;
    code: string;
    span?: { file: string; startLine: number; startCol: number; endLine: number; endCol: number };
}

function severityOf(raw: string): DiagnosticSeverity {
    switch (raw) {
        case 'error': return 'error';
        case 'warning': return 'warning';
        default: return 'info';
    }
}

/** The documents one model holds: the project's sources, or the ones named, and every library root's. */
export function openSysMLDocuments(context: ProviderContext): string[] {
    const project = context.files && context.files.length > 0
        ? context.files.map(file => resolve(context.projectDir, file))
        : findSysmlFiles(context.projectDir);
    const libraries = (context.includeDirs ?? []).flatMap(dir => findSysmlFiles(dir));
    return [...new Set([...libraries, ...project].map(file => resolve(file)))];
}

export function toDiagnostic(d: ServiceDiagnostic, version?: string): Diagnostic {
    const span = d.span;
    return {
        domain: 'sysml',
        provider: OPENSYSML_PROVIDER_ID,
        providerVersion: version,
        severity: severityOf(d.severity),
        message: d.message,
        ...(span?.file ? { file: span.file } : {}),
        ...(span && span.startLine > 0 ? {
            range: {
                start: { line: span.startLine, column: span.startCol },
                ...(span.endLine > 0 ? { end: { line: span.endLine, column: span.endCol } } : {}),
            },
        } : {}),
        ...(d.code ? { code: d.code } : {}),
    };
}

/**
 * A connection to OpenSysML's service through its Node client: one started from
 * `toolchain.opensysml.binary`, or the running one `toolchain.opensysml.service`
 * names. The caller closes it.
 */
export async function connectOpenSysML(config: MEMOConfig): Promise<OpenSysMLConnection> {
    const executable = binary(config);
    if (executable) process.env[OPENSYSML_ENV.binary] = executable;
    let client: OpenSysMLClient;
    try {
        client = await import(clientModule(config)) as OpenSysMLClient;
    } catch (error) {
        throw new Error(`${OPENSYSML_DISPLAY_NAME}'s Node client could not be loaded from "${clientModule(config)}": `
            + `${error instanceof Error ? error.message : error}. Install ${OPENSYSML_NPM_PACKAGE}, or set `
            + `toolchain.${OPENSYSML_PROVIDER_ID}.client to a built checkout's dist/node/index.js.`);
    }
    const service = address(config);
    return client.connect(service ? { address: service } : {});
}

/** What the OpenSysML providers are configured with, for a cache key: a change re-runs stage 1. */
export function openSysMLSettingsKey(config: MEMOConfig): string {
    return `${clientModule(config)}\0${binary(config) ?? ''}\0${address(config) ?? ''}`;
}

/** Whether OpenSysML's client and service can be reached as configured. */
export function probeOpenSysML(config: MEMOConfig): Availability {
    const spec = clientModule(config);
    if (spec.startsWith('file:') && !existsSync(new URL(spec))) {
        return { available: false, transport: 'process', detail: `the Node client "${spec}" does not exist.` };
    }
    const executable = binary(config);
    if (!address(config) && executable && !existsSync(executable)) {
        return { available: false, transport: 'process', detail: `the service "${executable}" does not exist.` };
    }
    return { available: true, transport: 'process', ...(executable ? { executable } : {}) };
}

async function check(context: ProviderContext): Promise<ProviderRunResult> {
    const connection = await connectOpenSysML(context.config);
    try {
        const version = connection.info?.version;
        const documents = openSysMLDocuments(context);
        const response = await connection.rpc.parseSources({
            documents: documents.map(file => ({ source: { case: 'filePath', value: file } })),
        });
        const diagnostics = response.diagnostics.map(d => toDiagnostic(d, version));
        if (response.error) {
            diagnostics.push({
                domain: 'sysml', provider: OPENSYSML_PROVIDER_ID, providerVersion: version,
                severity: 'error', message: response.error,
            });
        }
        return {
            provider: OPENSYSML_PROVIDER_ID,
            providerVersion: version,
            transport: 'process',
            accepted: !diagnostics.some(d => d.severity === 'error'),
            diagnostics,
        };
    } finally {
        await connection.close();
    }
}

export const openSysMLValidatorDescriptor: ValidatorDescriptor = {
    id: OPENSYSML_PROVIDER_ID,
    role: 'validator',
    capabilities: ['check'],
    settingsSchema: SETTINGS_SCHEMA,
    probe(context: ProviderContext): Availability {
        return probeOpenSysML(context.config);
    },
    create(context: ProviderContext) {
        return {
            id: OPENSYSML_PROVIDER_ID,
            role: 'validator' as const,
            transport: 'process' as const,
            invocation: () => ({ command: binary(context.config) ?? 'sysml-grpc', args: [], provider: OPENSYSML_PROVIDER_ID }),
            run: () => check(context),
        };
    },
};
