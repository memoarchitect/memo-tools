import { describe, expect, it } from 'vitest';
import { EmptyFileSystem } from 'langium';
import { parseHelper } from 'langium/test';
import { createMemoSysMLServices } from '../language/memo-sysml-module.js';
import type { Model } from '../language/generated/ast.js';
import { buildMemoModel } from '../model/builder.js';
import { deriveModelViews } from '../model/view-deriver.js';

// A viewpoint nests for system-of-systems modelling. The grammar accepted the
// nesting before the builder did, so `viewpoint vpSoS { viewpoint vpPump; }`
// parsed cleanly and produced no elements at all — and every consumer saw one
// flat list of viewpoints with no way to express which system a viewpoint
// frames. These pin the whole path: source → element → DTO.
const parse = parseHelper<Model>(createMemoSysMLServices({ ...EmptyFileSystem }).MemoSysML);

const SOURCE = `package t {
    viewpoint vpSoS : MemoViewpoint {
        attribute :>> name = "Therapy System of Systems";
        viewpoint vpPump : MemoViewpoint {
            attribute :>> name = "Pump";
            attribute :>> explorerLane = "architecture";
        }
        viewpoint vpMonitor : MemoViewpoint;
    }
    view vPumpStructure : MemoView {
        ref viewpointDefinition :> vpPump;
        attribute :>> title = "Pump structure";
    }
}`;

async function model() {
    const document = await parse(SOURCE);
    return buildMemoModel([{ document, filePath: 'test.sysml' }], { projectName: 'test' });
}

describe('a viewpoint declared inside a viewpoint', () => {
    it('becomes an element that carries its parent in owner', async () => {
        const built = await model();
        const pump = built.elements.get('vpPump');
        expect(pump?.construct).toBe('viewpoint');
        expect(pump?.owner).toBe('vpSoS');
        expect(built.elements.get('vpSoS')?.owner).toBeUndefined();
    });

    it('does not become part containment: framing is not composition', async () => {
        const built = await model();
        expect(built.relationships.filter(r => r.type === 'composes' && r.targetId === 'vpPump')).toEqual([]);
    });

    it('reaches the DTO with parentId set, and reads the attributes it declares', async () => {
        const { viewpoints } = deriveModelViews(await model());
        const pump = viewpoints.find(vp => vp.id === 'vpPump');
        expect(pump).toMatchObject({ label: 'Pump', parentId: 'vpSoS', explorerLane: 'architecture' });
    });

    it('carries the parent even though no view binds to it', async () => {
        const { viewpoints } = deriveModelViews(await model());
        // Only vPumpStructure exists, and it binds vpPump. The system-of-systems
        // viewpoint frames the constituents and draws nothing itself, so it
        // reaches the tree through the child's parent chain or not at all.
        expect(viewpoints.find(vp => vp.id === 'vpSoS')).toMatchObject({
            label: 'Therapy System of Systems',
        });
        expect(viewpoints.find(vp => vp.id === 'vpSoS')?.parentId).toBeUndefined();
    });
});
