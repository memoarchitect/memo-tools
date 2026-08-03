// ─── Session 7 — authoring write-back on the IR ──────────────────────────────
//
// The exit tests of §6.2, plus the properties of IR identity the write path
// depends on. What is being proven is narrow and worth stating plainly:
//
//   - a write is addressed by IR identity, so two same-named declarations in
//     different namespaces are two different targets;
//   - a write against an identity the current revision does not have fails
//     loudly, rather than editing whatever now answers to the name;
//   - a relationship is written in standard SysML notation — a guarded
//     succession comes out as one, not as a MEMO-flavoured connection;
//   - layout and source are separate stores, and no one action writes both.
// ─────────────────────────────────────────────────────────────────────────────

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import {
    buildIrIdentityIndex,
    indexFromIdentityTable,
    irIdentityTable,
    parseDeclarationPath,
    parseSysmlIdentityId,
    requireIrIdentity,
    StaleIrIdentityError,
    type IrIdentityIndex,
} from '../model/ir-identity.js';
import { lowerAstToSysmlIr } from '../model/sysml-ir.js';
import { parseFiles, parseText } from '../model/parser-utils.js';
import { buildMemoModel } from '../model/builder.js';
import { modelToDTO } from '../model/semantic.js';
import type { MEMOConfig } from '../model/config.js';
import { saveElementToFile, RENAME_IS_TEXT_ONLY } from '../server/persistor.js';
import { writeElement } from '../operations/authoring.js';
import { writeRelationship, generateRelationshipDeclaration } from '../server/relationship-writer.js';
import { notationFor, renderRelationship } from '../server/sysml-notation.js';
import {
    assertSingleDomainMutation,
    MixedMutationDomainError,
    mutationDomain,
} from '../server/mutation-domain.js';
import { saveViewLayout } from '../server/view-layout-store.js';
import type { RelationshipDefinitionDTO } from '../model/relationship-legality.js';
import type { DiagramDTO } from '../model/semantic.js';
import type { DiagramLayout } from '../protocol/messages.js';

const config: MEMOConfig = { projectName: 'write-back' } as MEMOConfig;

let projectRoot: string;

beforeEach(() => {
    projectRoot = mkdtempSync(join(tmpdir(), 'memo-write-back-'));
});

afterEach(() => {
    rmSync(projectRoot, { recursive: true, force: true });
});

function writeProjectFile(relativePath: string, contents: string): string {
    const absolute = resolve(projectRoot, relativePath);
    mkdirSync(resolve(absolute, '..'), { recursive: true });
    writeFileSync(absolute, contents, 'utf8');
    return absolute;
}

function readProjectFile(relativePath: string): string {
    return readFileSync(resolve(projectRoot, relativePath), 'utf8');
}

/** Compile the project the way a lowering run does. */
async function lower() {
    const { findSysmlFiles } = await import('../model/sysml-files.js');
    const files = findSysmlFiles(projectRoot).slice().sort();
    const { documents, errors } = await parseFiles(files, `${projectRoot}/`);
    const built = buildMemoModel(documents, config, errors);
    return lowerAstToSysmlIr(documents, modelToDTO(built), projectRoot);
}

/** …and index its identities, which is what a write resolves against. */
async function compile(): Promise<IrIdentityIndex> {
    return buildIrIdentityIndex(await lower());
}

/**
 * Two packages, each declaring a part called `pump`.
 *
 * The whole point of the fixture: under name-based lookup these are one target.
 */
const TWO_NAMESPACES = `package Plant {
    part pump : Component {
        attribute redefines note = "plant";
    }
}
package Spare {
    part pump : Component {
        attribute redefines note = "spare";
    }
}
`;

// ─── Identity ───────────────────────────────────────────────────────────────

