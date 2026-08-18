// The acceptance test for the validator/lowering split:
//
//   an internal-parser failure on source the validator accepted is a
//   `memo-ingest` diagnostic, never a SysML error.
//
// It asserts the *routing rule*, never a diagnostic count, so it keeps its
// meaning after the grammar gap closes. The fixture is purpose-built for this
// test rather than borrowed from the conformance corpus, for the same reason:
// a fixture that gets fixed takes the test's meaning with it.
//
// It also runs with zero external tools, because the whole CI suite must. A
// stub validator that accepts everything is a truer statement of the rule than
// any particular third-party tool would be — the rule is about roles, not about
// `syside`.

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
    buildProjectSnapshot,
    forgetLastGoodModel,
} from '../operations/project-snapshot.js';
import { createDefaultRegistry } from '../toolchain/default-registry.js';
import { diagnosticsInDomain } from '../toolchain/diagnostic.js';
import type { ProviderContext, ProviderRunResult, ValidatorDescriptor } from '../toolchain/registry.js';

const ACCEPTING_VALIDATOR = 'accepts-everything';

/**
 * A validator that accepts anything.
 *
 * It stands in for "a validator with a wider grammar than MEMO's" — which is
 * every external validator worth configuring. Using a stub keeps the test
 * honest about what it proves (the routing rule) and keeps CI free of external
 * tools.
 */
const acceptingValidator: ValidatorDescriptor = {
    id: ACCEPTING_VALIDATOR,
    role: 'validator',
    capabilities: ['check'],
    probe: () => ({ available: true, transport: 'in-process' }),
    create: (_context: ProviderContext) => ({
        id: ACCEPTING_VALIDATOR,
        role: 'validator' as const,
        transport: 'in-process' as const,
        invocation: () => undefined,
        async run(): Promise<ProviderRunResult> {
            return {
                provider: ACCEPTING_VALIDATOR,
                transport: 'in-process',
                accepted: true,
                diagnostics: [],
            };
        },
    }),
};

// Valid SysML — `syside check` exits 0 on it — that MEMO's own grammar cannot
// read: it dies on `assign`. Exactly the shape the rule is about.
const UNPARSABLE_BY_MEMO = `package IngestGap {
    attribute def Counter;
    action def Handle {
        attribute count : Counter;
        assign count := count;
    }
}
`;

const PARSABLE = `package Fine {
    part def Pump;
}
`;

const tempDirs: string[] = [];

afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
        forgetLastGoodModel(dir);
        rmSync(dir, { recursive: true, force: true });
    }
});

function project(files: Record<string, string>): string {
    const root = mkdtempSync(join(tmpdir(), 'memo-domain-'));
    tempDirs.push(root);
    // The descriptor carries the project locators. There is no conventional
    // fallback: a directory with a `project.sysml` and no `entrypoint` naming
    // it is not a project, so the helper has to write both.
    write(root, 'memo.package.yaml', 'name: routing-test\nentrypoint: model/catalog/project.sysml\ninclude: [model]\n');
    write(root, 'model/catalog/project.sysml', 'package ProjectCatalog {\n}\n');
    for (const [path, content] of Object.entries(files)) write(root, path, content);
    return root;
}

function write(root: string, path: string, content: string): void {
    const full = join(root, path);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, content);
}

function registryWithAcceptingValidator() {
    return createDefaultRegistry().register(acceptingValidator);
}

function settings(validator: string): string {
    return `name: routing-test\ntoolchain:\n  validator: ${validator}\n`;
}

describe('diagnostic domain routing', () => {
    it('routes an ingest failure to memo-ingest when the validator accepted the file', async () => {
        const root = project({
            'model/parts.sysml': UNPARSABLE_BY_MEMO,
            'memo.tools.yaml': settings(ACCEPTING_VALIDATOR),
        });

        const snapshot = await buildProjectSnapshot(root, { registry: registryWithAcceptingValidator() });

        expect(snapshot.validator).toBe(ACCEPTING_VALIDATOR);
        // The source is fine. Saying otherwise would be the exact failure this
        // split exists to prevent: the validator says yes and MEMO shows an
        // error it invented.
        expect(diagnosticsInDomain(snapshot.diagnostics, 'sysml')).toEqual([]);
        expect(diagnosticsInDomain(snapshot.diagnostics, 'memo-ingest').length).toBeGreaterThan(0);
    });

    it('routes the same failure to sysml when MEMO is itself the validator', async () => {
        const root = project({
            'model/parts.sysml': UNPARSABLE_BY_MEMO,
            'memo.tools.yaml': `name: routing-test\n`,
        });

        const snapshot = await buildProjectSnapshot(root);

        // Same file, same failure, different question asked of it. With MEMO's
        // grammar as the authority, "MEMO cannot read this" *is* the verdict on
        // the source.
        expect(diagnosticsInDomain(snapshot.diagnostics, 'sysml').length).toBeGreaterThan(0);
        // And it is reported once, not once per role.
        expect(diagnosticsInDomain(snapshot.diagnostics, 'memo-ingest')).toEqual([]);
    });

    it('reports nothing in either domain for source MEMO can read', async () => {
        const root = project({
            'model/parts.sysml': PARSABLE,
            'memo.tools.yaml': settings(ACCEPTING_VALIDATOR),
        });

        const snapshot = await buildProjectSnapshot(root, { registry: registryWithAcceptingValidator() });
        expect(snapshot.diagnostics).toEqual([]);
        expect(snapshot.stale).toBe(false);
    });

    it('carries the provider onto every diagnostic it produced', async () => {
        const root = project({
            'model/parts.sysml': UNPARSABLE_BY_MEMO,
            'memo.tools.yaml': settings(ACCEPTING_VALIDATOR),
        });
        const snapshot = await buildProjectSnapshot(root, { registry: registryWithAcceptingValidator() });
        for (const diagnostic of snapshot.diagnostics) {
            expect(diagnostic.provider).toBe(snapshot.lowering);
            expect(diagnostic.file).toBeTruthy();
        }
    });
});

describe('the last good model stays on screen', () => {
    it('keeps the previous model when a revision fails to lower', async () => {
        const root = project({
            'model/parts.sysml': PARSABLE,
            'memo.tools.yaml': settings(ACCEPTING_VALIDATOR),
        });
        const registry = registryWithAcceptingValidator();

        const good = await buildProjectSnapshot(root, { registry });
        expect(good.stale).toBe(false);
        expect(good.model.errors).toEqual([]);

        // Break it the way a modeller breaks it: by saving.
        write(root, 'model/parts.sysml', UNPARSABLE_BY_MEMO);
        const broken = await buildProjectSnapshot(root, { registry });

        // §1.1: the diagram never blanks and never shows a half-built model.
        // A model carrying this revision's parse wreckage is exactly the
        // half-built thing that must not reach the canvas — the retained one
        // carries the previous revision's clean parse instead.
        expect(broken.stale).toBe(true);
        expect(broken.model).toBe(good.model);
        expect(broken.model.errors).toEqual([]);
        // The picture is the old one; the diagnostics are the current ones.
        expect(diagnosticsInDomain(broken.diagnostics, 'memo-ingest').length).toBeGreaterThan(0);

        // Fixing it takes the new model, not the retained one.
        write(root, 'model/parts.sysml', `package Fine {\n    part def Pump;\n    part def Valve;\n}\n`);
        const fixed = await buildProjectSnapshot(root, { registry });
        expect(fixed.stale).toBe(false);
        expect(fixed.model).not.toBe(good.model);
        expect(fixed.diagnostics).toEqual([]);
    });
});
