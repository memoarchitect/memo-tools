import { layoutBlindRevision } from '../model/view-layout-block.js';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createFunction } from '../server/function-writer.js';
import { modelToDTO } from '../model/semantic.js';
import { computeWorkspaceMembership, workspaceMembershipToDTO } from '../model/workspace-membership.js';
import { selectedOutlineSource } from '../authoring/outline-source.js';
import { loadProjectModel } from '../toolchain/project-model.js';
import { compilerConfigured, examplesPresent, withExample } from './helpers/compile-source.js';
const file = 'model/catalog/function_creation.sysml';
const otherFile = 'model/catalog/component_template.sysml';
const otherSource = `package component_template { private import memo::*; part def ControllerTemplate specializes LogicalComponent { part worker : LogicalComponent; } }`;
const source = `package function_creation {
    private import memo::*;
    private import component_template::*;
    part def PumpSystem specializes System { part controller : ControllerTemplate; }
    part pump : PumpSystem;
    action def ReusableMeasure specializes SystemFunction;
    part def MonitorSystem specializes System;
    part monitor : MonitorSystem;
    action sharedResponsibility : SystemFunction {
        action measure : SystemFunction;
        action regulate : SystemFunction;
    }
    allocation allocate sharedResponsibility to pump;
    allocation allocate sharedResponsibility to monitor;
    allocation allocate sharedResponsibility.measure to pump;
    allocation allocate sharedResponsibility.regulate to pump;
}`;
function dto(project: Awaited<ReturnType<typeof loadProjectModel>>) {
    return modelToDTO(project.model, { registries: { kinds: project.registries!.kindRegistry!.toDefinitionDTOs(), relationships: [] },
        workspaceMembership: workspaceMembershipToDTO(computeWorkspaceMembership(project.model, project.registries!), project.model) });
}
const config = () => ({ toolchain: { compiler: process.env.MEMO_TOOLCHAIN_COMPILER } }) as any;
describe.runIf(compilerConfigured && examplesPresent)('native functional structure authoring', () => {
    it('adopts an exclusively local nested responsibility as the explicit root without moving it', async () => {
        const single = source.replace('allocate sharedResponsibility.regulate to pump;', 'allocate sharedResponsibility.regulate to monitor;');
        await withExample({ [file]: single, [otherFile]: otherSource }, async (project, root) => {
            const result = await createFunction(root, dto(project), { workspace: 'function_creation::PumpSystem' }, '', selectedOutlineSource(root, config()), file);
            expect(result.success, result.error).toBe(true);
            expect(result.elementId).toBe('function_creation::sharedResponsibility::measure');
            expect(readFileSync(join(root, file), 'utf8')).toContain('FunctionalRoot dependency from function_creation::PumpSystem to function_creation::sharedResponsibility::measure;');
        });
    }, 180_000);

    it('creates one explicit root referencing existing functions, then an allocated component function, preserving identities', async () => {
        await withExample({ [file]: source, [otherFile]: otherSource }, async (project, root) => {
            const outlines = selectedOutlineSource(root, config());
            const result = await createFunction(root, dto(project), { workspace: 'function_creation::PumpSystem' }, '', outlines, file);
            expect(result).toMatchObject({ success: true, elementId: 'function_creation::rootFunction' });
            const next = await loadProjectModel({ projectRoot: root, config: config(), cache: false });
            expect(next.model.elements.has('function_creation::sharedResponsibility::measure')).toBe(true);
            expect(next.model.elements.get('function_creation::rootFunction::responsibility1')?.kind).toBe('SystemFunction');
            expect(next.model.relationships.some(edge => edge.type === 'functionalRoot' && edge.targetId === result.elementId)).toBe(true);
            expect(readFileSync(join(root, file), 'utf8')).toContain('perform action responsibility1 : memo_architecture_functional_functions::SystemFunction :> function_creation::sharedResponsibility.measure');
            const child = await createFunction(root, dto(next), { workspace: 'function_creation::PumpSystem', componentId: 'component_template::ControllerTemplate::worker', componentSourceHash: layoutBlindRevision(readFileSync(join(root, otherFile), 'utf8')) }, 'Compute rate', outlines, file);
            expect(child.success, child.error).toBe(true);
            expect(child.sourceFiles).toEqual(expect.arrayContaining([file, otherFile]));
            const final = await loadProjectModel({ projectRoot: root, config: config(), cache: false });
            expect(final.model.elements.get(child.elementId!)?.kind).toBe('ComponentFunction');
            expect(final.model.relationships.filter(edge => edge.type === 'allocatedTo' && edge.sourceId === child.elementId).map(edge => edge.targetId)).toEqual(['component_template::ControllerTemplate::worker']);
            expect(final.model.relationships.some(edge => edge.type === 'composes' && edge.sourceId === result.elementId && edge.targetId === child.elementId)).toBe(true);
            const before = readFileSync(join(root, file), 'utf8');
            const otherBefore = readFileSync(join(root, otherFile), 'utf8');
            const repeated = await createFunction(root, dto(final), { workspace: 'function_creation::PumpSystem' }, '', outlines, file);
            expect(repeated.elementId).toBe(result.elementId);
            expect(readFileSync(join(root, file), 'utf8')).toBe(before);
            const stale = await createFunction(root, dto(final), { workspace: 'function_creation::PumpSystem', componentId: 'component_template::ControllerTemplate::worker', componentSourceHash: 'stale' }, 'Stale', outlines, file);
            expect(stale.success).toBe(false);
            expect(readFileSync(join(root, file), 'utf8')).toBe(before);
            expect(readFileSync(join(root, otherFile), 'utf8')).toBe(otherBefore);
            const compilerRefusal = await createFunction(root, dto(final), { workspace: 'function_creation::PumpSystem', componentId: 'component_template::ControllerTemplate::worker', componentSourceHash: layoutBlindRevision(readFileSync(join(root, otherFile), 'utf8')) }, 'Rejected', { ...outlines, verify: async () => { throw new Error('Compiler diagnostic'); } }, file);
            expect(readFileSync(join(root, otherFile), 'utf8')).toBe(otherBefore);
            expect(compilerRefusal).toMatchObject({ success: false, error: expect.stringContaining('Compiler diagnostic') });
            expect(readFileSync(join(root, file), 'utf8')).toBe(before);
            const refused = await createFunction(root, dto(final), { workspace: 'function_creation::PumpSystem', componentId: 'function_creation::sharedResponsibility::measure' }, 'Wrong', outlines, file);
            expect(refused.success).toBe(false);
            expect(readFileSync(join(root, file), 'utf8')).toBe(before);
        });
    }, 180_000); // The transaction is followed by several independent full compiler reloads.
});
