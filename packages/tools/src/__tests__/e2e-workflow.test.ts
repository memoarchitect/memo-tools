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
import { VENDOR_ONTOLOGY_PACKAGES_DIR } from '@memo/tools';
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
        const output = run('init test-device', tmpDir);

        expect(output).toContain('Creating MEMO project: test-device');
        expect(output).toContain('Project created');

        const projectDir = join(tmpDir, 'test-device');
        expect(existsSync(projectDir)).toBe(true);
        expect(existsSync(join(projectDir, 'memo.package.yaml'))).toBe(true);
        const starterPath = join(projectDir, 'src', 'catalog', 'starter.sysml');
        expect(existsSync(starterPath)).toBe(true);
        expect(readdirSync(join(projectDir, 'src', 'documents'))).toEqual(['.gitkeep']);

        // Check new-format config content
        const config = parseYaml(readFileSync(join(projectDir, 'memo.package.yaml'), 'utf-8'));
        expect(config).toMatchObject({
            name: 'test-device',
            type: 'device',
            extends: '@memo/medical-modeling-profile',
        });
        expect(readFileSync(starterPath, 'utf-8')).toContain('import memo_medical_device_library::*');

        expect(existsSync(join(projectDir, 'memo.lock.yaml'))).toBe(true);
        const lock = readFileSync(join(projectDir, 'memo.lock.yaml'), 'utf-8');
        expect(lock).not.toContain('test-device');
    });

    it('memo init with no name initializes the current directory', () => {
        const projectDir = join(tmpDir, 'inplace-device');
        mkdirSync(projectDir);

        const output = run('init', projectDir);
        expect(output).toContain('Creating MEMO project: inplace-device');
        expect(output).toContain('Project created in current directory');

        expect(existsSync(join(projectDir, 'memo.package.yaml'))).toBe(true);
        expect(existsSync(join(projectDir, 'src', 'catalog', 'starter.sysml'))).toBe(true);
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
        const output = run(`init ${join(tmpDir, 'test-core-device')} --ontology @memo/ontology`, REPO_ROOT);

        expect(output).toContain('Creating MEMO project');
        expect(output).toContain('Project created');

        const projectDir = join(tmpDir, 'test-core-device');
        const config = parseYaml(readFileSync(join(projectDir, 'memo.package.yaml'), 'utf-8'));
        expect(config.extends).toBe('@memo/ontology');

        // SysML should import the ontology
        const sysml = readFileSync(join(projectDir, 'src', 'catalog', 'starter.sysml'), 'utf-8');
        expect(sysml).toContain('import memo_medical_device_library::*');

        expect(existsSync(join(projectDir, 'memo.lock.yaml'))).toBe(true);
        expect(readFileSync(join(projectDir, 'memo.lock.yaml'), 'utf-8')).not.toContain('test-core-device');
    });

    it('memo init inside the workspace locks against the resolved ontology', () => {
        const projectDir = join(REPO_ROOT, 'tmp-e2e-lock-device');
        try {
            const output = run(`init ${projectDir}`, REPO_ROOT);
            expect(output).toContain('Created memo.lock.yaml');

            const lock = readFileSync(join(projectDir, 'memo.lock.yaml'), 'utf-8');
            expect(lock).toContain('ontology: "@memo/medical-modeling-profile"');
            expect(lock).not.toContain('tmp-e2e-lock-device');
        } finally {
            rmSync(projectDir, { recursive: true, force: true });
        }
    });

    it('memo init --ontology rejects unknown ontology', () => {
        // Run from REPO_ROOT so ontology packages are discoverable (and validation triggers)
        const { exitCode, stdout } = runMayFail(
            `init ${join(tmpDir, 'test-bad')} --ontology @memo/nonexistent`,
            REPO_ROOT
        );
        expect(exitCode).not.toBe(0);
        expect(stdout).toContain('not found');
    });

    it('memo init --list-ontologies shows available packages', () => {
        // Run from REPO_ROOT so packages are discoverable
        const output = run('init --list-ontologies', REPO_ROOT);
        expect(output).toContain('@memo/ontology');
        expect(output).toContain('@memo/medical-modeling-profile');
        expect(output).toContain('(default)');
    });

    it('memo init --archetype samd creates project with archetype pinned', () => {
        const projectDir = join(tmpDir, 'test-samd');
        const output = run(`init ${projectDir} --archetype samd`, REPO_ROOT);

        expect(output).toContain('Creating MEMO project');
        expect(output).toContain('Project created');

        const config = parseYaml(readFileSync(join(projectDir, 'memo.package.yaml'), 'utf-8'));
        expect(config.archetype).toBe('samd');
    });

    it('memo init --archetype blank creates project without archetype field', () => {
        const projectDir = join(tmpDir, 'test-blank');
        const output = run(`init ${projectDir} --archetype blank`, REPO_ROOT);

        expect(output).toContain('Project created');

        const config = parseYaml(readFileSync(join(projectDir, 'memo.package.yaml'), 'utf-8'));
        expect(config.archetype).toBeUndefined();
    });

    it('memo init --archetype rejects unknown archetype', () => {
        const projectDir = join(tmpDir, 'test-bad-arch');
        const { exitCode, stdout } = runMayFail(`init ${projectDir} --archetype nonexistent`, REPO_ROOT);
        expect(exitCode).not.toBe(0);
        expect(stdout).toContain('Unknown archetype');
    });

    it('memo init --list-ontologies shows archetypes from SysML', () => {
        const output = run('init --list-ontologies', REPO_ROOT);
        expect(output).toContain('device archetypes');
        expect(output).toContain('samd');
        expect(output).toContain('connected');
        expect(output).toContain('monitoring');
        expect(output).toContain('infusion_pump');
        expect(output).toContain('blank');
    });

    it('memo init --from-example gpca-pump copies example project', () => {
        const projectDir = join(tmpDir, 'test-from-example');
        const output = run(`init ${projectDir} --from-example gpca-pump`, REPO_ROOT);

        expect(output).toContain('Creating project from example');
        expect(output).toContain('gpca-pump');
        expect(output).toContain('Project created');

        expect(existsSync(join(projectDir, 'memo.config.yaml'))).toBe(true);
        expect(existsSync(join(projectDir, 'model'))).toBe(true);

        const modelDir = join(projectDir, 'model');
        const modelEntries = readdirSync(modelDir);
        expect(modelEntries).toEqual(expect.arrayContaining(['catalog', 'samples', 'views']));
        expect(modelEntries.some(f => f.endsWith('.sysml'))).toBe(false);

        const catalogFiles = readdirSync(join(modelDir, 'catalog'));
        expect(catalogFiles.some(f => f.endsWith('.sysml'))).toBe(true);
    });

    it('memo init --example gpca matches gpca-pump by prefix', () => {
        const projectDir = join(tmpDir, 'test-example-prefix');
        const output = run(`init ${projectDir} --example gpca`, REPO_ROOT);

        expect(output).toContain('Creating project from example');
        expect(output).toContain('gpca-pump');
        expect(existsSync(join(projectDir, 'memo.config.yaml'))).toBe(true);
    });

    it('memo init --example with no name copies into the current (empty) directory', () => {
        const projectDir = join(tmpDir, 'test-example-inplace');
        mkdirSync(projectDir);

        const output = run('init --example gpca', projectDir);
        expect(output).toContain('Project created in current directory');
        expect(existsSync(join(projectDir, 'memo.config.yaml'))).toBe(true);
        expect(existsSync(join(projectDir, 'model'))).toBe(true);

        // Refuses to copy into a non-empty directory
        const { exitCode, stdout } = runMayFail('init --example gpca', projectDir);
        expect(exitCode).not.toBe(0);
        expect(stdout).toContain('already a MEMO project');
    });

    it('memo init --from-example rejects unknown example', () => {
        const projectDir = join(tmpDir, 'test-bad-example');
        const { exitCode, stdout } = runMayFail(`init ${projectDir} --from-example nonexistent`, REPO_ROOT);
        expect(exitCode).not.toBe(0);
        expect(stdout).toContain('Unknown example');
    });

    it('memo init --list-ontologies shows available examples', () => {
        const output = run('init --list-ontologies', REPO_ROOT);
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

        writeFileSync(join(projectDir, 'memo.config.yaml'), `
projectName: lock-test
projectType: device
extends: "@memo/medical-modeling-profile"
`);

        writeFileSync(join(projectDir, 'model', 'device.sysml'), `
package LockTest {
    import memo_medical_device_library::*;
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
        expect(output).toContain('@memo/medical-modeling-profile');
        expect(existsSync(join(projectDir, 'memo.lock.yaml'))).toBe(true);

        const lock = readFileSync(join(projectDir, 'memo.lock.yaml'), 'utf-8');
        expect(lock).toContain('ontology: "@memo/medical-modeling-profile"');
        expect(lock).toContain('version:');
        expect(lock).toContain('lockedAt:');
        expect(lock).toContain('packages:');
        // Should have the ontology packages in the chain
        expect(lock).toContain('@memo/ontology');
        expect(lock).toContain('@memo/medical-modeling-profile');
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
            '@memo/medical-modeling-profile',
            '@memo/some-other-ontology'
        ));

        const { stdout, exitCode } = runMayFail('validate', projectDir);
        expect(exitCode).not.toBe(0);
        expect(stdout).toContain('Ontology mismatch');
        expect(stdout).toContain('@memo/some-other-ontology');

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
            '@memo/medical-modeling-profile',
            '@memo/some-other-ontology'
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
        // Create a test project inside the monorepo so config resolution finds @memo/medical-modeling-profile
        projectDir = join(REPO_ROOT, '.test-custom-device-' + process.pid);
        rmSync(projectDir, { recursive: true, force: true });
        mkdirSync(projectDir, { recursive: true });
        mkdirSync(join(projectDir, 'model'), { recursive: true });

        // Write a minimal config that extends @memo/medical-modeling-profile
        writeFileSync(join(projectDir, 'memo.config.yaml'), `
projectName: custom-device
projectType: device
extends: "@memo/medical-modeling-profile"
`);

        // Write a SysML model with elements and a traced relationship
        writeFileSync(join(projectDir, 'model', 'device.sysml'), `
package CustomDevice {
    import memo_medical_device_library::*;

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
        expect(stdout).toContain('3 elements');
        expect(stdout).toContain('1 relationships');
        expect(stdout).toContain('Completeness by Layer');
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
        run(`init ${projectDir}`, REPO_ROOT);

        // Create a fake local ontology package to install
        fakeOntologyDir = join(REPO_ROOT, '.test-fake-ontology-' + process.pid);
        rmSync(fakeOntologyDir, { recursive: true, force: true });
        mkdirSync(fakeOntologyDir, { recursive: true });

        writeFileSync(join(fakeOntologyDir, 'memo.package.yaml'), `
name: "@test/fake-ontology"
version: "1.0.0"
type: ontology
extends: "@memo/ontology"
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
        expect(output).toContain('@memo/ontology');
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

// `memo build` exports the static viewer site, so it needs a built @memo/web
// dist. @memo/web is an optional peer in the three-repo split (ADR-1-17):
// present in the monorepo, absent in memo-tools — skip the suite there.
const WEB_DIST_AVAILABLE = existsSync(join(REPO_ROOT, 'packages', 'web', 'dist', 'index.html'));

describe.skipIf(!WEB_DIST_AVAILABLE)('DD-3: kpar round-trip smoke test (GPCA pump)', () => {
    const GPCA_DIR = join(REPO_ROOT, 'memo', 'src', 'examples', 'gpca-pump');
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
        run('build --kpar', GPCA_DIR);
    });

    afterAll(() => {
        rmSync(extractDir, { recursive: true, force: true });
        rmSync(join(GPCA_DIR, 'dist'), { recursive: true, force: true });
        rmSync(join(GPCA_DIR, 'gpca-pump.kpar'), { force: true });
    });

    it('produces a .kpar file', () => {
        expect(existsSync(join(GPCA_DIR, 'gpca-pump.kpar'))).toBe(true);
    });

    it('kpar extracts without errors', () => {
        execSync(
            `gunzip -c "${join(GPCA_DIR, 'gpca-pump.kpar')}" | tar xf -`,
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
        const srcConfig = readFileSync(join(GPCA_DIR, 'memo.config.yaml'), 'utf-8');
        const extConfig = readFileSync(join(extractDir, 'memo.config.yaml'), 'utf-8');
        expect(extConfig).toBe(srcConfig);
    });
});

describe('DD-5: sysand publish --dry-run', () => {
    it('memo sysand publish --dry-run succeeds for ontology', () => {
        const pkgDir = join(REPO_ROOT, VENDOR_ONTOLOGY_PACKAGES_DIR, 'ontology');
        const output = run('sysand publish --dry-run --package @memo/ontology', pkgDir);
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
                { id: 2, name: 'Temp Monitor', type: 'Class', stereotype: 'RiskControl' },
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
        expect(output).toContain('Temp_Monitor : RiskControl');
        expect(output).toContain('Mitigates');
    });

    it('memo import cameo imports from Cameo JSON export', () => {
        const cameoJson = JSON.stringify({
            elements: [
                { id: 'e1', name: 'Shock Hazard', type: 'uml:Class', stereotypes: ['Hazard'] },
                { id: 'e2', name: 'Insulation', type: 'uml:Class', stereotypes: ['RiskControl'] },
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
        expect(output).toContain('Insulation : RiskControl');
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
        run('init test-check --template medical', tmpDir);
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
        run('init test-rt --template medical', tmpDir);
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
        expect(content).toContain('part def MyHazard specializes TraceableElement');
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
        expect(content).toContain('part def SafetyControl specializes TraceableElement');
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
