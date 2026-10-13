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
import { findProjectRoot, type NativeProjectResolution } from '../model/native-project.js';
import { compileResolvedProject } from '../toolchain/operations.js';
import { compilerConfigured } from './helpers/compile-source.js';
import { checkSemanticFields } from '../model/settings-boundary.js';

const TMP = resolve(__dirname, '__tmp_native_project__');

/** The project's resolution, from what the selected compiler compiled. */
async function resolveNativeProject(projectDir: string): Promise<NativeProjectResolution> {
    const result = await compileResolvedProject({
        config: { modelName: 'demo', toolchain: { compiler: process.env.MEMO_TOOLCHAIN_COMPILER } } as never,
        projectDir, force: true,
    });
    if (!result.accepted) {
        throw new Error(`stage 1 rejected the project:\n${result.diagnostics.filter(d => d.severity === 'error').map(d => `${d.file}:${d.range?.start.line} ${d.message}`).join('\n')}`);
    }
    return result.resolution!;
}

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
        '  template: ./libs/lib-a',
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
    private import ScalarValues::*;
    enum def ScopeModeKind { enum allAvailable; enum explicit; }
    part def MethodologyDefinition { attribute id : String; attribute scopeMode : ScopeModeKind; }
    part def ModelMethodBinding {
        attribute id : String;
        attribute modelName : String;
        ref selectedMethodology : MethodologyDefinition;
        attribute scopeMode : ScopeModeKind;
    }
    // The deprecated former spelling, as the ontology keeps it until 0.15.0.
    part def ProjectMethodBinding :> ModelMethodBinding {
        attribute projectName : String;
    }
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
    part projectBinding : ModelMethodBinding {
        attribute :>> id = "PMB-1";
        attribute :>> modelName = "Demo";
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

describe.runIf(compilerConfigured)('the resolution of a compiled project', () => {
    it('roots explicit scope and the binding at a configured entrypoint', async () => {
        write('memo.package.yaml', 'name: demo\nentrypoint: src/project.sysml\ninclude: [src]\n');
        write('src/project.sysml', `
package demo_project {
    private import lib_a::*;
    part projectBinding : ModelMethodBinding {
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
    private import lib_a::*;
    private import ots_lib::*;
    part projectBinding : ModelMethodBinding {
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
        expect(r.binding?.modelName).toBe('Demo');
        expect(r.binding?.selectedMethodologyName).toBe('chosenMethod');
        expect(r.binding?.scopeMode).toBe('explicit');
        expect(r.diagnostics).toEqual([]);
    });

    it('still binds a model written with the deprecated spelling, and warns once naming the new one', async () => {
        write('model/catalog/project.sysml', `
package demo_project {
    private import lib_a::*;
    part projectBinding : ProjectMethodBinding {
        attribute :>> id = "PMB-1";
        attribute :>> projectName = "Demo";
        ref :>> selectedMethodology = chosenMethod;
        attribute :>> scopeMode = ScopeModeKind::explicit;
    }
}
`);
        const r = await resolveNativeProject(TMP);
        expect(r.binding?.modelName).toBe('Demo');
        expect(r.binding?.selectedMethodologyName).toBe('chosenMethod');
        expect(r.diagnostics.map(d => [d.code, d.severity])).toEqual([['deprecated-binding-spelling', 'warning']]);
        expect(r.diagnostics[0].message).toContain('ModelMethodBinding');
        expect(r.diagnostics[0].message).toContain('modelName');
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

    it('does not report Metaobjects standard-library imports as unresolved', async () => {
        writeEntrypoint('    private import Metaobjects::SemanticMetadata;\n');
        const r = await resolveNativeProject(TMP);
        expect(r.diagnostics).toEqual([]);
    });

    it('reports a project with no entrypoint', async () => {
        const r = await resolveNativeProject(TMP);
        expect(r.diagnostics.map(d => d.code)).toEqual(['no-entrypoint']);
    });

    it('does not let an unimported source file supply a second project binding', async () => {
        writeEntrypoint();
        write('model/catalog/second.sysml', `
package demo_second {
    private import lib_a::*;
    part otherBinding : ModelMethodBinding {
        ref :>> selectedMethodology = chosenMethod;
    }
}
`);
        const r = await resolveNativeProject(TMP);
        expect(r.diagnostics.map(d => d.code)).not.toContain('multiple-bindings');
        expect(r.binding?.usageName).toBe('projectBinding');
    });

    it('rejects a binding that declares allAvailable and also adds packages by public import', async () => {
        write('model/catalog/project.sysml', `
package demo_project {
    private import lib_a::*;
    public import lib_b::*;
    part projectBinding : ModelMethodBinding {
        ref :>> selectedMethodology = chosenMethod;
        attribute :>> scopeMode = ScopeModeKind::allAvailable;
    }
}
`);
        const r = await resolveNativeProject(TMP);
        // The compiler's handoff says which import is public: lib_b is, lib_a is not.
        expect([...(r.publicImports.get('demo_project') ?? [])]).toEqual(['lib_b']);
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
