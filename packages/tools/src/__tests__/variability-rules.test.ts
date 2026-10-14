import { describe, expect, it } from 'vitest';
import { selectRelease } from '../model/variability.js';
import { collectApiConstraints } from '../validator/constraint-loader-api.js';
import { validateModel } from '../validator/rule-engine.js';
import type { ProjectModel } from '../toolchain/project-model.js';
import { compilerConfigured, examplesPresent, withExample } from './helpers/compile-source.js';
import { variabilityFiles } from './helpers/variability-fixture.js';

// O14: the release rules, each on a seeded bad example. The unmodified fixture is clean for all
// three (false findings), and each bad seed fires exactly one rule.

const RULES = ['CR-ONT-088', 'CR-ONT-089', 'CR-ONT-090'] as const;

const edit = (file: string, from: string, to: string) => (files: Record<string, string>) => {
    expect(files[file], `seed anchor in ${file}: ${from}`).toContain(from);
    files[file] = files[file].replace(from, to);
};
const RELEASES = 'model/sos/releases.sysml';
const FEATURES = 'model/shared/features.sysml';
const OPTIONS = 'model/systems/ablation/output_options.sysml';

/** The records each release rule flags, in a seeded copy of the fixture. */
async function flagged(seed: ((files: Record<string, string>) => void)[] = []): Promise<Record<string, string[]>> {
    const files = variabilityFiles();
    seed.forEach(apply => apply(files));
    return withExample(files, project => {
        const result = validateModel(project.model, collectApiConstraints(project.api), project.registries!.kindRegistry);
        const out: Record<string, string[]> = {};
        for (const rule of RULES) out[rule] = result.violations.filter(v => v.ruleId === rule)
            .map(v => project.model.elements.get(v.elementId)?.shortName ?? v.elementId).sort();
        checkAgainstSelectRelease(project, out['CR-ONT-090']);
        return out;
    }, 'ep-lab-family');
}

/**
 * CR-ONT-090 and `selectRelease` are one definition of "selected": they agree on every record.
 * A record is flagged when any point has two selected variants, or, when it is approved or released,
 * when it leaves a point of its item unresolved.
 */
function checkAgainstSelectRelease(project: ProjectModel, flaggedByRule: string[]) {
    const records = [...project.model.elements.values()].filter(e => e.kind === 'ReleaseRecord');
    const judged = (status: string | undefined) => status === 'ElementStatusKind::approved' || status === 'ElementStatusKind::released';
    const byCode = records.filter(r => {
        const selection = selectRelease(project.model, r.id);
        return selection.points.some(p => p.selected.length > 1) || (judged(r.attributes?.status as string | undefined) && selection.unresolved.length > 0);
    }).map(r => r.shortName).sort();
    expect(flaggedByRule).toEqual(byCode);
}

const silent = { 'CR-ONT-088': [], 'CR-ONT-089': [], 'CR-ONT-090': [] };

