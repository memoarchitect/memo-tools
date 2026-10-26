import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { readGuideSources } from '../stage2/guide-from-api.js';
import { checkSelectorVocabulary } from '../model/selector-vocabulary.js';
import { evaluateWorkspaceGuide } from '../methodology/guide-service.js';
import { collectApiConstraints } from '../validator/constraint-loader-api.js';
import type { ProjectModel } from '../toolchain/project-model.js';
import { compilerConfigured, examplesPresent, withExample } from './helpers/compile-source.js';
import { FAMILY_METHOD } from './guide-from-api.test.js';

// The Guide on E0 (the reference family) with the default method: what its systems of systems and
// systems have, step by step, and a family method that adds a step and is judged by an existing rule.

const E0 = resolve(__dirname, '../../../../../memo/examples/robot-cell-family');
const evaluate = (project: ProjectModel, workspace: string | undefined, packages = ['memo_methodology_profiles']) =>
    evaluateWorkspaceGuide({
        api: project.api, model: project.model, registries: project.registries!, constraints: collectApiConstraints(project.api),
        packages, workspace,
    });
const states = (result: ReturnType<typeof evaluate>) => Object.fromEntries(result.steps.map(s => [s.name.replace(/^step/, ''), s.state]));

describe.runIf(compilerConfigured && examplesPresent)('the Guide on a model (T10)', () => {
    it('reads the system of systems\' steps against E0: what is there is done, the rest waits behind it', async () => {
        await withExample({}, project => {
            const result = evaluate(project, 'RoboticCell');
            expect(result.error).toBeUndefined();
            expect(result.scope).toBe('sos');
            // E0's lab declares its systems, a clinical procedure and the workflow that realizes it; it has no
            // functional chain (the chain is a workflow) and no hazard. Its interfaces exist, so the architecture step
            // is done although the step before it is not: a step is judged by what it states, not by its place.
            expect(states(result)).toEqual({
                SosContext: 'done', SosOperational: 'done', SosFunctions: 'open', SosArchitecture: 'done', SosHazards: 'open',
            });
            expect(result.next).toBe('memo_methodology_profiles::stepSosFunctions');
            expect(result.steps.find(s => s.name === 'stepSosFunctions')!.reasons).toEqual(['no FunctionalFlow yet']);
            expect(result.steps.find(s => s.name === 'stepSosHazards')!.reasons).toEqual(['no Hazard yet', 'HazardMitigationRule has nothing to judge yet']);
        }, 'robot-cell-family');
    }, 180_000);

    it('reads one system\'s steps against its own elements, not the family\'s', async () => {
        await withExample({}, project => {
            const navigation = evaluate(project, 'NavigationSystem');
            expect(navigation.scope).toBe('system');
            expect(navigation.steps.every(s => s.level === 'system')).toBe(true);
            expect(states(navigation)).toMatchObject({ SysOperational: 'done', SysFunctional: 'done', SysLogical: 'done' });
            // The manipulator has no software of its own in E0, so its software step is open with nothing there.
            expect(states(evaluate(project, 'ManipulatorSystem')).SysSoftware).toBe('open');
        }, 'robot-cell-family');
    }, 180_000);

    it('says why when the workspace does not exist, and when the method has no steps', async () => {
        await withExample({}, project => {
            expect(evaluate(project, 'Nowhere').error).toMatch(/no workspace is named "Nowhere"/);
            expect(evaluate(project, undefined, ['no_such_package']).error).toMatch(/no steps/);
        }, 'robot-cell-family');
    }, 180_000);

    it('adds a family step through baseMethodology and judges it by an existing rule, per system', async () => {
        const perception = readFileSync(join(E0, 'model/catalog/systems/perception/perception_system.sysml'), 'utf8')
            .replace('private import memo_architecture_operational_use_cases::*;', 'private import memo_architecture_operational_use_cases::*;\n    private import memo_assurance_verification_validation::*;')
            .replace('attribute :>> outputDescription = "Filtered, timestamped point clouds";',
                `attribute :>> outputDescription = "Filtered, timestamped point clouds";
        attribute :>> criticality = CriticalityKind::high;
    }
    verification vcPointCloudFidelity : VerificationCase {
        @MemoIdentity { :>> providedId = "RCF-PER-VC-001"; :>> label = "Verify PointCloud Fidelity"; }
        attribute :>> methodKind = MemoVerificationMethodKind::test;
        attribute :>> acceptanceCriteria = "matches the injected reference signal";
        subject verified : Base::Anything[*] = (fnAcquirePointClouds);`);
        const manipulation = readFileSync(join(E0, 'model/catalog/systems/manipulation/manipulation_system.sysml'), 'utf8')
            .replace('and the event that records it";', 'and the event that records it";\n        attribute :>> criticality = CriticalityKind::high;');
        const method = FAMILY_METHOD
            .replace('#DoneWhen dependency from stepFamilyReview to NestedPartConnectedRule;', '#DoneWhen dependency from stepFamilyReview to SafetyCriticalFunctionVerifiedRule;')
            .replace('attribute :>> outputKinds = ("ReleaseRecord");', 'attribute :>> outputKinds = ();');
        await withExample({
            'model/catalog/systems/perception/perception_system.sysml': perception, 'model/catalog/systems/manipulation/manipulation_system.sysml': manipulation,
            'model/catalog/sos/family_method.sysml': method,
        }, project => {
            const packages = ['memo_methodology_profiles', 'robot_cell_family_method'];
            const review = (workspace: string) => evaluate(project, workspace, packages).steps.find(s => s.name === 'stepFamilyReview')!;
            // The perception system verifies its own critical function; the manipulator's has no test.
            expect(review('PerceptionSystem')).toMatchObject({ state: 'done', methodology: 'robot_cell_family_method' });
            // The manipulator's is not done, and it follows the base method's last step, which is not done either.
            expect(review('ManipulatorSystem')).toMatchObject({
                state: 'blocked', reasons: ['SafetyCriticalFunctionVerifiedRule: 1 finding(s)'],
                predecessors: ['memo_methodology_profiles::stepSysRelease'], blockedBy: ['memo_methodology_profiles::stepSysRelease'],
            });
        }, 'robot-cell-family');
    }, 180_000);

    it('names only kinds the ontology declares in the default method, and reports a family step that names one it does not', async () => {
        const method = FAMILY_METHOD.replace('attribute :>> outputKinds = ("ReleaseRecord");', 'attribute :>> outputKinds = ("ReleaseRecord", "Hazrd");');
        await withExample({ 'model/catalog/sos/family_method.sysml': method }, project => {
            const kinds = project.registries!.kindRegistry!;
            const defaults = readGuideSources(project.api, ['memo_methodology_profiles']).steps;
            expect(defaults.flatMap(s => [...s.inputKinds, ...s.outputKinds]).filter(kind => !kinds.has(kind))).toEqual([]);
            const found = checkSelectorVocabulary(project.model, { kindRegistry: kinds, relationshipRegistry: project.registries!.relationshipRegistry });
            expect(found.map(d => `${d.selector}: ${d.name}`)).toEqual(['outputKinds: Hazrd']);
        }, 'robot-cell-family');
    }, 180_000);
});