describe('IR identity', () => {
    it('gives same-named declarations in different namespaces different addresses', async () => {
        writeProjectFile('model/plant.sysml', TWO_NAMESPACES);
        const ir = await lower();
        const pumps = ir.elements.filter(element => element.identity.metaclass === 'PartUsage');
        expect(pumps).toHaveLength(2);
        expect(new Set(pumps.map(element => element.identity.id)).size).toBe(2);
    });

    it('projects declarations inside a top-level package', async () => {
        writeProjectFile('model/plant.sysml', TWO_NAMESPACES);
        const ir = await lower();
        expect(ir.elements.some(element => element.kind === 'mapped')).toBe(true);
    });

    it('round-trips through the compact table shipped to a client', async () => {
        writeProjectFile('model/plant.sysml', TWO_NAMESPACES);
        const index = await compile();
        const rebuilt = indexFromIdentityTable(index.byMemoElement);
        expect(rebuilt.byMemoElement).toEqual(index.byMemoElement);
        for (const identityId of Object.values(index.byMemoElement)) {
            expect(rebuilt.byIdentity.get(identityId)?.identity)
                .toEqual(index.byIdentity.get(identityId)?.identity);
        }
    });

    it('reads an identity ID back into file, path and metaclass', () => {
        const parsed = parseSysmlIdentityId('file:///p/model/a.sysml#members[0]/members[2]:PartUsage');
        expect(parsed).toMatchObject({
            fileUri: 'file:///p/model/a.sysml',
            declarationPath: 'members[0]/members[2]',
            metaclass: 'PartUsage',
        });
        expect(parseDeclarationPath(parsed!.declarationPath)).toEqual([0, 2]);
    });

    it('rejects an identity the current revision does not have', async () => {
        writeProjectFile('model/plant.sysml', TWO_NAMESPACES);
        const index = await compile();
        expect(() => requireIrIdentity(index, 'file:///gone#members[9]:PartUsage'))
            .toThrow(StaleIrIdentityError);
    });

    it('rejects an identity that now names a different element', async () => {
        writeProjectFile('model/plant.sysml', TWO_NAMESPACES);
        const index = await compile();
        const [elementId, identityId] = Object.entries(index.byMemoElement)[0];
        expect(() => requireIrIdentity(index, identityId, `${elementId}-other`))
            .toThrow(/not "\S+-other"/);
    });

    it('an identity table is derivable from an IR without indexing it twice', async () => {
        writeProjectFile('model/plant.sysml', TWO_NAMESPACES);
        const { findSysmlFiles } = await import('../model/sysml-files.js');
        const { documents, errors } = await parseFiles(findSysmlFiles(projectRoot).sort(), `${projectRoot}/`);
        const built = buildMemoModel(documents, config, errors);
        const ir = lowerAstToSysmlIr(documents, modelToDTO(built), projectRoot);
        expect(irIdentityTable(ir)).toEqual(buildIrIdentityIndex(ir).byMemoElement);
    });
});

// ─── Element write-back ─────────────────────────────────────────────────────

