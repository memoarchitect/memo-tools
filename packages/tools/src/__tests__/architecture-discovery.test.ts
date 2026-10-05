import { describe, it, expect } from 'vitest';
import { apiLayers } from '../stage2/package-metadata-from-api.js';
import { compilerConfigured, withCompiled } from './helpers/compile-source.js';

// W1.06.01 C-1: layer discovery supports flat and nested architecture layouts.
// A layer is the first directory under a package's source directory; its kinds
// are the definitions the compiler's handoff holds for files under it.

/** The layers of a source tree written as `{ path: text }`, compiled as a project's own. */
async function layersOf(files: Record<string, string>) {
    return withCompiled(
        Object.entries(files).map(([filePath, source]) => ({ filePath, source })),
        { asGiven: true },
        ({ api, root }) => apiLayers(api, root, 'project'),
    );
}

// Deliberately unwrapped: SysML v2 allows definitions at the root of a file,
// so layer discovery has to read them.
describe.runIf(compilerConfigured)('layer discovery — architecture sublayers', () => {
    it('loads kinds from flat architecture/<file>.sysml layout', async () => {
        const layers = await layersOf({ 'architecture/flat_kind.sysml': 'part def FlatKind;\n' });
        const arch = layers.find(l => l.id === 'architecture');
        expect(arch).toBeDefined();
        expect(arch!.kinds.map(k => k.name)).toContain('FlatKind');
    });

    it('loads kinds from nested architecture/<sublayer>/<file>.sysml layout', async () => {
        const layers = await layersOf({ 'architecture/electrical/nested_kind.sysml': 'part def NestedKind;\n' });
        const arch = layers.find(l => l.id === 'architecture');
        expect(arch).toBeDefined();
        expect(arch!.kinds.map(k => k.name)).toContain('NestedKind');
        expect(arch!.kinds.find(k => k.name === 'NestedKind')?.group).toBe('electrical');
    });

    it('loads both flat and nested files together under architecture/', async () => {
        const layers = await layersOf({
            'architecture/flat_kind.sysml': 'part def FlatKind;\n',
            'architecture/electrical/nested_kind.sysml': 'part def NestedKind;\n',
            'architecture/mechanical/another_kind.sysml': 'part def AnotherKind;\n',
        });
        const arch = layers.find(l => l.id === 'architecture');
        expect(arch).toBeDefined();
        expect(arch!.kinds.map(k => k.name).sort()).toEqual(['AnotherKind', 'FlatKind', 'NestedKind']);
    });

    it('records abstract kinds and all supported definition constructs', async () => {
        const layers = await layersOf({
            'architecture/types.sysml':
                'abstract part def AbstractNode;\nport def SignalPort;\ninterface def DeviceInterface { end a; end b; }\nconnection def Connects { end a; end b; }\n',
        });
        const architecture = layers.find(layer => layer.id === 'architecture')!;
        expect(architecture.kinds).toEqual(expect.arrayContaining([
            expect.objectContaining({ name: 'AbstractNode', isAbstract: true }),
            expect.objectContaining({ name: 'SignalPort', construct: 'port def' }),
            expect.objectContaining({ name: 'DeviceInterface', construct: 'interface def' }),
            expect.objectContaining({ name: 'Connects', construct: 'connection def' }),
        ]));
    });
});

// W1.08.01 E-1: artifact folder skeleton — layer discovery for artifacts/

describe.runIf(compilerConfigured)('layer discovery — artifact layer', () => {
    it('discovers artifacts/ as a layer', async () => {
        const layers = await layersOf({ 'artifacts/risk_plan.sysml': 'part def RiskManagementPlan;\n' });
        const artifacts = layers.find(l => l.id === 'artifacts');
        expect(artifacts).toBeDefined();
        expect(artifacts!.kinds.map(k => k.name)).toContain('RiskManagementPlan');
    });

    it('coexists with other layers without interference', async () => {
        const layers = await layersOf({
            'architecture/some_kind.sysml': 'part def SomeKind;\n',
            'artifacts/risk_plan.sysml': 'part def RiskManagementPlan;\n',
        });
        expect(layers.find(l => l.id === 'architecture')).toBeDefined();
        expect(layers.find(l => l.id === 'artifacts')).toBeDefined();
        expect(layers).toHaveLength(2);
    });

    it('a directory with no definition is no layer: there is nothing in the handoff to place', async () => {
        const layers = await layersOf({
            'architecture/some_kind.sysml': 'part def SomeKind;\n',
            'artifacts/note.sysml': 'package Note;\n',
        });
        expect(layers.find(l => l.id === 'artifacts')).toBeUndefined();
    });
});
