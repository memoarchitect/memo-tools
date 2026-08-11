import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import {
    CANONICAL_RELATIONSHIP_FILE,
    generateRelationshipDeclaration,
    generateRelationshipId,
    isWritableRelationshipFile,
    removeRelationship,
    resolveRelationshipPlacement,
    writeRelationship,
    type RelationshipWriterOptions,
} from '../server/relationship-writer.js';
import type {
    RelationshipCreateRequest,
    RelationshipDefinitionDTO,
} from '../model/relationship-legality.js';
import type { MemoElement, MemoModelDTO, MemoRelationship } from '../model/semantic.js';
import { parseFiles } from '../model/parser-utils.js';
import { buildMemoModel } from '../model/builder.js';
import type { MEMOConfig } from '../model/config.js';

// ─── Fixtures ───────────────────────────────────────────────────────────────

const satisfiedBy: RelationshipDefinitionDTO = {
    name: 'satisfiedBy',
    sysmlName: 'SatisfiedBy',
    label: 'Satisfied By',
    layer: 'requirements',
    sourceEnd: { name: 'satisfyingElement', type: 'ArchitectureElement' },
    targetEnd: { name: 'requiredElement', type: 'VerifiableElement' },
};

const nativeSatisfiedBy: RelationshipDefinitionDTO = {
    ...satisfiedBy,
    nativeKeyword: 'satisfy',
};

let projectRoot: string;

function options(overrides: Partial<RelationshipWriterOptions> = {}): RelationshipWriterOptions {
    return { projectRoot, ...overrides };
}

function element(id: string, kind: string, file: string, pkg?: string): MemoElement {
    return {
        id, name: id, kind, construct: 'part', layer: 'logical',
        file, package: pkg, attributes: {},
    };
}

function model(
    elements: MemoElement[],
    relationships: MemoRelationship[] = [],
): Pick<MemoModelDTO, 'elements' | 'relationships'> {
    return {
        elements: Object.fromEntries(elements.map(el => [el.id, el])),
        relationships,
    };
}

function request(overrides: Partial<RelationshipCreateRequest> = {}): RelationshipCreateRequest {
    return {
        requestId: 'req-1',
        type: 'satisfiedBy',
        sourceId: 'controller',
        targetId: 'sr104',
        direction: 'outgoing',
        ...overrides,
    };
}

/** Write a project file, creating parent directories as needed. */
function writeProjectFile(relativePath: string, contents: string): string {
    const absolute = resolve(projectRoot, relativePath);
    mkdirSync(resolve(absolute, '..'), { recursive: true });
    writeFileSync(absolute, contents, 'utf8');
    return absolute;
}

function readProjectFile(relativePath: string): string {
    return readFileSync(resolve(projectRoot, relativePath), 'utf8');
}

beforeEach(() => {
    projectRoot = mkdtempSync(join(tmpdir(), 'memo-rel-writer-'));
});

afterEach(() => {
    rmSync(projectRoot, { recursive: true, force: true });
});

// ─── Path guards ────────────────────────────────────────────────────────────

describe('isWritableRelationshipFile', () => {
    it('accepts a project-local .sysml file', () => {
        writeProjectFile('model/catalog/system.sysml', 'package system {}\n');
        expect(isWritableRelationshipFile('model/catalog/system.sysml', options())).toBe(true);
    });

    it('accepts a file that does not exist yet inside the project', () => {
        expect(isWritableRelationshipFile('model/catalog/relationships.sysml', options())).toBe(true);
    });

    it('rejects a path that escapes the project', () => {
        expect(isWritableRelationshipFile('../outside.sysml', options())).toBe(false);
    });

    it('rejects a non-.sysml file', () => {
        expect(isWritableRelationshipFile('model/notes.md', options())).toBe(false);
    });

    it('rejects installed ontology content under node_modules', () => {
        writeProjectFile('node_modules/@memoarchitect/ontology/src/core.sysml', 'package core {}\n');
        expect(isWritableRelationshipFile(
            'node_modules/@memoarchitect/ontology/src/core.sysml', options())).toBe(false);
    });

    it('rejects files under a declared ontology root', () => {
        const ontologyRoot = resolve(projectRoot, 'vendor/ontology');
        writeProjectFile('vendor/ontology/relationships.sysml', 'package o {}\n');
        expect(isWritableRelationshipFile('vendor/ontology/relationships.sysml',
            options({ ontologyRoots: [ontologyRoot] }))).toBe(false);
    });

    it('rejects the diagram presentation section', () => {
        writeProjectFile('model/views/logical_view.sysml', 'package v {}\n');
        expect(isWritableRelationshipFile('model/views/logical_view.sysml', options())).toBe(false);
    });
});

