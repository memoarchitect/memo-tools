// ─── `memo validate` cannot report a parse failure as success ────────────────
//
// A file the parser rejected declares less of the model than it says it does,
// and every number validate prints is computed from the elements that did load.
// So a catastrophic failure makes completeness look reachable and the violation
// total FALL — measured
// 2026-09-19, one file with 805 parse errors built 2 elements instead of 124
// and validate said "92% complete, 1583 violations, 32 rules passed", down from
// 1595. The drop was read as progress.
//
// The validator role does not cover this. MEMO's grammar is a subset, so a
// validator that answers "is this valid SysML?" — `syside` — can accept a file
// MEMO's own parser rejects, which is precisely when the counts go wrong and
// nothing says so. These tests therefore hold validate to reporting ITS OWN
// parse errors, including when the validator raised nothing.
// ─────────────────────────────────────────────────────────────────────────────

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';

const TMP = resolve(__dirname, '__tmp_validate_parse_errors__');

// The validator is mocked to accept everything, so a failure in these tests can
// only have come from validate's own parse of the project source.
vi.mock('../toolchain/operations.js', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../toolchain/operations.js')>()),
    runValidator: vi.fn(async () => ({
        provider: 'stub', providerVersion: '0.0.0', transport: 'in-process' as const,
        accepted: true, diagnostics: [],
    })),
}));

const { validateCommand } = await import('../commands/validate.js');

function write(relPath: string, content: string): void {
    const full = join(TMP, relPath);
    mkdirSync(join(full, '..'), { recursive: true });
    writeFileSync(full, content);
}

beforeEach(() => {
    rmSync(TMP, { recursive: true, force: true });
    mkdirSync(TMP, { recursive: true });
    write('memo.package.yaml', 'name: demo\nentrypoint: model/catalog/project.sysml\ninclude: [model]\n');
    write('memo.manifest.yaml', [
        'manifest: 1',
        'packages:',
        '  "@memoarchitect/lib-a": ./libs/lib-a',
        'init:',
        '  defaultExtends: "@memoarchitect/lib-a"',
        '  rootImport: memo',
        '  defaultTemplate: default',
        'templates:',
        '  default: ./libs/lib-a',
        'examples: {}',
        '',
    ].join('\n'));
    write('libs/lib-a/memo.package.yaml', 'name: "@memoarchitect/lib-a"\nversion: 1.0.0\nsysmlDir: "./src"\n');
    write('libs/lib-a/src/lib_a.sysml', `
package lib_a {
    part def MethodologyDefinition;
    part def ProjectMethodBinding;
    part def Widget;
    part chosenMethod : MethodologyDefinition {
        attribute :>> id = "METH-A";
        attribute :>> scopeMode = ScopeModeKind::allAvailable;
    }
}
`);
    write('model/catalog/project.sysml', `
package demo_project {
    private import lib_a::*;
    part projectBinding : ProjectMethodBinding {
        attribute :>> id = "PMB-1";
        attribute :>> projectName = "Demo";
        ref :>> selectedMethodology = chosenMethod;
        attribute :>> scopeMode = ScopeModeKind::allAvailable;
    }
}
`);
    write('model/good.sysml', `
package demo_content {
    private import lib_a::*;
    part pump : Widget;
}
`);
});

afterEach(() => {
    rmSync(TMP, { recursive: true, force: true });
    vi.restoreAllMocks();
});

/** A file MEMO's grammar cannot read. */
function writeUnparseableFile(): void {
    write('model/broken.sysml', `
package demo_broken {
    part def ((( ;
    part ??? : ;
}
`);
}

async function runValidate(
    options?: Record<string, unknown>,
): Promise<{ out: string; err: string; exitCode?: number }> {
    const out: string[] = [];
    const err: string[] = [];
    const previous = process.exitCode;
    process.exitCode = undefined;
    vi.spyOn(console, 'log').mockImplementation((...args) => { out.push(args.join(' ')); });
    vi.spyOn(console, 'error').mockImplementation((...args) => { err.push(args.join(' ')); });
    vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
        throw new Error(`process.exit(${code ?? 0})`);
    }) as never);
    try {
        await validateCommand(TMP, options);
    } finally {
        const exitCode = process.exitCode;
        process.exitCode = previous;
        vi.restoreAllMocks();
        return { out: out.join('\n'), err: err.join('\n'), exitCode: exitCode as number | undefined };
    }
}

describe('memo validate and a file that does not parse', () => {
    it('reports 0 parse errors and does not fail when every file parses', async () => {
        const { out, exitCode } = await runValidate();

        expect(out).toMatch(/Parse errors: 0/);
        expect(exitCode).toBeUndefined();
    });

    it('prints the parse-error count in its summary', async () => {
        writeUnparseableFile();

        const { out } = await runValidate();

        // The count, not merely a hint that something was odd — the summary is
        // what a reader compares against the previous run.
        expect(out).toMatch(/Parse errors: [1-9]\d* in 1 file\(s\)/);
        expect(out).toContain('model/broken.sysml');
    });

    it('exits non-zero even when the validator accepted the source', async () => {
        writeUnparseableFile();

        const { exitCode } = await runValidate();

        expect(exitCode).toBe(1);
    });

    it('counts parse errors separately from validator diagnostics in JSON', async () => {
        writeUnparseableFile();

        const { out, exitCode } = await runValidate({ format: 'json', output: 'report.json' });
        const report = JSON.parse(
            require('node:fs').readFileSync(join(TMP, 'report.json'), 'utf8'),
        );

        expect(report.summary.sysmlErrors).toBe(0);
        expect(report.summary.parseErrors).toBeGreaterThan(0);
        expect(report.summary.filesNotParsed).toBe(1);
        expect(report.parseErrors[0].file).toContain('broken.sysml');
        expect(exitCode).toBe(1);
        expect(out).toBeTruthy();
    });

    it('fails the JUnit suite rather than passing a model the rules never saw', async () => {
        writeUnparseableFile();

        await runValidate({ format: 'junit', output: 'report.xml' });
        const xml = require('node:fs').readFileSync(join(TMP, 'report.xml'), 'utf8');

        expect(xml).toContain('type="PARSE_ERROR"');
        expect(xml).toMatch(/failures="[1-9]/);
    });
});
