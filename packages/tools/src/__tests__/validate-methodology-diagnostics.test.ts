import { spawnSync } from 'node:child_process';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { compiledExample, compilerConfigured, examplesPresent } from './helpers/compile-source.js';
import { resolveEffectiveMethodology } from '../model/methodology-resolver.js';
import { buildEffectiveScope, isPackageInScope } from '../model/effective-scope.js';

// A methodology selects what the package declaring it publicly imports, and a
// project adds to that by publicly importing in its binding's package. There is
// no list of package names: a selection that names a package nothing declares
// is an import the compiler rejects, so the run fails before a selection could
// silently select nothing.

const CLI_PATH = join(__dirname, '../../lib/bin/memo.js');
const EXAMPLES = resolve(__dirname, '../../../../../memo/examples');

function validate(root: string) {
    return spawnSync('node', [CLI_PATH, 'validate', root], {
        encoding: 'utf-8',
        env: { ...process.env, NO_COLOR: '1' },
    });
}

function withCopy(example: string, run: (root: string) => void): void {
    const root = mkdtempSync(join(tmpdir(), 'memo-methodology-'));
    try {
        cpSync(join(EXAMPLES, example), root, { recursive: true });
        run(root);
    } finally {
        rmSync(root, { recursive: true, force: true });
    }
}

function edit(file: string, from: string, to: string): void {
    const text = readFileSync(file, 'utf-8');
    expect(text).toContain(from);
    writeFileSync(file, text.replace(from, to));
}

describe.runIf(examplesPresent)('a selection that names a package nothing declares', () => {
    it('fails the run when a project imports a misspelled extension, and a resolvable one does not', () => {
        withCopy('ros-mobile-robot', root => {
            expect(validate(root).stdout).not.toContain('Methodology resolution');

            edit(join(root, 'model/methodology/project.sysml'),
                'public import memo_extension_ros::*;', 'public import memo_extension_rss::*;');
            const misspelled = validate(root);
            // The example has rule violations of its own, so exit 1 alone proves
            // nothing: the compiler has to be what stopped the run.
            expect(misspelled.stdout + misspelled.stderr).toContain('memo_extension_rss');
            expect(misspelled.stderr).toContain('stage 2 and the rules did not run');
            expect(misspelled.status).toBe(1);
        });
    }, 120_000);

    // A layer is selected the same way, through its layer package. (A copy of
    // gpca-pump cannot show this for a methodology: its methodology is read
    // from the library root, not from the copy.)
    it('fails the run when a project imports a misspelled layer', () => {
        withCopy('ros-mobile-robot', root => {
            edit(join(root, 'model/methodology/project.sysml'),
                'public import memo_extension_ros::*;',
                'public import memo_extension_ros::*;\n    public import memo_architecture_logicl::*;');
            const misspelled = validate(root);
            // The example has rule violations of its own, so exit 1 alone proves
            // nothing: the compiler has to be what stopped the run.
            expect(misspelled.stdout + misspelled.stderr).toContain('memo_architecture_logicl');
            expect(misspelled.stderr).toContain('stage 2 and the rules did not run');
            expect(misspelled.status).toBe(1);
        });
    }, 120_000);
});

// GPCA is the shipped methodology that narrows: five architecture layers and
// four of the five assurance disciplines, cybersecurity left out. Its selection
// is its package's public imports, and the rule packages it does not import
// (coverage, lifecycle) stay out with cybersecurity.
describe.runIf(compilerConfigured && examplesPresent)('the GPCA methodology selected by import', () => {
    it('selects every package of its layers and the packages it imports, and nothing it does not', async () => {
        const { resolution } = await compiledExample('gpca-pump');
        const effective = resolveEffectiveMethodology(
            resolution!.binding, resolution!.methodologies, resolution!.publicImports);
        expect(effective.diagnostics).toEqual([]);
        const scope = buildEffectiveScope(effective);
        expect(scope.mode).toBe('explicit');
        for (const selected of [
            'memo_architecture_logical_interfaces', 'memo_architecture_operational_context_actors',
            'memo_architecture_implementation_hardware_sensing', 'memo_assurance_safety_risk', 'memo_rules_closure',
        ]) expect(isPackageInScope(scope, selected), selected).toBe(true);
        for (const excluded of [
            'memo_assurance_cybersecurity', 'memo_assurance_safety_risk_analysis', 'memo_rules_coverage',
            'memo_rules_lifecycle', 'memo_examples_gpca_pump_methodology_gpca_profiles',
        ]) expect(isPackageInScope(scope, excluded), excluded).toBe(false);
    });
});