// ─── Ownership policy ───────────────────────────────────────────────────────

describe('resolveRelationshipPlacement', () => {
    const controller = element('controller', 'SoftwareComponent', 'model/catalog/architecture.sysml', 'Pump');
    const requirement = element('sr104', 'SoftwareRequirement', 'model/catalog/requirements.sysml', 'Pump');

    it('1 — honours an explicitly requested file', () => {
        writeProjectFile('model/catalog/links.sysml', 'package links {}\n');
        const placement = resolveRelationshipPlacement(
            request({ owningFile: 'model/catalog/links.sysml' }),
            model([controller, requirement]), options());
        expect(placement).toEqual({ file: 'model/catalog/links.sysml', reason: 'requested', willCreate: false });
    });

    it('1 — ignores a requested file that is not writable', () => {
        const placement = resolveRelationshipPlacement(
            request({ owningFile: '../escape.sysml' }),
            model([controller, requirement]), options());
        expect(placement.reason).not.toBe('requested');
    });

    it('2 — uses the active package\'s designated relationship file', () => {
        writeProjectFile('model/catalog/pump_links.sysml', 'package pump_links {}\n');
        const placement = resolveRelationshipPlacement(
            request(), model([controller, requirement]),
            options({ designatedFiles: { Pump: 'model/catalog/pump_links.sysml' } }));
        expect(placement.file).toBe('model/catalog/pump_links.sysml');
        expect(placement.reason).toBe('designated-package-file');
    });

    it('3 — uses an existing relationships file in the common package', () => {
        writeProjectFile('model/catalog/relationships.sysml', 'package rels {}\n');
        const placement = resolveRelationshipPlacement(
            request(), model([controller, requirement]), options());
        expect(placement.file).toBe('model/catalog/relationships.sysml');
        expect(placement.reason).toBe('common-package-file');
    });

    it('3 — falls back to the source element file within the common package', () => {
        writeProjectFile('model/catalog/architecture.sysml', 'package arch {}\n');
        writeProjectFile('model/catalog/requirements.sysml', 'package reqs {}\n');
        const placement = resolveRelationshipPlacement(
            request(), model([controller, requirement]), options());
        expect(placement.file).toBe('model/catalog/architecture.sysml');
        expect(placement.reason).toBe('source-element-file');
    });

    it('4 — uses the configured canonical file when it exists', () => {
        writeProjectFile('model/links.sysml', 'package links {}\n');
        const placement = resolveRelationshipPlacement(
            request(),
            // Endpoints in unrelated trees with nothing writable in common.
            model([
                element('controller', 'SoftwareComponent', 'a/architecture.sysml'),
                element('sr104', 'SoftwareRequirement', 'b/requirements.sysml'),
            ]),
            options({ canonicalFile: 'model/links.sysml' }));
        expect(placement.file).toBe('model/links.sysml');
        expect(placement.reason).toBe('canonical-file');
    });

    it('5 — creates the canonical file only as a last resort', () => {
        const placement = resolveRelationshipPlacement(
            request(),
            model([
                element('controller', 'SoftwareComponent', 'a/architecture.sysml'),
                element('sr104', 'SoftwareRequirement', 'b/requirements.sysml'),
            ]),
            options());
        expect(placement.file).toBe(CANONICAL_RELATIONSHIP_FILE);
        expect(placement.reason).toBe('canonical-file-created');
        expect(placement.willCreate).toBe(true);
    });

    it('never places a relationship in the presentation section', () => {
        // Both endpoints are declared inside views/ — placement must escape it.
        const placement = resolveRelationshipPlacement(
            request(),
            model([
                element('controller', 'SoftwareComponent', 'model/views/logical_view.sysml'),
                element('sr104', 'SoftwareRequirement', 'model/views/logical_view.sysml'),
            ]),
            options());
        expect(placement.file).not.toContain('views');
        expect(placement.file).toBe(CANONICAL_RELATIONSHIP_FILE);
    });

    it('is deterministic across repeated calls', () => {
        writeProjectFile('model/catalog/relationships.sysml', 'package rels {}\n');
        const args = [request(), model([controller, requirement]), options()] as const;
        const first = resolveRelationshipPlacement(...args);
        const second = resolveRelationshipPlacement(...args);
        const third = resolveRelationshipPlacement(...args);
        expect(second).toEqual(first);
        expect(third).toEqual(first);
    });
});

