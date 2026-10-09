// ─── The rule service ────────────────────────────────────────────────────────
//
// What the dev server does for the rule editor: a condition from a form becomes
// the rule expression; a preview says what the rule would flag; a write goes
// through the compiler and refuses a file that changed. The conditions always
// run; the service runs against a real compile when a compiler is configured
// (`MEMO_SYSIDE_PYTHON`; `OPENSYSML_BINARY`, and `MEMO_OPENSYSML_CLIENT` only to override the pinned client).
// (plans/memo-rules-domain-trace-and-editor.md)
// ─────────────────────────────────────────────────────────────────────────────

import { cpSync, existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { openSysMLFlags, openSysMLUnderTest } from './helpers/compile-source.js';
import { describe, expect, it } from 'vitest';
import { discoverProjectSources } from '../model/native-project.js';
import { compileResolvedProject } from '../toolchain/operations.js';
import { collectApiConstraints } from '../validator/constraint-loader-api.js';
import { readClauseFacts } from '../validator/rule-clauses.js';
import { createRule, previewRule, revisionOf, type RuleFormRequest, type RuleServiceContext } from '../server/rule-service.js';
import { conditionExpression } from '../server/rule-writer.js';
import type { MEMOConfig } from '../model/config.js';

describe('conditionExpression', () => {
    it('writes the three shapes in the rule language', () => {
        expect(conditionExpression({ kind: 'atLeast', relation: 'mitigates', count: 2 })).toBe('mitigates->size() >= 2');
        expect(conditionExpression({ kind: 'atMost', relation: 'threatenedBy', count: 8 })).toBe('threatenedBy->size() <= 8');
        expect(conditionExpression({ kind: 'attributeSet', attribute: 'safetyClass' })).toBe("attributes.safetyClass != ''");
        expect(conditionExpression({ kind: 'expression', expression: ' verifiedBy->size() >= 1 ' })).toBe('verifiedBy->size() >= 1');
    });
    it('refuses what is not a name, a count or an expression', () => {
        expect(() => conditionExpression({ kind: 'atLeast', relation: 'a b', count: 1 })).toThrow(/not a relation name/);
        expect(() => conditionExpression({ kind: 'atLeast', relation: 'a', count: -1 })).toThrow(/whole number/);
        expect(() => conditionExpression({ kind: 'atLeast', relation: 'a', count: 1.5 })).toThrow(/whole number/);
        expect(() => conditionExpression({ kind: 'attributeSet', attribute: "x') or ('" })).toThrow(/not an attribute name/);
        expect(() => conditionExpression({ kind: 'expression', expression: '  ' })).toThrow(/empty/);
    });
});

const example = resolve(__dirname, '../../../../../memo/examples/temperature-alarm');
const python = process.env.MEMO_SYSIDE_PYTHON;
const opensysml = openSysMLUnderTest;
const FILE = 'model/catalog/temperature_alarm.sysml';

function service(name: string, toolchain: Record<string, unknown>): void {
    describe(`the rule service, through ${name}`, () => {
        it('previews, refuses, writes, and refuses a changed file', async () => {
            // A real path: through a symlinked one (macOS /tmp, /var) SysIDE accepts the project and resolves nothing from it.
            const root = realpathSync(mkdtempSync(join(tmpdir(), 'memo-rule-service-')));
            try {
                cpSync(example, root, { recursive: true, filter: source => !source.includes(`${example}/.memo`) });
                const config = { projectName: 'x', toolchain } as unknown as MEMOConfig;
                const compiled = await compileResolvedProject({ config, projectDir: root, force: true });
                expect(compiled?.accepted).toBe(true);
                const context: RuleServiceContext = {
                    projectRoot: root, config, model: compiled!.model!, kindRegistry: compiled!.registries?.kindRegistry,
                    constraints: collectApiConstraints(compiled!.api!), clauses: readClauseFacts(compiled!.api!),
                    projectFiles: new Set(discoverProjectSources(root).projectFiles.map(f => resolve(f))),
                };
                const clause = context.clauses.find(c => c.standard === 'ISO 14971:2019' && c.clauseNumber === '7')!;
                const form = (over: Partial<RuleFormRequest> = {}): RuleFormRequest => ({
                    id: 'ORG-001', typeName: 'TwoControls', appliesTo: 'Hazard', condition: { kind: 'atLeast', relation: 'mitigates', count: 2 },
                    severity: 'warning', obligation: 'recommended', rationaleText: 'Our SOP 4.1 wants two independent controls', enforces: [clause.qualifiedName],
                    file: FILE, ...over,
                });

                const preview = previewRule(context, form());
                expect(preview, JSON.stringify(preview)).toMatchObject({ success: true, predicateExpression: 'mitigates->size() >= 2', subjects: 1 });
                expect(preview.success && preview.flagged.map(f => f.elementName)).toEqual(['UndetectedTemperatureDeviation']);
                expect(preview.success && preview.baseRevision).toBe(revisionOf(readFileSync(join(root, FILE), 'utf8')));

                expect(previewRule(context, form({ id: 'CR-MED-001' }))).toMatchObject({ success: false, code: 'duplicate-id' });
                expect(previewRule(context, form({ condition: { kind: 'atLeast', relation: 'bad name', count: 1 } }))).toMatchObject({ success: false, code: 'invalid-predicate' });
                expect(await createRule(context, form({ file: 'model/elsewhere.sysml' }))).toMatchObject({ success: false, code: 'bad-file' });

                const before = readFileSync(join(root, FILE), 'utf8');
                // A form loaded from another revision of the file is refused, and the file is left alone.
                expect(await createRule(context, form({ baseRevision: 'stale' }))).toMatchObject({ success: false, conflict: true });
                expect(readFileSync(join(root, FILE), 'utf8')).toBe(before);

                const written = await createRule(context, form({ baseRevision: preview.success ? preview.baseRevision : undefined }));
                expect(written, JSON.stringify(written).slice(0, 600)).toMatchObject({ success: true });
                const after = readFileSync(join(root, FILE), 'utf8');
                expect(after).toContain('constraint def TwoControls');
                // The trace is the typed dependency, and the obligation is stated.
                expect(after).toContain('#EnforcesClause dependency from TwoControls to');
                expect(after).toContain('RuleObligationKind::recommended');
                expect(written.success && written.revision).toBe(revisionOf(after));

                // The saved rule is the previewed one: compile again and read it back.
                const recompiled = await compileResolvedProject({ config, projectDir: root, force: true });
                const saved = collectApiConstraints(recompiled!.api!).find(c => c.id === 'ORG-001');
                expect(saved).toMatchObject({ domain: 'organisation', severity: 'warning', obligation: 'recommended', enforces: [clause.qualifiedName] });
                writeFileSync(join(root, FILE), before);
            } finally {
                rmSync(root, { recursive: true, force: true });
            }
        }, 240_000);
    });
}

if (python && existsSync(example)) service('SysIDE', { compiler: 'syside', syside: { python } });
if (opensysml && existsSync(example)) service('OpenSysML', { compiler: 'opensysml', opensysml });
