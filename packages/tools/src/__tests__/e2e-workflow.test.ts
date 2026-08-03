// ─── E2E CLI Workflow Tests ───────────────────────────────────────────────────
//
// Tests the full workflow: init → parse → validate → completeness → export
// Uses a temp directory so tests are isolated from the real filesystem.
// ─────────────────────────────────────────────────────────────────────────────

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execSync } from 'node:child_process';
import { mkdtempSync, existsSync, readFileSync, rmSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { tmpdir } from 'node:os';
import { resolveContentPackageRoot } from '@memoarchitect/tools';
import { parse as parseYaml } from 'yaml';

const CLI_PATH = join(__dirname, '../../lib/bin/memo.js');
const REPO_ROOT = join(__dirname, '../../../..');

function run(cmd: string, cwd: string): string {
    return execSync(`node ${CLI_PATH} ${cmd}`, {
        cwd,
        encoding: 'utf-8',
        timeout: 30_000,
        env: { ...process.env, NO_COLOR: '1' },
    });
}

function runMayFail(cmd: string, cwd: string): { stdout: string; exitCode: number } {
    try {
        const stdout = execSync(`node ${CLI_PATH} ${cmd}`, {
            cwd,
            encoding: 'utf-8',
            timeout: 30_000,
            env: { ...process.env, NO_COLOR: '1' },
            stdio: ['pipe', 'pipe', 'pipe'],
        });
        return { stdout, exitCode: 0 };
    } catch (err: any) {
        // execSync throws on non-zero exit; stdout is still available
        return { stdout: (err.stdout || '') + (err.stderr || ''), exitCode: err.status || 1 };
    }
}

describe('E2E: memo init → validate → export', () => {
    let tmpDir: string;

    beforeAll(() => {
        tmpDir = mkdtempSync(join(tmpdir(), 'memo-e2e-'));
    });

    afterAll(() => {
        rmSync(tmpDir, { recursive: true, force: true });
    });

    it('memo init creates project structure with memo.package.yaml', () => {
        const output = run('init test-device --no-install', tmpDir);

        expect(output).toContain('Creating MEMO project: test-device');
        expect(output).toContain('Project created');

        const projectDir = join(tmpDir, 'test-device');
        expect(existsSync(projectDir)).toBe(true);
        expect(existsSync(join(projectDir, 'memo.package.yaml'))).toBe(true);
        const architecturePath = join(projectDir, 'model', 'catalog', 'architecture', 'system.sysml');
        expect(existsSync(architecturePath)).toBe(true);
        expect(existsSync(join(projectDir, 'model', 'catalog', 'assurance', 'requirements.sysml'))).toBe(true);
        expect(existsSync(join(projectDir, 'model', 'catalog', 'artifacts', 'catalog.sysml'))).toBe(true);
        const samplesDir = join(projectDir, 'analysis', 'Samples');
        expect(readdirSync(samplesDir).sort()).toEqual([
            '01-model-overview.ipynb',
            '02-architecture-hotspots.ipynb',
            '03-model-quality.ipynb',
            '04-change-impact-explorer.ipynb',
            '05-model-charts.ipynb',
            '06-ownership-graph.ipynb',
            '07-model-inventory-table.ipynb',
            'README.md',
        ]);
        const overview = JSON.parse(readFileSync(join(samplesDir, '01-model-overview.ipynb'), 'utf-8'));
        expect(overview.nbformat).toBe(4);
        expect(overview.cells.some((cell: { source?: string[] }) => cell.source?.join('').includes('find_sysml_root'))).toBe(true);
        expect(readFileSync(join(samplesDir, 'README.md'), 'utf-8')).toContain('Analysis → Jupyter Notebooks');

        // Check new-format config content
        const config = parseYaml(readFileSync(join(projectDir, 'memo.package.yaml'), 'utf-8'));
        // Identity only. `type` and `extends` selected model content and are
        // no longer written or read.
        expect(config).toMatchObject({ name: 'test-device' });
        expect(config.type).toBeUndefined();
        expect(config.extends).toBeUndefined();
        expect(readFileSync(architecturePath, 'utf-8')).toContain('private import memo::*');

        // The native entrypoint carries the imports and the binding.
        const entrypointPath = join(projectDir, 'model', 'catalog', 'project.sysml');
        expect(existsSync(entrypointPath)).toBe(true);
        const entrypoint = readFileSync(entrypointPath, 'utf-8');
        expect(entrypoint).toContain('ProjectMethodBinding');
        expect(entrypoint).toContain('ref :>> selectedMethodology');
        expect(entrypoint).toContain('private import memo_methodology_profiles::*;');

        expect(existsSync(join(projectDir, 'memo.lock.yaml'))).toBe(true);
        const lock = readFileSync(join(projectDir, 'memo.lock.yaml'), 'utf-8');
        expect(lock).not.toContain('test-device');
    });

    it('memo init with no name initializes the current directory', () => {
        const projectDir = join(tmpDir, 'inplace-device');
        mkdirSync(projectDir);

        const output = run('init --no-install', projectDir);
        expect(output).toContain('Creating MEMO project: inplace-device');
        expect(output).toContain('Project created in current directory');

        expect(existsSync(join(projectDir, 'memo.package.yaml'))).toBe(true);
        expect(existsSync(join(projectDir, 'model', 'catalog', 'architecture', 'system.sysml'))).toBe(true);
        expect(existsSync(join(projectDir, 'model', 'catalog', 'assurance', 'requirements.sysml'))).toBe(true);
        expect(existsSync(join(projectDir, 'model', 'catalog', 'artifacts', 'catalog.sysml'))).toBe(true);
        const config = parseYaml(readFileSync(join(projectDir, 'memo.package.yaml'), 'utf-8'));
        expect(config.name).toBe('inplace-device');

        // Second init in the same directory must refuse
        const { exitCode, stdout } = runMayFail('init', projectDir);
        expect(exitCode).not.toBe(0);
        expect(stdout).toContain('already a MEMO project');
    });

    it('memo init refuses to overwrite existing directory', () => {
        const { exitCode } = runMayFail('init test-device', tmpDir);
        expect(exitCode).not.toBe(0);
    });

    it('memo init --ontology selects a different ontology', () => {
        // Run from REPO_ROOT so ontology packages are discoverable
        const output = run(`init ${join(tmpDir, 'test-core-device')} --ontology @memoarchitect/ontology --no-install`, REPO_ROOT);

        expect(output).toContain('Creating MEMO project');
        expect(output).toContain('Project created');

        const projectDir = join(tmpDir, 'test-core-device');
        const config = parseYaml(readFileSync(join(projectDir, 'memo.package.yaml'), 'utf-8'));
        // The descriptor records identity only. What the project imports and
        // which methodology it binds is in model/catalog/project.sysml.
        expect(config.extends).toBeUndefined();
        const entrypoint = readFileSync(join(projectDir, 'model', 'catalog', 'project.sysml'), 'utf-8');
        expect(entrypoint).toContain('ProjectMethodBinding');

        // SysML should import the ontology
        const sysml = readFileSync(join(projectDir, 'model', 'catalog', 'architecture', 'system.sysml'), 'utf-8');
        expect(sysml).toContain('private import memo::*');

        expect(existsSync(join(projectDir, 'memo.lock.yaml'))).toBe(true);
        expect(readFileSync(join(projectDir, 'memo.lock.yaml'), 'utf-8')).not.toContain('test-core-device');
    });

    it('memo init inside the workspace locks against the resolved ontology', () => {
        const projectDir = join(REPO_ROOT, 'tmp-e2e-lock-device');
        try {
            const output = run(`init ${projectDir} --no-install`, REPO_ROOT);
            expect(output).toContain('Created memo.lock.yaml');

            const lock = readFileSync(join(projectDir, 'memo.lock.yaml'), 'utf-8');
            // The lock records the packages the project's imports resolved to.
            expect(lock).toContain('ontology: "@memoarchitect/ontology"');
            expect(lock).toContain('name: "@memoarchitect/ontology"');
            expect(lock).not.toContain('tmp-e2e-lock-device');
        } finally {
            rmSync(projectDir, { recursive: true, force: true });
        }
    });

    it('memo init --ontology rejects unknown ontology', () => {
        // Run from REPO_ROOT so ontology packages are discoverable (and validation triggers)
        const { exitCode, stdout } = runMayFail(
            `init ${join(tmpDir, 'test-bad')} --ontology @memoarchitect/nonexistent`,
            REPO_ROOT
        );
        expect(exitCode).not.toBe(0);
        expect(stdout).toContain('not found');
    });

    it('memo init --list shows available packages', () => {
        // Run from REPO_ROOT so packages are discoverable
        const output = run('init --list', REPO_ROOT);
        expect(output).toContain('@memoarchitect/ontology');
        expect(output).toContain('@memoarchitect/');
        expect(output).toContain('(default)');
    });

    it('memo init --template samd copies the ontology template', () => {
        const projectDir = join(tmpDir, 'test-samd');
        const output = run(`init ${projectDir} --template samd --no-install`, REPO_ROOT);

        expect(output).toContain('template: samd');
        expect(output).toContain('Project created');
        expect(readFileSync(join(projectDir, 'model', 'catalog', 'architecture', 'system.sysml'), 'utf-8'))
            .toContain('samdDevice');
    });

    it('memo init uses the ontology default template', () => {
        const projectDir = join(tmpDir, 'test-default');
        const output = run(`init ${projectDir} --no-install`, REPO_ROOT);

        expect(output).toContain('template: default');
        expect(output).toContain('Project created');
        expect(existsSync(join(projectDir, 'model', 'catalog', 'architecture', 'system.sysml'))).toBe(true);
        expect(existsSync(join(projectDir, 'model', 'catalog', 'assurance', 'requirements.sysml'))).toBe(true);
        expect(existsSync(join(projectDir, 'model', 'catalog', 'artifacts', 'catalog.sysml'))).toBe(true);
        expect(existsSync(join(projectDir, 'syside.toml'))).toBe(true);
        const npmPackage = JSON.parse(readFileSync(join(projectDir, 'package.json'), 'utf-8'));
        expect(npmPackage.name).toBe('test-default');
        expect(npmPackage.dependencies['@memoarchitect/ontology']).toMatch(/^\d+\.\d+\.\d+$/);
        const config = parseYaml(readFileSync(join(projectDir, 'memo.package.yaml'), 'utf-8'));
        expect(config.extends).toBeUndefined();
        expect(readFileSync(join(projectDir, 'model', 'catalog', 'project.sysml'), 'utf-8'))
            .toContain('ProjectMethodBinding');
    });

    it('memo init --template rejects an unknown template', () => {
        const projectDir = join(tmpDir, 'test-bad-template');
        const { exitCode, stdout } = runMayFail(`init ${projectDir} --template nonexistent --no-install`, REPO_ROOT);
        expect(exitCode).not.toBe(0);
        expect(stdout).toContain('Unknown template');
    });

    it('memo init --list shows templates from the ontology manifest', () => {
        const output = run('init --list', REPO_ROOT);
        expect(output).toContain('Available templates');
        expect(output).toContain('default');
        expect(output).toContain('samd');
        expect(output).toContain('connected-device');
        expect(output).toContain('monitoring-device');
        expect(output).toContain('infusion-pump');
    });

    it('memo init --example gpca-pump copies example project', () => {
        const projectDir = join(tmpDir, 'test-from-example');
        const output = run(`init ${projectDir} --example gpca-pump`, REPO_ROOT);

        expect(output).toContain('Creating project from example');
        expect(output).toContain('gpca-pump');
        expect(output).toContain('Project created');

        expect(existsSync(join(projectDir, 'model', 'catalog', 'project.sysml'))).toBe(true);
        expect(existsSync(join(projectDir, 'model'))).toBe(true);

        // One catalog root, and nothing beside it. `model/views/` and
        // `model/samples/` were the pre-catalog layout; the session 4
        // conversion moved views beneath the viewpoints that govern them, so
        // their absence here is the assertion, not an omission.
        const modelDir = join(projectDir, 'model');
        expect(readdirSync(modelDir)).toEqual(['catalog']);

        const catalogFiles = readdirSync(join(modelDir, 'catalog'));
        expect(catalogFiles.some(f => f.endsWith('.sysml'))).toBe(true);
        expect(existsSync(join(modelDir, 'catalog', 'viewpoints'))).toBe(true);
    });

    it('memo init --example gpca matches gpca-pump by prefix', () => {
        const projectDir = join(tmpDir, 'test-example-prefix');
        const output = run(`init ${projectDir} --example gpca`, REPO_ROOT);

        expect(output).toContain('Creating project from example');
        expect(output).toContain('gpca-pump');
        expect(existsSync(join(projectDir, 'model', 'catalog', 'project.sysml'))).toBe(true);
    });

    it('memo init --example with no name copies into the current (empty) directory', () => {
        const projectDir = join(tmpDir, 'test-example-inplace');
        mkdirSync(projectDir);

        const output = run('init --example gpca', projectDir);
        expect(output).toContain('Project created in current directory');
        expect(existsSync(join(projectDir, 'model', 'catalog', 'project.sysml'))).toBe(true);
        expect(existsSync(join(projectDir, 'model'))).toBe(true);

        // Refuses to copy into a non-empty directory
        const { exitCode, stdout } = runMayFail('init --example gpca', projectDir);
        expect(exitCode).not.toBe(0);
        expect(stdout).toContain('already a MEMO project');
    });

    it('memo init --example rejects unknown example', () => {
        const projectDir = join(tmpDir, 'test-bad-example');
        const { exitCode, stdout } = runMayFail(`init ${projectDir} --example nonexistent`, REPO_ROOT);
        expect(exitCode).not.toBe(0);
        expect(stdout).toContain('Unknown example');
    });

    it('memo init --list shows available examples', () => {
        const output = run('init --list', REPO_ROOT);
        expect(output).toContain('Available examples');
        expect(output).toContain('gpca-pump');
    });
});

describe('E2E: ontology lock + change detection', () => {
    let projectDir: string;

    beforeAll(() => {
        // Create a test project inside the monorepo so config resolution finds ontology packages
        projectDir = join(REPO_ROOT, '.test-lock-' + process.pid);
        rmSync(projectDir, { recursive: true, force: true });
        mkdirSync(projectDir, { recursive: true });
        mkdirSync(join(projectDir, 'model'), { recursive: true });

        writeFileSync(join(projectDir, 'memo.package.yaml'), `name: lock-test\n`);
        mkdirSync(join(projectDir, 'model', 'catalog'), { recursive: true });
        writeFileSync(join(projectDir, 'model', 'catalog', 'project.sysml'), `
package lock_test_project {
    private import memo_core_enumerations::*;
    private import memo_methodology_core::*;
    private import memo_methodology_profiles::*;
    private import lock_test_model::*;

    part binding : ProjectMethodBinding {
        attribute :>> id = "PMB-TEST";
        attribute :>> name = "lock-testBinding";
        attribute :>> projectName = "lock-test";
        ref :>> selectedMethodology = mdDefaultDefinition;
        attribute :>> scopeMode = ScopeModeKind::explicit;
    }
}
`);

        writeFileSync(join(projectDir, 'model', 'device.sysml'), `
package lock_test_model {
    part sys : System {
        attribute redefines name = "Lock Test";
    }
}
`);
    });

    afterAll(() => {
        rmSync(projectDir, { recursive: true, force: true });
    });

    it('memo lock creates memo.lock.yaml', () => {
        const output = run('lock', projectDir);

        expect(output).toContain('Lock file written');
        expect(output).toContain('@memoarchitect/');
        expect(existsSync(join(projectDir, 'memo.lock.yaml'))).toBe(true);

        const lock = readFileSync(join(projectDir, 'memo.lock.yaml'), 'utf-8');
        expect(lock).toContain('ontology: "@memoarchitect/ontology"');
        expect(lock).toContain('version:');
        expect(lock).toContain('lockedAt:');
        expect(lock).toContain('packages:');
        // The lock records what the project's imports resolved to. There is no
        // `extends` chain to walk, so a package the model never reaches is not
        // in the lock — which is the point of locking the resolution.
        expect(lock).toContain('@memoarchitect/ontology');
    });

    it('memo validate succeeds with matching lock', () => {
        // Lock file was created in previous test
        const { stdout, exitCode } = runMayFail('validate', projectDir);

        expect(stdout).toContain('locked to');
        expect(stdout).toContain('Model:');
        expect(exitCode).toBe(0);
    });

    it('memo validate fails when ontology ID changes', () => {
        // Tamper the lock file to simulate an ontology change
        const lockPath = join(projectDir, 'memo.lock.yaml');
        const lock = readFileSync(lockPath, 'utf-8');
        writeFileSync(lockPath, lock.replace(
            '@memoarchitect/ontology',
            '@memoarchitect/some-other-ontology'
        ));

        const { stdout, exitCode } = runMayFail('validate', projectDir);
        expect(exitCode).not.toBe(0);
        expect(stdout).toContain('Locked ontology cannot be resolved');
        expect(stdout).toContain('@memoarchitect/some-other-ontology');

        // Restore the lock file for subsequent tests
        writeFileSync(lockPath, lock);
    });

    it('memo validate fails when ontology version changes', () => {
        const lockPath = join(projectDir, 'memo.lock.yaml');
        const lock = readFileSync(lockPath, 'utf-8');
        writeFileSync(lockPath, lock.replace(
            /version: "[^"]+"\nlockedAt/,
            'version: "99.0.0"\nlockedAt'
        ));

        const { stdout, exitCode } = runMayFail('validate', projectDir);
        expect(exitCode).not.toBe(0);
        expect(stdout).toContain('version changed');

        // Restore
        writeFileSync(lockPath, lock);
    });

    it('memo lock regenerates after ontology changes', () => {
        // First tamper the lock
        const lockPath = join(projectDir, 'memo.lock.yaml');
        const oldLock = readFileSync(lockPath, 'utf-8');
        writeFileSync(lockPath, oldLock.replace(
            '@memoarchitect/ontology',
            '@memoarchitect/some-other-ontology'
        ));

        // Verify validate fails
        const { exitCode: fail } = runMayFail('validate', projectDir);
        expect(fail).not.toBe(0);

        // Regenerate lock
        const output = run('lock', projectDir);
        expect(output).toContain('Lock file written');

        // Now validate should pass
        const { exitCode: pass } = runMayFail('validate', projectDir);
        expect(pass).toBe(0);
    });
});

