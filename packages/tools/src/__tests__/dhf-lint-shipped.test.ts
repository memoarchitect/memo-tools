import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { dhfLintCommand } from '../commands/dhf-lint.js';
import { lintTemplates } from '../dhf/template-lint.js';
import { compilerConfigured, examplesPresent, withExample } from './helpers/compile-source.js';

// ─── The shipped DHF templates agree with the ontology they query ────────────
//
// A template that names a kind the ontology does not declare renders an empty table, which reads like a clean
// audit. `memo-architect dhf lint` finds that, but nothing ran it: `UserTask` and `TaskStep` (merged into
// `OperativeAction`) and the abstract `Interface` went unnoticed.
// ─────────────────────────────────────────────────────────────────────────────

describe.runIf(compilerConfigured && examplesPresent)('the shipped DHF templates against the ontology', () => {
    it('name only kinds the ontology declares, and none that is abstract', async () => {
        await withExample({}, project => {
            const registry = project.registries!.kindRegistry!;
            const report = lintTemplates({
                kindRegistry: registry, relationshipRegistry: project.registries!.relationshipRegistry ?? undefined,
                knownLayers: new Set(registry.entries().map(e => e.layer).filter((l): l is string => Boolean(l) && l !== 'unknown')),
            });
            expect(report.ontologyAware).toBe(true);
            expect(report.findings.map(f => `${f.template}: ${f.rule}: ${f.message}`)).toEqual([]);
        }, 'gpca-pump');
    }, 300_000);
});

describe('dhf lint in a directory that is not a project', () => {
    it('checks structure only and says so, instead of calling every kind unknown', async () => {
        const empty = realpathSync(mkdtempSync(join(tmpdir(), 'memo-lint-')));
        const original = process.cwd();
        const lines: string[] = [];
        const log = vi.spyOn(console, 'log').mockImplementation((...args) => { lines.push(args.join(' ')); });
        try {
            process.chdir(empty);
            await dhfLintCommand({ json: true });
        } finally {
            process.chdir(original);
            log.mockRestore();
            rmSync(empty, { recursive: true, force: true });
            process.exitCode = undefined;
        }
        const report = JSON.parse(lines.join('\n'));
        expect(report.ontologyAware).toBe(false);
        expect(report.findings.filter((f: { rule: string }) => f.rule === 'unknown-kind')).toEqual([]);
    });
});