// ─── ID and declaration generation ──────────────────────────────────────────

describe('generateRelationshipId', () => {
    it('produces an explicit, stable, readable ID', () => {
        expect(generateRelationshipId('satisfiedBy', 'controller', 'sr104', []))
            .toBe('rel_satisfiedBy_controller_sr104');
    });

    it('is stable for the same inputs', () => {
        const a = generateRelationshipId('satisfiedBy', 'controller', 'sr104', []);
        const b = generateRelationshipId('satisfiedBy', 'controller', 'sr104', []);
        expect(a).toBe(b);
    });

    it('uniquifies against IDs already in the model', () => {
        expect(generateRelationshipId('satisfiedBy', 'controller', 'sr104', ['rel_satisfiedBy_controller_sr104']))
            .toBe('rel_satisfiedBy_controller_sr104_2');
    });

    it('sanitizes characters that are illegal in a SysML name', () => {
        expect(generateRelationshipId('traces.to', 'a-b', 'c::d', []))
            .toBe('rel_traces_to_a_b_c__d');
    });
});

describe('generateRelationshipDeclaration', () => {
    it('renders a typed connection usage with named ends', () => {
        expect(generateRelationshipDeclaration('rel_1', satisfiedBy, 'controller', 'sr104'))
            .toBe('connection rel_1 : SatisfiedBy connect satisfyingElement ::> controller to requiredElement ::> sr104;');
    });

    it('persists an optional transported-item label on the connector', () => {
        expect(generateRelationshipDeclaration('rel_1', satisfiedBy, 'controller', 'sr104', 'Alarm status'))
            .toContain('attribute transportedItem = "Alarm status";');
    });

    it('writes a native satisfaction with the SysML order, not a connection usage', () => {
        expect(generateRelationshipDeclaration('rel_1', nativeSatisfiedBy, 'sr104', 'controller'))
            .toBe('satisfy sr104 by controller;');
    });
});

// ─── Writing ────────────────────────────────────────────────────────────────

