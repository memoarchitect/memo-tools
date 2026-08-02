// ─── Normalized toolchain diagnostics ────────────────────────────────────────
//
// One diagnostic shape for every provider, in every role. A provider adapter
// parses its tool's output format; nothing downstream of the adapter ever sees
// that format again.
//
// The mandatory field is `domain`. It answers "whose complaint is this?", and
// that answer is what decides how the canvas behaves:
//
//   sysml             the selected validator rejected the source. Error.
//                     Keep the last good scene — there is nothing new to draw.
//   memo-ingest       the validator accepted it, MEMO could not lower it.
//                     Warning. Draw what was understood; never blank.
//   memo-methodology  valid SysML, MEMO rule violated. Info/warning.
//                     Draw normally and flag the element.
//
// Collapsing those three into one "error" list is the failure mode this type
// exists to prevent: `syside` says the file is fine and MEMO shows nothing.
// ─────────────────────────────────────────────────────────────────────────────

/** Who is complaining. See the table above — this drives canvas behaviour. */
export type DiagnosticDomain = 'sysml' | 'memo-ingest' | 'memo-methodology';

export type DiagnosticSeverity = 'error' | 'warning' | 'info';

/** 1-based line and column, matching every tool's own numbering. */
export interface DiagnosticPosition {
    line: number;
    column: number;
}

export interface DiagnosticRange {
    start: DiagnosticPosition;
    /** Absent when the tool reported a point rather than a span. */
    end?: DiagnosticPosition;
}

export interface Diagnostic {
    domain: DiagnosticDomain;
    /** Provider ID that produced this, e.g. the value of `toolchain.validator`. */
    provider: string;
    /** Version string the provider reported, when it reports one. */
    providerVersion?: string;
    severity: DiagnosticSeverity;
    message: string;
    /** Absolute path when the provider gave one; otherwise as the tool wrote it. */
    file?: string;
    range?: DiagnosticRange;
    /**
     * The provider's own stable rule code, carried through verbatim.
     *
     * `syside` publishes 151 kebab-case codes (`reference-error`,
     * `accept-action-usage-parameters`, …). We do not renumber them into a
     * parallel MEMO scheme: suppression and configuration are by code, and a
     * project's suppressions have to survive both a provider upgrade and an
     * eventual engine swap.
     */
    code?: string;
}

/**
 * Default severity for a domain.
 *
 * A provider that reports its own severity always wins; this is for diagnostics
 * MEMO itself synthesizes, where the domain is the only thing known.
 */
export function defaultSeverityForDomain(domain: DiagnosticDomain): DiagnosticSeverity {
    switch (domain) {
        case 'sysml': return 'error';
        case 'memo-ingest': return 'warning';
        case 'memo-methodology': return 'info';
    }
}

/**
 * One GNU-style line:
 *   `file:line:col: severity: message [code] [domain/provider]`
 *
 * The leading `file:line:col: severity:` prefix is what every editor and CI
 * annotator already parses. The trailing brackets are additive, so a tool that
 * only understands the GNU prefix still gets a usable line.
 */
export function formatDiagnosticText(diagnostic: Diagnostic): string {
    const parts: string[] = [];
    if (diagnostic.file) {
        const { start } = diagnostic.range ?? {};
        parts.push(start ? `${diagnostic.file}:${start.line}:${start.column}: ` : `${diagnostic.file}: `);
    }
    parts.push(`${diagnostic.severity}: ${diagnostic.message}`);
    if (diagnostic.code) parts.push(` [${diagnostic.code}]`);
    parts.push(` [${diagnostic.domain}/${diagnostic.provider}]`);
    return parts.join('');
}

export function formatDiagnosticsText(diagnostics: readonly Diagnostic[]): string {
    return diagnostics.map(formatDiagnosticText).join('\n');
}

export function diagnosticsToJson(diagnostics: readonly Diagnostic[], pretty = true): string {
    return JSON.stringify(diagnostics, null, pretty ? 2 : undefined);
}

/** Count by severity — used by commands deciding an exit code. */
export function countBySeverity(diagnostics: readonly Diagnostic[]): Record<DiagnosticSeverity, number> {
    const counts: Record<DiagnosticSeverity, number> = { error: 0, warning: 0, info: 0 };
    for (const d of diagnostics) counts[d.severity] += 1;
    return counts;
}

export function diagnosticsInDomain(
    diagnostics: readonly Diagnostic[],
    domain: DiagnosticDomain,
): Diagnostic[] {
    return diagnostics.filter(d => d.domain === domain);
}
