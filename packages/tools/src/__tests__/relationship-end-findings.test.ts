import { describe, it, expect, beforeAll } from 'vitest';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadOntologyRegistries } from '../model/ontology-loader.js';
import { findProjectRoot } from '../model/native-project.js';
import { buildMemoModel, RELATIONSHIP_END_KIND } from '../model/builder.js';
import { loadProjectSettings } from '../model/config-loader.js';
import { parseText } from '../model/parser-utils.js';
import type { BuilderRegistries } from '../model/builder.js';

// ─── A relationship whose end is the wrong kind is a finding someone reads ───
//
// The builder checked every edge's ends against the kinds its definition
// types them with and put each failure in `model.errors` — where no command
// looked, because `memo validate` reported the parse errors it had passed in.
// Surfaced on 2026-09-25 they were 72 findings in three shipped examples, all
// at `1:1` of their file, with no code to tell them from a parse error.
//
// The fixes these pin: the finding carries a code and the edge's own line, and
// the risk chain gpca-pump could not previously write is now expressible —
// a risk is estimated for a harm, reduced by a control, evaluated in the
// overall residual-risk evaluation — while TracesRisk still refuses a risk.
// ─────────────────────────────────────────────────────────────────────────────

const GPCA_PROJECT = resolve(__dirname, '../../../../../memo/examples/gpca-pump');
const available = existsSync(GPCA_PROJECT);
let registries: BuilderRegistries;
let settings: ReturnType<typeof loadProjectSettings>;

beforeAll(async () => {
    if (!available) return;
    const root = findProjectRoot(GPCA_PROJECT)!;
    const loaded = await loadOntologyRegistries(root);
    registries = { ...loaded.registries, provenance: loaded.provenance };
    settings = loadProjectSettings(root);
}, 120_000);

const DECLARATIONS = `package p {
    private import memo_assurance_safety_risk::*;
    item harm : Harm;
    part risk : Risk;
    part residual : ResidualRisk;
    part control : RiskControlMeasure;
    part evaluation : OverallResidualRiskEvaluation;
`;

async function findings(edges: string) {
    const { document, errors } = await parseText(`${DECLARATIONS}${edges}\n}\n`);
    expect(errors).toEqual([]);
    const model = buildMemoModel([{ document, filePath: 'p.sysml' }], settings, [], registries);
    return model.errors.filter(e => e.code === RELATIONSHIP_END_KIND);
}

describe('relationship end-kind findings', () => {
    it('accept the ISO 14971 links from a risk to its chain', async () => {
        if (!available) return;
        expect(await findings([
            '    connection : EstimatedFor connect risk ::> risk to riskElement ::> harm;',
            '    connection : ReducedBy connect residualRisk ::> residual to control ::> control;',
            '    connection : EvaluatedIn connect residualRisk ::> residual to evaluation ::> evaluation;',
        ].join('\n'))).toEqual([]);
    });

    it('type those links, so a reversed one is a finding and the acceptance above is not vacuous', async () => {
        if (!available) return;
        const found = await findings(
            '    connection : EstimatedFor connect risk ::> harm to riskElement ::> risk;');
        expect(found.map(f => f.message).join('\n')).toMatch(/"estimatedFor" expects risk to be Risk/);
    });

    it('still refuse a risk as a link in the chain, with a code and the edge\'s line', async () => {
        if (!available) return;
        const found = await findings([
            '    // a comment line, so the edge is not on the line after the declarations',
            '    connection : TracesRisk connect sourceRiskElement ::> harm to targetRiskElement ::> risk;',
        ].join('\n'));
        expect(found).toHaveLength(1);
        expect(found[0].message).toContain('found Risk');
        // DECLARATIONS is 7 lines; the comment is 8, the edge 9.
        expect(found[0].line).toBe(9);
    });
});