describe.runIf(compilerConfigured && examplesPresent)('release rules (O14)', () => {
    it('flags nothing on a consistent family', async () => {
        expect(await flagged()).toEqual(silent);
    }, 120_000);

    it('CR-ONT-088: a released record cannot select a feature whose variant is proposed', async () => {
        expect(await flagged([edit(RELEASES, 'attribute :>> status = ElementStatusKind::draft;', 'attribute :>> status = ElementStatusKind::released;')]))
            .toEqual({ ...silent, 'CR-ONT-088': ['relUs'] });
    }, 120_000);

    it('CR-ONT-089: a selected feature needs the features it requires', async () => {
        expect(await flagged([edit(RELEASES, '#SelectsFeature dependency from relUs to featUsMarket, featIrrigatedTip;', '#SelectsFeature dependency from relUs to featIrrigatedTip;')]))
            .toEqual({ ...silent, 'CR-ONT-089': ['relUs'] });
    }, 120_000);

    it('CR-ONT-089: two selected features cannot exclude each other', async () => {
        expect(await flagged([
            edit(FEATURES, 'connection euExcludesUs', 'part featSterile : ProductFeature;\n    connection sterileExcludesEu : ExcludesFeature connect firstFeature ::> featSterile to secondFeature ::> featEuMarket;\n    connection euExcludesUs'),
            edit(RELEASES, '#SelectsFeature dependency from relEu to featEuMarket;', '#SelectsFeature dependency from relEu to featEuMarket, featSterile;'),
        ])).toEqual({ ...silent, 'CR-ONT-089': ['relEu'] });
    }, 120_000);

    it('CR-ONT-090: one variation point cannot have two selected variants', async () => {
        expect(await flagged([
            edit(FEATURES, 'connection euExcludesUs : ExcludesFeature connect firstFeature ::> featEuMarket to secondFeature ::> featUsMarket;', ''),
            edit(OPTIONS, 'attribute :>> status = ElementStatusKind::proposed;', 'attribute :>> status = ElementStatusKind::approved;'),
            edit(RELEASES, '#SelectsFeature dependency from relEu to featEuMarket;', '#SelectsFeature dependency from relEu to featEuMarket, featUsMarket;'),
        ])).toEqual({ ...silent, 'CR-ONT-090': ['relEu'] });
    }, 120_000);

    // The exactly-one half: the item's variation points are resolved by an approved or released record.
    // `relEu` is released and a release of OutputStageSystem, whose one point has an EU and a US variant.
    const SELECTS_NOTHING = [
        edit(FEATURES, 'connection irrigatedTipNeedsUs', 'part featSterile : ProductFeature;\n    connection irrigatedTipNeedsUs'),
        edit(RELEASES, '#SelectsFeature dependency from relEu to featEuMarket;', '#SelectsFeature dependency from relEu to featSterile;'),
    ];
    // A second point inside a variant, whose variants realize features of their own.
    const nested = (owner: 'euOutput' | 'usOutput') => [
        edit(FEATURES, 'connection irrigatedTipNeedsUs', 'part featFilterA : ProductFeature;\n    part featFilterB : ProductFeature;\n    connection irrigatedTipNeedsUs'),
        edit(OPTIONS, `variant part ${owner} : LogicalComponent {`, `variant part ${owner} : LogicalComponent {
                variation part stageFilter : LogicalComponent {
                    variant part filterA : LogicalComponent;
                    variant part filterB : LogicalComponent;
                }`),
        edit(OPTIONS, '    }\n}\n', `    }
}
package ep_lab_family_ablation_filter_features {
    private import memo_architecture_variability::*;
    private import ep_lab_family_features::*;
    private import ep_lab_family_ablation_options::*;
    #RealizesFeature dependency from OutputStageSystem::outputStage::${owner}::stageFilter::filterA to featFilterA;
    #RealizesFeature dependency from OutputStageSystem::outputStage::${owner}::stageFilter::filterB to featFilterB;
}
`),
    ];

    it('CR-ONT-090: a released record that selects none of its item\'s variants leaves the point unresolved', async () => {
        expect(await flagged(SELECTS_NOTHING)).toEqual({ ...silent, 'CR-ONT-090': ['relEu'] });
    }, 120_000);

    it('CR-ONT-090: a draft record may leave a point unresolved', async () => {
        expect(await flagged([
            ...SELECTS_NOTHING,
            edit(RELEASES, 'attribute :>> status = ElementStatusKind::released;', 'attribute :>> status = ElementStatusKind::draft;'),
        ])).toEqual(silent);
    }, 120_000);

    it('CR-ONT-090: a point whose variants realize no feature is not the record\'s to resolve', async () => {
        expect(await flagged([
            edit(OPTIONS, '        #RealizesFeature dependency from outputStage::euOutput', `        variation part cableStage : LogicalComponent {
            variant part shortCable : LogicalComponent;
            variant part longCable : LogicalComponent;
        }
        #RealizesFeature dependency from outputStage::euOutput`),
        ])).toEqual(silent);
    }, 120_000);

    it('CR-ONT-090: a point inside a variant the record does not select is not in its product', async () => {
        expect(await flagged(nested('usOutput'))).toEqual(silent);
    }, 120_000);

    it('CR-ONT-090: a point inside a selected variant is judged', async () => {
        expect(await flagged(nested('euOutput'))).toEqual({ ...silent, 'CR-ONT-090': ['relEu'] });
    }, 120_000);

    it('CR-ONT-090: a record with no item is judged only for two variants of one point', async () => {
        expect(await flagged([
            ...SELECTS_NOTHING,
            edit(RELEASES, '    #ReleaseOf dependency from relEu to OutputStageSystem;\n', ''),
        ])).toEqual(silent);
    }, 120_000);
});
