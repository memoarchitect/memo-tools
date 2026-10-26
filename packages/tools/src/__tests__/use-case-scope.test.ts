import { describe, expect, it } from 'vitest';
import { validateModel } from '../validator/rule-engine.js';
import { collectApiConstraints } from '../validator/constraint-loader-api.js';
import type { ProjectModel } from '../toolchain/project-model.js';
import { compilerConfigured, examplesPresent, withExample } from './helpers/compile-source.js';

// O8: a use case is at the level of its subject. A use case whose subject is the system of systems
// includes at least one use case whose subject is a system (CR-ONT-085). Seeded on E0, whose own
// use cases are all well formed: its clinical use case includes the three system use cases.

const RULES = ['CR-ONT-085'];

const IMPORTS = `
    private import memo_core_common::*;
    private import memo_core_common::MemoIdentity;
    private import memo_core_enumerations::*;
    private import memo_architecture_operational_use_cases::*;
    private import robot_cell_family_shared::*;
    private import robot_cell_family_sos::*;
    private import robot_cell_family_systems_manipulation_manipulation_system::*;`;

const sosUseCase = `package seeded_sos_use_case {${IMPORTS}
    use case ucPlanProcedure : UseCase {
        @MemoIdentity { :>> providedId = "RCF-UC-099"; :>> label = "Plan Procedure"; }
        attribute :>> useCaseKind = UseCaseKind::clinical;
        subject :>> supportingSystem = robotCell;
    }
}`;

/** Which rule fires, as `rule:element name`. */
function findings(project: ProjectModel): string[] {
    const result = validateModel(project.model, collectApiConstraints(project.api), project.registries!.kindRegistry);
    return result.violations.filter(v => RULES.includes(v.ruleId)).map(v => `${v.ruleId}:${v.elementName}`).sort();
}

describe.runIf(compilerConfigured && examplesPresent)('use case scope rule (O8)', () => {
    it('is a rule in the rule set', async () => {
        await withExample({}, project => {
            const ids = collectApiConstraints(project.api).map(c => c.id);
            for (const rule of RULES) expect(ids).toContain(rule);
        }, 'robot-cell-family');
    }, 180_000);

    it('find nothing wrong with E0, whose clinical use case includes each system use case', async () => {
        await withExample({}, project => expect(findings(project)).toEqual([]), 'robot-cell-family');
    }, 180_000);

    it('flag a use case of the system of systems that includes no system use case', async () => {
        await withExample({ 'model/catalog/sos/seeded.sysml': sosUseCase },
            project => expect(findings(project)).toEqual(['CR-ONT-085:Plan Procedure']), 'robot-cell-family');
    }, 180_000);
});