describe('E2E: custom model validation', () => {
    let projectDir: string;

    beforeAll(() => {
        // Create a test project inside the monorepo so config resolution finds @memoarchitect/medical-modeling-profile
        projectDir = join(REPO_ROOT, '.test-custom-device-' + process.pid);
        rmSync(projectDir, { recursive: true, force: true });
        mkdirSync(projectDir, { recursive: true });
        mkdirSync(join(projectDir, 'model'), { recursive: true });

        writeFileSync(join(projectDir, 'memo.package.yaml'), `name: custom-device\n`);
        mkdirSync(join(projectDir, 'model', 'catalog'), { recursive: true });
        writeFileSync(join(projectDir, 'model', 'catalog', 'project.sysml'), `
package custom_device_project {
    private import memo_core_enumerations::*;
    private import memo_methodology_core::*;
    private import memo_methodology_profiles::*;
    private import custom_device_model::*;

    part binding : ProjectMethodBinding {
        attribute :>> id = "PMB-TEST";
        attribute :>> name = "custom-deviceBinding";
        attribute :>> projectName = "custom-device";
        ref :>> selectedMethodology = mdDefaultDefinition;
        attribute :>> scopeMode = ScopeModeKind::explicit;
    }
}
`);

        // Write a SysML model with elements and a traced relationship
        writeFileSync(join(projectDir, 'model', 'device.sysml'), `
package custom_device_model {

    part mySystem : System {
        attribute redefines name = "Custom Device";
    }

    part need1 : Requirement {
        attribute redefines source = "User";
        attribute redefines reqId = "REQ-001";
        attribute redefines statement = "User need 1";
    }

    part sysReq1 : Requirement {
        attribute redefines source = "System";
        attribute redefines reqId = "REQ-002";
        attribute redefines statement = "System requirement 1";
    }

    connection : TraceTo connect source ::> sysReq1 to target ::> need1;
}
`);
    });

    afterAll(() => {
        rmSync(projectDir, { recursive: true, force: true });
    });

    it('validates a custom model with elements and relationships', () => {
        const { stdout } = runMayFail('validate', projectDir);

        expect(stdout).toContain('Model:');
        // Three modelled parts plus the two methodology elements the native
        // entrypoint contributes: the binding and the methodology it selects.
        expect(stdout).toContain('5 elements');
        expect(stdout).toContain('1 relationships');
        expect(stdout).toContain('Completeness by Layer');
        // The project is resolved from its entrypoint, and the binding names
        // the methodology with a typed reference rather than a YAML field.
        expect(stdout).toContain('Binding: custom-device → mdDefaultDefinition');
    });
});

