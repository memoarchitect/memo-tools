import { describe, expect, it } from 'vitest';
import { validateModel } from '../validator/rule-engine.js';
import { collectApiConstraints } from '../validator/constraint-loader-api.js';
import type { ProjectModel } from '../toolchain/project-model.js';
import { compilerConfigured, examplesPresent, withExample } from './helpers/compile-source.js';

// Operational levels (plan memo-operational-levels): a use case is at the level of its subject, and
// the rules CR-ONT-093..098 judge what each level may say. Each rule has a passing and a failing
// fixture, seeded into temperature-alarm, whose own model has no use case subject and no currency,
// so the rules find nothing in it before the seed.

const RULES = ['CR-ONT-093', 'CR-ONT-094', 'CR-ONT-095', 'CR-ONT-096', 'CR-ONT-097', 'CR-ONT-098'];

const IMPORTS = `
    private import ScalarValues::*;
    private import ModelingMetadata::*;
    private import memo_core_common::*;
    private import memo_core_common::MemoIdentity;
    private import memo_core_enumerations::*;
    private import memo_core_stdlib_quantities::*;
    private import memo_core_stdlib_money::*;
    private import memo_architecture_operational_structure::*;
    private import memo_architecture_operational_context_actors::*;
    private import memo_architecture_operational_use_cases::*;
    private import memo_architecture_operational_activities::*;
    private import memo_architecture_operational_workflows::*;
    private import memo_architecture_operational_scenarios::*;
    private import memo_architecture_logical_structure::*;
    private import memo_architecture_functional_functions::*;`;

/**
 * Level 1 (the care team) and level 2 (one platform), well formed: the level-1 step carries no
 * number, the level-2 activity refines it and carries them, the platform performs the activity and
 * the activity performs the function. `edit` is applied to the text to make one rule fail.
 */
const levels = (edit: (text: string) => string = text => text): string => edit(`package seeded_levels {${IMPORTS}
    part careTeam : OperationalEntity;
    part def PlatformX :> System;
    part platformX : PlatformX {
        perform actPouchX;
    }
    action fnStaple : SystemFunction;

    action stepPouch : OperativeAction;
    action actPouchX : OperativeAction {
        attribute :>> expectedDuration = 30 [min];
        attribute :>> plannedSuccessProbability = 0.9 [one];
        perform fnStaple;
    }

    use case ucL1 : UseCase {
        subject :>> supportingSystem = careTeam;
    }
    use case ucL2 : UseCase {
        subject :>> supportingSystem = platformX;
    }
    part wfL1 : OperationalWorkflow {
        action scL1 : OperativeScenario { perform stepPouch; }
    }
    part wfL2 : OperationalWorkflow {
        action scL2 : OperativeScenario { perform actPouchX; }
    }
    connection : RealizesUseCase connect realizingWorkflow ::> wfL1 to realizedUseCase ::> ucL1;
    connection : RealizesUseCase connect realizingWorkflow ::> wfL2 to realizedUseCase ::> ucL2;
    #refinement dependency actPouchX to stepPouch;
    attribute <EUR> euro : CurrencyUnit;
}`);

/** Which rule fires, as `rule:element name`. */
function findings(project: ProjectModel): string[] {
    const result = validateModel(project.model, collectApiConstraints(project.api), project.registries!.kindRegistry);
    return result.violations.filter(v => RULES.includes(v.ruleId)).map(v => `${v.ruleId}:${v.elementName}`).sort();
}

const seeded = (text: string) => ({ 'model/catalog/seeded_levels.sysml': text });

describe.runIf(compilerConfigured && examplesPresent)('operational level rules (CR-ONT-093..098)', () => {
    it('are rules in the rule set', async () => {
        await withExample({}, project => {
            const ids = collectApiConstraints(project.api).map(c => c.id);
            for (const rule of RULES) expect(ids).toContain(rule);
        });
    }, 180_000);

    it('find nothing wrong with two well formed levels', async () => {
        await withExample(seeded(levels()), project => expect(findings(project)).toEqual([]));
    }, 180_000);

    it('093 flags a use case whose subject is at neither level', async () => {
        const text = levels(t => t.replace('subject :>> supportingSystem = careTeam;', 'subject :>> supportingSystem = surgeon;')
            .replace('part careTeam : OperationalEntity;', 'part careTeam : OperationalEntity;\n    part surgeon : User;'));
        await withExample(seeded(text), project => expect(findings(project)).toEqual(['CR-ONT-093:ucL1']));
    }, 180_000);

    it('094 flags a level-1 step that carries a planned number', async () => {
        const text = levels(t => t.replace('action stepPouch : OperativeAction;', 'action stepPouch : OperativeAction { attribute :>> expectedDuration = 30 [min]; }'));
        await withExample(seeded(text), project => expect(findings(project)).toEqual(['CR-ONT-094:stepPouch']));
    }, 180_000);

    it('095 flags a level-1 step refined by something that is not level 2', async () => {
        const text = levels(t => t.replace('#refinement dependency actPouchX to stepPouch;',
            '#refinement dependency actPouchX to stepPouch;\n    action actOrphan : OperativeAction;\n    #refinement dependency actOrphan to stepPouch;'));
        await withExample(seeded(text), project => expect(findings(project)).toEqual(['CR-ONT-095:actOrphan']));
    }, 180_000);

    it('096 flags an activity an internal system performs that performs no function', async () => {
        const text = levels(t => t.replace('        perform fnStaple;\n', ''));
        await withExample(seeded(text), project => expect(findings(project)).toEqual(['CR-ONT-096:actPouchX']));
    }, 180_000);

    it('096 asks nothing of an external system', async () => {
        const text = levels(t => t.replace('        perform fnStaple;\n', '').replace('part platformX : PlatformX {', 'part platformX : PlatformX {\n        attribute :>> origin = SystemOriginKind::external;'));
        await withExample(seeded(text), project => expect(findings(project)).toEqual([]));
    }, 180_000);

    it('097 flags a function performed from a level-1 step', async () => {
        const text = levels(t => t.replace('action stepPouch : OperativeAction;', 'action stepPouch : OperativeAction { perform fnStaple; }'));
        await withExample(seeded(text), project => expect(findings(project)).toEqual(['CR-ONT-097:fnStaple']));
    }, 180_000);

    it('098 flags a project that declares two currencies', async () => {
        const text = levels(t => t.replace('attribute <EUR> euro : CurrencyUnit;', 'attribute <EUR> euro : CurrencyUnit;\n    attribute <USD> dollar : CurrencyUnit;'));
        await withExample(seeded(text), project => expect(findings(project).map(f => f.split(':')[0])).toEqual(['CR-ONT-098']));
    }, 180_000);
});
