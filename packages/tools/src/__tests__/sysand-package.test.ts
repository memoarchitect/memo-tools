// ─── Packaging a MEMO project as a SysAnd package ────────────────────────────
//
// `sysand build` packs an interchange project (sources, `.project.json`,
// `.meta.json`), which a MEMO project is not. Packaging stages a scratch copy,
// states what the project says about itself, lets `sysand include` index and
// checksum the sources, and builds. The identity tests need nothing; the
// packaging test runs the real `sysand` and OpenSysML, and is skipped without them.

import { execFileSync, spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { findSysmlFiles } from '../model/sysml-files.js';
import { declaredSources, sysandPackageFileName, sysandProjectIdentity } from '../toolchain/providers/sysand-project.js';
import { runPackager } from '../toolchain/operations.js';
import { openSysMLUnderTest } from './helpers/compile-source.js';

const dirs: string[] = [];
const scratch = (): string => { const d = mkdtempSync(join(tmpdir(), 'memo-sysand-pkg-')); dirs.push(d); return d; };
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });

describe('what a project says about itself in its SysAnd package', () => {
    it('takes name, version, publisher, description and licence from the project\'s settings file', () => {
        const dir = scratch();
        writeFileSync(join(dir, 'memo.package.yaml'), 'name: pump\nversion: 2.1.0\npublisher: acme\ndescription: An infusion pump\nlicense: Apache-2.0\n');
        expect(sysandProjectIdentity(dir, { projectName: 'pump' })).toEqual({
            name: 'pump', publisher: 'acme', version: '2.1.0', description: 'An infusion pump', license: 'Apache-2.0',
        });
    });

    it('says what sysand init says when nobody says: untitled, 0.1.0', () => {
        const dir = scratch();
        writeFileSync(join(dir, 'memo.package.yaml'), 'name: pump\n');
        expect(sysandProjectIdentity(dir, { projectName: 'pump' })).toEqual({ name: 'pump', publisher: 'untitled', version: '0.1.0' });
    });

    it('never reads a settings file of a directory above the project', () => {
        const above = scratch();
        writeFileSync(join(above, 'memo.package.yaml'), 'name: above\nversion: 9.9.9\n');
        const dir = join(above, 'project');
        mkdirSync(dir);
        expect(sysandProjectIdentity(dir, { projectName: 'p' }).version).toBe('0.1.0');
    });

    it('names the file <name>-<version>.kpar, as sysand build names its own', () => {
        expect(sysandPackageFileName({ name: 'infusion pump', version: '1.0.0' })).toBe('infusion-pump-1.0.0.kpar');
    });
});

describe('which SysML is the project\'s own to package', () => {
    const write = (dir: string, file: string) => { mkdirSync(join(dir, file, '..'), { recursive: true }); writeFileSync(join(dir, file), 'package P;\n'); };

    it('a package packs its sysmlDir, and not the examples, templates and other packages beside it', () => {
        const repo = scratch();
        const pkg = join(repo, 'ontology');
        mkdirSync(pkg);
        writeFileSync(join(pkg, 'memo.package.yaml'), 'name: "@x/ontology"\nsysmlDir: ../src\n');
        write(repo, 'src/core/a.sysml');
        write(repo, 'src/arch/b.sysml');
        write(repo, 'examples/pump/model/c.sysml');
        write(repo, 'templates/default/model/d.sysml');
        write(repo, 'extensions/ros/src/e.sysml');
        const { base, files } = declaredSources(pkg);
        expect(base).toBe(join(repo, 'src'));
        expect(files).toEqual(['arch/b.sysml', 'core/a.sysml']);
    });

    it('a project packs its include roots and entrypoint, not what else sits in its directory', () => {
        const dir = scratch();
        writeFileSync(join(dir, 'memo.package.yaml'), 'name: pump\nentrypoint: model/catalog/project.sysml\ninclude: [model]\n');
        write(dir, 'model/catalog/project.sysml');
        write(dir, 'model/catalog/parts.sysml');
        write(dir, 'examples/other/model/x.sysml');
        write(dir, 'node_modules/@memoarchitect/ontology/src/o.sysml');
        const { base, files } = declaredSources(dir);
        expect(base).toBe(dir);
        expect(files).toEqual(['model/catalog/parts.sysml', 'model/catalog/project.sysml']);
    });

    it('refuses a directory that declares no sources of its own, instead of guessing from what is there', () => {
        const dir = scratch();
        writeFileSync(join(dir, 'memo.manifest.yaml'), 'manifest: 1\n');
        write(dir, 'src/a.sysml');
        write(dir, 'examples/b.sysml');
        expect(() => declaredSources(dir)).toThrow(/declares no SysML of its own/);
    });
});

