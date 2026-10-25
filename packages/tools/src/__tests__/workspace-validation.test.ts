import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { computeWorkspaceMembership, selectWorkspace } from '../model/workspace-membership.js';
import { createQueryContext } from '../dhf/query-engine.js';
import { validateModel } from '../validator/rule-engine.js';
import { collectApiConstraints } from '../validator/constraint-loader-api.js';
import type { ProjectModel } from '../toolchain/project-model.js';
import { compiledExample, compilerConfigured, examplesPresent, withExample } from './helpers/compile-source.js';

// T3: `memo validate --workspace`. Rules run on a workspace's elements over the WHOLE model.
// E0 has no safety-critical function and no verification case, so the cases are seeded here:
// the perception system verifies its own critical function and the manipulator's critical
// function has no test. The perception system's test must not stand in for the manipulator's.

const E0 = resolve(__dirname, '../../../../../memo/examples/robot-cell-family');
const CLI_PATH = join(__dirname, '../../lib/bin/memo.js');
const RULE = 'CR-ONT-040';

const seeded = (): Record<string, string> => {
    const perception = readFileSync(join(E0, 'model/systems/perception/perception_system.sysml'), 'utf8')
        .replace('private import memo_architecture_operational_use_cases::*;',
            'private import memo_architecture_operational_use_cases::*;\n    private import memo_assurance_verification_validation::*;')
        .replace('attribute :>> outputDescription = "Filtered, timestamped point clouds";',
            `attribute :>> outputDescription = "Filtered, timestamped point clouds";
        attribute :>> criticality = CriticalityKind::high;
    }
    verification vcPointCloudFidelity : VerificationCase {
        @MemoIdentity { :>> providedId = "RCF-PER-VC-001"; :>> label = "Verify PointCloud Fidelity"; }
        attribute :>> methodKind = MemoVerificationMethodKind::test;
        attribute :>> acceptanceCriteria = "matches the injected reference signal";
        subject verified : Base::Anything[*] = (fnAcquirePointClouds);`);
    const manipulation = readFileSync(join(E0, 'model/systems/manipulation/manipulation_system.sysml'), 'utf8')
        .replace('and the event that records it";', 'and the event that records it";\n        attribute :>> criticality = CriticalityKind::high;');
    return {
        'model/systems/perception/perception_system.sysml': perception,
        'model/systems/manipulation/manipulation_system.sysml': manipulation,
    };
};

const nameOf = (project: ProjectModel, id: string) => project.model.elements.get(id)?.shortName ?? id;

/** The names the safety-critical-function rule flags, whole model or in one workspace. */
function flagged(project: ProjectModel, workspace?: string, override?: { foreign: ReadonlySet<string> }): string[] {
    const membership = computeWorkspaceMembership(project.model, project.registries!);
    let scope;
    if (workspace) {
        const selection = selectWorkspace(project.model, membership, workspace);
        if (!selection.ok) throw new Error(selection.message);
        scope = override ? { ...selection.scope, ...override } : selection.scope;
    }
    const result = validateModel(
        project.model, collectApiConstraints(project.api), project.registries!.kindRegistry, undefined, undefined, scope);
    return result.violations.filter(v => v.ruleId === RULE).map(v => nameOf(project, v.elementId)).sort();
}

