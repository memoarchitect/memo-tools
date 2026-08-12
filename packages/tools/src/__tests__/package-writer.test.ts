// ─── Containment is package membership ───────────────────────────────────────
//
// An Architect explorer's containers are SysML packages, so creating, renaming,
// removing or moving into one has to be a source edit that survives a rebuild.
// What these tests hold down:
//
//   - a created package is a real declaration, and is still there when it
//     declares nothing — an empty container is a container;
//   - removing a package lifts its members into the enclosing scope rather than
//     deleting the subtree, and refuses to orphan a top-level one;
//   - a move is addressed by IR identity, so a move made against a stale
//     revision fails instead of cutting whatever now sits at that position;
//   - every operation parses its result before writing, so no edit can leave a
//     file that does not compile.
// ─────────────────────────────────────────────────────────────────────────────

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { buildIrIdentityIndex, type IrIdentityIndex } from '../model/ir-identity.js';
import { lowerAstToSysmlIr } from '../model/sysml-ir.js';
import { parseFiles } from '../model/parser-utils.js';
import { buildMemoModel } from '../model/builder.js';
import { modelToDTO } from '../model/semantic.js';
import type { MEMOConfig } from '../model/config.js';
import {
    createPackage,
    deletePackage,
    moveElementToPackage,
    renamePackage,
} from '../server/package-writer.js';
import { saveElementToFile } from '../server/persistor.js';

const config: MEMOConfig = { projectName: 'packages' } as MEMOConfig;

let projectRoot: string;

beforeEach(() => {
    projectRoot = mkdtempSync(join(tmpdir(), 'memo-package-writer-'));
});

afterEach(() => {
    rmSync(projectRoot, { recursive: true, force: true });
});

function writeProjectFile(relativePath: string, contents: string): void {
    const absolute = resolve(projectRoot, relativePath);
    mkdirSync(resolve(absolute, '..'), { recursive: true });
    writeFileSync(absolute, contents, 'utf8');
}

function readProjectFile(relativePath: string): string {
    return readFileSync(resolve(projectRoot, relativePath), 'utf8');
}

async function build() {
    const { findSysmlFiles } = await import('../model/sysml-files.js');
    const files = findSysmlFiles(projectRoot).slice().sort();
    const { documents, errors } = await parseFiles(files, `${projectRoot}/`);
    const built = buildMemoModel(documents, config, errors);
    return { built, dto: modelToDTO(built), documents };
}

/** Compile and index identities, which is what a move resolves against. */
async function compile(): Promise<IrIdentityIndex> {
    const { dto, documents } = await build();
    return buildIrIdentityIndex(lowerAstToSysmlIr(documents, dto, projectRoot));
}

const PROJECT = `package Plant {
    part pump : Component {
        attribute redefines note = "pump";
    }
    part valve : Component {
        attribute redefines note = "valve";
    }
}
`;

describe('createPackage', () => {
    it('nests a package inside its parent and reports the qualified name', async () => {
        writeProjectFile('model/plant.sysml', PROJECT);

        const result = await createPackage(projectRoot, {
            file: 'model/plant.sysml', parent: 'Plant', name: 'Hydraulics',
        });

        expect(result.success).toBe(true);
        expect(result.qualifiedName).toBe('Plant::Hydraulics');
        expect(readProjectFile('model/plant.sysml')).toContain('package Hydraulics {');
        // The parent's existing members are untouched by the insertion.
        expect(readProjectFile('model/plant.sysml')).toContain('part pump : Component {');
    });

    it('reports a package that declares nothing, so an empty container is visible', async () => {
        writeProjectFile('model/plant.sysml', PROJECT);
        await createPackage(projectRoot, { file: 'model/plant.sysml', parent: 'Plant', name: 'Hydraulics' });

        const { built } = await build();

        expect(built.packages.map(pkg => pkg.qualifiedName)).toContain('Plant::Hydraulics');
        const created = built.packages.find(pkg => pkg.qualifiedName === 'Plant::Hydraulics');
        expect(created).toMatchObject({ name: 'Hydraulics', parent: 'Plant', file: 'model/plant.sysml' });
    });

    it('appends a top-level package when no parent is named', async () => {
        writeProjectFile('model/plant.sysml', PROJECT);

        const result = await createPackage(projectRoot, { file: 'model/plant.sysml', name: 'Spares' });

        expect(result.success).toBe(true);
        expect(result.qualifiedName).toBe('Spares');
        const { built } = await build();
        expect(built.packages.map(pkg => pkg.qualifiedName)).toContain('Spares');
    });

    it('refuses a name that is not a SysML identifier', async () => {
        writeProjectFile('model/plant.sysml', PROJECT);

        const result = await createPackage(projectRoot, { file: 'model/plant.sysml', name: 'Hydraulics & Air' });

        expect(result.success).toBe(false);
        expect(result.error).toContain('not a valid package name');
        expect(readProjectFile('model/plant.sysml')).toBe(PROJECT);
    });

    it('refuses a duplicate qualified name rather than declaring it twice', async () => {
        writeProjectFile('model/plant.sysml', PROJECT);

        const result = await createPackage(projectRoot, { file: 'model/plant.sysml', name: 'Plant' });

        expect(result.success).toBe(false);
        expect(result.error).toContain('already exists');
    });
});