describe('E2E: memo install', () => {
    let projectDir: string;
    let fakeOntologyDir: string;

    beforeAll(() => {
        // Create a project inside the monorepo for config resolution
        projectDir = join(REPO_ROOT, '.test-install-' + process.pid);
        rmSync(projectDir, { recursive: true, force: true });

        // Use memo init to create a properly configured project
        run(`init ${projectDir} --no-install`, REPO_ROOT);

        // Create a fake local ontology package to install
        fakeOntologyDir = join(REPO_ROOT, '.test-fake-ontology-' + process.pid);
        rmSync(fakeOntologyDir, { recursive: true, force: true });
        mkdirSync(fakeOntologyDir, { recursive: true });

        writeFileSync(join(fakeOntologyDir, 'memo.package.yaml'), `
name: "@test/fake-ontology"
version: "1.0.0"
type: ontology
extends: "@memoarchitect/ontology"
description: "Fake ontology for testing memo install"
`);

        mkdirSync(join(fakeOntologyDir, 'sysml', 'custom'), { recursive: true });
        writeFileSync(join(fakeOntologyDir, 'sysml', 'custom', 'custom.sysml'), `
package FakeOntology {
    part def CustomKind { }
}
`);
    });

    afterAll(() => {
        rmSync(projectDir, { recursive: true, force: true });
        rmSync(fakeOntologyDir, { recursive: true, force: true });
    });

    it('memo install with no source uses the lock and leaves resolvable content alone', () => {
        const output = run('install', projectDir);
        expect(output).toContain('already resolvable');
        expect(output).toContain('@memoarchitect/ontology');
    });

    it('memo install --mode local symlinks a local package into memo_packages/', () => {
        const output = run(`install ${fakeOntologyDir} --mode local`, projectDir);

        expect(output).toContain('Installing package (local)');
        expect(output).toContain('Installed @test/fake-ontology');

        // Check symlink was created
        const linkPath = join(projectDir, 'memo_packages', 'fake-ontology');
        expect(existsSync(linkPath)).toBe(true);

        // Check memo.package.yaml has the dependency
        const config = readFileSync(join(projectDir, 'memo.package.yaml'), 'utf-8');
        expect(config).toContain('@test/fake-ontology');
    });

    it('memo install --mode local refuses non-existent path', () => {
        const { exitCode, stdout } = runMayFail('install /nonexistent/path --mode local', projectDir);
        expect(exitCode).not.toBe(0);
        expect(stdout).toContain('does not exist');
    });

    it('memo install detects local paths automatically', () => {
        // Create another fake package
        const anotherDir = join(REPO_ROOT, '.test-another-ontology-' + process.pid);
        rmSync(anotherDir, { recursive: true, force: true });
        mkdirSync(anotherDir, { recursive: true });
        writeFileSync(join(anotherDir, 'memo.package.yaml'), `
name: "@test/another-ontology"
version: "2.0.0"
type: ontology
description: "Another fake ontology"
`);

        try {
            const output = run(`install ${anotherDir}`, projectDir);
            expect(output).toContain('Installing package (local)');
            expect(output).toContain('Installed @test/another-ontology');
        } finally {
            rmSync(anotherDir, { recursive: true, force: true });
        }
    });

    it('memo install requires a project config', () => {
        const emptyDir = mkdtempSync(join(tmpdir(), 'memo-empty-'));
        try {
            const { exitCode, stdout } = runMayFail('install some-package', emptyDir);
            expect(exitCode).not.toBe(0);
            expect(stdout).toContain('No memo.package.yaml');
        } finally {
            rmSync(emptyDir, { recursive: true, force: true });
        }
    });
});

