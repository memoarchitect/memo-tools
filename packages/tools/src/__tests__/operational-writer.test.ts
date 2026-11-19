import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { writeOperationalWork } from '../server/operational-writer.js';
import { modelToDTO } from '../model/semantic.js';
import { operationalLevels } from '../model/operational-level.js';
import { computeWorkspaceMembership, workspaceMembershipToDTO } from '../model/workspace-membership.js';
import { selectedOutlineSource } from '../authoring/outline-source.js';
import { loadProjectModel } from '../toolchain/project-model.js';
import { operationalWorkLevel, type OperationalWriteContext } from '../model/operational-work.js';
import { functionalFlowSteps } from '../model/functional-work.js';
import { layoutBlindRevision } from '../model/view-layout-block.js';
import { compilerConfigured, examplesPresent, withExample } from './helpers/compile-source.js';
const file = 'model/catalog/operational_authoring.sysml';
const source = `package operational_authoring {
    private import memo::*;
    part def ControllerSystem specializes System;
    part controller : ControllerSystem;
    part def DisplaySystem specializes System;
    part display : DisplaySystem;
    part careTeam : OperationalEntity;
    action rootFunction : SystemFunction { action monitor : SystemFunction; action monitorFlow : FunctionalFlow { action monitorHere :> rootFunction.monitor; } }
    #memo_architecture_functional_functions::FunctionalRoot dependency from ControllerSystem to rootFunction;
}`;
const config = () => ({ toolchain: { compiler: process.env.MEMO_TOOLCHAIN_COMPILER } }) as any;
function dto(project: Awaited<ReturnType<typeof loadProjectModel>>) {
    return modelToDTO(project.model, { registries: { kinds: project.registries!.kindRegistry!.toDefinitionDTOs(), relationships: [] }, operationalLevels: operationalLevels(project.model, project.registries!.kindRegistry!),
        workspaceMembership: workspaceMembershipToDTO(computeWorkspaceMembership(project.model, project.registries!), project.model) });
}
describe.runIf(compilerConfigured && examplesPresent)('guided operational authoring', () => {
    it('creates both hierarchies, includes use cases, and connects system activities to clinical work and functional behavior', async () => {
        await withExample({ [file]: source }, async (project, root) => {
            let current = dto(project);
            const workspace = 'operational_authoring::ControllerSystem';
            const outlines = selectedOutlineSource(root, config());
            const write = async (context: Omit<OperationalWriteContext, 'workspace'>, name = '') => {
                const result = await writeOperationalWork(root, current, { workspace, ...context }, name, outlines, file);
                expect(result.success, result.error).toBe(true);
                current = dto(await loadProjectModel({ projectRoot: root, config: config(), cache: false }));
                return result.elementId!;
            };
            const clinical = await write({ operation: 'use-case', level: 'clinical', subjectId: 'operational_authoring::careTeam' }, 'Assess condition');
            const clinicalWorkflow = await write({ operation: 'workflow', level: 'clinical', useCaseId: clinical }, 'Assessment work');
            const clinicalScenario = await write({ operation: 'scenario', level: 'clinical', workflowId: clinicalWorkflow }, 'Normal assessment');
            const clinicalStep = await write({ operation: 'step', level: 'clinical', scenarioId: clinicalScenario }, 'Observe condition');
            const systemCase = await write({ operation: 'use-case', level: 'operational', subjectId: workspace }, 'Monitor condition');
            const workflow = await write({ operation: 'workflow', level: 'operational', useCaseId: systemCase }, 'Monitoring work');
            const scenario = await write({ operation: 'scenario', level: 'operational', workflowId: workflow, fields: { preCondition: 'Ready to monitor', postCondition: 'Condition recorded' } }, 'Normal monitoring');
            const step = await write({ operation: 'step', level: 'operational', scenarioId: scenario }, 'Read signal');
            const second = await write({ operation: 'step', level: 'operational', scenarioId: scenario }, 'Report signal');
            expect(functionalFlowSteps(current, scenario).steps.map(item => item.step.id)).toEqual([step, second]);
            await write({ operation: 'sequence', level: 'operational', scenarioId: scenario, stepIds: [second, step] });
            expect(functionalFlowSteps(current, scenario).steps.map(item => item.step.id)).toEqual([second, step]);
            expect(current.elements[scenario].attributes.preCondition).toBe('Ready to monitor');
            await write({ operation: 'fields', level: 'operational', sourceId: scenario, fields: { preCondition: 'Patient ready', trigger: 'A reading is due', doc: 'The usual monitoring path.' } });
            expect(current.elements[scenario].attributes).toMatchObject({ preCondition: 'Patient ready', trigger: 'A reading is due', postCondition: 'Condition recorded' });
            expect(current.elements[scenario].doc).toContain('The usual monitoring path.');
            expect(functionalFlowSteps(current, scenario).steps.map(item => item.step.id)).toEqual([second, step]);
            await write({ operation: 'fields', level: 'operational', sourceId: scenario, fields: { trigger: '' } });
            expect(current.elements[scenario].attributes.trigger).toBeUndefined();
            await write({ operation: 'fields', level: 'operational', sourceId: step, fields: { doc: 'Read the sensor.' } });
            expect(current.elements[step].doc).toContain('Read the sensor.');
            const refused = await writeOperationalWork(root, current, { workspace, operation: 'fields', level: 'operational', sourceId: scenario, fields: { entryCondition: 'x' } }, '', outlines, file);
            expect(refused.success).toBe(false);
            await write({ operation: 'refine', level: 'operational', sourceId: step, targetId: clinicalStep });
            await write({ operation: 'perform-function', level: 'operational', sourceId: step, targetId: 'operational_authoring::rootFunction::monitor' });
            await write({ operation: 'realize-flow', level: 'operational', sourceId: step, targetId: 'operational_authoring::rootFunction::monitorFlow' });
            await write({ operation: 'performer', level: 'operational', sourceId: step, performerId: 'operational_authoring::controller', relatedSourceHashes: { [file]: layoutBlindRevision(readFileSync(join(root, file), 'utf8')) } });
            const childCase = await write({ operation: 'use-case', level: 'operational', useCaseId: systemCase, subjectId: 'operational_authoring::DisplaySystem' }, 'Review status');
            expect(current.relationships.some(edge => edge.type === 'includesStep' && edge.sourceId === systemCase && edge.targetId === childCase)).toBe(true);
            expect(current.relationships.some(edge => edge.type === 'realizesUseCase' && edge.sourceId === workflow && edge.targetId === systemCase)).toBe(true);
            expect(current.relationships.some(edge => edge.type === 'realizes' && edge.sourceId === 'operational_authoring::rootFunction::monitorFlow' && edge.targetId === step)).toBe(true);
            expect(current.relationships.some(edge => edge.type === 'performs' && edge.sourceId === step && edge.targetId === 'operational_authoring::rootFunction::monitor')).toBe(true);
            expect(operationalWorkLevel(current, clinicalStep)).toBe('clinical'); expect(operationalWorkLevel(current, step)).toBe('operational');
            expect(current.workspaceMembership!.membership[scenario]).toContain(workspace);
            expect(current.workspaceMembership!.membership[clinicalScenario] ?? []).not.toContain(workspace);
            const before = readFileSync(join(root, file), 'utf8');
            const cycle = await writeOperationalWork(root, current, { operation: 'include', level: 'operational', workspace: 'operational_authoring::DisplaySystem', sourceId: childCase, targetId: systemCase }, '', outlines, file);
            expect(cycle.success).toBe(false); expect(cycle.error).toContain('cycle');
            expect(current.workspaceMembership!.membership[childCase]).not.toContain(workspace);
            const recursive = await writeOperationalWork(root, current, { operation: 'reuse-step', level: 'operational', workspace, parentStepId: step, targetId: step }, '', outlines, file);
            expect(recursive.success).toBe(false);
            const invalid = await writeOperationalWork(root, current, { operation: 'perform-function', level: 'clinical', workspace, sourceId: clinicalStep, targetId: 'operational_authoring::rootFunction::monitor' }, '', outlines, file);
            expect(invalid.success).toBe(false);
            const crossLevel = await writeOperationalWork(root, current, { operation: 'link-workflow', level: 'operational', workspace, workflowId: workflow, useCaseId: clinical }, '', outlines, file);
            expect(crossLevel.success).toBe(false); expect(readFileSync(join(root, file), 'utf8')).toBe(before);
        });
    }, 240_000);
    it('edits a use case profile: its fields, its actors and the use cases it includes', async () => {
        await withExample({ [file]: source.replace('part careTeam : OperationalEntity;', 'part careTeam : OperationalEntity;\n    part nurse : User;') }, async (project, root) => {
            let current = dto(project); const workspace = 'operational_authoring::ControllerSystem'; const outlines = selectedOutlineSource(root, config());
            const write = async (context: Omit<OperationalWriteContext, 'workspace'>, name = '') => {
                const result = await writeOperationalWork(root, current, { workspace, ...context }, name, outlines, file);
                expect(result.success, result.error).toBe(true); current = dto(await loadProjectModel({ projectRoot: root, config: config(), cache: false })); return result.elementId!;
            };
            const nurse = 'operational_authoring::nurse';
            const goal = await write({ operation: 'use-case', level: 'operational', subjectId: workspace }, 'Monitor condition');
            const child = await write({ operation: 'use-case', level: 'operational', useCaseId: goal, subjectId: workspace }, 'Review status');
            await write({ operation: 'fields', level: 'operational', sourceId: goal, fields: { goalStatement: 'Keep the condition in view', doc: 'The monitoring goal.' } });
            expect(current.elements[goal].attributes.goalStatement).toBe('Keep the condition in view');
            expect(current.elements[goal].doc).toContain('The monitoring goal.');
            const notAField = await writeOperationalWork(root, current, { workspace, operation: 'fields', level: 'operational', sourceId: goal, fields: { expectedResult: 'x' } }, '', outlines, file);
            expect(notAField.success).toBe(false);
            await write({ operation: 'actor', level: 'operational', sourceId: goal, targetId: nurse });
            const actorEdge = () => current.relationships.some(edge => edge.type === 'participatesIn' && edge.sourceId === nurse && edge.targetId === goal);
            expect(actorEdge()).toBe(true);
            const system = await writeOperationalWork(root, current, { workspace, operation: 'actor', level: 'operational', sourceId: goal, targetId: 'operational_authoring::display' }, '', outlines, file);
            expect(system.success).toBe(false);
            await write({ operation: 'unlink', level: 'operational', sourceId: goal, targetId: nurse, relation: 'participatesIn' });
            expect(actorEdge()).toBe(false);
            await write({ operation: 'unlink', level: 'operational', sourceId: goal, targetId: child, relation: 'includesStep' });
            expect(current.relationships.some(edge => edge.type === 'includesStep' && edge.sourceId === goal && edge.targetId === child)).toBe(false);
            expect(current.elements[goal].attributes.goalStatement).toBe('Keep the condition in view');
        });
    }, 240_000);
    it('creates clinical context, preserves reused step identities and checks a cross-file performer edit', async () => {
        const other = 'model/catalog/operational_devices.sysml';
        const split = source.replace('part def ControllerSystem specializes System;', '').replace('part controller : ControllerSystem;', 'part controller : operational_devices::ControllerSystem;').replace('dependency from ControllerSystem to', 'dependency from operational_devices::ControllerSystem to');
        await withExample({ [file]: split, [other]: 'package operational_devices { private import memo::*; part def ControllerSystem specializes System; }' }, async (project, root) => {
            let current = dto(project); const workspace = 'operational_devices::ControllerSystem'; const outlines = selectedOutlineSource(root, config());
            const write = async (context: Omit<OperationalWriteContext, 'workspace'>, name = '') => {
                const result = await writeOperationalWork(root, current, { workspace, ...context }, name, outlines, file);
                expect(result.success, result.error).toBe(true); current = dto(await loadProjectModel({ projectRoot: root, config: config(), cache: false })); return result.elementId!;
            };
            const team = await write({ operation: 'context', level: 'clinical', homeId: 'operational_authoring::careTeam' }, 'Assessment team');
            const goal = await write({ operation: 'use-case', level: 'clinical', subjectId: team }, 'Assess readiness');
            const work = await write({ operation: 'workflow', level: 'clinical', useCaseId: goal }, 'Readiness analysis');
            const nominal = await write({ operation: 'scenario', level: 'clinical', workflowId: work }, 'Ready path');
            const step = await write({ operation: 'step', level: 'clinical', scenarioId: nominal }, 'Confirm readiness');
            const alternate = await write({ operation: 'scenario', level: 'clinical', workflowId: work, scenarioKind: 'alternate' }, 'Retry path');
            const reused = await write({ operation: 'reuse-step', level: 'clinical', scenarioId: alternate, targetId: step });
            expect(current.relationships.some(edge => edge.type === 'subsets' && edge.sourceId === reused && edge.targetId === step)).toBe(true);
            const systemCase = await write({ operation: 'use-case', level: 'operational', subjectId: 'operational_authoring::controller' }, 'Check readiness');
            const systemWork = await write({ operation: 'workflow', level: 'operational', useCaseId: systemCase }, 'Readiness check');
            const path = await write({ operation: 'scenario', level: 'operational', workflowId: systemWork }, 'Check path');
            const activity = await write({ operation: 'step', level: 'operational', scenarioId: path }, 'Read readiness');
            const before = readFileSync(join(root, file), 'utf8'); const otherBefore = readFileSync(join(root, other), 'utf8');
            const stale = await writeOperationalWork(root, current, { operation: 'performer', level: 'operational', workspace, sourceId: activity, performerId: workspace, relatedSourceHashes: { [other]: 'stale' } }, '', outlines, file);
            expect(stale.success).toBe(false); expect(readFileSync(join(root, other), 'utf8')).toBe(otherBefore); expect(readFileSync(join(root, file), 'utf8')).toBe(before);
            await write({ operation: 'performer', level: 'operational', sourceId: activity, performerId: workspace, relatedSourceHashes: { [other]: layoutBlindRevision(otherBefore) } });
            expect(current.relationships.some(edge => edge.type === 'performs' && edge.sourceId === workspace && edge.targetId === activity)).toBe(true);
        });
    }, 240_000);

});
