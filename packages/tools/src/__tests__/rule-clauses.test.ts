// ─── Which rules enforce which clauses ───────────────────────────────────────
//
// The coverage computation always runs. With a compiler configured
// (`MEMO_SYSIDE_PYTHON`; `OPENSYSML_BINARY` with `MEMO_OPENSYSML_CLIENT`) the
// commands run on a copy of temperature-alarm and report what the ontology
// states: 21 medical-device rules, 16 of them tracing to a clause
// (plans/memo-rules-domain-trace-and-editor.md).
// ─────────────────────────────────────────────────────────────────────────────

import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { computeRuleClauseCoverage, clauseLabel, type ClauseFact } from '../validator/rule-clauses.js';

const clauses: ClauseFact[] = [
    { qualifiedName: 'p::std::c5', standard: 'ISO 14971:2019', standardName: 'p::std', clauseNumber: '5', title: 'risk analysis' },
    { qualifiedName: 'p::std::c7', standard: 'ISO 14971:2019', standardName: 'p::std', clauseNumber: '7', title: 'risk control' },
    { qualifiedName: 'p::other::c1', standard: 'IEC 62304', standardName: 'p::other', clauseNumber: '1' },
];
const rule = (id: string, over: Record<string, unknown> = {}) =>
    ({ sourceRuleId: id, sourceRuleType: `${id}Rule`, disposition: 'enabled' as const, ...over });

describe('computeRuleClauseCoverage', () => {
    it('counts the clauses enabled rules enforce, per standard', () => {
        const coverage = computeRuleClauseCoverage(clauses, [
            rule('A', { domain: 'medicalDevice', enforces: ['p::std::c7'] }),
            rule('B', { domain: 'medicalDevice', enforces: ['p::std::c7', 'p::std::c5'] }),
        ]);
        expect(coverage.standards).toEqual([
            { designation: 'IEC 62304', clauses: 1, enforced: 0 },
            { designation: 'ISO 14971:2019', clauses: 2, enforced: 2 },
        ]);
        expect(coverage.enforcedClauses.find(c => c.clauseNumber === '7')?.rules).toEqual(['A', 'B']);
    });

    it('does not count a rule a user disabled or replaced', () => {
        const coverage = computeRuleClauseCoverage(clauses, [
            rule('A', { domain: 'medicalDevice', enforces: ['p::std::c7'], disposition: 'disabled' }),
        ]);
        expect(coverage.enforcedClauses).toEqual([]);
    });

    it('lists the medical-device rules that trace to nothing', () => {
        const coverage = computeRuleClauseCoverage(clauses, [
            rule('A', { domain: 'medicalDevice' }),
            rule('B', { domain: 'modelling' }),
            rule('C', { domain: 'organisation' }),
            rule('D'),
        ]);
        expect(coverage.untracedMedicalRules.map(r => r.id)).toEqual(['A']);
        expect(coverage.byDomain).toEqual({ medicalDevice: 1, modelling: 1, organisation: 1, unstated: 1 });
    });

    it('reports a clause the model does not carry', () => {
        const coverage = computeRuleClauseCoverage(clauses, [rule('A', { domain: 'medicalDevice', enforces: ['p::gone::c9'] })]);
        expect(coverage.unknownClauses).toEqual([{ ruleId: 'A', clause: 'p::gone::c9' }]);
    });
});

describe('clauseLabel', () => {
    it('names a clause by its standard and number, and falls back to the qualified name', () => {
        expect(clauseLabel(clauses, 'p::std::c7')).toBe('ISO 14971:2019 §7');
        expect(clauseLabel(clauses, 'p::gone::c9')).toBe('p::gone::c9');
    });
});

const example = resolve(__dirname, '../../../../../memo/examples/temperature-alarm');
const cli = resolve(__dirname, '../../lib/bin/memo.js');
const python = process.env.MEMO_SYSIDE_PYTHON;
const binary = process.env.OPENSYSML_BINARY;
const client = process.env.MEMO_OPENSYSML_CLIENT;

function run(root: string, args: string[], flags: string[]): string {
    return execFileSync(process.execPath, [cli, ...args, ...flags], { cwd: root, encoding: 'utf8', env: process.env });
}

function integration(name: string, flags: string[]): void {
    describe(`rule domains and clauses, through ${name}`, () => {
        it('lists 21 medical-device rules, 16 with a clause, and reports the other 5', () => {
            const root = mkdtempSync(join(tmpdir(), 'memo-rule-clauses-'));
            try {
                cpSync(example, root, { recursive: true, filter: source => !source.includes(`${example}/.memo`) });
                const listed = JSON.parse(run(root, ['rules', 'list', '.', '--format', 'json', '--domain', 'medicalDevice'], flags)) as {
                    tailorable: { sourceRuleId: string; domain: string; clauses: { label: string }[] }[];
                };
                expect(listed.tailorable).toHaveLength(21);
                expect(listed.tailorable.every(r => r.domain === 'medicalDevice')).toBe(true);
                expect(listed.tailorable.filter(r => r.clauses.length > 0)).toHaveLength(16);
                expect(listed.tailorable.find(r => r.sourceRuleId === 'CR-MED-011')?.clauses[0].label)
                    .toBe('IEC 62304:2006+AMD1:2015 §5.2.1');

                const checked = JSON.parse(run(root, ['standards', 'check', '--json'], flags)) as {
                    ruleCoverage: { untracedMedicalRules: { id: string }[]; unknownClauses: unknown[]; byDomain: Record<string, number> };
                };
                expect(checked.ruleCoverage.untracedMedicalRules.map(r => r.id).sort())
                    .toEqual(['CR-MED-021', 'CR-MED-030', 'CR-MED-031', 'CR-MED-032', 'CR-ONT-032']);
                expect(checked.ruleCoverage.unknownClauses).toEqual([]);
                expect(checked.ruleCoverage.byDomain).toMatchObject({ medicalDevice: 21, modelling: 35 });
            } finally {
                rmSync(root, { recursive: true, force: true });
            }
        }, 180_000);
    });
}

if (python && existsSync(example)) integration('SysIDE', ['--toolchain.compiler=syside', `--toolchain.syside.python=${python}`]);
if (binary && client && existsSync(example)) {
    integration('OpenSysML', ['--toolchain.compiler=opensysml', `--toolchain.opensysml.binary=${binary}`, `--toolchain.opensysml.client=${client}`]);
}