const sysand = spawnSync('sysand', ['--version'], { encoding: 'utf8' }).status === 0;
const unzip = spawnSync('unzip', ['-v'], { encoding: 'utf8' }).status === 0;
const example = resolve(__dirname, '../../../../../memo/examples/temperature-alarm');

describe.runIf(sysand && unzip && Boolean(openSysMLUnderTest) && existsSync(example))('packing with the sysand packager', () => {
    it('builds a real KPAR with the project\'s sources, .project.json and an indexed, checksummed .meta.json, and leaves the project alone', async () => {
        const project = scratch();
        cpSync(example, project, { recursive: true, filter: s => !s.includes(`${example}/.memo`) });
        // Beside the project's own `model/`: things that must not be bundled.
        for (const stray of ['examples/other/model/x.sysml', 'templates/default/y.sysml']) {
            mkdirSync(join(project, stray, '..'), { recursive: true });
            writeFileSync(join(project, stray), 'package Stray;\n');
        }
        const sources = findSysmlFiles(join(project, 'model')).length;
        const output = join(scratch(), 'out.kpar');
        const result = await runPackager({
            config: { projectName: 'temperature-alarm', toolchain: { compiler: 'opensysml', packager: 'sysand', opensysml: openSysMLUnderTest } } as never,
            projectDir: project,
            outputPath: output,
        });
        expect(result.accepted, JSON.stringify(result.diagnostics)).toBe(true);
        expect(existsSync(output)).toBe(true);

        const read = (name: string) => execFileSync('unzip', ['-p', output, name], { encoding: 'utf8' });
        const info = JSON.parse(read('.project.json'));
        expect(info).toMatchObject({ name: 'temperature-alarm', version: expect.any(String) });
        // Only the libraries the project's imports reach, not every package that could be found.
        expect(info.usage.map((u: { resource: string }) => u.resource)).toEqual(['urn:kpar:@memoarchitect/ontology']);
        expect(info.usage[0].versionConstraint).toMatch(/^\^\d+\.\d+\.\d+/);

        const meta = JSON.parse(read('.meta.json'));
        expect(Object.keys(meta.checksum)).toHaveLength(sources);
        const packed = execFileSync('unzip', ['-Z1', output], { encoding: 'utf8' }).split('\n').filter(Boolean);
        expect(packed.filter(name => name.startsWith('examples/') || name.startsWith('templates/') || name.includes('node_modules'))).toEqual([]);
        expect(Object.keys(meta.index).length).toBeGreaterThan(0);

        // The project is untouched: no interchange files were written into it.
        expect(existsSync(join(project, '.project.json'))).toBe(false);
        expect(existsSync(join(project, '.meta.json'))).toBe(false);
    }, 120_000);

    it('refuses a directory that declares no sources, and says so', async () => {
        const project = scratch();
        writeFileSync(join(project, 'memo.package.yaml'), 'name: empty\n');
        const failure = await runPackager({
            config: { projectName: 'empty', toolchain: { compiler: 'opensysml', packager: 'sysand', opensysml: openSysMLUnderTest } } as never,
            projectDir: project,
            outputPath: join(project, 'x.kpar'),
        }).catch(error => error);
        expect(String(failure)).toMatch(/declares no SysML of its own/);
    }, 60_000);

    it('names the tool when sysand is not there, and does not fall back to the internal packager', async () => {
        const project = scratch();
        cpSync(example, project, { recursive: true, filter: s => !s.includes(`${example}/.memo`) });
        const failure = await runPackager({
            config: { projectName: 'temperature-alarm', toolchain: { compiler: 'opensysml', packager: 'sysand', opensysml: openSysMLUnderTest, sysand: { executable: 'definitely-not-sysand' } } } as never,
            projectDir: project,
            outputPath: join(scratch(), 'x.kpar'),
        }).catch(error => error);
        expect(String(failure)).toMatch(/definitely-not-sysand/);
        expect(String(failure)).toMatch(/does not silently fall back/);
    }, 60_000);
});
