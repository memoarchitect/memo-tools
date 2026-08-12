// `memo inspect --provenance` (design section 18.1 deliverable 6, section 19).
//
// Section 19 requires that every definition, element, and relationship traces to
// a source file, package, version, and origin — and section 18.1 requires the
// CLI to expose it, "so the distinction is not Architect-only".
//
// It had stopped working. `inspect` passed the settings-file path where the
// loader expects a project root, which the session-3 flip changed; the loader
// resolved nothing, the provenance table was never built, and `--provenance`
// printed a bare id. Nothing failed, because nothing tested it — the guarantee
// was documented and absent at the same time. Hence this test.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

const cli = resolve(__dirname, '../../lib/bin/memo.js');
const TMP = resolve(__dirname, '__tmp_inspect__');
const project = join(TMP, 'p');

function run(args: string[]): string {
    return execFileSync('node', [cli, ...args], {
        cwd: project, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024,
    });
}

const available = existsSync(cli);

beforeAll(() => {
    if (!available) return;
    rmSync(TMP, { recursive: true, force: true });
    mkdirSync(TMP, { recursive: true });
    // `--no-install` keeps this test off the network. `memo init` otherwise
    // shells out to a real `npm install`, so the suite failed here on any
    // machine where `@memoarchitect/ontology` could not be resolved from a
    // registry — in `beforeAll`, before a line of the code under test ran. What
    // is being tested is provenance, not npm.
    execFileSync('node', [cli, 'init', 'p', '--no-install'], {
        cwd: TMP, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'],
    });
    // The ontology still has to be resolvable from the temp project, since
    // provenance distinguishes ontology-owned definitions from project-owned
    // ones. Link the one this repo already depends on rather than fetching it.
    const ontologyRoot = dirname(require.resolve('@memoarchitect/ontology/package.json'));
    const scopeDir = join(project, 'node_modules', '@memoarchitect');
    mkdirSync(scopeDir, { recursive: true });
    symlinkSync(ontologyRoot, join(scopeDir, 'ontology'), 'dir');

    // A project-local definition — the section 19 ownership case.
    const file = join(project, 'model/catalog/architecture/system.sysml');
    const source = readFileSync(file, 'utf-8').trimEnd();
    writeFileSync(file, `${source.slice(0, -1)}\n    action def ProjectAction;\n}\n`);
}, 120_000);

afterAll(() => rmSync(TMP, { recursive: true, force: true }));

describe.runIf(available)('memo inspect --provenance', () => {
    it('reports origin, source file, and writability for a project element', () => {
        const out = JSON.parse(run(['inspect', 'system', '--provenance']));
        expect(out.provenance).toBeDefined();
        expect(out.provenance.declaration.origin).toBe('project');
        expect(out.provenance.declaration.writable).toBe(true);
        expect(out.provenance.declaration.sourceFile).toContain('system.sysml');
    }, 120_000);

    it('reports the classifier chain with an origin per link', () => {
        // Section 7.2's declaration/classifier split: a project usage is
        // writable, and the ontology definition classifying it is not.
        const out = JSON.parse(run(['inspect', 'system', '--provenance']));
        expect(out.provenance.classifier.provenance.origin).toBe('ontology');
        expect(out.provenance.classifier.provenance.writable).toBe(false);
    }, 120_000);

    it('traces a project-local definition to project source', () => {
        const out = JSON.parse(run(['inspect', 'ProjectAction', '--provenance']));
        expect(out.provenance.declaration.origin).toBe('project');
        expect(out.provenance.declaration.writable).toBe(true);
    }, 120_000);

    it('traces an ontology definition to its package and version', () => {
        // A definition is not an element; reporting only elements meant
        // `memo inspect Requirement` claimed the ontology's own kind
        // did not exist.
        const out = JSON.parse(run(['inspect', 'Requirement', '--provenance']));
        expect(out.provenance.origin).toBe('ontology');
        expect(out.provenance.writable).toBe(false);
        expect(out.provenance.packageVersion).toBeTruthy();
    }, 120_000);

    it('fails with a clear message for a name that resolves to nothing', () => {
        expect(() => run(['inspect', 'NoSuchThing', '--provenance']))
            .toThrow(/No model element, relationship, or definition/);
    }, 120_000);
});