describe('DD-3: kpar round-trip (GPCA pump)', () => {
    const GPCA_DIR = join(resolveContentPackageRoot(), 'examples', 'gpca-pump');
    let extractDir: string;

    function collectSysmlFiles(dir: string): string[] {
        const files: string[] = [];
        for (const entry of readdirSync(dir, { withFileTypes: true })) {
            const full = join(dir, entry.name);
            if (entry.isDirectory()) {
                files.push(...collectSysmlFiles(full));
            } else if (entry.name.endsWith('.sysml')) {
                files.push(full);
            }
        }
        return files;
    }

    beforeAll(() => {
        extractDir = mkdtempSync(join(tmpdir(), 'memo-kpar-roundtrip-'));
        run('pack', GPCA_DIR);
    });

    afterAll(() => {
        rmSync(extractDir, { recursive: true, force: true });
        rmSync(join(GPCA_DIR, 'gpca-pump.memo-bundle'), { force: true });
    });

    it('produces a private .memo-bundle file, never a KPAR', () => {
        expect(existsSync(join(GPCA_DIR, 'gpca-pump.memo-bundle'))).toBe(true);
        expect(existsSync(join(GPCA_DIR, 'gpca-pump.kpar'))).toBe(false);
    });

    it('the MEMO bundle extracts without errors', () => {
        execSync(
            `gunzip -c "${join(GPCA_DIR, 'gpca-pump.memo-bundle')}" | tar xf -`,
            { cwd: extractDir },
        );
        expect(existsSync(join(extractDir, 'manifest.json'))).toBe(true);
    });

    it('manifest lists all source SysML files', () => {
        const manifest = JSON.parse(readFileSync(join(extractDir, 'manifest.json'), 'utf-8'));
        // The kpar packs every source dir of the project (model/ + methodology/).
        const sourceFiles = [
            ...collectSysmlFiles(join(GPCA_DIR, 'model')),
            ...collectSysmlFiles(join(GPCA_DIR, 'methodology')),
        ];
        const manifestSysml = (manifest.files as string[]).filter((f: string) => f.endsWith('.sysml'));

        expect(manifest.format).toBe('kpar');
        expect(manifestSysml.length).toBe(sourceFiles.length);
        for (const src of sourceFiles) {
            const rel = relative(GPCA_DIR, src);
            expect(manifestSysml).toContain(rel);
        }
    });

    it('extracted SysML files are byte-identical to source', () => {
        const sourceFiles = collectSysmlFiles(join(GPCA_DIR, 'model'));
        expect(sourceFiles.length).toBeGreaterThanOrEqual(10);

        const diffs: string[] = [];
        for (const src of sourceFiles) {
            const rel = relative(GPCA_DIR, src);
            const extracted = join(extractDir, rel);
            if (!existsSync(extracted)) {
                diffs.push(`MISSING: ${rel}`);
                continue;
            }
            const srcContent = readFileSync(src);
            const extContent = readFileSync(extracted);
            if (!srcContent.equals(extContent)) {
                diffs.push(`CHANGED: ${rel}`);
            }
        }

        if (diffs.length > 0) {
            throw new Error(`Round-trip diff is not empty:\n${diffs.join('\n')}`);
        }
        expect(diffs).toHaveLength(0);
    });

    it('config file survives round-trip', () => {
        const srcConfig = readFileSync(join(GPCA_DIR, 'model', 'catalog', 'project.sysml'), 'utf-8');
        const extConfig = readFileSync(join(extractDir, 'model', 'catalog', 'project.sysml'), 'utf-8');
        expect(extConfig).toBe(srcConfig);
    });
});