describe('writeRelationship', () => {
    const controller = element('controller', 'SoftwareComponent', 'model/catalog/architecture.sysml', 'Pump');
    const requirement = element('sr104', 'SoftwareRequirement', 'model/catalog/architecture.sysml', 'Pump');

    it('writes a typed relationship usage into project SysML', async () => {
        writeProjectFile('model/catalog/architecture.sysml',
            'package Pump {\n    part controller : SoftwareComponent;\n    requirement sr104 : SoftwareRequirement;\n}\n');

        const result = await writeRelationship(
            request(), satisfiedBy, model([controller, requirement]), options());

        expect(result.success).toBe(true);
        expect(result.sourceFile).toBe('model/catalog/architecture.sysml');
        expect(result.relationshipId).toBe('rel_satisfiedBy_controller_sr104');

        const written = readProjectFile('model/catalog/architecture.sysml');
        expect(written).toContain(
            'connection rel_satisfiedBy_controller_sr104 : SatisfiedBy connect satisfyingElement ::> controller to requiredElement ::> sr104;');
    });

    it('reports the file it chose', async () => {
        writeProjectFile('model/catalog/architecture.sysml', 'package Pump {\n}\n');
        const result = await writeRelationship(
            request(), satisfiedBy, model([controller, requirement]), options());
        expect(result.sourceFile).toBe('model/catalog/architecture.sysml');
        expect(result.placementReason).toBe('source-element-file');
    });

    it('writes native satisfy syntax and rebuilds it as the same trace edge', async () => {
        writeProjectFile('model/catalog/architecture.sysml', [
            'package Pump {',
            '    part controller : SoftwareComponent;',
            '    requirement sr104 : SoftwareRequirement;',
            '}',
            '',
        ].join('\n'));

        const result = await writeRelationship(
            request({ sourceId: 'sr104', targetId: 'controller', direction: 'incoming' }),
            nativeSatisfiedBy, model([controller, requirement]), options());
        expect(result).toMatchObject({
            success: true,
            notation: 'satisfy',
            declaration: 'satisfy sr104 by controller;',
        });
        expect(result.relationshipId).toBeUndefined();

        const written = readProjectFile('model/catalog/architecture.sysml');
        expect(written).toContain('satisfy sr104 by controller;');
        expect(written).not.toContain('connection rel_satisfiedBy');

        const { documents, errors } = await parseFiles(
            [resolve(projectRoot, 'model/catalog/architecture.sysml')], projectRoot + '/');
        expect(errors).toEqual([]);
        const rebuilt = buildMemoModel(documents, {} as MEMOConfig, errors);
        expect(rebuilt.relationships).toContainEqual(expect.objectContaining({
            type: 'satisfiedBy',
            sourceId: 'sr104', targetId: 'controller',
            sourceEnd: 'requiredElement', targetEnd: 'satisfyingElement',
        }));
    });

    it('preserves comments, imports and unrelated declarations', async () => {
        const original = [
            '// Top-of-file note that must survive.',
            'package Pump {',
            '    private import memo_core::*;',
            '',
            '    doc /* The controller drives the pump motor. */',
            '    part controller : SoftwareComponent;',
            '',
            '    // A trailing comment about the requirement.',
            '    requirement sr104 : SoftwareRequirement;',
            '}',
            '',
        ].join('\n');
        writeProjectFile('model/catalog/architecture.sysml', original);

        const result = await writeRelationship(
            request(), satisfiedBy, model([controller, requirement]), options());
        expect(result.success).toBe(true);

        const written = readProjectFile('model/catalog/architecture.sysml');
        expect(written).toContain('// Top-of-file note that must survive.');
        expect(written).toContain('private import memo_core::*;');
        expect(written).toContain('doc /* The controller drives the pump motor. */');
        expect(written).toContain('// A trailing comment about the requirement.');
        // Everything that was there before is still there, in order.
        const originalLines = original.split('\n').filter(l => l.trim());
        const writtenLines = written.split('\n').filter(l => l.trim());
        for (const line of originalLines) expect(writtenLines).toContain(line);
    });

    it('matches the indentation of existing members', async () => {
        writeProjectFile('model/catalog/architecture.sysml',
            'package Pump {\n        part controller : SoftwareComponent;\n}\n');
        await writeRelationship(request(), satisfiedBy, model([controller, requirement]), options());
        const written = readProjectFile('model/catalog/architecture.sysml');
        expect(written).toContain('        connection rel_satisfiedBy_controller_sr104');
    });

    it('creates the canonical file when nothing suitable exists', async () => {
        const result = await writeRelationship(
            request(), satisfiedBy,
            model([
                element('controller', 'SoftwareComponent', 'a/architecture.sysml'),
                element('sr104', 'SoftwareRequirement', 'b/requirements.sysml'),
            ]),
            options());

        expect(result.success).toBe(true);
        expect(result.sourceFile).toBe(CANONICAL_RELATIONSHIP_FILE);
        const written = readProjectFile(CANONICAL_RELATIONSHIP_FILE);
        expect(written).toContain('package model_catalog_relationships {');
        expect(written).toContain('connection rel_satisfiedBy_controller_sr104 : SatisfiedBy');
    });

    it('never modifies an installed ontology file', async () => {
        const ontologyRoot = resolve(projectRoot, 'vendor/ontology');
        const ontologyFile = 'vendor/ontology/relationships.sysml';
        const untouched = 'package ontology_rels {\n    connection def SatisfiedBy;\n}\n';
        writeProjectFile(ontologyFile, untouched);

        const result = await writeRelationship(
            request({ owningFile: ontologyFile }), satisfiedBy,
            model([controller, requirement]),
            options({ ontologyRoots: [ontologyRoot] }));

        // The write is redirected, and the ontology file is byte-identical.
        expect(result.sourceFile).not.toBe(ontologyFile);
        expect(readProjectFile(ontologyFile)).toBe(untouched);
    });

    it('never writes into the view presentation section', async () => {
        const viewFile = 'model/views/logical_view.sysml';
        const untouched = 'package logical_view {\n    view logicalView : DiagramView;\n}\n';
        writeProjectFile(viewFile, untouched);

        const result = await writeRelationship(
            request({ owningFile: viewFile }), satisfiedBy,
            model([controller, requirement]), options());

        expect(result.sourceFile).not.toBe(viewFile);
        expect(readProjectFile(viewFile)).toBe(untouched);
    });

    it('leaves the file untouched when the target does not parse', async () => {
        const broken = 'package Pump {\n    part controller : ;;;\n';
        writeProjectFile('model/catalog/architecture.sysml', broken);

        const result = await writeRelationship(
            request(), satisfiedBy, model([controller, requirement]), options());

        expect(result.success).toBe(false);
        expect(result.error).toContain('does not parse');
        expect(readProjectFile('model/catalog/architecture.sysml')).toBe(broken);
    });

    it('fails cleanly when the target file declares no package', async () => {
        writeProjectFile('model/catalog/architecture.sysml', '// only a comment\n');
        const result = await writeRelationship(
            request(), satisfiedBy, model([controller, requirement]), options());
        expect(result.success).toBe(false);
        expect(result.error).toContain('no package');
    });

    it('leaves no temp files behind', async () => {
        writeProjectFile('model/catalog/architecture.sysml', 'package Pump {\n}\n');
        await writeRelationship(request(), satisfiedBy, model([controller, requirement]), options());
        expect(existsSync(resolve(projectRoot, `model/catalog/architecture.sysml.${process.pid}.tmp`))).toBe(false);
    });

    it('writes a second relationship alongside the first', async () => {
        writeProjectFile('model/catalog/architecture.sysml', 'package Pump {\n}\n');
        const state = model([controller, requirement, element('sr105', 'SoftwareRequirement', 'model/catalog/architecture.sysml')]);

        const first = await writeRelationship(request(), satisfiedBy, state, options());
        const second = await writeRelationship(
            request({ targetId: 'sr105' }), satisfiedBy, state, options());

        expect(first.success && second.success).toBe(true);
        const written = readProjectFile('model/catalog/architecture.sysml');
        expect(written).toContain('rel_satisfiedBy_controller_sr104');
        expect(written).toContain('rel_satisfiedBy_controller_sr105');
    });
});

