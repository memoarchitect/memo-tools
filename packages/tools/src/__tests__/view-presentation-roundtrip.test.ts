import { describe, expect, it } from 'vitest';
import type { DiagramDTO } from '../types/index.js';
import { writeViewDeclaration } from '../server/view-writer.js';
import { deriveModelViews } from '../model/view-deriver.js';
import { modelToDTO } from '../model/semantic.js';
import { selectedOutlineSource } from '../authoring/outline-source.js';
import { loadProjectModel } from '../toolchain/project-model.js';
import { compilerConfigured, examplesPresent, withExample } from './helpers/compile-source.js';
const source = `package presentation {
    private import memo::*;
    part team : OperationalEntity;
    use case goal : ClinicalUseCase { subject :>> supportingSystem = team; actor observer = team; include child; }
    use case child : ClinicalUseCase { subject :>> supportingSystem = team; }
    action rootFunction : SystemFunction { action measure : SystemFunction; }
    action behavior : FunctionalFlow { action step :> rootFunction.measure; }
}`;
const config = () => ({ toolchain: { compiler: process.env.MEMO_TOOLCHAIN_COMPILER } }) as any;
describe.runIf(compilerConfigured && examplesPresent)('authored view presentation round trip', () => {
    it('keeps use-case/activity notation and function tree hints after native recompilation', async () => {
        await withExample({ 'model/catalog/presentation.sysml': source }, async (project, root) => {
            let current = project;
            const requests: (Omit<DiagramDTO, 'id' | 'auto'> & { elementIds: string[]; properties: Record<string, string> })[] = [
                { name: 'Goal diagram', diagramType: 'ucd', viewKind: 'general', viewpointId: 'memo_viewpoints_catalog::vpUseCase', elementIds: ['presentation::goal', 'presentation::child', 'presentation::team'], properties: { autoPopulate: 'false' } },
                { name: 'Function decomposition', diagramType: 'bdd', viewKind: 'general', viewpointId: 'memo_viewpoints_catalog::vpFunctionalArchitecture', elementIds: ['presentation::rootFunction', 'presentation::rootFunction::measure'], properties: { autoPopulate: 'false', layoutHint: 'tree', styleHint: 'expanded:presentation::rootFunction' } },
                { name: 'Behavior activity', diagramType: 'afd', viewKind: 'actionflow', viewpointId: 'memo_viewpoints_catalog::vpFunctionalFlow', elementIds: ['presentation::behavior', 'presentation::behavior::step'], properties: { autoPopulate: 'false' } },
            ];
            for (const request of requests) {
                const derived = deriveModelViews(current.model, current.registries!.kindRegistry!);
                const result = await writeViewDeclaration(root, modelToDTO(current.model, derived), request, selectedOutlineSource(root, config()));
                expect(result.success, result.reason).toBe(true);
                current = await loadProjectModel({ projectRoot: root, config: config(), cache: false });
                const rebuilt = deriveModelViews(current.model, current.registries!.kindRegistry!).diagrams.find(diagram => diagram.elementId === result.qualifiedName)!;
                expect(rebuilt.diagramType).toBe(request.diagramType); expect(rebuilt.viewKind).toBe(request.viewKind);
                expect(rebuilt.elementIds?.slice().sort()).toEqual(request.elementIds.slice().sort());
                if (request.properties.layoutHint) expect(rebuilt.properties).toMatchObject({ layoutHint: 'tree', styleHint: 'expanded:presentation::rootFunction' });
            }
            expect(current.model.relationships.some(edge => edge.type === 'includesStep' && edge.sourceId === 'presentation::goal' && edge.targetId === 'presentation::child')).toBe(true);
            expect(current.model.relationships.some(edge => edge.type === 'participatesIn' && edge.sourceId === 'presentation::team' && edge.targetId === 'presentation::goal')).toBe(true);
        });
    }, 180_000);
});
