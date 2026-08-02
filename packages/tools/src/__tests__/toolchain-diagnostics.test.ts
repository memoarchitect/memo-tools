// Diagnostic normalization and emission.
//
// The syside fixture below is real captured output from `syside 0.10.2`, not an
// invented shape — the parser's whole job is to survive the format the tool
// actually prints.

import { describe, expect, it } from 'vitest';
import {
    countBySeverity,
    defaultSeverityForDomain,
    diagnosticsToJson,
    formatDiagnosticText,
    formatDiagnosticsText,
    type Diagnostic,
} from '../toolchain/diagnostic.js';
import { normalizeSysideVersion, parseSysideDiagnostics } from '../toolchain/providers/syside.js';

const SYSIDE_OUTPUT = [
    "/tmp/p/bad.sysml:3:14: error (reference-error): No Type named 'NoSuchType' found.",
    '    3 |     part w : NoSuchType;',
    '      |              ^^^^^^^^^^',
    "/tmp/p/bad.sysml:4:15: error (reference-error): No Feature named 'notAFeature' found.",
    '    4 |     part x :> notAFeature;',
    '      |               ^^^^^^^^^^^',
    '',
].join('\n');

describe('syside diagnostics', () => {
    it('parses file, range, severity and message', () => {
        const [first, second] = parseSysideDiagnostics(SYSIDE_OUTPUT, '0.10.2');
        expect(first).toEqual({
            domain: 'sysml',
            provider: 'syside',
            providerVersion: '0.10.2',
            severity: 'error',
            message: "No Type named 'NoSuchType' found.",
            file: '/tmp/p/bad.sysml',
            range: { start: { line: 3, column: 14 }, end: { line: 3, column: 24 } },
            code: 'reference-error',
        });
        expect(second.range?.start).toEqual({ line: 4, column: 15 });
    });

    it('carries the rule code through verbatim', () => {
        // Not renumbered into a parallel MEMO scheme: suppression is by code,
        // and a project's suppressions have to survive a provider upgrade.
        expect(parseSysideDiagnostics(SYSIDE_OUTPUT).map(d => d.code))
            .toEqual(['reference-error', 'reference-error']);
    });

    it('does not absorb the next diagnostic when a snippet is missing', () => {
        const terse = [
            '/tmp/a.sysml:1:1: error (a-code): first',
            '/tmp/b.sysml:2:2: warning (b-code): second',
        ].join('\n');
        const parsed = parseSysideDiagnostics(terse);
        expect(parsed).toHaveLength(2);
        expect(parsed[0].range?.end).toBeUndefined();
        expect(parsed[1].severity).toBe('warning');
    });

    it('keeps a diagnostic that carries no code', () => {
        const parsed = parseSysideDiagnostics('/tmp/a.sysml:1:1: error: no code here');
        expect(parsed).toHaveLength(1);
        expect(parsed[0].code).toBeUndefined();
        expect(parsed[0].message).toBe('no code here');
    });

    it('ignores everything that is not a diagnostic line', () => {
        expect(parseSysideDiagnostics('Checked 12 files in 0.4s\n')).toEqual([]);
    });

    it('reduces the version banner to the version', () => {
        expect(normalizeSysideVersion('syside 0.10.2 9e2b7f0e89cc4076f432504c3e4183e9a13b2734'))
            .toBe('0.10.2');
        // And says whatever it was told rather than nothing, when it cannot.
        expect(normalizeSysideVersion('some-build')).toBe('some-build');
        expect(normalizeSysideVersion(undefined)).toBeUndefined();
    });
});

describe('diagnostic emission', () => {
    const diagnostic: Diagnostic = {
        domain: 'memo-ingest',
        provider: 'internal',
        severity: 'warning',
        message: "Expecting token of type '}' but found `assign`.",
        file: 'model/parts.sysml',
        range: { start: { line: 5, column: 9 } },
        code: 'parse-error',
    };

    it('emits a GNU one-liner an editor can already parse', () => {
        expect(formatDiagnosticText(diagnostic)).toBe(
            'model/parts.sysml:5:9: warning: '
            + "Expecting token of type '}' but found `assign`. [parse-error] [memo-ingest/internal]");
    });

    it('emits a line without a position when the provider gave none', () => {
        expect(formatDiagnosticText({
            domain: 'sysml', provider: 'p', severity: 'error', message: 'boom',
        })).toBe('error: boom [sysml/p]');
    });

    it('emits JSON carrying every field', () => {
        const parsed = JSON.parse(diagnosticsToJson([diagnostic]));
        expect(parsed[0]).toEqual(diagnostic);
    });

    it('formats a list one per line', () => {
        expect(formatDiagnosticsText([diagnostic, diagnostic]).split('\n')).toHaveLength(2);
    });

    it('counts by severity', () => {
        expect(countBySeverity([
            diagnostic,
            { ...diagnostic, severity: 'error' },
            { ...diagnostic, severity: 'error' },
        ])).toEqual({ error: 2, warning: 1, info: 0 });
    });

    it('defaults severity from the domain, per the canvas contract', () => {
        // §1.1: a rejected source is an error and keeps the last scene; an
        // ingest gap is a warning and still draws; a methodology violation
        // never suppresses a diagram.
        expect(defaultSeverityForDomain('sysml')).toBe('error');
        expect(defaultSeverityForDomain('memo-ingest')).toBe('warning');
        expect(defaultSeverityForDomain('memo-methodology')).toBe('info');
    });
});
