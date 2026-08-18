// Native project resolution (design sections 5.3, 6.2, 9) and the
// configuration boundary (sections 5.5, 16, 19).
//
// The claim under test is the one the flip makes: SysML decides what the model
// contains, and application settings decide only where a package's source sits.
// A settings file that names a package the imports never reach changes nothing;
// a settings file that names a semantic fact is rejected outright.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { findProjectRoot, resolveNativeProject } from '../model/native-project.js';
import { checkSemanticFields } from '../model/settings-boundary.js';

const TMP = resolve(__dirname, '__tmp_native_project__');

function write(relPath: string, content: string): void {
    const full = join(TMP, relPath);
    mkdirSync(join(full, '..'), { recursive: true });
    writeFileSync(full, content);
}

/** A resolvable library package the project may or may not import. */
function library(name: string, packageName: string, body: string): void {
    write(`libs/${name}/memo.package.yaml`, `name: "@memoarchitect/${name}"\nversion: 1.0.0\nsysmlDir: "./src"\n`);
    write(`libs/${name}/src/${packageName}.sysml`, body);
    write('memo.manifest.yaml', [
        'manifest: 1',
        'packages:',
        '  "@memoarchitect/lib-a": ./libs/lib-a',
        '  "@memoarchitect/lib-b": ./libs/lib-b',
        'init:',
        '  defaultExtends: "@memoarchitect/lib-a"',
        '  rootImport: memo',
        '  defaultTemplate: default',
        'templates:',
        '  default: ./libs/lib-a',
        'examples: {}',
        '',
    ].join('\n'));
}

beforeEach(() => {
    rmSync(TMP, { recursive: true, force: true });
    mkdirSync(TMP, { recursive: true });
    write('memo.package.yaml', 'name: demo\nentrypoint: model/catalog/project.sysml\ninclude: [model]\n');

    library('lib-a', 'lib_a', `
package lib_a {
    part def MethodologyDefinition;
    part def ProjectMethodBinding;
    part def Widget;
    part chosenMethod : MethodologyDefinition {
        attribute :>> id = "METH-A";
        attribute :>> scopeMode = ScopeModeKind::allAvailable;
    }
}
`);
    library('lib-b', 'lib_b', `
package lib_b {
    part def Unused;
}
`);
});

afterEach(() => { rmSync(TMP, { recursive: true, force: true }); });

function writeEntrypoint(extra = ''): void {
    write('model/catalog/project.sysml', `
package demo_project {
    private import lib_a::*;
${extra}
    part binding : ProjectMethodBinding {
        attribute :>> id = "PMB-1";
        attribute :>> projectName = "Demo";
        ref :>> selectedMethodology = chosenMethod;
        attribute :>> scopeMode = ScopeModeKind::explicit;
    }
}
`);
}

describe('findProjectRoot', () => {
    it('identifies a project by its configured native entrypoint', () => {
        writeEntrypoint();
        expect(findProjectRoot(join(TMP, 'model', 'catalog'))).toBe(TMP);
        expect(findProjectRoot(resolve(TMP, '..', '..'))).not.toBe(TMP);
    });

    it('uses a project-relative manifest entrypoint when configured', () => {
        write('memo.package.yaml', 'name: demo\nentrypoint: src/project.sysml\ninclude: [src]\n');
        write('src/project.sysml', 'package demo_project {}\n');
        expect(findProjectRoot(join(TMP, 'src'))).toBe(TMP);
        expect(findProjectRoot(join(TMP, 'model'))).toBe(TMP);
    });
});