describe.runIf(compilerConfigured && examplesPresent)('memo validate --workspace (T3)', () => {
    it("runs rules on one workspace's elements over the whole model", async () => {
        await withExample(seeded(), project => {
            expect(flagged(project)).toEqual(['fnExecuteGrasp']);
            expect(flagged(project, 'ManipulatorSystem')).toEqual(['fnExecuteGrasp']);
            // The perception system's own critical function is verified, and the manipulator's gap is not its finding.
            expect(flagged(project, 'PerceptionSystem')).toEqual([]);
            expect(flagged(project, 'NavigationSystem')).toEqual([]);
        }, 'robot-cell-family');
    }, 180_000);

    it("does not count another system's test as evidence", async () => {
        await withExample(seeded(), project => {
            // The test is the perception system's, and it also verifies the manipulator's function here.
            // Closure puts a test into every workspace of what it verifies, so it is shared and counts:
            const sharedTest = [...project.model.elements.values()].find(e => e.shortName === 'vcPointCloudFidelity')!;
            expect(sharedTest).toBeDefined();
            // Deleting nothing and adding the edge by hand would test the closure, not the filter. The
            // filter is tested on its own: with the test marked foreign, no edge to it is evidence.
            const withEdge = { ...project.model };
            const rel = { sourceId: [...project.model.elements.values()].find(e => e.shortName === 'fnExecuteGrasp')!.id,
                targetId: sharedTest.id, type: 'verifiedBy' } as any;
            withEdge.outgoing = new Map(project.model.outgoing).set(rel.sourceId, [...(project.model.outgoing.get(rel.sourceId) ?? []), rel]);
            withEdge.incoming = new Map(project.model.incoming).set(rel.targetId, [...(project.model.incoming.get(rel.targetId) ?? []), rel]);
            const withEdgeProject = { ...project, model: withEdge };
            // Whole model, and a workspace that does not treat the test as foreign: the edge satisfies the rule.
            expect(flagged(withEdgeProject, 'ManipulatorSystem', { foreign: new Set() })).toEqual([]);
            // The same workspace with the test foreign: the edge is not evidence, so the gap is found.
            expect(flagged(withEdgeProject, 'ManipulatorSystem', { foreign: new Set([sharedTest.id]) })).toEqual(['fnExecuteGrasp']);
        }, 'robot-cell-family');
    }, 180_000);

    it('names the choices for an unknown workspace, and refuses a model without a System', async () => {
        const e0 = await compiledExample('robot-cell-family');
        const membership = computeWorkspaceMembership(e0.model, e0.registries!);
        const unknown = selectWorkspace(e0.model, membership, 'nope');
        expect(unknown).toMatchObject({ ok: false });
        expect((unknown as { message: string }).message).toMatch(/Manipulator System \(system\)/);
        // The example declares a System now; take its definition away to get a model without one.
        const none = await withExample({ 'model/catalog/nested_architecture_dsm_system.sysml': 'package memo_examples_nested_architecture_dsm_system {}' },
            dsm => selectWorkspace(dsm.model, computeWorkspaceMembership(dsm.model, dsm.registries!), 'anything'), 'nested-architecture-dsm');
        expect(none).toMatchObject({ ok: false });
        expect((none as { message: string }).message).toMatch(/declares no System/);
    }, 180_000);

    it('requires the model to declare a System (CR-ONT-084)', async () => {
        const fires = (project: ProjectModel) =>
            validateModel(project.model, collectApiConstraints(project.api), project.registries!.kindRegistry)
                .violations.some(v => v.ruleId === 'CR-ONT-084');
        expect(fires(await compiledExample('robot-cell-family'))).toBe(false);
        expect(fires(await compiledExample('nested-architecture-dsm'))).toBe(false);
        // Without its System definition the same model fires the rule.
        expect(await withExample({ 'model/catalog/nested_architecture_dsm_system.sysml': 'package memo_examples_nested_architecture_dsm_system {}' },
            fires, 'nested-architecture-dsm')).toBe(true);
    }, 180_000);

    it('scopes the DHF query context to the workspace', async () => {
        const project = await compiledExample('robot-cell-family');
        const membership = computeWorkspaceMembership(project.model, project.registries!);
        const selection = selectWorkspace(project.model, membership, 'PerceptionSystem');
        if (!selection.ok) throw new Error(selection.message);
        const validation = { violations: [], rulesEvaluated: 0, rulesPassed: 0, rulesVacuous: 0, timestamp: 0 };
        const completeness = { overall: 0, completeElements: 0, totalElements: 0, layers: [] } as any;
        const make = (workspace?: typeof selection.scope) =>
            createQueryContext(project.model, validation, completeness, {} as any, undefined, workspace);
        expect(make().allElements().length).toBe(project.model.elements.size);
        const scoped = make(selection.scope);
        expect(scoped.allElements().map(e => e.id).sort()).toEqual([...selection.scope.subjects].sort());
        expect(scoped.totalElements()).toBe(selection.scope.subjects.size);
        // A function of another system is not listed, though the model holds it.
        expect(scoped.allElements().some(e => e.shortName === 'fnExecuteGrasp')).toBe(false);
        expect(scoped.element([...project.model.elements.values()].find(e => e.shortName === 'fnExecuteGrasp')!.id)).toBeDefined();
    }, 180_000);

    it('the CLI exits 1 on an unknown workspace and reports the workspace it ran', async () => {
        await withExample({}, (_project, root) => {
            const run = (...args: string[]) => spawnSync('node', [CLI_PATH, 'validate', root, '--no-server', ...args], {
                encoding: 'utf-8', env: { ...process.env, NO_COLOR: '1' },
            });
            const bad = run('--workspace', 'nope');
            expect(bad.status).toBe(1);
            expect(bad.stderr).toContain('no workspace is named "nope"');
            const good = run('--workspace', 'PerceptionSystem');
            expect(good.stdout + good.stderr).toContain('Workspace: Perception System (system)');
        }, 'robot-cell-family');
    }, 240_000);

    it("judges the elements no workspace holds in the system of systems' workspace", async () => {
        const orphan = 'package orphans { private import memo_architecture_logical_structure::*; part def StrayModule specializes LogicalComponent; }';
        await withExample({ 'model/shared/orphan.sysml': orphan }, project => {
            const membership = computeWorkspaceMembership(project.model, project.registries!);
            const stray = membership.unassigned[0];
            const lab = selectWorkspace(project.model, membership, 'RoboticCell');
            const manipulation = selectWorkspace(project.model, membership, 'ManipulatorSystem');
            if (!lab.ok || !manipulation.ok) throw new Error('workspace not found');
            expect(lab.scope.subjects.has(stray)).toBe(true);
            expect(manipulation.scope.subjects.has(stray)).toBe(false);
        }, 'robot-cell-family');
    }, 180_000);
});