// ─── Round trip through the parser and builder ──────────────────────────────

describe('relationship persistence round trip', () => {
    const minimalConfig = {
        projectName: 'test', kinds: {}, relationshipTypes: [], architectureLayers: [], viewpoints: [],
    } as unknown as MEMOConfig;

    it('survives a rebuild with a stable named ID', async () => {
        writeProjectFile('model/catalog/architecture.sysml', [
            'package Pump {',
            '    part controller : SoftwareComponent;',
            '    requirement sr104 : SoftwareRequirement;',
            '}',
            '',
        ].join('\n'));

        const controller = element('controller', 'SoftwareComponent', 'model/catalog/architecture.sysml');
        const requirement = element('sr104', 'SoftwareRequirement', 'model/catalog/architecture.sysml');
        const result = await writeRelationship(
            request(), satisfiedBy, model([controller, requirement]), options());
        expect(result.success).toBe(true);

        // Rebuild from disk exactly as the file watcher would after a restart.
        const rebuild = async () => {
            const { documents, errors } = await parseFiles(
                [resolve(projectRoot, 'model/catalog/architecture.sysml')], projectRoot + '/');
            expect(errors).toEqual([]);
            return buildMemoModel(documents, minimalConfig, errors);
        };

        const first = await rebuild();
        expect(first.relationships).toHaveLength(1);
        expect(first.relationships[0]).toMatchObject({
            id: 'rel_satisfiedBy_controller_sr104',
            type: 'satisfiedBy',
            sourceId: 'controller',
            targetId: 'sr104',
            sourceEnd: 'satisfyingElement',
            targetEnd: 'requiredElement',
            named: true,
        });

        // A second rebuild yields the identical ID — it is not positional.
        const second = await rebuild();
        expect(second.relationships[0].id).toBe(first.relationships[0].id);

        // The endpoint elements are still present and untouched.
        expect(second.elements.has('controller')).toBe(true);
        expect(second.elements.has('sr104')).toBe(true);
    });

    it('is not persisted to any view, layout or UI sidecar', async () => {
        writeProjectFile('model/catalog/architecture.sysml', 'package Pump {\n}\n');
        writeProjectFile('model/views/logical_view.sysml', 'package logical_view {\n}\n');
        mkdirSync(resolve(projectRoot, '.memo'), { recursive: true });
        writeProjectFile('.memo/user-diagrams.json', '[]');

        const controller = element('controller', 'SoftwareComponent', 'model/catalog/architecture.sysml');
        const requirement = element('sr104', 'SoftwareRequirement', 'model/catalog/architecture.sysml');
        await writeRelationship(request(), satisfiedBy, model([controller, requirement]), options());

        // The link lives in project SysML and nowhere else.
        expect(readProjectFile('model/catalog/architecture.sysml')).toContain('connection rel_satisfiedBy');
        expect(readProjectFile('model/views/logical_view.sysml')).not.toContain('connection');
        expect(readProjectFile('.memo/user-diagrams.json')).toBe('[]');
    });
});

