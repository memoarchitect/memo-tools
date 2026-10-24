// ─── memo validate --standards ─────────────────────────────────────────────────────
//
// The clause coverage report: what the project's declared regimes require,
// what it claims, and what it can show evidence for.
//
// This is a REPORT, not a rule. `memo_rules_coverage` is an empty package whose
// header says why — coverage is project-profile dependent, and a universal
// per-element constraint would oblige every project to implement every standard
// pack. A gap here is the normal state of a project in flight, not a defect in
// its model, and it exits 0 unless asked otherwise.
//
// Model loading follows `memo validate`: a project is found by its native
// entrypoint (model/methodology/project.sysml), never by a settings file. When
// there is no entrypoint — a bare ontology checkout, someone running this from
// the repo root — the command falls back to scanning the working directory and
// says which mode it used, the same graceful pattern `memo-architect dhf lint` uses.
// ─────────────────────────────────────────────────────────────────────────────

import chalk from 'chalk';
import {
    loadProjectSettings, findProjectRoot,
    loadStandardsLibrary, computeStandardsReport, filterStandardsReport,
    readDeclaredRegimes, collectDocumentClauses,
    type StandardsReport, type StandardRow, type BuilderRegistries, type MemoModel,
} from '@memoarchitect/tools';
import { loadProjectModel as loadSelectedModel } from '../toolchain/project-model.js';
import { loadDhfDocs } from '../server/dhf-doc-store.js';
import { loadContext as loadRulesContext } from './rules.js';
import { computeRuleClauseCoverage, type RuleClauseCoverage } from '../validator/rule-clauses.js';

export interface StandardsCheckOptions {
    /** Substring of a designation: `--standard 62304`. */
    standard?: string;
    /** Regimes to scope the report to, overriding the project's declaration. */
    regime?: string[];
    /** Show only clauses nothing claims. */
    gapsOnly?: boolean;
    /** Emit the report as JSON for CI and for the Architect. */
    json?: boolean;
}

// ─── Model loading ────────────────────────────────────────────────────────────

async function loadProjectModel(cwd: string): Promise<{
    model: MemoModel | undefined;
    registries: BuilderRegistries | undefined;
    projectRoot: string;
    native: boolean;
}> {
    const projectRoot = findProjectRoot(cwd);
    const root = projectRoot ?? cwd;
    const config = loadProjectSettings(root);
    // A project is loaded as every command loads it, from the selected
    // compiler. A bare directory has no entrypoint to compile: there is no
    // model then, and the report is the library alone.
    if (projectRoot) {
        const { model, registries } = await loadSelectedModel({ projectRoot, config });
        return { model, registries, projectRoot, native: true };
    }
    return { model: undefined, registries: undefined, projectRoot: root, native: false };
}

// ─── The report, for anything that needs it ───────────────────────────────────

/**
 * Compute the clause coverage report for a loaded project.
 *
 * Shared with `memo-architect dhf export`, so a ```memo-standards``` block in a document
 * and the `memo validate --standards` table are the same computation. A second
 * implementation is how the hand-written matrix and the real coverage drifted
 * apart in the first place.
 */
export function buildStandardsReport(args: {
    model?: MemoModel;
    registries?: BuilderRegistries;
    projectRoot: string;
    /** Regimes from a flag; the project's own declaration wins when absent. */
    regimeOverride?: string[];
}): StandardsReport {
    const library = loadStandardsLibrary(args.projectRoot);
    const declared = readDeclaredRegimes(args.model, args.registries?.kindRegistry);
    const flagged = (args.regimeOverride ?? []).filter(Boolean);
    const regimes = flagged.length > 0 ? flagged : declared.regimes;

    return computeStandardsReport({
        library,
        model: args.model,
        kindRegistry: args.registries?.kindRegistry,
        regimes,
        regimeSource: flagged.length > 0 ? 'flag' : declared.regimes.length > 0 ? 'project' : 'none',
        documentClauses: collectDocumentClauses(
            loadDhfDocs(args.projectRoot).map(d => ({
                id: d.id, title: d.title, templateId: d.templateId, content: d.content,
            })),
            library,
        ),
    });
}

// ─── memo validate --standards ─────────────────────────────────────────────────────

