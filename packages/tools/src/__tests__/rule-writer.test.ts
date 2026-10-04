// ─── Writing a rule of one's own ─────────────────────────────────────────────
//
// The checks, the rendering and the clause lookup always run. With a compiler
// configured (`MEMO_SYSIDE_PYTHON`; `OPENSYSML_BINARY` with
// `MEMO_OPENSYSML_CLIENT`) a rule is written into a copy of temperature-alarm
// through the CLI and read back (plans/memo-rules-domain-trace-and-editor.md).
// ─────────────────────────────────────────────────────────────────────────────

import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { checkNewRule, insertRule, renderRule, resolveClauseReference, type NewRuleRequest } from '../server/rule-writer.js';
import type { ClauseFact } from '../validator/rule-clauses.js';

const clauses: ClauseFact[] = [
    { qualifiedName: 'memo_artifacts_standards_iso_14971::iso14971::iso14971Clause7', standard: 'ISO 14971:2019', clauseNumber: '7', title: 'risk control' },
    { qualifiedName: 'memo_artifacts_standards_iec_62304::iec62304::iec62304Clause5::iec62304Clause5_2', standard: 'IEC 62304:2006+AMD1:2015', clauseNumber: '5.2' },
];
const context = {
    existingIds: new Set(['CR-MED-001']), existingTypeNames: new Set(['HazardMitigationRule']),
    kindNames: new Set(['Hazard', 'Requirement']), clauses,
};
const request = (over: Partial<NewRuleRequest> = {}): NewRuleRequest => ({
    id: 'ORG-001', typeName: 'TwoControls', appliesTo: 'Hazard', predicateExpression: 'mitigates->size() >= 2',
    severity: 'warning', rationaleText: 'SOP 4.1', file: 'model/rules.sysml', ...over,
});

describe('checkNewRule', () => {
    it('accepts a sound rule', () => {
        expect(checkNewRule(request({ enforces: [clauses[0].qualifiedName] }), context)).toBeUndefined();
        expect(checkNewRule(request({ appliesTo: 'Requirement[requirementType=system]' }), context)).toBeUndefined();
        expect(checkNewRule(request({ appliesTo: 'Model' }), context)).toBeUndefined();
    });
    it.each([
        [{ id: 'CR-MED-001' }, 'duplicate-id'],
        [{ id: '1bad' }, 'bad-id'],
        [{ typeName: 'HazardMitigationRule' }, 'duplicate-type-name'],
        [{ typeName: 'lower' }, 'bad-type-name'],
        [{ appliesTo: 'Nope' }, 'unknown-kind'],
        [{ predicateExpression: 'mitigates->size() >=' }, 'invalid-predicate'],
        [{ rationaleText: '  ' }, 'missing-rationale'],
        [{ severity: 'fatal' as 'error' }, 'bad-severity'],
        [{ tailoring: 'invariant' as 'assurance' }, 'bad-tailoring'],
        [{ enforces: ['pkg::gone::c1'] }, 'unknown-clause'],
        [{ file: '../outside.sysml' }, 'bad-file'],
        [{ file: 'model/rules.txt' }, 'bad-file'],
    ] as [Partial<NewRuleRequest>, string][])('refuses %j as %s', (over, code) => {
        expect(checkNewRule(request(over), context)?.code).toBe(code);
    });
});

describe('resolveClauseReference', () => {
    it('finds a clause by qualified name or by standard and number', () => {
        expect(resolveClauseReference(clauses, clauses[1].qualifiedName)).toBe(clauses[1]);
        expect(resolveClauseReference(clauses, '14971 §7')).toBe(clauses[0]);
        expect(resolveClauseReference(clauses, 'IEC 62304:2006+AMD1:2015 §5.2')).toBe(clauses[1]);
    });
    it('finds nothing for a miss or an ambiguity', () => {
        expect(resolveClauseReference(clauses, '14971 §99')).toBeUndefined();
        expect(resolveClauseReference(clauses, 'ISO §7')).toBeDefined();
        expect(resolveClauseReference([...clauses, { ...clauses[0], qualifiedName: 'other::c7' }], '14971 §7')).toBeUndefined();
    });
});

