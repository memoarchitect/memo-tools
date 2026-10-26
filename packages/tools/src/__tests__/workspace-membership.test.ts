import { describe, expect, it } from 'vitest';
import { ElementIndex } from '../model/element-index.js';
import { modelToDTO } from '../model/semantic.js';
import { computeWorkspaceMembership, workspaceMembershipToDTO, type WorkspaceMembership } from '../model/workspace-membership.js';
import type { ProjectModel } from '../toolchain/project-model.js';
import { compiledExample, compilerConfigured, examplesPresent, withExample } from './helpers/compile-source.js';

// T2: which workspace holds each element, on the E0 test bed (robot-cell-family), whose
// expected placement is the oracle in plans/memo-model-product-project-structure.md §7.
// Written from the oracle before the closure was run, then amended where the oracle
// was silent (the constituent-system slots and the ICD ends); E0's chain became a workflow realizing the clinical use case.

const membership = (project: ProjectModel): WorkspaceMembership =>
    computeWorkspaceMembership(project.model, project.registries!);

/** `Owner::name` for an owned element, the name alone otherwise: the oracle's spelling. */
const label = (project: ProjectModel, id: string): string => {
    const element = project.model.elements.get(id)!;
    return element.owner ? `${project.model.elements.get(element.owner)!.shortName}::${element.shortName}` : element.shortName!;
};

const membersOf = (project: ProjectModel, result: WorkspaceMembership, rootName: string): string[] => {
    const workspace = result.workspaces.find(candidate => project.model.elements.get(candidate.root)!.shortName === rootName)!;
    return [...workspace.members].map(id => label(project, id)).sort();
};