describe('DD-5: sysand publish --dry-run', () => {
    it('memo sysand publish --dry-run succeeds for ontology', () => {
        const pkgDir = join(resolveContentPackageRoot(), 'ontology');
        const output = run('sysand publish --dry-run --package @memoarchitect/ontology', pkgDir);
        expect(output).toContain('PASS');
        expect(output).toContain('.kpar');
        expect(output).toContain('All packages pass dry-run');
    });

    it('memo sysand publish --dry-run fails gracefully outside a project', () => {
        const tmpDir = mkdtempSync(join(tmpdir(), 'memo-publish-'));
        const { exitCode } = runMayFail('sysand publish --dry-run', tmpDir);
        rmSync(tmpDir, { recursive: true, force: true });
        expect(exitCode).not.toBe(0);
    });
});

describe('E2E: import ea/cameo/sysand/owl', () => {
    let tmpDir: string;

    beforeAll(() => {
        tmpDir = mkdtempSync(join(tmpdir(), 'memo-import-e2e-'));
    });

    afterAll(() => {
        rmSync(tmpDir, { recursive: true, force: true });
    });

    it('memo import ea imports from EA JSON export', () => {
        const eaJson = JSON.stringify({
            elements: [
                { id: 1, name: 'Overheating', type: 'Class', stereotype: 'Hazard', notes: 'Thermal hazard' },
                { id: 2, name: 'Temp Monitor', type: 'Class', stereotype: 'RiskControlMeasure' },
            ],
            connectors: [
                { id: 1, sourceId: 2, targetId: 1, type: 'Dependency', stereotype: 'mitigates' },
            ],
        });
        writeFileSync(join(tmpDir, 'ea-export.json'), eaJson);

        const output = run(`import ea ea-export.json --dry-run`, tmpDir);
        expect(output).toContain('Sparx EA');
        expect(output).toContain('2 mapped');
        expect(output).toContain('Overheating : Hazard');
        expect(output).toContain('Temp_Monitor : RiskControlMeasure');
        expect(output).toContain('Mitigates');
    });

    it('memo import cameo imports from Cameo JSON export', () => {
        const cameoJson = JSON.stringify({
            elements: [
                { id: 'e1', name: 'Shock Hazard', type: 'uml:Class', stereotypes: ['Hazard'] },
                { id: 'e2', name: 'Insulation', type: 'uml:Class', stereotypes: ['RiskControlMeasure'] },
            ],
            relationships: [
                { id: 'r1', sourceId: 'e2', targetId: 'e1', type: 'sysml:Satisfy' },
            ],
        });
        writeFileSync(join(tmpDir, 'cameo-export.json'), cameoJson);

        const output = run(`import cameo cameo-export.json --dry-run`, tmpDir);
        expect(output).toContain('MagicDraw/Cameo');
        expect(output).toContain('2 mapped');
        expect(output).toContain('Shock_Hazard : Hazard');
        expect(output).toContain('Insulation : RiskControlMeasure');
    });

    it('memo import owl imports from OWL/Turtle', () => {
        const turtle = `
@prefix memo: <https://example.org/memo#> .
@prefix owl: <http://www.w3.org/2002/07/owl#> .
@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .
@prefix dcterms: <http://purl.org/dc/terms/> .

<https://example.org/memo> a owl:Ontology ;
    dcterms:title "Test OWL Import" ;
    owl:versionInfo "1.0.0" ;
    .

memo:Hazard a owl:Class ;
    rdfs:label "Hazard" ;
    memo:layer "risk" ;
    memo:sysmlConstruct "part def" ;
    .

memo:mitigates a owl:ObjectProperty ;
    rdfs:label "mitigates" ;
    .
`;
        writeFileSync(join(tmpDir, 'test-ontology.ttl'), turtle);

        const output = run(`import owl test-ontology.ttl --dry-run`, tmpDir);
        expect(output).toContain('OWL/JSON-LD');
        expect(output).toContain('Classes:    1');
        expect(output).toContain('Properties: 1');
        expect(output).toContain('part def Hazard');
        expect(output).toContain('connection def Mitigates');
    });

    it('memo import owl --package-dir creates ontology package', () => {
        const turtle = `
@prefix memo: <https://example.org/memo#> .
@prefix owl: <http://www.w3.org/2002/07/owl#> .
@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .

memo:Hazard a owl:Class ;
    rdfs:label "Hazard" ;
    memo:layer "risk" ;
    .

memo:Requirement a owl:Class ;
    rdfs:label "Requirement" ;
    memo:layer "requirements" ;
    .
`;
        writeFileSync(join(tmpDir, 'pkg-test.ttl'), turtle);
        const pkgDir = join(tmpDir, 'imported-pkg');

        run(`import owl pkg-test.ttl --package-dir ${pkgDir} --package test_pkg`, tmpDir);

        expect(existsSync(join(pkgDir, 'memo.package.yaml'))).toBe(true);
        expect(existsSync(join(pkgDir, '.project.json'))).toBe(true);
        expect(existsSync(join(pkgDir, 'sysml', 'index.sysml'))).toBe(true);
        expect(existsSync(join(pkgDir, 'sysml', 'risk', 'risk.sysml'))).toBe(true);
        expect(existsSync(join(pkgDir, 'sysml', 'requirements', 'requirements.sysml'))).toBe(true);
    });
});

