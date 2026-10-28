// ─── memo evaluate ───────────────────────────────────────────────────────────
//
// Evaluate the project's calculations and trade studies: each `calc` usage with the inputs it binds, and
// each `TradeStudy` scored over its alternatives. The calculations are the ontology's own (the roll-ups
// of time, cost and success), read from their bodies (analysis/calc); nothing here knows one.

import { resolve } from 'node:path';
import chalk from 'chalk';
import { loadProjectSettings } from '../model/config-loader.js';
import { findProjectRoot } from '../model/native-project.js';
import { defaultRegistry } from '../toolchain/default-registry.js';
import { withToolchainOverrides } from '../toolchain/schema.js';
import { loadProjectModel } from '../toolchain/project-model.js';
import { evaluateCalculations } from '../analysis/calc/calc-run.js';

export async function evaluateCommand(dir: string, options: Record<string, unknown> = {}): Promise<void> {
    const projectRoot = findProjectRoot(resolve(dir));
    if (!projectRoot) throw new Error('No MEMO project found. A project is located by the `entrypoint` in its `memo.package.yaml`.');
    const config = withToolchainOverrides(loadProjectSettings(projectRoot), options, defaultRegistry);
    const project = await loadProjectModel({ projectRoot, config });
    const report = evaluateCalculations(project);
    if (options.format === 'json') {
        console.log(JSON.stringify(report, null, 2));
    } else {
        if (report.calculations.length === 0 && report.studies.length === 0) console.log('The project declares no calculation and no trade study.');
        for (const calculation of report.calculations) {
            const line = `${calculation.name.padEnd(20)} ${calculation.calc.padEnd(20)} ${calculation.result}`;
            console.log(calculation.ok ? line : chalk.red(line));
        }
        for (const study of report.studies) {
            console.log(`\nTrade study ${study.name} (${study.objective || 'no objective'})`);
            if (!study.ok) { console.log(chalk.red(`  ${study.error}`)); continue; }
            for (const score of study.scores) console.log(`  ${score.alternative.padEnd(70)} ${score.score}${score.alternative === study.selected ? '  ← selected' : ''}`);
        }
    }
    if (report.calculations.some(c => !c.ok) || report.studies.some(s => !s.ok)) process.exitCode = 1;
}
