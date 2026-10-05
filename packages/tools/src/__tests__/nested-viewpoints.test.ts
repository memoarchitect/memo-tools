import { describe, expect, it } from 'vitest';
import { deriveModelViews } from '../model/view-deriver.js';
import { shortNameOf } from '../model/element-index.js';
import { compilerConfigured, examplesPresent, withExample } from './helpers/compile-source.js';

// A viewpoint nests for system-of-systems modelling. The grammar accepted the
// nesting before the builder did, so `viewpoint vpSoS { viewpoint vpPump; }`
// parsed cleanly and produced no elements at all — and every consumer saw one
// flat list of viewpoints with no way to express which system a viewpoint
// frames. These pin the whole path: source → element → DTO.
const SOURCE = `package t {
    private import memo_viewpoints_definitions::*;
    private import memo_core_common::MemoIdentity;
    viewpoint vpSoS : MemoViewpoint {
        @MemoIdentity { :>> label = "Therapy System of Systems"; }
        viewpoint vpPump : MemoViewpoint {
            @MemoIdentity { :>> label = "Pump"; }
            attribute :>> explorerLane = "architecture";
        }
        viewpoint vpMonitor : MemoViewpoint;
    }
    view vPumpStructure : MemoView {
        ref :>> viewpointDefinition = vpSoS.vpPump;
        @MemoIdentity { :>> label = "Pump structure"; }
    }
}`;

/** The source, compiled as one more file of a shipped example so it sees the real ontology. */
async function model() {
    return withExample({ 'model/catalog/nested_viewpoints.sysml': SOURCE }, project => ({
        model: project.model, registry: project.registries?.kindRegistry,
    }));
}

describe.runIf(compilerConfigured && examplesPresent)('a viewpoint declared inside a viewpoint', () => {
    it('becomes an element that carries its parent in owner', async () => {
        const built = (await model()).model;
        const pump = built.elements.lookup('vpPump');
        expect(pump?.construct).toBe('viewpoint');
        expect(shortNameOf(pump?.owner)).toBe('vpSoS');
        expect(built.elements.lookup('vpSoS')?.owner).toBeUndefined();
    });

    it('does not become part containment: framing is not composition', async () => {
        const built = (await model()).model;
        expect(built.relationships.filter(r => r.type === 'composes' && r.targetId === 'vpPump')).toEqual([]);
    });

    it('reaches the DTO with parentId set, and reads the attributes it declares', async () => {
        const { model: built, registry } = await model();
        const { viewpoints } = deriveModelViews(built, registry);
        const pump = viewpoints.find(vp => vp.id === 'vpPump');
        expect(pump).toMatchObject({ label: 'Pump', parentId: 'vpSoS', explorerLane: 'architecture' });
    });

    it('carries the parent even though no view binds to it', async () => {
        const { model: built, registry } = await model();
        const { viewpoints } = deriveModelViews(built, registry);
        // Only vPumpStructure exists, and it binds vpPump. The system-of-systems
        // viewpoint frames the constituents and draws nothing itself, so it
        // reaches the tree through the child's parent chain or not at all.
        expect(viewpoints.find(vp => vp.id === 'vpSoS')).toMatchObject({
            label: 'Therapy System of Systems',
        });
        expect(viewpoints.find(vp => vp.id === 'vpSoS')?.parentId).toBeUndefined();
    });
});