// ─── Deletion ───────────────────────────────────────────────────────────────

describe('removeRelationship', () => {
    const named: MemoRelationship = {
        id: 'rel_satisfiedBy_controller_sr104',
        type: 'satisfiedBy',
        sourceId: 'controller', targetId: 'sr104',
        sourceEnd: 'satisfyingElement', targetEnd: 'requiredElement',
        file: 'model/catalog/architecture.sysml',
        named: true,
    };

    const sourceWithTwoLinks = [
        'package Pump {',
        '    // The controller realizes the dose limiter.',
        '    part controller : SoftwareComponent;',
        '    requirement sr104 : SoftwareRequirement;',
        '    requirement sr105 : SoftwareRequirement;',
        '    connection rel_satisfiedBy_controller_sr104 : SatisfiedBy connect satisfyingElement ::> controller to requiredElement ::> sr104;',
        '    connection rel_satisfiedBy_controller_sr105 : SatisfiedBy connect satisfyingElement ::> controller to requiredElement ::> sr105;',
        '}',
        '',
    ].join('\n');

    it('removes only the named relationship usage', async () => {
        writeProjectFile('model/catalog/architecture.sysml', sourceWithTwoLinks);

        const result = await removeRelationship(named, options());
        expect(result.success).toBe(true);
        expect(result.sourceFile).toBe('model/catalog/architecture.sysml');

        const written = readProjectFile('model/catalog/architecture.sysml');
        expect(written).not.toContain('rel_satisfiedBy_controller_sr104');
        // The sibling relationship is untouched.
        expect(written).toContain('rel_satisfiedBy_controller_sr105');
    });

    it('never deletes either endpoint element', async () => {
        writeProjectFile('model/catalog/architecture.sysml', sourceWithTwoLinks);
        await removeRelationship(named, options());
        const written = readProjectFile('model/catalog/architecture.sysml');
        expect(written).toContain('part controller : SoftwareComponent;');
        expect(written).toContain('requirement sr104 : SoftwareRequirement;');
    });

    it('preserves surrounding comments and formatting', async () => {
        writeProjectFile('model/catalog/architecture.sysml', sourceWithTwoLinks);
        await removeRelationship(named, options());
        const written = readProjectFile('model/catalog/architecture.sysml');
        expect(written).toContain('// The controller realizes the dose limiter.');
        // No blank indented remnant is left where the line used to be.
        expect(written).not.toMatch(/\n[ \t]+\n[ \t]+connection rel_satisfiedBy_controller_sr105/);
    });

    it('returns the removed declaration so the caller can undo it', async () => {
        writeProjectFile('model/catalog/architecture.sysml', sourceWithTwoLinks);
        const result = await removeRelationship(named, options());
        expect(result.removedDeclaration).toBe(
            'connection rel_satisfiedBy_controller_sr104 : SatisfiedBy connect satisfyingElement ::> controller to requiredElement ::> sr104;');
    });

    it('supports undo by recreating the exact declaration', async () => {
        writeProjectFile('model/catalog/architecture.sysml', sourceWithTwoLinks);
        const removed = await removeRelationship(named, options());
        expect(removed.success).toBe(true);

        const restored = await writeRelationship(
            request(), satisfiedBy,
            model([
                element('controller', 'SoftwareComponent', 'model/catalog/architecture.sysml'),
                element('sr104', 'SoftwareRequirement', 'model/catalog/architecture.sysml'),
            ]),
            options());
        expect(restored.success).toBe(true);
        expect(restored.declaration).toBe(removed.removedDeclaration);
    });

    it('refuses to address an anonymous connection', async () => {
        writeProjectFile('model/catalog/architecture.sysml',
            'package Pump {\n    connection : SatisfiedBy connect satisfyingElement ::> controller to requiredElement ::> sr104;\n}\n');
        const result = await removeRelationship({ ...named, id: 'rel-1', named: undefined }, options());
        expect(result.success).toBe(false);
        expect(result.error).toContain('anonymous');
    });

    it('refuses to touch an installed ontology file', async () => {
        const ontologyRoot = resolve(projectRoot, 'vendor/ontology');
        const untouched = sourceWithTwoLinks;
        writeProjectFile('vendor/ontology/rels.sysml', untouched);

        const result = await removeRelationship(
            { ...named, file: 'vendor/ontology/rels.sysml' },
            options({ ontologyRoots: [ontologyRoot] }));

        expect(result.success).toBe(false);
        expect(readProjectFile('vendor/ontology/rels.sysml')).toBe(untouched);
    });

    it('reports a relationship that is not in the file', async () => {
        writeProjectFile('model/catalog/architecture.sysml', 'package Pump {\n}\n');
        const result = await removeRelationship(named, options());
        expect(result.success).toBe(false);
        expect(result.error).toContain('not found');
    });

    it('leaves the file parseable after removal', async () => {
        writeProjectFile('model/catalog/architecture.sysml', sourceWithTwoLinks);
        await removeRelationship(named, options());
        const { errors } = await parseFiles(
            [resolve(projectRoot, 'model/catalog/architecture.sysml')], projectRoot + '/');
        expect(errors).toEqual([]);
    });
});