describe('renderRule and insertRule', () => {
    it('states the rule as an organisation rule, with the clause written as a dotted path', () => {
        const { text, imports } = renderRule(request({ enforces: [clauses[1].qualifiedName] }), '');
        expect(text).toContain('constraint def TwoControls :> MemoConsistencyRule');
        expect(text).toContain('attribute domain = RuleDomainKind::organisation;');
        expect(text).toContain('attribute tailoring = RuleTailoringKind::methodology;');
        expect(text).toContain('ref enforces : StandardClause[1..*] = iec62304.iec62304Clause5.iec62304Clause5_2;');
        expect(imports).toContain('memo_artifacts_standards_iec_62304::*');
    });
    it('escapes quotes in the text it writes', () => {
        expect(renderRule(request({ rationaleText: 'say "no"' }), '').text).toContain('rationaleText = "say \\"no\\"";');
    });
    it('adds the rule and only the imports the file lacks', () => {
        const source = 'package P {\n    private import memo_core_enumerations::*;\n}\n';
        const updated = insertRule(source, request())!;
        expect(updated).toContain('constraint def TwoControls');
        expect(updated.match(/import memo_core_enumerations::\*;/g)).toHaveLength(1);
        expect(updated).toContain('import memo_core_consistency_rules::*;');
    });
    it('writes nothing into a file with no package', () => {
        expect(insertRule('// empty\n', request())).toBeUndefined();
    });
});

const example = resolve(__dirname, '../../../../../memo/examples/temperature-alarm');
const cli = resolve(__dirname, '../../lib/bin/memo.js');
const python = process.env.MEMO_SYSIDE_PYTHON;
const binary = process.env.OPENSYSML_BINARY;
const client = process.env.MEMO_OPENSYSML_CLIENT;

function integration(name: string, flags: string[]): void {
    describe(`a rule written through ${name}`, () => {
        it('is previewed, written, listed with its clause, and flags the hazard', () => {
            const root = mkdtempSync(join(tmpdir(), 'memo-rule-writer-'));
            const run = (args: string[]): string => execFileSync(process.execPath, [cli, ...args, ...flags], { cwd: root, encoding: 'utf8', env: process.env });
            try {
                cpSync(example, root, { recursive: true, filter: source => !source.includes(`${example}/.memo`) });
                const file = 'model/catalog/temperature_alarm.sysml';
                const base = ['rules', 'new', '.', '--id', 'ORG-001', '--type', 'TwoControls', '--applies-to', 'Hazard',
                    '--predicate', 'mitigates->size() >= 2', '--rationale', 'Our SOP 4.1 wants two independent controls',
                    '--enforces', '14971 §7', '--file', file];
                const before = readFileSync(join(root, file), 'utf8');

                expect(run([...base, '--dry-run'])).toContain('would flag 1 of 1 Hazard');
                expect(readFileSync(join(root, file), 'utf8')).toBe(before);

                expect(run(base)).toContain('Wrote ORG-001');
                const listed = JSON.parse(run(['rules', 'list', '.', '--format', 'json', '--domain', 'organisation'])) as {
                    tailorable: { sourceRuleId: string; clauses: { label: string }[] }[];
                };
                expect(listed.tailorable.map(r => r.sourceRuleId)).toEqual(['ORG-001']);
                expect(listed.tailorable[0].clauses[0].label).toBe('ISO 14971:2019 §7');
                // The example carries other findings, so validate exits 1; its report is what is read.
                let report = '';
                try { report = run(['validate', '.']); } catch (error) { report = String((error as { stdout?: string }).stdout ?? ''); }
                expect(report).toContain('[ORG-001] Hazard/UndetectedTemperatureDeviation');

                // The same id again is refused and the file is left alone.
                const after = readFileSync(join(root, file), 'utf8');
                expect(() => run(base)).toThrow();
                expect(readFileSync(join(root, file), 'utf8')).toBe(after);
            } finally {
                rmSync(root, { recursive: true, force: true });
            }
        }, 240_000);
    });
}

if (python && existsSync(example)) integration('SysIDE', ['--toolchain.compiler=syside', `--toolchain.syside.python=${python}`]);
if (binary && client && existsSync(example)) {
    integration('OpenSysML', ['--toolchain.compiler=opensysml', `--toolchain.opensysml.binary=${binary}`, `--toolchain.opensysml.client=${client}`]);
}