describe('E2E: memo check --sysml-compat', () => {
    let tmpDir: string;

    beforeAll(() => {
        tmpDir = mkdtempSync(join(tmpdir(), 'memo-check-'));
        run('init test-check --no-install', tmpDir);
    });

    afterAll(() => {
        rmSync(tmpDir, { recursive: true, force: true });
    });

    it('memo check --sysml-compat produces text report', () => {
        const result = runMayFail('check --sysml-compat test-check', tmpDir);
        expect(result.stdout).toContain('SysML Compatibility Check');
    });

    it('memo check --sysml-compat --format json produces valid JSON', () => {
        const result = runMayFail('check --sysml-compat --format json test-check', tmpDir);
        const report = JSON.parse(result.stdout);
        expect(report.tool).toBe('memo-sysml-compat');
        expect(report.summary).toBeDefined();
        expect(typeof report.summary.compatible).toBe('boolean');
        expect(typeof report.summary.elements).toBe('number');
        expect(Array.isArray(report.findings)).toBe(true);
    });

    it('memo check without --sysml-compat shows usage', () => {
        const result = runMayFail('check test-check', tmpDir);
        expect(result.stdout).toContain('--sysml-compat');
    });
});

describe('E2E: memo round-trip', () => {
    let tmpDir: string;

    beforeAll(() => {
        tmpDir = mkdtempSync(join(tmpdir(), 'memo-rt-'));
        run('init test-rt --no-install', tmpDir);
    });

    afterAll(() => {
        rmSync(tmpDir, { recursive: true, force: true });
    });

    it('memo round-trip --tool syson produces text report', () => {
        const result = runMayFail('round-trip --tool syson test-rt', tmpDir);
        expect(result.stdout).toContain('Round-Trip Conformance');
        expect(result.stdout).toContain('syson');
    });

    it('memo round-trip --format json produces valid JSON', () => {
        const result = runMayFail('round-trip --tool syson --format json test-rt', tmpDir);
        const report = JSON.parse(result.stdout);
        expect(report.tool).toBe('syson');
        expect(report.summary).toBeDefined();
        expect(typeof report.summary.conformant).toBe('boolean');
        expect(typeof report.summary.elementsLost).toBe('number');
        expect(Array.isArray(report.diffs)).toBe(true);
    });

    it('memo round-trip defaults to syson tool', () => {
        const result = runMayFail('round-trip --format json test-rt', tmpDir);
        const report = JSON.parse(result.stdout);
        expect(report.tool).toBe('syson');
    });
});

