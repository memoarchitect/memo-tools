// ─── Adapter: Syside CLI ─────────────────────────────────────────────────────
//
// The best validator available today: full semantic validation, 151 stable
// rule codes, absolute paths and full ranges. It cannot emit IR (`syside 0.10.2`
// exposes only check/format/rule/viz/table), so it fills the validator role and
// nothing else — which is precisely why the validator and lowering roles are
// separate. Requiring one tool to do both would delete the only external
// provider that works.
//
// Everything Syside-specific lives here: the ID, the argument shape, the
// settings block, and the parser for its diagnostic format.
// ─────────────────────────────────────────────────────────────────────────────

import { captureToolInvocation, probeVersion, resolveExecutable, resolveProjectPath, whichExecutable } from '../process.js';
import type { Diagnostic, DiagnosticSeverity } from '../diagnostic.js';
import type {
    Availability,
    ProviderContext,
    ProviderRunResult,
    ToolInvocation,
    ToolchainSchemaLeaf,
    ValidatorDescriptor,
} from '../registry.js';
import { providerSettings } from '../effective.js';

/** The one place this string is written. */
export const SYSIDE_PROVIDER_ID = 'syside';

export interface SysideToolConfig {
    /** Executable name or path. Defaults to `syside` on PATH. */
    executable?: string;
    /** Optional syside.toml path, relative to the project directory. */
    configFile?: string;
    /** Treat Syside warnings as errors. Defaults to true. */
    warningsAsErrors?: boolean;
    /** Validation scope. Defaults to `all`. Use `none` for syntax only. */
    diagnose?: 'all' | 'external' | 'project' | 'none';
}

const DIAGNOSE_SCOPES = ['all', 'external', 'project', 'none'] as const;

const SETTINGS_SCHEMA: readonly ToolchainSchemaLeaf[] = [
    {
        path: `${SYSIDE_PROVIDER_ID}.executable`,
        type: 'string',
        description: `Executable name or path. Defaults to \`${SYSIDE_PROVIDER_ID}\` on PATH.`,
    },
    {
        path: `${SYSIDE_PROVIDER_ID}.configFile`,
        type: 'string',
        description: `Path to a ${SYSIDE_PROVIDER_ID}.toml, relative to the project directory.`,
    },
    {
        path: `${SYSIDE_PROVIDER_ID}.warningsAsErrors`,
        type: 'boolean',
        description: 'Treat warnings as errors. Defaults to true.',
    },
    {
        path: `${SYSIDE_PROVIDER_ID}.diagnose`,
        type: 'enum',
        values: DIAGNOSE_SCOPES,
        description: 'Validation scope. Defaults to all.',
    },
];

function settings(context: ProviderContext): SysideToolConfig {
    return providerSettings<SysideToolConfig>(context.config, SYSIDE_PROVIDER_ID) ?? {};
}

function command(context: ProviderContext): string {
    return resolveExecutable(settings(context).executable, SYSIDE_PROVIDER_ID, context.projectDir);
}

export function buildSysideInvocation(context: ProviderContext): ToolInvocation {
    const tool = settings(context);
    const args = ['check', '--colour', 'no', '--diagnose', tool.diagnose ?? 'all'];
    if (tool.configFile) args.push('--config', resolveProjectPath(tool.configFile, context.projectDir));
    if (tool.warningsAsErrors ?? true) args.push('--warnings-as-errors');
    // Every resolvable library root is offered as an include path. Which of
    // them the model actually uses is decided by the project's imports, not by
    // this list — an include path a file never imports contributes nothing.
    for (const includeDir of [...new Set(context.includeDirs ?? [])]) args.push('--include', includeDir);
    // `syside check` takes paths, so an explicit source list is passed through
    // as the paths rather than approximated by the directory that contains
    // them. A caller that named its files gets exactly those checked — which is
    // what makes a conformance count comparable across providers.
    if (context.files && context.files.length > 0) args.push(...[...context.files].sort());
    else args.push(context.projectDir);
    return { command: command(context), args, provider: SYSIDE_PROVIDER_ID };
}

/**
 * `syside --version` prints `syside 0.10.2 <commit>`; the commit is noise for a
 * probe listing. Reduce to the version number when the shape is recognisable,
 * and otherwise report whatever it said rather than nothing.
 */