export async function standardsCheckCommand(options: StandardsCheckOptions = {}): Promise<void> {
    const cwd = process.cwd();
    const { model, registries, projectRoot, native } = await loadProjectModel(cwd);

    const declared = readDeclaredRegimes(model, registries?.kindRegistry);
    const flagged = (options.regime ?? []).filter(Boolean);

    const full = buildStandardsReport({ model, registries, projectRoot, regimeOverride: flagged });
    const report = filterStandardsReport(full, {
        standard: options.standard,
        gapsOnly: options.gapsOnly,
    });

    // Which rules enforce which clauses. Only a compiler that builds the model
    // states the clauses and the rules' references to them, so under any other
    // there is nothing to report and the section says so.
    const ruleCoverage = native ? await ruleCoverageFor(projectRoot) : undefined;

    if (options.json) {
        console.log(JSON.stringify({ ...report, ruleCoverage: ruleCoverage ?? null }, null, 2));
        return;
    }

    printReport(report, {
        projectRoot, native, declaredRejected: declared.rejected,
        unknownFlags: flagged.filter(r => !report.regimeVocabulary.includes(r)),
        modelPresent: !!model,
        // Clause detail is what makes a narrowed report useful: "show me the
        // 24 IEC 62304 clauses nothing claims" is the actual question. The
        // unnarrowed report stays a summary, because ~110 clause lines is not
        // a status view.
        detail: !!options.gapsOnly || !!options.standard,
    });
    printRuleCoverage(ruleCoverage, !!options.standard ? options.standard : undefined);
}

// ─── Rules that enforce clauses ───────────────────────────────────────────────

/** The coverage of the library's clauses by the project's effective rules; undefined without clauses to cover. */
async function ruleCoverageFor(projectRoot: string): Promise<RuleClauseCoverage | undefined> {
    let context: Awaited<ReturnType<typeof loadRulesContext>>;
    try {
        context = await loadRulesContext(projectRoot);
    } catch {
        return undefined;
    }
    if (context.clauseFacts.length === 0) return undefined;
    return computeRuleClauseCoverage(context.clauseFacts, context.effectiveRules);
}

function printRuleCoverage(coverage: RuleClauseCoverage | undefined, standard?: string): void {
    console.log(chalk.bold('Rules that enforce clauses\n'));
    if (!coverage) {
        console.log(chalk.gray(
            '  Not available: rules name their clauses in the compiled model, and the selected compiler\n'
            + '  does not build one (or the project did not compile).\n'));
        return;
    }
    const domains = Object.entries(coverage.byDomain).map(([name, count]) => `${count} ${name}`).join(', ');
    console.log(chalk.gray(`  Rules by domain: ${domains}\n`));
    console.log(chalk.bold('  Standard                          Clauses  Enforced by a rule'));
    console.log(chalk.gray('  ' + '─'.repeat(58)));
    for (const row of coverage.standards) {
        if (standard && !row.designation.toLowerCase().includes(standard.toLowerCase())) continue;
        const label = row.designation.length > 33 ? row.designation.slice(0, 32) + '…' : row.designation;
        console.log(`  ${label.padEnd(34)}${String(row.clauses).padStart(7)}${String(row.enforced).padStart(20)}`);
        for (const clause of coverage.enforcedClauses.filter(c => c.standard === row.designation)) {
            const title = clause.title ? chalk.gray(` — ${clause.title}`) : '';
            console.log(`      §${clause.clauseNumber.padEnd(8)}${title}${chalk.gray(`  ← ${clause.rules.join(', ')}`)}`);
        }
    }
    // Not every rule traces to a standard: the ontology's modelling rules and a user's own rules need not.
    const ruleCount = coverage.tracedRules + coverage.untracedRules.length;
    console.log(chalk.gray(`\n  ${coverage.tracedRules} of ${ruleCount} rules name at least one clause; the other ${coverage.untracedRules.length} trace to no standard, which a rule need not.`));
    for (const unknown of coverage.unknownClauses) {
        console.log(chalk.red(`  ✖ ${unknown.ruleId} enforces ${unknown.clause}, which the model does not carry.`));
    }
    console.log('');
}

// ─── Rendering ────────────────────────────────────────────────────────────────

interface PrintContext {
    projectRoot: string;
    native: boolean;
    declaredRejected: string[];
    unknownFlags: string[];
    modelPresent: boolean;
    detail: boolean;
}

