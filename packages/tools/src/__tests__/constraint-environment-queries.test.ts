import { describe, expect, it } from 'vitest';
import { compilerConfigured, modelFromSources } from './helpers/compile-source.js';
import { createQueryContext } from '../dhf/query-engine.js';
import { executeQuery, parseMemoQuery } from '../dhf/query-executor.js';
import type { CompletenessReport, ValidationResult } from '../validator/types.js';

// ─── "All constraints" and "all environment" are memo-query blocks ───────────
//
// No query form of their own: the same `memo-query` a DHF template uses, over elements that now
// include native constraints. `construct:` and `owner:` are fields a block can filter and show.
// ─────────────────────────────────────────────────────────────────────────────

const SRC = `package P {
    private import ScalarValues::*;
    action def Dose { in rate : Real; assert constraint rateRange { rate >= 0 and rate <= 10 } }
    action fnDose : Dose;
    action fnLog;
    state def Operating { do fnLog; }
    state machine { state off; state on { do fnLog; } }
    state def Standby;
    requirement def DoseLimit { subject d : Dose; }
    constraint def Range { in x : Real; x >= 0 }
}`;

const validation: ValidationResult = { violations: [], rulesEvaluated: 0, rulesPassed: 0, rulesVacuous: 0, timestamp: 0 };
const completeness: CompletenessReport = { layers: [], overall: 100, totalElements: 0, completeElements: 0, elementStatus: {} };

async function run(block: string): Promise<string[]> {
    const model = await modelFromSources([{ source: SRC, filePath: 'p.sysml' }], { asGiven: true });
    const ctx = createQueryContext(model, validation, completeness, { modelName: 'Test' });
    return executeQuery(parseMemoQuery(block)!, ctx).map(row => (row as { id: string }).id).sort();
}

describe.runIf(compilerConfigured)('querying constraints and environment', () => {
    it('lists every native constraint, with the element that holds it', async () => {
        expect(await run('where: construct == "constraint"')).toEqual(['P::Dose::rateRange', 'P::Range']);
        expect(await run('where: owner == "P::Dose"')).toEqual(['P::Dose::rateRange']);
    }, 120_000);

    it('lists requirements, which constrain a function by satisfying it or having it as subject', async () => {
        expect(await run('where: construct == "requirement"')).toEqual(['P::DoseLimit']);
    }, 120_000);

    it('lists the states a project declares', async () => {
        expect(await run('where: construct == "state"')).toEqual(['P::Operating', 'P::Standby', 'P::machine', 'P::machine::off', 'P::machine::on']);
    }, 120_000);

    it('lists the functions available in a state, from the state that performs them', async () => {
        const model = await modelFromSources([{ source: SRC, filePath: 'p.sysml' }], { asGiven: true });
        const ctx = createQueryContext(model, validation, completeness, { modelName: 'Test' });
        const rows = executeQuery(parseMemoQuery('select: relationships\nkind: performs\nwhere: source.construct == "state"')!, ctx)
            .map(row => { const r = row as { sourceId: string; targetId: string }; return `${r.sourceId} -> ${r.targetId}`; }).sort();
        expect(rows).toEqual(['P::Operating -> P::fnLog', 'P::machine::on -> P::fnLog']);
    }, 120_000);
});
