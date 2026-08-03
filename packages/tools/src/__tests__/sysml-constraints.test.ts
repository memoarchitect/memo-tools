// ─── Well-formedness constraints and their scoreboard (Track B B4) ───────────
//
// The rules themselves, and the two properties of the scoring that keep it
// honest: every implemented code is one Syside actually publishes (§5.1.2 — no
// MEMO-invented numbering), and every unimplemented one carries a reason, so a
// gap cannot masquerade as an oversight.
// ─────────────────────────────────────────────────────────────────────────────

import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
    IMPLEMENTED_CONSTRAINTS,
    SYSIDE_RULES,
    checkSysmlConstraints,
    classifyConstraints,
} from '../validator/sysml-constraints.js';
import { recompileProject } from '../operations/authoring.js';

let projectRoot: string;

beforeEach(() => { projectRoot = mkdtempSync(join(tmpdir(), 'memo-constraints-')); });
afterEach(() => { rmSync(projectRoot, { recursive: true, force: true }); });

function write(relativePath: string, contents: string): void {
    const absolute = resolve(projectRoot, relativePath);
    mkdirSync(resolve(absolute, '..'), { recursive: true });
    writeFileSync(absolute, contents, 'utf8');
}

async function violations(): Promise<{ code: string; elementId: string }[]> {
    const revision = await recompileProject({ projectDir: projectRoot, config: { projectName: 'constraints' } });
    return checkSysmlConstraints(revision.ir.model).map(({ code, elementId }) => ({ code, elementId }));
}

describe('constraints over declared structure', () => {
    it('flags an import with no declared visibility, and passes one that has it', async () => {
        write('model/a.sysml', `package Lib {
    import Other::*;
    private import Base::Anything;
}
`);
        const found = await violations();
        expect(found.filter(v => v.code === 'import-explicit-visibility')).toHaveLength(1);
    });

    it('flags a non-private import at the root of a file', async () => {
        write('model/a.sysml', 'public import Other::*;\n');
        const found = await violations();
        expect(found.some(v => v.code === 'import-top-level-visibility')).toBe(true);
    });

    it('flags two same-named members of one namespace, and allows them in different ones', async () => {
        write('model/a.sysml', `package Plant {
    package Upstream {
        part pump : Component;
    }
    package Downstream {
        part pump : Component;
    }
}
`);
        expect((await violations()).filter(v => v.code === 'namespace-distinguishability')).toHaveLength(0);

        write('model/a.sysml', `package Plant {
    part pump : Component;
    part pump : Component;
}
`);
        expect((await violations()).filter(v => v.code === 'namespace-distinguishability')).toHaveLength(1);
    });

    it('flags a root-level name declared in two files, which no single file can see', async () => {
        write('model/a.sysml', 'part shared : Component;\n');
        write('model/b.sysml', 'part shared : Component;\n');
        const found = await violations();
        expect(found.filter(v => v.code === 'global-namespace-distinguishability')).toHaveLength(1);
    });

    it('does not catch the package form of that collision, and says so', async () => {
        // The IR recurses into a package rather than recording it, so this case
        // is outside what the rule can see. Asserted rather than left implicit:
        // the scoreboard prints the same limitation, and a future IR change
        // that starts recording packages should make this test fail loudly.
        write('model/a.sysml', 'package Shared {\n}\n');
        write('model/b.sysml', 'package Shared {\n}\n');
        expect((await violations()).filter(v => v.code === 'global-namespace-distinguishability')).toHaveLength(0);
        expect(IMPLEMENTED_CONSTRAINTS.find(c => c.code === 'global-namespace-distinguishability')?.limitation)
            .toMatch(/package/);
    });

    it('accepts a clean model', async () => {
        write('model/a.sysml', `package Plant {
    private import Base::Anything;
    part pump : Component;
    action def Flow {
        action step;
    }
}
`);
        expect(await violations()).toEqual([]);
    });
});

describe('scoring against the published checklist', () => {
    const score = classifyConstraints();

    it('implements only codes Syside publishes', () => {
        // §5.1.2: a MEMO-invented code would not survive the engine swap and
        // would break a project's suppressions, so it is a failure, not a bonus.
        expect(score.unpublished).toEqual([]);
        const published = new Set(SYSIDE_RULES.map(rule => rule.code));
        for (const constraint of IMPLEMENTED_CONSTRAINTS) {
            expect(published.has(constraint.code), `${constraint.code} is published`).toBe(true);
        }
    });

    it('scores against all 151 published codes', () => {
        expect(score.total).toBe(151);
        expect(score.implemented.length + score.unimplemented.length).toBe(151);
    });

    it('cites a specification clause for every implemented rule', () => {
        for (const constraint of IMPLEMENTED_CONSTRAINTS) {
            expect(constraint.clause, constraint.code).toMatch(/^(KerML|SysML) \d/);
        }
    });

    it('gives a reason for every code with no implementation', () => {
        for (const entry of score.unimplemented) {
            expect(entry.detail, entry.code).toBeTruthy();
            expect(['blocked', 'not-yet', 'out-of-scope']).toContain(entry.reason);
        }
    });
});

// ─── Optional: the vendored checklist against a live syside ──────────────────
//
// §1.3 rule 1 — the suite passes with no external tools, so this runs only
// where `syside` happens to be installed. What it catches is the one thing the
// vendored snapshot cannot catch on its own: the upstream list having moved.

function sysideAvailable(): boolean {
    try {
        execFileSync('syside', ['--version'], { stdio: 'ignore' });
        return true;
    } catch {
        return false;
    }
}

describe.runIf(sysideAvailable())('the vendored checklist', () => {
    it('matches what the installed syside publishes', () => {
        const script = resolve(import.meta.dirname, '../../../../scripts/vendor-syside-rules.mjs');
        expect(() => execFileSync(process.execPath, [script, '--check'], { stdio: 'pipe' })).not.toThrow();
    });
});