describe.runIf(compilerConfigured && examplesPresent)('workspace membership on E0', () => {
    it('places every element as the oracle expects', async () => {
        const project = await compiledExample('robot-cell-family');
        const result = membership(project);

        expect(membersOf(project, result, 'NavigationSystem')).toEqual([
            'GraspEvent', 'GraspEventPort', 'NavigationSystem', 'NavigationSystem::safetyRelay',
            'NavigationSystem::mapEngine', 'NavigationSystem::pGraspEventIn', 'NavigationSystem::pPointCloudIn',
            'RobotPose', 'PointCloud', 'PointCloudPort', 'SafetyRelayModule', 'cellOperator',
            'fnBuildMap', 'fnTagGrasp', 'ucAcquireMap',
        ].sort());
        expect(membersOf(project, result, 'ManipulatorSystem')).toEqual([
            'GraspEvent', 'GraspEventPort', 'ManipulatorSystem', 'ManipulatorSystem::motionController',
            'ManipulatorSystem::gripperDrive', 'ManipulatorSystem::pGraspEventOut', 'cellOperator', 'fnExecuteGrasp', 'ucExecuteGrasp',
        ].sort());
        expect(membersOf(project, result, 'PerceptionSystem')).toEqual([
            'PointCloud', 'PointCloudPort', 'SafetyRelayModule', 'PerceptionSystem',
            'PerceptionSystem::sensorHub', 'PerceptionSystem::safetyRelay', 'PerceptionSystem::pPointCloudOut',
            'fnAcquirePointClouds', 'cellTechnician', 'ucRecordRun',
        ].sort());
        // The lab holds its constituent systems as parts but not their definitions, the two ICDs with
        // their ends, and the use case whose subject is the lab. The workflow that realizes the lab's use case comes in through
        // `realizesUseCase`, with its scenario and steps by ownership.
        expect(membersOf(project, result, 'RoboticCell')).toEqual([
            'GraspEventPort', 'ManipulationToNavigationIcd', 'ManipulationToNavigationIcd::consumer', 'ManipulationToNavigationIcd::provider',
            'PointCloudPort', 'RoboticCell', 'RoboticCell::manipulation', 'RoboticCell::navigation',
            'RoboticCell::perception', 'PerceptionToNavigationIcd', 'PerceptionToNavigationIcd::consumer',
            'PerceptionToNavigationIcd::provider', 'cellOperator', 'robotCell', 'cellTechnician', 'ucPerformPickAndPlace',
            'wfMapGuidedPick', 'scMapGuidedPick', 'stepAcquire', 'stepBuildMap', 'stepGrasp', 'stepTag',
        ].sort());
    }, 120_000);

    it('counts shared over systems only', async () => {
        const project = await compiledExample('robot-cell-family');
        const result = membership(project);
        expect(result.shared.map(id => label(project, id)).sort()).toEqual([
            'GraspEvent', 'GraspEventPort', 'PointCloud', 'PointCloudPort', 'SafetyRelayModule', 'cellOperator',
        ]);
        // The lab reaches cellTechnician and the clinical use case's participants, and neither makes it shared.
        expect(result.shared.map(id => label(project, id))).not.toContain('cellTechnician');
        expect(result.unresolvedTypes).toEqual([]);
    }, 120_000);

    it('has nothing Unassigned, and requires a system', async () => {
        const result = membership(await compiledExample('robot-cell-family'));
        expect(result.unassigned).toEqual([]);
        expect(result.missingSystem).toBe(false);
    }, 120_000);

    it('reports a model with no System definition as missing one', async () => {
        // E0 with its System and SystemOfSystems definitions taken out: no root, so no workspace and no implicit one.
        const project = await compiledExample('robot-cell-family');
        const elements = new ElementIndex();
        for (const element of project.model.elements.values()) {
            if (!(element.isDefinition && ['System', 'SystemOfSystems'].includes(element.kind))) elements.define(element);
        }
        const result = membership({ ...project, model: { ...project.model, elements } } as ProjectModel);
        expect(result.workspaces).toEqual([]);
        expect(result.missingSystem).toBe(true);
    }, 120_000);

    it('puts the hardware a logical component is allocated to in the same system, nothing nested', async () => {
        // The logical and the implementation structures stay separate and are joined by a typed allocation
        // (RealizedBy, the logical component as source). The hardware follows the logical component.
        const source = `package realized {
            private import memo_architecture_logical_structure::*;
            private import memo_architecture_implementation_hardware_structure::*;
            private import memo_architecture_realization_deployment::*;
            part workstation : HardwareAssembly;
            part def DemoSystem specializes System {
                part core : LogicalComponent;
                allocation coreOnWorkstation : RealizedBy allocate core to workstation;
            }
        }`;
        await withExample({ 'model/catalog/shared/realized.sysml': source }, project => {
            expect(project.model.relationships.filter(r => r.type === 'realizedBy').map(r => `${label(project, r.sourceId)} -> ${label(project, r.targetId)}`))
                .toEqual(['DemoSystem::core -> workstation']);
            const result = membership(project);
            expect(membersOf(project, result, 'DemoSystem')).toEqual(['DemoSystem', 'DemoSystem::core', 'workstation']);
            expect(result.unassigned).toEqual([]);
        }, 'robot-cell-family');
    }, 120_000);

    it('ships as plain JSON on the model DTO, enough to filter by a chosen workspace', async () => {
        const project = await compiledExample('robot-cell-family');
        const dto = modelToDTO(project.model, { workspaceMembership: workspaceMembershipToDTO(membership(project), project.model) });
        const shipped = JSON.parse(JSON.stringify(dto.workspaceMembership));
        expect(shipped.workspaces.map((w: { scope: string }) => w.scope).sort()).toEqual(['sos', 'system', 'system', 'system']);
        expect(shipped.workspaces.every((w: { name: string; root: string }) => w.name && w.root)).toBe(true);
        const root = (name: string) => shipped.workspaces.find((w: { root: string }) => w.root.endsWith(`::${name}`)).root;
        const inWorkspace = (name: string) => Object.keys(shipped.membership).filter(id => shipped.membership[id].includes(root(name))).map(id => label(project, id)).sort();
        expect(inWorkspace('ManipulatorSystem')).toContain('fnExecuteGrasp');
        expect(inWorkspace('ManipulatorSystem')).not.toContain('fnBuildMap');
        expect(shipped.shared.map((id: string) => label(project, id))).toContain('PointCloud');
        expect(shipped.missingSystem).toBe(false);
    }, 120_000);

    it('lists a seeded orphan as Unassigned and nothing else new', async () => {
        const orphan = 'package orphans { private import memo_architecture_logical_structure::*; part def StrayModule specializes LogicalComponent; }';
        await withExample({ 'model/catalog/shared/orphan.sysml': orphan }, project => {
            expect(membership(project).unassigned.map(id => label(project, id))).toContain('StrayModule');
            expect(membership(project).unassigned).toHaveLength(1);
        }, 'robot-cell-family');
    }, 120_000);

    it('resolves each usage to its definition, so a client never matches a type by name', async () => {
        const project = await compiledExample('robot-cell-family');
        const result = membership(project);
        const byLabel = (name: string) => [...project.model.elements.keys()].find(id => label(project, id) === name)!;
        // Lab -> its constituent slot -> the system definition -> a part of it -> that part's definition.
        const lab = project.model.elements.get(byLabel('robotCell'))!;
        expect(result.definitionOf.get(lab.id)).toBe(byLabel('RoboticCell'));
        expect(result.definitionOf.get(byLabel('RoboticCell::navigation'))).toBe(byLabel('NavigationSystem'));
        expect(result.definitionOf.get(byLabel('NavigationSystem::safetyRelay'))).toBe(byLabel('SafetyRelayModule'));
        expect(workspaceMembershipToDTO(result, project.model).definitionOf[byLabel('NavigationSystem::safetyRelay')]).toBe(byLabel('SafetyRelayModule'));
        // The clinical use case includes each system use case (the use-case grouping reads these edges).
        const includes = project.model.relationships.filter(r => r.type === 'includesStep')
            .map(r => `${label(project, r.sourceId)}>${label(project, r.targetId)}`).sort();
        expect(includes).toEqual([
            'ucPerformPickAndPlace>ucAcquireMap', 'ucPerformPickAndPlace>ucExecuteGrasp', 'ucPerformPickAndPlace>ucRecordRun',
        ]);
    }, 120_000);
});