export function normalizeSysideVersion(raw: string | undefined): string | undefined {
    if (!raw) return undefined;
    const match = /\b(\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?)\b/.exec(raw);
    return match ? match[1] : raw;
}

/**
 * Asking the tool its version is a second process spawn, and a validation run
 * already pays for one. Cache per resolved command for the life of the process.
 */
const versionCache = new Map<string, string | undefined>();

function cachedVersion(command: string): string | undefined {
    if (!versionCache.has(command)) {
        versionCache.set(command, normalizeSysideVersion(probeVersion(command)));
    }
    return versionCache.get(command);
}

/**
 * Parse Syside's diagnostic lines.
 *
 *   /abs/path/file.sysml:3:14: error (reference-error): No Type named 'X' found.
 *       3 |     part w : X;
 *         |              ^^^^
 *
 * The code in parentheses is one of the 151 published rule codes and is carried
 * through verbatim: suppression and configuration are by code, never by
 * matching message text, and a project's suppressions have to survive both a
 * Syside upgrade and an eventual engine swap.
 *
 * The caret line gives the span's width, so an end position is recoverable and
 * worth keeping — the canvas badges a range, not a point.
 */
const DIAGNOSTIC_LINE =
    /^(?<file>.+?):(?<line>\d+):(?<column>\d+):\s+(?<severity>error|warning|info|note|help)(?:\s+\((?<code>[^)]+)\))?:\s+(?<message>.*)$/;
const CARET_LINE = /^\s*\|\s*(?<carets>\^+)/;

function toSeverity(raw: string): DiagnosticSeverity {
    switch (raw) {
        case 'error': return 'error';
        case 'warning': return 'warning';
        default: return 'info';
    }
}

export function parseSysideDiagnostics(output: string, version?: string): Diagnostic[] {
    const diagnostics: Diagnostic[] = [];
    const lines = output.split('\n');
    for (let i = 0; i < lines.length; i += 1) {
        const match = DIAGNOSTIC_LINE.exec(lines[i]);
        if (!match?.groups) continue;
        const { file, line, column, severity, code, message } = match.groups;
        const start = { line: Number(line), column: Number(column) };
        // The snippet under the message carries the span width. Look no further
        // than the next two lines so a following diagnostic is never absorbed.
        let end: { line: number; column: number } | undefined;
        for (let j = i + 1; j <= Math.min(i + 2, lines.length - 1); j += 1) {
            if (DIAGNOSTIC_LINE.test(lines[j])) break;
            const caret = CARET_LINE.exec(lines[j]);
            if (caret?.groups) {
                end = { line: start.line, column: start.column + caret.groups.carets.length };
                break;
            }
        }
        diagnostics.push({
            domain: 'sysml',
            provider: SYSIDE_PROVIDER_ID,
            providerVersion: version,
            severity: toSeverity(severity),
            message,
            file,
            range: { start, end },
            code,
        });
    }
    return diagnostics;
}

export const sysideValidatorDescriptor: ValidatorDescriptor = {
    id: SYSIDE_PROVIDER_ID,
    role: 'validator',
    // No `emit-ir`: `syside 0.10.2` has no AST, semantic-model or IR export.
    capabilities: ['check', 'format'],
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
            id: SYSIDE_PROVIDER_ID,
            role: 'validator' as const,
            transport: 'process' as const,
            invocation: () => buildSysideInvocation(context),
            async run(): Promise<ProviderRunResult> {
                const invocation = buildSysideInvocation(context);
                const result = captureToolInvocation(invocation, context.projectDir);
                const version = cachedVersion(invocation.command);
                const diagnostics = parseSysideDiagnostics(`${result.stdout}\n${result.stderr}`, version);
                // A non-zero exit that parsed into nothing is a refusal we do
                // not understand — a licence check, an unreadable path. Report
                // it rather than record a rejection with no stated reason.
                if (result.status !== 0 && diagnostics.length === 0) {
                    const detail = `${result.stderr}\n${result.stdout}`.trim();
                    diagnostics.push({
                        domain: 'sysml',
                        provider: SYSIDE_PROVIDER_ID,
                        providerVersion: version,
                        severity: 'error',
                        message:
                            `${SYSIDE_PROVIDER_ID} exited with status ${result.status ?? 'unknown'} `
                            + `and reported no diagnostics.${detail ? ` Output: ${detail}` : ''}`,
                    });
                }
                return {
                    provider: SYSIDE_PROVIDER_ID,
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
