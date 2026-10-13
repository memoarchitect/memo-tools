import { describe, expect, it } from 'vitest';
import { computeWorkspaceMembership, type WorkspaceMembership } from '../model/workspace-membership.js';
import type { ProjectModel } from '../toolchain/project-model.js';
import { compiledExample, compilerConfigured, examplesPresent, withExample } from './helpers/compile-source.js';

// T2: which workspace holds each element, on the E0 test bed (ep-lab-family), whose
// expected placement is the oracle in plans/memo-model-product-project-structure.md §7.
// Written from the oracle before the closure was run, then amended where the oracle
// was silent (the constituent-system slots and the ICD ends) or wrong (the chain).

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
        const project = await compiledExample('ep-lab-family');
        const result = membership(project);

        expect(membersOf(project, result, 'CardiacMappingSystem')).toEqual([
            'AblationEvent', 'AblationEventPort', 'CardiacMappingSystem', 'CardiacMappingSystem::isolation',
            'CardiacMappingSystem::mapEngine', 'CardiacMappingSystem::pAblationEventIn', 'CardiacMappingSystem::pElectrogramIn',
            'CatheterLocation', 'Electrogram', 'ElectrogramPort', 'PatientIsolationModule', 'electrophysiologist',
            'fnBuildMap', 'fnTagLesion', 'ucAcquireMap',
        ].sort());
        expect(membersOf(project, result, 'AblationGeneratorSystem')).toEqual([
            'AblationEvent', 'AblationEventPort', 'AblationGeneratorSystem', 'AblationGeneratorSystem::energyController',
            'AblationGeneratorSystem::pAblationEventOut', 'electrophysiologist', 'fnDeliverEnergy', 'ucDeliverEnergy',
        ].sort());
        expect(membersOf(project, result, 'SignalRecordingSystem')).toEqual([
            'Electrogram', 'ElectrogramPort', 'PatientIsolationModule', 'SignalRecordingSystem',
            'SignalRecordingSystem::acquisitionUnit', 'SignalRecordingSystem::isolation', 'SignalRecordingSystem::pElectrogramOut',
            'fnAcquireElectrograms', 'labTechnician', 'ucRecordProcedure',
        ].sort());
        // The lab holds its constituent systems as parts but not their definitions, the two ICDs with
        // their ends, and the use case whose subject is the lab. The chain is not here: see below.
        expect(membersOf(project, result, 'ElectrophysiologyLab')).toEqual([
            'AblationEventPort', 'AblationToMappingIcd', 'AblationToMappingIcd::consumer', 'AblationToMappingIcd::provider',
            'ElectrogramPort', 'ElectrophysiologyLab', 'ElectrophysiologyLab::ablation', 'ElectrophysiologyLab::mapping',
            'ElectrophysiologyLab::recording', 'RecordingToMappingIcd', 'RecordingToMappingIcd::consumer',
            'RecordingToMappingIcd::provider', 'electrophysiologist', 'epLab', 'labTechnician', 'ucPerformCatheterAblation',
        ].sort());
    }, 120_000);

    it('counts shared over systems only', async () => {
        const project = await compiledExample('ep-lab-family');
        const result = membership(project);
        expect(result.shared.map(id => label(project, id)).sort()).toEqual([
            'AblationEvent', 'AblationEventPort', 'Electrogram', 'ElectrogramPort', 'PatientIsolationModule', 'electrophysiologist',
        ]);
        // The lab reaches labTechnician and the clinical use case's participants, and neither makes it shared.
        expect(result.shared.map(id => label(project, id))).not.toContain('labTechnician');
        expect(result.unresolvedTypes).toEqual([]);
    }, 120_000);

    it('leaves a chain nothing links as the one Unassigned finding', async () => {
        // `performs` places neither end and the steps subset the functions without an edge, so the chain is
        // tied to no use case and no system. That is what the diagnostic is for; methodology elements are excluded.
        const project = await compiledExample('ep-lab-family');
        expect(membership(project).unassigned.map(id => label(project, id)).sort()).toEqual([
            'fcMapGuidedAblation', 'stepAcquire', 'stepBuildMap', 'stepDeliver', 'stepTag',
        ]);
    }, 120_000);

    it('lists a seeded orphan as Unassigned and nothing else new', async () => {
        const orphan = 'package orphans { private import memo_architecture_logical_structure::*; part def StrayModule specializes LogicalComponent; }';
        await withExample({ 'model/shared/orphan.sysml': orphan }, project => {
            expect(membership(project).unassigned.map(id => label(project, id))).toContain('StrayModule');
            expect(membership(project).unassigned).toHaveLength(6);
        }, 'ep-lab-family');
    }, 120_000);
});
