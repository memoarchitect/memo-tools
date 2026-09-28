// ─── OpenSysML as a validator ────────────────────────────────────────────────
//
// `toolchain.validator: opensysml` checks the project with OpenSysML's service,
// reached through its Node client (`@opensysml/client`), which starts one
// `sysml-grpc` child per MEMO process or connects to one already running
// (`opensysml.service`, `$OPENSYSML_SERVICE`). The project and its library
// roots are parsed as one model (`ParseSources`), and every document's
// diagnostics come back located (plans/memo-compiler-stages-opensysml.md).
//
// The service caches a parsed model by content, so a long-lived one (memo dev,
// Architect) re-parses only when a file changes.
//
// The client is not on npm yet, so it is imported from `opensysml.client`, a
// path to a built checkout's `dist/node/index.js`, else the package name.
// ─────────────────────────────────────────────────────────────────────────────

import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { MEMOConfig } from '../../model/config.js';
import { findSysmlFiles } from '../../model/sysml-files.js';
import type { Diagnostic, DiagnosticSeverity } from '../diagnostic.js';
import { providerSettings } from '../effective.js';
import type {
    Availability,
    ProviderContext,
    ProviderRunResult,
    ToolchainSchemaLeaf,
    ValidatorDescriptor,
} from '../registry.js';

export const OPENSYSML_PROVIDER_ID = 'opensysml';

interface OpenSysMLConfig {
    client?: string;
    binary?: string;
    service?: string;
}

const SETTINGS_SCHEMA: readonly ToolchainSchemaLeaf[] = [
    {
        path: `${OPENSYSML_PROVIDER_ID}.client`,
        type: 'string',
        description: 'Module the Node client is imported from: a built `dist/node/index.js`, or `@opensysml/client` (the default).',
    },
    {
        path: `${OPENSYSML_PROVIDER_ID}.binary`,
        type: 'string',
        description: 'The `sysml-grpc` executable the client starts. Defaults to `$OPENSYSML_BINARY`.',
    },
    {
        path: `${OPENSYSML_PROVIDER_ID}.service`,
        type: 'string',
        description: 'Address of a running `sysml-grpc` to use instead of starting one. Defaults to `$OPENSYSML_SERVICE`.',
    },
];

function settings(config: MEMOConfig): OpenSysMLConfig {
    return providerSettings<OpenSysMLConfig>(config, OPENSYSML_PROVIDER_ID) ?? {};
}

function clientModule(config: MEMOConfig): string {
    const spec = settings(config).client ?? process.env.MEMO_OPENSYSML_CLIENT ?? '@opensysml/client';
    return spec.startsWith('.') || spec.startsWith('/') ? pathToFileURL(resolve(spec)).href : spec;
}

function binary(config: MEMOConfig): string | undefined {
    return settings(config).binary ?? process.env.OPENSYSML_BINARY;
}

function address(config: MEMOConfig): string | undefined {
    return settings(config).service ?? process.env.OPENSYSML_SERVICE;
}

/** The part of the client this provider uses. */
interface OpenSysMLClient {
    connect(options?: { address?: string }): Promise<{
        info?: { version?: string };
        rpc: {
            parseSources(request: {
                documents: { source: { case: 'filePath'; value: string } }[];
            }): Promise<{ diagnostics: ServiceDiagnostic[]; error?: string }>;
        };
        close(): Promise<void>;
    }>;
}

interface ServiceDiagnostic {
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

async function check(context: ProviderContext): Promise<ProviderRunResult> {
    const executable = binary(context.config);
    if (executable) process.env.OPENSYSML_BINARY = executable;
    let client: OpenSysMLClient;
    try {
        client = await import(clientModule(context.config)) as OpenSysMLClient;
    } catch (error) {
        throw new Error(`OpenSysML's Node client could not be loaded from "${clientModule(context.config)}": `
            + `${error instanceof Error ? error.message : error}. Set toolchain.${OPENSYSML_PROVIDER_ID}.client `
            + 'to a built checkout\'s dist/node/index.js.');
    }
    const service = address(context.config);
    const connection = await client.connect(service ? { address: service } : {});
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
        const spec = clientModule(context.config);
        if (spec.startsWith('file:') && !existsSync(new URL(spec))) {
            return { available: false, transport: 'process', detail: `the Node client "${spec}" does not exist.` };
        }
        const executable = binary(context.config);
        if (!address(context.config) && executable && !existsSync(executable)) {
            return { available: false, transport: 'process', detail: `the service "${executable}" does not exist.` };
        }
        return { available: true, transport: 'process', ...(executable ? { executable } : {}) };
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