function printReport(report: StandardsReport, ctx: PrintContext): void {
    console.log(chalk.bold('\nMEMO Standards Check\n'));

    if (report.libraryMissing) {
        console.error(chalk.red(
            'No standards library found. The clause packs ship with @memoarchitect/ontology '
            + 'under src/artifacts/standards/ — install the ontology package, or run this from '
            + 'an ontology checkout.\n'));
        process.exitCode = 1;
        return;
    }

    console.log(chalk.gray(
        `Project: ${ctx.projectRoot}${ctx.native ? '' : ' (no model/methodology/project.sysml — scanned the working directory)'}`));
    if (!ctx.modelPresent) {
        console.log(chalk.yellow(
            'No .sysml files found: nothing claims anything, so every clause below is a gap.'));
    }

    // Which regimes, and where they came from. A report scoped to a market the
    // reader did not expect is worse than one that says it is scoped to none.
    if (report.regimes.length > 0) {
        const origin = report.regimeSource === 'flag' ? '--regime' : 'RegulatedDevice';
        console.log(chalk.gray(`Regimes: ${report.regimes.join(', ')} (from ${origin})`));
    } else {
        console.log(chalk.yellow(
            'Regimes: none declared. Every standard with regime standing is reported. '
            + 'Declare a `RegulatedDevice` with a jurisdiction for each approval to scope this to your submission.'));
    }
    console.log('');

    for (const entry of ctx.unknownFlags) {
        console.log(chalk.yellow(
            `  ⚠ --regime ${entry} names no RegulatoryRegimeKind member. Known: ${report.regimeVocabulary.join(', ')}`));
    }
    for (const entry of ctx.declaredRejected) {
        console.log(chalk.yellow(
            `  ⚠ jurisdiction "${entry}" is not a qualified member and was ignored. `
            + `Write RegulatoryRegimeKind::${entry}.`));
    }
    for (const bad of report.unknownRegimes) {
        console.log(chalk.red(
            `  ✖ ${bad.designation} declares appliesToRegime = ${bad.raw} (${bad.reason}) — pack defect.`));
    }
    for (const orphan of report.orphanClauses) {
        console.log(chalk.red(
            `  ✖ clause ${orphan.clauseNumber} (${orphan.name}) composes into no standard — pack defect.`));
    }
    if (report.unknownRegimes.length + report.orphanClauses.length > 0) console.log('');

    printTable(report.standards, ctx);

    if (report.standards.length > 0) {
        const t = report.totals;
        console.log(chalk.gray('  ' + '─'.repeat(62)));
        console.log(
            `  ${'Total'.padEnd(34)}${String(t.clauses).padStart(7)}${String(t.claimed).padStart(9)}`
            + `${String(t.evidenced).padStart(11)}${gapCell(t.gaps)}`);
    }

    if (report.unrequired.length > 0) {
        console.log(chalk.bold('\n  Not required by the declared regimes'));
        console.log(chalk.gray(
            '  Method and reference standards no regime mandates, and packs outside the'
            + '\n  declared regimes. Clauses claimed here are still traceability; they are not gaps.\n'));
        printTable(report.unrequired, ctx);
    }

    if (ctx.detail) printClauseDetail(report.standards);

    console.log('');
}

const STATUS_CELL: Record<string, string> = {
    evidenced: chalk.green('evidenced'),
    claimed: chalk.yellow('claimed  '),
    gap: chalk.red('gap      '),
};

function printClauseDetail(rows: StandardRow[]): void {
    for (const row of rows) {
        if (row.clauses.length === 0) continue;
        console.log(chalk.bold(`\n  ${row.designation}`));
        for (const clause of row.clauses) {
            // A clause with no scope phrase prints its number alone. Two packs
            // ship without phrases on purpose — MEMO has no verified reading of
            // what those clause numbers govern, and a guessed label is a
            // citation nobody can check.
            const title = clause.title ? chalk.gray(` — ${clause.title}`) : '';
            const claim = clause.claimants.length > 0
                ? chalk.gray(`  ← ${clause.claimants.map(c => c.name).join(', ')}`)
                : clause.documents.length > 0
                    ? chalk.gray(`  ← ${clause.documents.map(d => d.documentTitle).join(', ')}`)
                    : '';
            console.log(`    ${STATUS_CELL[clause.status]}  §${clause.clauseNumber.padEnd(10)}${title}${claim}`);
        }
    }
}

function printTable(rows: StandardRow[], ctx: PrintContext): void {
    if (rows.length === 0) {
        console.log(chalk.gray('  (no standards match)\n'));
        return;
    }
    console.log(chalk.bold('  Standard                          Clauses  Claimed  Evidenced  Gaps'));
    console.log(chalk.gray('  ' + '─'.repeat(62)));
    for (const row of rows) {
        const label = row.designation.length > 33
            ? row.designation.slice(0, 32) + '…'
            : row.designation;
        // An unrequired standard has no gaps to report: nothing obliges the
        // project to claim its clauses, so a count there would read as debt
        // the project does not owe.
        const gaps = row.required ? gapCell(row.totals.gaps) : chalk.gray('     —');
        console.log(
            `  ${label.padEnd(34)}${String(row.totals.clauses).padStart(7)}`
            + `${String(row.totals.claimed).padStart(9)}${String(row.totals.evidenced).padStart(11)}`
            + gaps);
    }
}

function gapCell(gaps: number): string {
    const text = String(gaps).padStart(6);
    return gaps === 0 ? chalk.green(text) : chalk.yellow(text);
}
