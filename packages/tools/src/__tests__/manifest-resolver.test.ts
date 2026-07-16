import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { resolvePackageConfig } from '../model/ontology-loader.js';

function fixture(): string {
    return mkdtempSync(join(tmpdir(), 'memo-manifest-'));
}

describe('manifest package resolution', () => {
    it('maps a logical package name to a subpath in an installed ontology package', () => {
        const root = fixture();
        const project = join(root, 'project');
        const content = join(project, 'node_modules', '@vendor', 'content');
        mkdirSync(join(content, 'profile'), { recursive: true });
        writeFileSync(join(project, 'memo.package.yaml'), 'name: project\ntype: device\nextends: "@logical/profile"\n');
        writeFileSync(join(content, 'memo.manifest.yaml'), [
            'manifest: 1',
            'packages:',
            '  "@logical/profile": ./profile',
            'init:',
            '  defaultExtends: "@logical/profile"',
            '  rootImport: "logical_library"',
            '  template: ./template',
            '  archetypes: ./profile/archetypes.yaml',
            'examples: {}',
            '',
        ].join('\n'));
        writeFileSync(join(content, 'profile', 'memo.package.yaml'), 'name: "@logical/profile"\ntype: profile\n');

        expect(resolvePackageConfig('@logical/profile', project))
            .toBe(join(content, 'profile', 'memo.package.yaml'));
    });

    it('resolves sibling logical packages through their enclosing manifest', () => {
        const root = fixture();
        const content = join(root, 'node_modules', '@vendor', 'content');
        mkdirSync(join(content, 'profile'), { recursive: true });
        mkdirSync(join(content, 'ontology'), { recursive: true });
        writeFileSync(join(content, 'memo.manifest.yaml'), [
            'manifest: 1',
            'packages:',
            '  "@logical/ontology": ./ontology',
            '  "@logical/profile": ./profile',
            'init:',
            '  defaultExtends: "@logical/profile"',
            '  rootImport: "logical_library"',
            '  template: ./template',
            '  archetypes: ./profile/archetypes.yaml',
            'examples: {}',
            '',
        ].join('\n'));
        writeFileSync(join(content, 'profile', 'memo.package.yaml'), 'name: "@logical/profile"\ntype: profile\nextends: "@logical/ontology"\n');
        writeFileSync(join(content, 'ontology', 'memo.package.yaml'), 'name: "@logical/ontology"\ntype: ontology\n');

        expect(resolvePackageConfig('@logical/ontology', join(content, 'profile')))
            .toBe(join(content, 'ontology', 'memo.package.yaml'));
    });

    it('does not walk above the project root into an unrelated node_modules', () => {
        const root = fixture();
        const project = join(root, 'project');
        mkdirSync(project, { recursive: true });
        mkdirSync(join(root, 'node_modules', '@logical', 'profile'), { recursive: true });
        writeFileSync(join(project, 'memo.package.yaml'), 'name: project\ntype: device\nextends: "@logical/profile"\n');
        writeFileSync(join(root, 'node_modules', '@logical', 'profile', 'memo.package.yaml'), 'name: "@logical/profile"\ntype: profile\n');

        expect(resolvePackageConfig('@logical/profile', project)).toBeUndefined();
    });

    it('keeps the legacy project-local memo_packages path working', () => {
        const root = fixture();
        const project = join(root, 'project');
        const legacy = join(project, 'memo_packages', 'profile');
        mkdirSync(legacy, { recursive: true });
        writeFileSync(join(project, 'memo.package.yaml'), 'name: project\ntype: device\n');
        writeFileSync(join(legacy, 'memo.package.yaml'), 'name: "@memo/profile"\ntype: profile\n');

        expect(resolvePackageConfig('@memo/profile', project))
            .toBe(join(legacy, 'memo.package.yaml'));
    });

    it('resolves logical packages from the project-local content store', () => {
        const root = fixture();
        const project = join(root, 'project');
        const content = join(project, '.memo', 'content', 'node_modules', '@vendor', 'content');
        mkdirSync(join(content, 'profile'), { recursive: true });
        writeFileSync(join(project, 'memo.package.yaml'), 'name: project\ntype: device\nextends: "@logical/profile"\n');
        writeFileSync(join(content, 'memo.manifest.yaml'), [
            'manifest: 1',
            'packages:',
            '  "@logical/profile": ./profile',
            'init:',
            '  defaultExtends: "@logical/profile"',
            '  rootImport: "logical_library"',
            '  template: ./template',
            '  archetypes: ./profile/archetypes.yaml',
            'examples: {}',
            '',
        ].join('\n'));
        writeFileSync(join(content, 'profile', 'memo.package.yaml'), 'name: "@logical/profile"\ntype: profile\n');

        expect(resolvePackageConfig('@logical/profile', project))
            .toBe(join(content, 'profile', 'memo.package.yaml'));
    });
});
