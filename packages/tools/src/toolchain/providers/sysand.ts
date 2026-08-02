// ─── Adapter: SysAnd package manager ─────────────────────────────────────────
//
// Registers on the same terms as every other provider — the packaging role had
// the identical `if (provider === 'sysand')` shape the compiler role had, and
// it is gone the same way.
// ─────────────────────────────────────────────────────────────────────────────

import { existsSync } from 'node:fs';
import { captureToolInvocation, probeVersion, resolveExecutable, resolveProjectPath, whichExecutable } from '../process.js';
import type { Diagnostic } from '../diagnostic.js';
import type {
    Availability,
    PackageDescriptor,
    ProviderContext,
    ProviderRunResult,
    ToolInvocation,
    ToolchainSchemaLeaf,
} from '../registry.js';
import { providerSettings } from '../effective.js';

/** The one place this string is written. */
export const SYSAND_PROVIDER_ID = 'sysand';

export interface SysandToolConfig {
    /** Executable name or path. Defaults to `sysand` on PATH. */
    executable?: string;
    /** Optional sysand.toml path, relative to the project directory. */
    configFile?: string;
}

const SETTINGS_SCHEMA: readonly ToolchainSchemaLeaf[] = [
    {
        path: `${SYSAND_PROVIDER_ID}.executable`,
        type: 'string',
        description: `Executable name or path. Defaults to \`${SYSAND_PROVIDER_ID}\` on PATH.`,
    },
    {
        path: `${SYSAND_PROVIDER_ID}.configFile`,
        type: 'string',
        description: `Path to a ${SYSAND_PROVIDER_ID}.toml, relative to the project directory.`,
    },
];

function settings(context: ProviderContext): SysandToolConfig {
    return providerSettings<SysandToolConfig>(context.config, SYSAND_PROVIDER_ID) ?? {};
}

function command(context: ProviderContext): string {
    return resolveExecutable(settings(context).executable, SYSAND_PROVIDER_ID, context.projectDir);
}

export function buildSysandInvocation(context: ProviderContext): ToolInvocation {
    const tool = settings(context);
    if (!context.outputPath) throw new Error('Packaging requires an output path.');
    const args: string[] = [];
    if (tool.configFile) args.push('--config-file', resolveProjectPath(tool.configFile, context.projectDir));
    args.push('build', context.outputPath);
    return { command: command(context), args, provider: SYSAND_PROVIDER_ID };
}

const versionCache = new Map<string, string | undefined>();

function cachedVersion(executable: string): string | undefined {
    if (!versionCache.has(executable)) {
        const raw = probeVersion(executable);
        const match = raw ? /\b(\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?)\b/.exec(raw) : undefined;
        versionCache.set(executable, match ? match[1] : raw);
    }
    return versionCache.get(executable);
}

export const sysandPackageDescriptor: PackageDescriptor = {
    id: SYSAND_PROVIDER_ID,
    role: 'package',
    capabilities: ['pack'],
    settingsSchema: SETTINGS_SCHEMA,
    probe(context: ProviderContext): Availability {
        const executable = whichExecutable(command(context));
        if (!executable) {
            return {
                available: false,
                transport: 'process',
                detail: `"${command(context)}" was not found on PATH.`,
            };
        }
        return {
            available: true,
            transport: 'process',
            executable,
            version: cachedVersion(executable),
        };
    },
    create(context: ProviderContext) {
        return {
            id: SYSAND_PROVIDER_ID,
            role: 'package' as const,
            transport: 'process' as const,
            invocation: () => buildSysandInvocation(context),
            async run(): Promise<ProviderRunResult> {
                const invocation = buildSysandInvocation(context);
                const result = captureToolInvocation(invocation, context.projectDir);
                const version = cachedVersion(invocation.command);
                const diagnostics: Diagnostic[] = [];
                if (result.status !== 0) {
                    const detail = `${result.stderr}\n${result.stdout}`.trim();
                    diagnostics.push({
                        domain: 'sysml',
                        provider: SYSAND_PROVIDER_ID,
                        providerVersion: version,
                        severity: 'error',
                        message:
                            `${SYSAND_PROVIDER_ID} exited with status ${result.status ?? 'unknown'}.`
                            + (detail ? ` ${detail}` : ''),
                    });
                }
                // Packaging is the one role with a checkable postcondition:
                // either the artifact is there or the run did not do its job,
                // whatever it printed.
                if (result.status === 0 && !existsSync(context.outputPath!)) {
                    throw new Error(
                        `${SYSAND_PROVIDER_ID} completed but did not create ${context.outputPath}.`);
                }
                return {
                    provider: SYSAND_PROVIDER_ID,
                    providerVersion: version,
                    transport: 'process',
                    accepted: result.status === 0,
                    diagnostics,
                    exitCode: result.status ?? undefined,
                };
            },
        };
    },
};
