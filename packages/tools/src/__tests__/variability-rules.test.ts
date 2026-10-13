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

/** CR-ONT-090 and `selectRelease` are one definition of "selected": they agree on every record. */
function checkAgainstSelectRelease(project: ProjectModel, flaggedByRule: string[]) {
    const records = [...project.model.elements.values()].filter(e => e.kind === 'ReleaseRecord');
    const byCode = records.filter(r => selectRelease(project.model, r.id).points.some(p => p.selected.length > 1)).map(r => r.shortName).sort();
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
});
