// ─── Rules written for clauses of ISO 14971 and IEC 62304 ────────────────────
//
// The examples carry no ChangeRequest, no SOUP-with-gaps and no software item
// without units, so a rule over them runs on nothing there. This puts one of
// each, flawed and sound, in a copy of temperature-alarm and reads what
// `memo validate` reports. With a compiler configured (`MEMO_SYSIDE_PYTHON`;
// `OPENSYSML_BINARY`, and `MEMO_OPENSYSML_CLIENT` only to override the pinned client).
// ─────────────────────────────────────────────────────────────────────────────

import { openSysMLFlags, openSysMLUnderTest } from './helpers/compile-source.js';
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const example = resolve(__dirname, '../../../../../memo/examples/temperature-alarm');
const cli = resolve(__dirname, '../../lib/bin/memo.js');
const python = process.env.MEMO_SYSIDE_PYTHON;
const opensysml = openSysMLUnderTest;

const MODEL = `package org_lifecycle {
    private import ScalarValues::*;
    private import memo_core_enumerations::*;
    private import memo_core_common::*;
    private import memo_core_common::MemoIdentity;
    private import memo_architecture_implementation_software_structure::*;
    private import memo_artifacts_configuration_management::*;

    part itemWithoutUnits : SoftwareModule {
        @MemoIdentity { :>> providedId = "T-001"; :>> label = "ItemWithoutUnits"; }
        attribute :>> moduleKind = ModuleKind::'item';
        attribute :>> safetyClass = SafetyClassKind::B;
    }
    part itemWithUnits : SoftwareModule {
        @MemoIdentity { :>> providedId = "T-002"; :>> label = "ItemWithUnits"; }
        attribute :>> moduleKind = ModuleKind::'item';
        attribute :>> safetyClass = SafetyClassKind::B;
        part unitOne : SoftwareModule {
            @MemoIdentity { :>> providedId = "T-003"; :>> label = "UnitOne"; }
            attribute :>> moduleKind = ModuleKind::unit;
            attribute :>> safetyClass = SafetyClassKind::B;
        }
    }
    part bareSoup : SOUPSoftwareModule {
        @MemoIdentity { :>> providedId = "T-004"; :>> label = "BareSoup"; }
        attribute :>> supplier = "vendor";
    }
    part bareOts : OTSSoftwareModule {
        @MemoIdentity { :>> providedId = "T-006"; :>> label = "BareOts"; }
        attribute :>> supplier = "vendor";
    }
    part identifiedSoup : SOUPSoftwareModule {
        @MemoIdentity { :>> providedId = "T-007"; :>> label = "IdentifiedSoup"; }
        attribute :>> supplier = "vendor";
        attribute :>> version = "1.2.3";
        attribute :>> knownAnomalies = "none affecting the device";
    }
    part unrecordedChange : ChangeRequest {
        @MemoIdentity { :>> providedId = "T-005"; :>> label = "UnrecordedChange"; }
        attribute :>> changeType = ChangeTypeKind::corrective;
    }
}
`;

function run(root: string, args: string[], flags: string[]): string {
    try {
        return execFileSync(process.execPath, [cli, ...args, ...flags], { cwd: root, encoding: 'utf8', env: process.env });
    } catch (error) {
        return String((error as { stdout?: string }).stdout ?? '');
    }
}

function clauseRules(name: string, flags: string[], available: boolean): void {
    // Always registered: without a configured compiler it reports as skipped, not as an empty file.
    describe.runIf(available)(`the clause rules, through ${name}`, () => {
        it('flag what is missing and not what is there', () => {
            const root = realpathSync(mkdtempSync(join(tmpdir(), 'memo-clause-rules-')));
            try {
                cpSync(example, root, { recursive: true, filter: source => !source.includes(`${example}/.memo`) });
                writeFileSync(join(root, 'model/catalog/org_lifecycle.sysml'), MODEL);
                const report = run(root, ['validate', '.'], flags);
                const flagged = (rule: string, label: string) => report.includes(`[${rule}] `) && new RegExp(`\\[${rule}\\] [A-Za-z]+/${label}:`).test(report);

                expect(flagged('CR-MED-018', 'ItemWithoutUnits')).toBe(true);
                expect(flagged('CR-MED-018', 'ItemWithUnits')).toBe(false);
                // An OTS module is SOUP (IEC 62304 §3.29), so the SOUP rules reach it.
                for (const rule of ['CR-MED-015', 'CR-MED-016', 'CR-MED-017']) {
                    expect(flagged(rule, 'BareSoup')).toBe(true);
                    expect(flagged(rule, 'BareOts')).toBe(true);
                }
                expect(flagged('CR-MED-015', 'IdentifiedSoup')).toBe(false);
                expect(flagged('CR-MED-016', 'IdentifiedSoup')).toBe(false);
                for (const rule of ['CR-MED-019', 'CR-MED-025', 'CR-MED-026']) expect(flagged(rule, 'UnrecordedChange')).toBe(true);
                // The temperature-alarm hazard reaches a hazardous situation now, so the rule is quiet about it.
                expect(report).not.toMatch(/\[CR-MED-005\] Hazard\/UndetectedTemperatureDeviation/);
            } finally {
                rmSync(root, { recursive: true, force: true });
            }
        }, 240_000);
    });
}

clauseRules('SysIDE', ['--toolchain.compiler=syside', `--toolchain.syside.python=${python}`], Boolean(python) && existsSync(example));
clauseRules('OpenSysML', opensysml ? openSysMLFlags(opensysml) : [], Boolean(opensysml) && existsSync(example));