describe('resolveNativeProject', () => {
    it('roots explicit scope and the binding at a configured entrypoint', async () => {
        write('memo.package.yaml', 'name: demo\nentrypoint: src/project.sysml\ninclude: [src]\n');
        write('src/project.sysml', `
package demo_project {
    private import lib_a::*;
    part binding : ProjectMethodBinding {
        ref :>> selectedMethodology = chosenMethod;
        attribute :>> scopeMode = ScopeModeKind::explicit;
    }
}
`);
        write('src/unimported.sysml', 'package unimported { part def Noise; }\n');
        const r = await resolveNativeProject(TMP);
        expect(r.entrypoint).toBe(join(TMP, 'src/project.sysml'));
        expect(r.closure.has('demo_project')).toBe(true);
        expect(r.closure.has('lib_a')).toBe(true);
        expect(r.closure.has('unimported')).toBe(false);
        expect(r.binding?.sourceFile).toBe(join(TMP, 'src/project.sysml'));
    });

    it('loads an imported OTS repository from an explicit include root', async () => {
        write('memo.package.yaml', 'name: demo\nentrypoint: src/project.sysml\ninclude: [src, ../ots]\n');
        write('src/project.sysml', `
package demo_project {
    private import ots_lib::*;
    part binding : ProjectMethodBinding {
        ref :>> selectedMethodology = chosenMethod;
    }
}
`);
        const otsRoot = resolve(TMP, '..', 'ots');
        mkdirSync(otsRoot, { recursive: true });
        writeFileSync(join(otsRoot, 'ots.sysml'), 'package ots_lib { part def OtsPart; }\n');
        try {
            const r = await resolveNativeProject(TMP);
            expect(r.closure.has('ots_lib')).toBe(true);
        } finally {
            rmSync(otsRoot, { recursive: true, force: true });
        }
    });

    it('reads the binding and its typed methodology reference from SysML', async () => {
        writeEntrypoint();
        const r = await resolveNativeProject(TMP);
        expect(r.binding?.projectName).toBe('Demo');
        expect(r.binding?.selectedMethodologyName).toBe('chosenMethod');
        expect(r.binding?.scopeMode).toBe('explicit');
        expect(r.diagnostics).toEqual([]);
    });

    it('selects only the packages the import graph reaches', async () => {
        writeEntrypoint();
        const r = await resolveNativeProject(TMP);
        expect(r.closure.has('lib_a')).toBe(true);
        // lib-b is on disk and named by the distribution manifest, and the
        // project never imports it. A locator makes a package available; it
        // does not select it.
        expect(r.closure.has('lib_b')).toBe(false);
        expect(r.selectedRoots.map(root => root.packageName)).toEqual(['@memoarchitect/lib-a']);
        const unused = r.unusedRoots.map(root => root.packageName);
        expect(unused).toContain('@memoarchitect/lib-b');
        expect(unused).not.toContain('@memoarchitect/lib-a');
    });

    it('selects a further package as soon as an import names it', async () => {
        writeEntrypoint('    private import lib_b::*;\n');
        const r = await resolveNativeProject(TMP);
        expect(r.closure.has('lib_b')).toBe(true);
        expect(r.selectedRoots.map(root => root.packageName).sort())
            .toEqual(['@memoarchitect/lib-a', '@memoarchitect/lib-b']);
    });

    it('records real import distance from the entrypoint', async () => {
        writeEntrypoint();
        const r = await resolveNativeProject(TMP);
        expect(r.closure.get('demo_project')?.importDepth).toBe(0);
        expect(r.closure.get('lib_a')?.importDepth).toBe(1);
        expect(r.closure.get('demo_project')?.origin).toBe('project');
    });

    it('reports an import no resolved source can satisfy', async () => {
        writeEntrypoint('    private import lib_missing::*;\n');
        const r = await resolveNativeProject(TMP);
        expect(r.diagnostics.map(d => d.code)).toContain('unresolved-import');
        expect(r.diagnostics[0].message).toContain('lib_missing');
    });

    it('does not report Metaobjects standard-library imports as unresolved', async () => {
        writeEntrypoint('    private import Metaobjects::SemanticMetadata;\n');
        const r = await resolveNativeProject(TMP);
        expect(r.diagnostics).toEqual([]);
    });

    it('reports a project with no entrypoint', async () => {
        const r = await resolveNativeProject(TMP);
        expect(r.diagnostics.map(d => d.code)).toEqual(['no-entrypoint']);
    });

    it('reports a methodology reference nothing declares', async () => {
        write('model/catalog/project.sysml', `
package demo_project {
    private import lib_a::*;
    part binding : ProjectMethodBinding {
        ref :>> selectedMethodology = ghostMethod;
    }
}
`);
        const r = await resolveNativeProject(TMP);
        expect(r.diagnostics.map(d => d.code)).toContain('unresolved-methodology');
    });

    it('does not let an unimported source file supply a second project binding', async () => {
        writeEntrypoint();
        write('model/catalog/second.sysml', `
package demo_second {
    private import lib_a::*;
    part otherBinding : ProjectMethodBinding {
        ref :>> selectedMethodology = chosenMethod;
    }
}
`);
        const r = await resolveNativeProject(TMP);
        expect(r.diagnostics.map(d => d.code)).not.toContain('multiple-bindings');
        expect(r.binding?.usageName).toBe('binding');
    });

    it('rejects a binding that declares allAvailable and lists modules', async () => {
        write('model/catalog/project.sysml', `
package demo_project {
    private import lib_a::*;
    part binding : ProjectMethodBinding {
        ref :>> selectedMethodology = chosenMethod;
        attribute :>> scopeMode = ScopeModeKind::allAvailable;
        attribute :>> includedModule = ("lib_b");
    }
}
`);
        const r = await resolveNativeProject(TMP);
        expect(r.diagnostics.map(d => d.code)).toContain('scope-mode-conflict');
    });

    it('ignores a semantic field a settings file still carries', async () => {
        writeEntrypoint();
        // A settings file naming lib-b as a dependency must not pull it in.
        // Before the flip this field was the dependency graph.
        writeFileSync(join(TMP, 'memo.package.yaml'),
            'name: demo\nentrypoint: model/catalog/project.sysml\ninclude: [model]\n'
            + 'extends: "@memoarchitect/lib-b"\nmethodology: "@memoarchitect/lib-b"\n');
        const r = await resolveNativeProject(TMP);
        expect(r.closure.has('lib_b')).toBe(false);
        expect(r.selectedRoots.map(root => root.packageName)).toEqual(['@memoarchitect/lib-a']);

        // …and the field is reported rather than silently ignored.
        const rejected = checkSemanticFields(TMP).map(x => x.field).sort();
        expect(rejected).toEqual(['extends', 'methodology']);
    });

    it('resolves identically after every application setting is deleted', async () => {
        writeEntrypoint();
        writeFileSync(join(TMP, 'memo.package.yaml'), 'name: demo\nversion: 0.1.0\n');
        const withSettings = await resolveNativeProject(TMP);
        rmSync(join(TMP, 'memo.package.yaml'));
        mkdirSync(join(TMP, '.memo', 'architect'), { recursive: true });
        writeFileSync(join(TMP, '.memo', 'architect', 'workspace-state.json'), '{"panel":"left"}');
        const withoutSettings = await resolveNativeProject(TMP);

        const project = (r: Awaited<ReturnType<typeof resolveNativeProject>>) => ({
            binding: r.binding?.selectedMethodologyName,
            closure: [...r.closure.keys()].sort(),
            roots: r.selectedRoots.map(x => x.packageName).sort(),
        });
        expect(project(withoutSettings)).toEqual(project(withSettings));

        // And deleting the transient workspace state changes nothing either.
        rmSync(join(TMP, '.memo'), { recursive: true, force: true });
        expect(project(await resolveNativeProject(TMP))).toEqual(project(withSettings));
    });
});
