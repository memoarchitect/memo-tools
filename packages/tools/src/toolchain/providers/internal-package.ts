// ─── MEMO's own packager ─────────────────────────────────────────────────────
//
// The built-in gzip-tar MEMO bundle writer, selected as `toolchain.packager:
// internal`. It is a packager, not a compiler: it reads the project's files and
// writes an archive, and needs no SysML compiler to do it.
// ─────────────────────────────────────────────────────────────────────────────

import { existsSync } from 'node:fs';
import { writeInternalMemoBundle } from './internal-kpar.js';
import type { PackageDescriptor, ProviderContext, ProviderRunResult } from '../registry.js';

/** The one place this string is written. Everything else reads it from here. */
export const INTERNAL_PROVIDER_ID = 'internal';

/** MEMO's own version, reported the way an external tool reports `--version`. */
function internalVersion(): string | undefined {
    return process.env.MEMO_VERSION;
}

/** Package role — the built-in gzip-tar MEMO bundle writer. */
export const internalPackageDescriptor: PackageDescriptor = {
    id: INTERNAL_PROVIDER_ID,
    role: 'package',
    capabilities: ['pack'],
    defaultOutputName: context => `${(context.config.projectName || 'memo-project').replace(/[^a-zA-Z0-9_-]/g, '-')}.memo-bundle`,
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
                await writeInternalMemoBundle(
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