describe('element placement on create', () => {
    it('declares a new element inside the package the request names', async () => {
        writeProjectFile('model/plant.sysml', PROJECT);
        await createPackage(projectRoot, { file: 'model/plant.sysml', parent: 'Plant', name: 'Hydraulics' });

        const result = await saveElementToFile(projectRoot, {
            id: 'filter', name: 'Filter', kind: 'Component', construct: 'part',
            file: 'model/plant.sysml', package: 'Plant::Hydraulics',
        });

        expect(result.success).toBe(true);
        const { built } = await build();
        expect(built.elements.get('filter')?.package).toBe('Plant::Hydraulics');
    });

    it('refuses to place an element in a package the file does not declare', async () => {
        writeProjectFile('model/plant.sysml', PROJECT);

        const result = await saveElementToFile(projectRoot, {
            id: 'filter', name: 'Filter', kind: 'Component', construct: 'part',
            file: 'model/plant.sysml', package: 'Plant::Missing',
        });

        expect(result.success).toBe(false);
        expect(readProjectFile('model/plant.sysml')).toBe(PROJECT);
    });
});

describe('renamePackage', () => {
    it('renames the declaration and says what it did not update', async () => {
        writeProjectFile('model/plant.sysml', PROJECT);

        const result = await renamePackage(projectRoot, {
            file: 'model/plant.sysml', qualifiedName: 'Plant', name: 'Facility',
        });

        expect(result.success).toBe(true);
        expect(result.qualifiedName).toBe('Facility');
        expect(result.warnings?.[0].code).toBe('package-edit-is-text-only');
        const source = readProjectFile('model/plant.sysml');
        expect(source).toContain('package Facility {');
        expect(source).toContain('part pump : Component {');
    });
});

describe('deletePackage', () => {
    it('lifts members into the enclosing package instead of deleting them', async () => {
        writeProjectFile('model/plant.sysml', `package Plant {
    package Hydraulics {
        part pump : Component {
            attribute redefines note = "pump";
        }
    }
}
`);

        const result = await deletePackage(projectRoot, {
            file: 'model/plant.sysml', qualifiedName: 'Plant::Hydraulics',
        });

        expect(result.success).toBe(true);
        const { built } = await build();
        expect(built.packages.map(pkg => pkg.qualifiedName)).not.toContain('Plant::Hydraulics');
        expect(built.elements.get('pump')?.package).toBe('Plant');
    });

    it('removes an empty package outright', async () => {
        writeProjectFile('model/plant.sysml', PROJECT);
        await createPackage(projectRoot, { file: 'model/plant.sysml', parent: 'Plant', name: 'Hydraulics' });

        const result = await deletePackage(projectRoot, {
            file: 'model/plant.sysml', qualifiedName: 'Plant::Hydraulics',
        });

        expect(result.success).toBe(true);
        const { built } = await build();
        expect(built.packages.map(pkg => pkg.qualifiedName)).not.toContain('Plant::Hydraulics');
        expect(built.elements.get('pump')?.package).toBe('Plant');
    });

    it('refuses to remove a top-level package, which would orphan its members', async () => {
        writeProjectFile('model/plant.sysml', PROJECT);

        const result = await deletePackage(projectRoot, { file: 'model/plant.sysml', qualifiedName: 'Plant' });

        expect(result.success).toBe(false);
        expect(result.error).toContain('top-level package');
        expect(readProjectFile('model/plant.sysml')).toBe(PROJECT);
    });
});

describe('moveElementToPackage', () => {
    it('moves a declaration into another package in the same file', async () => {
        writeProjectFile('model/plant.sysml', PROJECT);
        await createPackage(projectRoot, { file: 'model/plant.sysml', parent: 'Plant', name: 'Hydraulics' });
        const index = await compile();

        const result = await moveElementToPackage(projectRoot, {
            elementId: 'pump',
            irIdentity: index.byMemoElement.pump,
            sourceFile: 'model/plant.sysml',
            targetFile: 'model/plant.sysml',
            targetPackage: 'Plant::Hydraulics',
        }, index);

        expect(result.success).toBe(true);
        const { built } = await build();
        expect(built.elements.get('pump')?.package).toBe('Plant::Hydraulics');
        expect(built.elements.get('valve')?.package).toBe('Plant');
        // The declaration is moved, not regenerated: its body survives intact.
        expect(readProjectFile('model/plant.sysml')).toContain('attribute redefines note = "pump"');
    });

    it('moves a declaration into a package in another file', async () => {
        writeProjectFile('model/plant.sysml', PROJECT);
        writeProjectFile('model/spares.sysml', 'package Spares {\n}\n');
        const index = await compile();

        const result = await moveElementToPackage(projectRoot, {
            elementId: 'valve',
            irIdentity: index.byMemoElement.valve,
            sourceFile: 'model/plant.sysml',
            targetFile: 'model/spares.sysml',
            targetPackage: 'Spares',
        }, index);

        expect(result.success).toBe(true);
        expect(result.filePaths).toEqual(['model/spares.sysml', 'model/plant.sysml']);
        const { built } = await build();
        expect(built.elements.get('valve')?.package).toBe('Spares');
        expect(built.elements.get('valve')?.file).toBe('model/spares.sysml');
        expect(readProjectFile('model/plant.sysml')).not.toContain('valve');
    });

    it('fails loudly when the quoted identity is stale', async () => {
        writeProjectFile('model/plant.sysml', PROJECT);
        const index = await compile();
        const stale = index.byMemoElement.pump;
        // The revision the identity was minted against no longer exists.
        writeProjectFile('model/plant.sysml', 'package Plant {\n}\n');
        await createPackage(projectRoot, { file: 'model/plant.sysml', parent: 'Plant', name: 'Hydraulics' });

        const result = await moveElementToPackage(projectRoot, {
            elementId: 'pump',
            irIdentity: stale,
            sourceFile: 'model/plant.sysml',
            targetFile: 'model/plant.sysml',
            targetPackage: 'Plant::Hydraulics',
        }, index);

        expect(result.success).toBe(false);
        expect(result.stale).toBe(true);
    });
});
