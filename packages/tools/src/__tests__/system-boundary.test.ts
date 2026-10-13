import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { computeWorkspaceMembership } from '../model/workspace-membership.js';
import { validateModel } from '../validator/rule-engine.js';
import { collectApiConstraints } from '../validator/constraint-loader-api.js';
import type { ProjectModel } from '../toolchain/project-model.js';
import { compilerConfigured, examplesPresent, withExample } from './helpers/compile-source.js';

// O16: a system does not reference another system or the system of systems from inside itself
// (CR-ONT-087). Seeded inside the mapping system's definition, so membership comes from ownership.
// E0's own system of systems references its systems everywhere and must stay silent.

const MAPPING = join(resolve(__dirname, '../../../../../memo/examples/ep-lab-family'), 'model/systems/mapping/mapping_system.sysml');
const RULE = 'CR-ONT-087';

/** The mapping system's file with `lines` added inside its definition and `imports` added to the package. */
const mapping = (imports: string, lines: string): Record<string, string> => ({
    'model/systems/mapping/mapping_system.sysml': readFileSync(MAPPING, 'utf8')
        .replace('private import ep_lab_family_shared::*;', `private import ep_lab_family_shared::*;\n    ${imports}`)
        .replace('allocate fnBuildMap to mapEngine;', `allocate fnBuildMap to mapEngine;\n        ${lines}`),
});

function findings(project: ProjectModel, withMembership = true): string[] {
    const membership = withMembership ? computeWorkspaceMembership(project.model, project.registries!) : undefined;
    const result = validateModel(project.model, collectApiConstraints(project.api), project.registries!.kindRegistry,
        undefined, undefined, undefined, membership);
    return result.violations.filter(v => v.ruleId === RULE).map(v => v.elementName).sort();
}

describe.runIf(compilerConfigured && examplesPresent)('system boundary rule (O16)', () => {
    it('is in the rule set', async () => {
        await withExample({}, project => expect(collectApiConstraints(project.api).map(c => c.id)).toContain(RULE), 'ep-lab-family');
    }, 180_000);

    it('finds nothing in E0, whose system of systems references each of its systems', async () => {
        await withExample({}, project => expect(findings(project)).toEqual([]), 'ep-lab-family');
    }, 180_000);

    it('flags a part typed by another system', async () => {
        await withExample(mapping('private import ep_lab_family_ablation::*;', 'part generator : AblationGeneratorSystem;'),
            project => expect(findings(project)).toEqual(['generator']), 'ep-lab-family');
    }, 180_000);

    it('flags a relationship from inside the system to the system of systems', async () => {
        await withExample(mapping('private import ep_lab_family_sos::*;', 'allocate fnBuildMap to epLab;'),
            project => expect(findings(project)).toEqual(['Build Activation Map']), 'ep-lab-family');
    }, 180_000);

    it('judges nothing without a membership, and says so rather than passing', async () => {
        await withExample(mapping('private import ep_lab_family_ablation::*;', 'part generator : AblationGeneratorSystem;'),
            project => expect(findings(project, false)).toEqual([]), 'ep-lab-family');
    }, 180_000);
});
