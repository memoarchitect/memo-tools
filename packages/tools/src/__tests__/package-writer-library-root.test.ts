import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { outlineIdentityIndex, projectOutlines, selectedOutlineSource } from '../authoring/outline-source.js';
import type { MEMOConfig } from '../model/config.js';
import { moveElementToPackage } from '../server/package-writer.js';
import { compilerConfigured, withExample } from './helpers/compile-source.js';

// A package a project carries in its own directory (`packages/<name>/`, with a
// memo.package.yaml) is a library root inside the project: the project's files,
// which the handoff marks as library documents. gpca's `methodology/` is one in
// the checkout. A move into such a package goes through the outline source
// Architect uses, the selected compiler's.

const config = { projectName: 'temperature-alarm', toolchain: { compiler: process.env.MEMO_TOOLCHAIN_COMPILER } } as MEMOConfig;

describe.runIf(compilerConfigured)('moving a declaration into a package under a library root in the project', () => {
    it('moves it, and the library file holds the declaration', async () => {
        await withExample({
            'packages/local-lib/memo.package.yaml': 'name: local-lib\nversion: 0.0.1\n',
            'packages/local-lib/target.sysml': 'package LocalTarget {\n}\n',
            'model/scratch.sysml': 'package Scratch {\n    private import LocalTarget::*;\n    part def Movable;\n}\n',
        }, async (project, root) => {
            const files = projectOutlines(root, project).map(outline => outline.file);
            expect(files).toContain('packages/local-lib/target.sysml');
            const index = outlineIdentityIndex(projectOutlines(root, project), project.model.elements.values(), root);
            const irIdentity = index.byMemoElement['Scratch::Movable'];
            expect(irIdentity).toBeDefined();

            const result = await moveElementToPackage(root, {
                elementId: 'Scratch::Movable',
                irIdentity,
                sourceFile: 'model/scratch.sysml',
                targetFile: 'packages/local-lib/target.sysml',
                targetPackage: 'LocalTarget',
            }, index, selectedOutlineSource(root, config));

            expect({ success: result.success, error: result.error }).toEqual({ success: true, error: undefined });
            expect(readFileSync(join(root, 'packages/local-lib/target.sysml'), 'utf8')).toContain('part def Movable;');
            expect(readFileSync(join(root, 'model/scratch.sysml'), 'utf8')).not.toContain('part def Movable');
        });
    }, 180_000);
});
