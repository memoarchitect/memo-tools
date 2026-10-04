// ─── Which rules run, and that every command agrees ──────────────────────────
//
// A rule a project wrote in its own files runs, whether or not anything imports
// its package, and `memo validate` and `memo rules list` report one rule set.
// And a project reached through a symbolic link resolves like any other: it used
// to compile to nothing and be reported valid. With a compiler configured
// (`MEMO_SYSIDE_PYTHON`; `OPENSYSML_BINARY` with `MEMO_OPENSYSML_CLIENT`).
// ─────────────────────────────────────────────────────────────────────────────

import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { compileResolvedProject } from '../toolchain/operations.js';
import type { MEMOConfig } from '../model/config.js';

const example = resolve(__dirname, '../../../../../memo/examples/temperature-alarm');
const cli = resolve(__dirname, '../../lib/bin/memo.js');
const python = process.env.MEMO_SYSIDE_PYTHON;
const binary = process.env.OPENSYSML_BINARY;
const client = process.env.MEMO_OPENSYSML_CLIENT;

const OWN_RULE = `package org_rules {
    private import memo_core_consistency_rules::*;
    private import memo_core_enumerations::*;
    private import memo_core_common::MemoIdentity;
    constraint def NeedsTwoControls :> MemoConsistencyRule {
        @MemoIdentity { :>> providedId = "ORG-002"; }
        attribute tailoring = RuleTailoringKind::methodology;
        attribute domain = RuleDomainKind::organisation;
        attribute appliesTo = "Hazard";
        attribute severity = RuleSeverityKind::warning;
        attribute rationaleText = "two controls";
        attribute predicateExpression = "mitigates->size() >= 2";
        constraint { true }
    }
}
`;

function run(root: string, args: string[], flags: string[]): string {
    try {
        return execFileSync(process.execPath, [cli, ...args, ...flags], { cwd: root, encoding: 'utf8', env: process.env });
    } catch (error) {
        // validate exits 1 on this example's other findings; its report is what is read.
        return String((error as { stdout?: string }).stdout ?? '');
    }
}

function activation(name: string, flags: string[]): void {
    describe(`a project's own rule, through ${name}`, () => {
        it('runs although nothing imports its package, and list and validate agree', () => {
            const root = realpathSync(mkdtempSync(join(tmpdir(), 'memo-rules-activation-')));
            try {
                cpSync(example, root, { recursive: true, filter: source => !source.includes(`${example}/.memo`) });
                writeFileSync(join(root, 'model/catalog/org_rules.sysml'), OWN_RULE);

                const listed = JSON.parse(run(root, ['rules', 'list', '.', '--format', 'json'], flags)) as {
                    tailorable: { sourceRuleId: string }[]; inactive: unknown[];
                };
                expect(listed.tailorable.map(r => r.sourceRuleId)).toContain('ORG-002');
                expect(listed.inactive).toEqual([]);
                expect(run(root, ['validate', '.'], flags)).toContain('[ORG-002] Hazard/UndetectedTemperatureDeviation');
            } finally {
                rmSync(root, { recursive: true, force: true });
            }
        }, 240_000);
    });
}

if (python && existsSync(example)) activation('SysIDE', ['--toolchain.compiler=syside', `--toolchain.syside.python=${python}`]);
if (binary && client && existsSync(example)) {
    activation('OpenSysML', ['--toolchain.compiler=opensysml', `--toolchain.opensysml.binary=${binary}`, `--toolchain.opensysml.client=${client}`]);
}

describe.runIf(Boolean(python) && existsSync(example))('a project reached through a symbolic link', () => {
    it('resolves its ontology like one reached by its real path', async () => {
        const base = realpathSync(mkdtempSync(join(tmpdir(), 'memo-symlink-')));
        try {
            cpSync(example, join(base, 'real'), { recursive: true, filter: source => !source.includes(`${example}/.memo`) });
            symlinkSync(join(base, 'real'), join(base, 'link'));
            const config = { projectName: 'x', toolchain: { compiler: 'syside', syside: { python } } } as unknown as MEMOConfig;
            const viaLink = await compileResolvedProject({ config, projectDir: join(base, 'link'), force: true });
            const viaReal = await compileResolvedProject({ config, projectDir: join(base, 'real'), force: true });
            expect(viaLink?.accepted).toBe(true);
            expect(viaLink!.registries!.kindRegistry!.kindNames().length).toBeGreaterThan(300);
            expect(viaLink!.registries!.kindRegistry!.kindNames().length).toBe(viaReal!.registries!.kindRegistry!.kindNames().length);
            expect(viaLink!.resolution!.selectedRoots.length).toBe(viaReal!.resolution!.selectedRoots.length);
        } finally {
            rmSync(base, { recursive: true, force: true });
        }
    }, 240_000);
});