describe('I-1: memo ontology add-kind', () => {
    let tmpDir: string;

    beforeAll(() => {
        tmpDir = mkdtempSync(join(tmpdir(), 'memo-add-kind-'));
    });

    afterAll(() => {
        rmSync(tmpDir, { recursive: true, force: true });
    });

    it('writes a parser-valid .sysml file for a simple layer', () => {
        run('ontology add-kind MyHazard --layer risk', tmpDir);
        const outPath = join(tmpDir, 'ontology', 'risk', 'MyHazard.sysml');
        expect(existsSync(outPath)).toBe(true);
        const content = readFileSync(outPath, 'utf-8');
        expect(content).toContain('part def MyHazard specializes MemoPart');
        expect(content).toContain('package risk {');
        expect(content).toContain('private import memo::core::common::*;');
    });

    it('supports nested layer paths', () => {
        run('ontology add-kind SafetyControl --layer architecture/risk', tmpDir);
        const outPath = join(tmpDir, 'ontology', 'architecture', 'risk', 'SafetyControl.sysml');
        expect(existsSync(outPath)).toBe(true);
        const content = readFileSync(outPath, 'utf-8');
        expect(content).toContain('package architecture {');
        expect(content).toContain('package risk {');
        expect(content).toContain('part def SafetyControl specializes MemoPart');
    });

    it('rejects non-PascalCase kind names', () => {
        const result = runMayFail('ontology add-kind lowercase --layer risk', tmpDir);
        expect(result.exitCode).not.toBe(0);
    });

    it('refuses to overwrite an existing file', () => {
        // MyHazard.sysml already exists from the first test — second call must fail
        const result = runMayFail('ontology add-kind MyHazard --layer risk', tmpDir);
        expect(result.exitCode).not.toBe(0);
    });

    it('does not write any YAML or JSON files', () => {
        const entries = readdirSync(join(tmpDir, 'ontology', 'risk'));
        const nonSysml = entries.filter(f => !f.endsWith('.sysml'));
        expect(nonSysml).toHaveLength(0);
    });
});