describe('element write-back', () => {
    it('edits the declaration the identity names, not its same-named twin', async () => {
        writeProjectFile('model/plant.sysml', TWO_NAMESPACES);
        const index = await compile();
        // One identity, naming exactly one of the two declarations. The regex
        // this replaced was global: editing `pump` rewrote both.
        const identity = index.byMemoElement['pump'];
        expect(identity).toBeTruthy();

        const result = await saveElementToFile(projectRoot, {
            id: 'pump',
            kind: 'Component',
            construct: 'part',
            attributes: { note: 'edited' },
            file: 'model/plant.sysml',
            irIdentity: identity,
        }, index);

        expect(result.success).toBe(true);
        expect(result.replaced).toBe(true);
        const source = readProjectFile('model/plant.sysml');
        expect(source).toContain('"edited"');
        // Exactly one of the two declarations changed; the other is intact.
        expect(source.match(/note = "/g)).toHaveLength(2);
        expect(source).toContain('"plant"');
        expect(source).not.toContain('"spare"');
    });

    it('leaves comments and neighbouring declarations untouched', async () => {
        writeProjectFile('model/plant.sysml', `package Plant {
    // a comment that mentions pump and must survive
    part motor : Component;
    part pump : Component {
        attribute redefines note = "before";
    }
    part valve : Component;
}
`);
        const index = await compile();
        const identity = index.byMemoElement['pump'];
        const result = await saveElementToFile(projectRoot, {
            id: 'pump', kind: 'Component', construct: 'part',
            attributes: { note: 'after' }, file: 'model/plant.sysml', irIdentity: identity,
        }, index);

        expect(result.success).toBe(true);
        const source = readProjectFile('model/plant.sysml');
        expect(source).toContain('// a comment that mentions pump and must survive');
        expect(source).toContain('part motor : Component;');
        expect(source).toContain('part valve : Component;');
        expect(source).toContain('"after"');
    });

    it('fails loudly on a stale identity rather than editing by name', async () => {
        writeProjectFile('model/plant.sysml', TWO_NAMESPACES);
        const index = await compile();
        const before = readProjectFile('model/plant.sysml');

        const result = await saveElementToFile(projectRoot, {
            id: 'pump', kind: 'Component', construct: 'part',
            attributes: { note: 'edited' }, file: 'model/plant.sysml',
            irIdentity: `file://${projectRoot}/model/plant.sysml#members[7]:PartUsage`,
        }, index);

        expect(result.success).toBe(false);
        expect(result.stale).toBe(true);
        expect(result.error).toMatch(/not in the current model revision/);
        expect(readProjectFile('model/plant.sysml')).toBe(before);
    });

    it('fails loudly when the source moved under a still-registered identity', async () => {
        writeProjectFile('model/plant.sysml', TWO_NAMESPACES);
        const index = await compile();
        const identity = index.byMemoElement['pump'];

        // Someone else prepends a declaration: the recorded position now holds
        // a different node, which is exactly the silent-miss case.
        writeProjectFile('model/plant.sysml', `package Inserted {\n    part first : Component;\n}\n${TWO_NAMESPACES}`);
        const before = readProjectFile('model/plant.sysml');

        const result = await saveElementToFile(projectRoot, {
            id: 'pump', kind: 'Component', construct: 'part',
            attributes: { note: 'edited' }, file: 'model/plant.sysml', irIdentity: identity,
        }, index);

        expect(result.success).toBe(false);
        expect(result.stale).toBe(true);
        expect(readProjectFile('model/plant.sysml')).toBe(before);
    });

    it('refuses a quoted identity when no revision is available to resolve it', async () => {
        writeProjectFile('model/plant.sysml', TWO_NAMESPACES);
        const result = await saveElementToFile(projectRoot, {
            id: 'pump', kind: 'Component', construct: 'part',
            file: 'model/plant.sysml', irIdentity: 'file:///x#members[0]:PartUsage',
        });
        expect(result.success).toBe(false);
        expect(result.stale).toBe(true);
    });

    it('appends a genuinely new element and leaves the existing ones alone', async () => {
        writeProjectFile('model/plant.sysml', TWO_NAMESPACES);
        const index = await compile();
        const result = await saveElementToFile(projectRoot, {
            id: 'newPump', kind: 'Component', construct: 'part', file: 'model/plant.sysml',
        }, index);

        expect(result.success).toBe(true);
        expect(result.replaced).toBeFalsy();
        const source = readProjectFile('model/plant.sysml');
        expect(source).toContain('newPump');
        expect(source).toContain('"plant"');
        expect(source).toContain('"spare"');
    });

    it('refuses a declaration rename that does not declare what it is renaming', async () => {
        writeProjectFile('model/plant.sysml', TWO_NAMESPACES);
        const index = await compile();
        const result = await saveElementToFile(projectRoot, {
            id: 'pumpRenamed', kind: 'Component', construct: 'part',
            file: 'model/plant.sysml', irIdentity: index.byMemoElement['pump'],
        }, index);
        expect(result.success).toBe(false);
        expect(result.stale).toBe(true);
    });

    it('says a rename is a text edit rather than implying references follow', async () => {
        writeProjectFile('model/plant.sysml', `package Plant {
    part pump : Component;
    part tank : Component {
        attribute redefines feed = "pump";
    }
}
`);
        const index = await compile();
        const identity = index.byMemoElement['pump'];

        const result = await saveElementToFile(projectRoot, {
            id: 'pumpRenamed', renamedFrom: 'pump', kind: 'Component', construct: 'part',
            file: 'model/plant.sysml', irIdentity: identity,
        }, index);

        expect(result.success).toBe(true);
        expect(result.warnings?.[0]).toEqual({ code: 'rename-is-text-only', message: RENAME_IS_TEXT_ONLY });
        // The reference is deliberately *not* updated — that needs the linker.
        expect(readProjectFile('model/plant.sysml')).toContain('feed = "pump"');
    });

    it('never writes source that does not parse', async () => {
        writeProjectFile('model/plant.sysml', TWO_NAMESPACES);
        const index = await compile();
        const identity = index.byMemoElement['pump'];
        const before = readProjectFile('model/plant.sysml');

        const result = await saveElementToFile(projectRoot, {
            id: 'not a legal name', renamedFrom: 'pump', kind: 'Component', construct: 'part',
            file: 'model/plant.sysml', irIdentity: identity,
        }, index);

        expect(result.success).toBe(false);
        expect(result.error).toMatch(/did not parse/);
        expect(readProjectFile('model/plant.sysml')).toBe(before);
    });
});

// ─── Write, then recompile through the selected provider ────────────────────

describe('the write-back operation', () => {
    it('recompiles through the lowering provider and returns fresh identities', async () => {
        writeProjectFile('model/plant.sysml', TWO_NAMESPACES);
        const index = await compile();

        const result = await writeElement(
            { projectDir: projectRoot, config, irIndex: index },
            {
                id: 'pump', kind: 'Component', construct: 'part',
                attributes: { note: 'recompiled' }, file: 'model/plant.sysml',
                irIdentity: index.byMemoElement['pump'],
            },
        );

        expect(result.success).toBe(true);
        // The revision came back from a provider run, not from the writer's own
        // guess about what it had just written.
        expect(result.revision?.provider).toBeTruthy();
        expect(result.revision?.index.byMemoElement['pump']).toBeTruthy();
        expect(readProjectFile('model/plant.sysml')).toContain('"recompiled"');
    }, 30_000);

    it('does not recompile a write that failed', async () => {
        writeProjectFile('model/plant.sysml', TWO_NAMESPACES);
        const index = await compile();
        const result = await writeElement(
            { projectDir: projectRoot, config, irIndex: index },
            {
                id: 'pump', kind: 'Component', construct: 'part', file: 'model/plant.sysml',
                irIdentity: 'file:///gone#members[0]:PartUsage',
            },
        );
        expect(result.success).toBe(false);
        expect(result.revision).toBeUndefined();
    });
});

// ─── Notation ───────────────────────────────────────────────────────────────

const succession: RelationshipDefinitionDTO = {
    name: 'succession',
    sysmlName: 'SuccessionUsage',
    label: 'Succession',
    layer: 'behavior',
    sourceEnd: { name: 'first' },
    targetEnd: { name: 'then' },
};

const satisfiedBy: RelationshipDefinitionDTO = {
    name: 'satisfiedBy',
    sysmlName: 'SatisfiedBy',
    label: 'Satisfied By',
    layer: 'requirements',
    sourceEnd: { name: 'satisfyingElement', type: 'ArchitectureElement' },
    targetEnd: { name: 'requiredElement', type: 'VerifiableElement' },
};

describe('SysML notation', () => {
    it('writes a succession in the language production, not as a connection', () => {
        expect(notationFor(succession)).toBe('succession');
        expect(renderRelationship({ id: 'rel_1', definition: succession, sourceId: 'a', targetId: 'b' }))
            .toBe('succession first a then b;');
    });

    it('puts the guard on the first step, where SysML puts it', () => {
        expect(generateRelationshipDeclaration('rel_1', succession, 'routeOrder', 'processOrder', undefined, 'true'))
            .toBe('succession first routeOrder if true then processOrder;');
    });

    it('still writes an ontology-defined relationship as a typed connection', () => {
        expect(notationFor(satisfiedBy)).toBe('connection');
        expect(generateRelationshipDeclaration('rel_1', satisfiedBy, 'controller', 'sr104'))
            .toBe('connection rel_1 : SatisfiedBy connect satisfyingElement ::> controller to requiredElement ::> sr104;');
    });

    it('the internal parser reads back every notation it emits', async () => {
        const forms = [
            renderRelationship({ id: 'r1', definition: succession, sourceId: 'a', targetId: 'b', guard: 'true' }),
            renderRelationship({ id: 'r2', definition: satisfiedBy, sourceId: 'a', targetId: 'b' }),
        ];
        for (const declaration of forms) {
            const { errors } = await parseText(`package P {\n    ${declaration}\n}\n`);
            expect(errors, declaration).toEqual([]);
        }
    });
});

// ─── Relationship write-back ────────────────────────────────────────────────

describe('relationship write-back', () => {
    const model = (ids: string[]) => ({
        elements: Object.fromEntries(ids.map(id => [id, {
            id, name: id, kind: 'Action', construct: 'action', layer: 'behavior',
            file: 'model/flow.sysml', package: 'Flow', attributes: {},
        }])),
        relationships: [],
    });

    it('writes a guarded succession from the canvas as valid textual notation', async () => {
        writeProjectFile('model/flow.sysml', `package Flow {
    action routeOrder;
    action processOrder;
}
`);
        const index = await compile();
        const result = await writeRelationship(
            {
                requestId: 'req-1', type: 'succession', direction: 'outgoing',
                sourceId: 'routeOrder', targetId: 'processOrder', guard: 'true',
                owningFile: 'model/flow.sysml',
                sourceIdentity: index.byMemoElement['routeOrder'],
                targetIdentity: index.byMemoElement['processOrder'],
            },
            succession,
            model(['routeOrder', 'processOrder']),
            { projectRoot, irIndex: index },
        );

        expect(result.success).toBe(true);
        expect(result.notation).toBe('succession');
        expect(result.declaration).toBe('succession first routeOrder if true then processOrder;');
        // A succession takes no declared name in SysML, and the result says so
        // rather than reporting an ID that deletion could not later resolve.
        expect(result.relationshipId).toBeUndefined();
        expect(readProjectFile('model/flow.sysml'))
            .toContain('succession first routeOrder if true then processOrder;');

        // And the written project recompiles.
        const recompiled = await compile();
        expect(Object.keys(recompiled.byMemoElement).length).toBeGreaterThan(0);
    });

    it('refuses a relationship whose endpoint identity is stale', async () => {
        writeProjectFile('model/flow.sysml', `package Flow {
    action routeOrder;
    action processOrder;
}
`);
        const index = await compile();
        const before = readProjectFile('model/flow.sysml');

        const result = await writeRelationship(
            {
                requestId: 'req-1', type: 'succession', direction: 'outgoing',
                sourceId: 'routeOrder', targetId: 'processOrder',
                owningFile: 'model/flow.sysml',
                sourceIdentity: `file://${projectRoot}/model/flow.sysml#members[0]/members[42]:ActionUsage`,
            },
            succession,
            model(['routeOrder', 'processOrder']),
            { projectRoot, irIndex: index },
        );

        expect(result.success).toBe(false);
        expect(result.stale).toBe(true);
        expect(result.error).toMatch(/source endpoint/);
        expect(readProjectFile('model/flow.sysml')).toBe(before);
    });

    it('refuses an endpoint identity that now names a different element', async () => {
        writeProjectFile('model/flow.sysml', `package Flow {
    action routeOrder;
    action processOrder;
}
`);
        const index = await compile();
        const result = await writeRelationship(
            {
                requestId: 'req-1', type: 'succession', direction: 'outgoing',
                sourceId: 'routeOrder', targetId: 'processOrder',
                owningFile: 'model/flow.sysml',
                // The identity of processOrder, quoted as the source.
                sourceIdentity: index.byMemoElement['processOrder'],
            },
            succession,
            model(['routeOrder', 'processOrder']),
            { projectRoot, irIndex: index },
        );

        expect(result.success).toBe(false);
        expect(result.stale).toBe(true);
        expect(result.error).toMatch(/now names "processOrder"/);
    });
});

// ─── Layout and source are different stores ─────────────────────────────────

describe('one action, one store', () => {
    it('classifies every mutation it guards', () => {
        expect(mutationDomain('element:update')).toBe('semantic');
        expect(mutationDomain('relationship:create')).toBe('semantic');
        expect(mutationDomain('diagram:layout:update')).toBe('layout');
    });

    it('refuses a semantic mutation carrying canvas geometry', () => {
        expect(() => assertSingleDomainMutation('element:update', { id: 'a', position: { x: 1, y: 2 } }))
            .toThrow(MixedMutationDomainError);
        expect(() => assertSingleDomainMutation('element:update', { id: 'a', attributes: { position: 'left' } }))
            .not.toThrow();
    });

    it('moving a symbol produces no .sysml diff', () => {
        writeProjectFile('model/flow.sysml', `package Flow {
    action routeOrder;
    action processOrder;
}
`);
        const before = readProjectFile('model/flow.sysml');
        const diagram: DiagramDTO = {
            id: 'diag-1', name: 'Flow', diagramType: 'bdd',
            viewpointId: '__model', auto: false, sourceFile: 'model/flow.sysml',
        } as DiagramDTO;
        const layout: DiagramLayout = { nodes: { routeOrder: { x: 120, y: 40 } }, edges: {} };

        const saved = saveViewLayout(projectRoot, diagram, layout);

        expect(saved).toBeTruthy();
        expect(saved!.endsWith('.sysml')).toBe(false);
        expect(readProjectFile('model/flow.sysml')).toBe(before);
    });
});

// ─── Optional: the external validator, when the user has one ────────────────
//
// §1.3 rule 1 — the whole suite passes with zero external tools, so this is a
// bonus check rather than a gate. When `syside` is on PATH it answers the exit
// test as written: it, not only MEMO's parser, accepts what the canvas wrote.

function sysideAvailable(): boolean {
    try {
        execFileSync('syside', ['--version'], { stdio: 'ignore' });
        return true;
    } catch {
        return false;
    }
}

describe.runIf(sysideAvailable())('the configured external validator', () => {
    it('accepts the guarded succession the canvas writes', () => {
        const declaration = renderRelationship({
            id: 'rel_1', definition: succession, sourceId: 'routeOrder', targetId: 'processOrder', guard: 'true',
        });
        writeProjectFile('model/flow.sysml', `package Flow {
    action def Order {
        action routeOrder;
        action processOrder;
        ${declaration}
    }
}
`);
        expect(() => execFileSync(
            'syside',
            ['check', '--diagnose', 'all', resolve(projectRoot, 'model/flow.sysml')],
            { stdio: 'pipe' },
        )).not.toThrow();
    });
});
