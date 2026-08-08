// ─── memo standards check ─────────────────────────────────────────────────────
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
// entrypoint (model/catalog/project.sysml), never by a settings file. When
// there is no entrypoint — a bare ontology checkout, someone running this from
// the repo root — the command falls back to scanning the working directory and
// says which mode it used, the same graceful pattern `memo dhf lint` uses.
// ─────────────────────────────────────────────────────────────────────────────

import chalk from 'chalk';
import {
    parseFiles, buildMemoModel, loadOntologyRegistries, loadProjectSettings, findProjectRoot,
    loadStandardsLibrary, computeStandardsReport, filterStandardsReport,
    readDeclaredRegimes, collectDocumentClauses,
    type StandardsReport, type StandardRow, type BuilderRegistries, type MemoModel,
} from '@memoarchitect/tools';
import { findSysmlFiles } from '../model/sysml-files.js';
import { loadDhfDocs } from '../server/dhf-doc-store.js';

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

    let registries: BuilderRegistries | undefined;
    let ontologyDirs: string[] = [];
    try {
        const loaded = await loadOntologyRegistries(root);
        if (loaded.fileCount > 0) {
            registries = loaded.registries;
            ontologyDirs = (loaded.resolution?.selectedRoots ?? []).map(r => r.sysmlDir);
        }
    } catch {
        // A report without resolved kinds still has a library and a set of
        // ConformsTo edges; the evidence closure degrades, which is stated.
    }

    const files = findSysmlFiles(root).filter(f => !ontologyDirs.some(dir => f.startsWith(dir)));
    if (files.length === 0) return { model: undefined, registries, projectRoot: root, native: !!projectRoot };

    const { documents, errors } = await parseFiles(files, root + '/');
    const model = buildMemoModel(documents, config, errors, registries);
    return { model, registries, projectRoot: root, native: !!projectRoot };
}

// ─── The report, for anything that needs it ───────────────────────────────────

/**
 * Compute the clause coverage report for a loaded project.
 *
 * Shared with `memo dhf export`, so a ```memo-standards``` block in a document
 * and the `memo standards check` table are the same computation. A second
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
    const declared = readDeclaredRegimes(args.model);
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

// ─── memo standards check ─────────────────────────────────────────────────────

export async function standardsCheckCommand(options: StandardsCheckOptions = {}): Promise<void> {
    const cwd = process.cwd();
    const { model, registries, projectRoot, native } = await loadProjectModel(cwd);

    const declared = readDeclaredRegimes(model);
    const flagged = (options.regime ?? []).filter(Boolean);

    const full = buildStandardsReport({ model, registries, projectRoot, regimeOverride: flagged });
    const report = filterStandardsReport(full, {
        standard: options.standard,
        gapsOnly: options.gapsOnly,
    });

    if (options.json) {
        console.log(JSON.stringify(report, null, 2));
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
        `Project: ${ctx.projectRoot}${ctx.native ? '' : ' (no model/catalog/project.sysml — scanned the working directory)'}`));
    if (!ctx.modelPresent) {
        console.log(chalk.yellow(
            'No .sysml files found: nothing claims anything, so every clause below is a gap.'));
    }

    // Which regimes, and where they came from. A report scoped to a market the
    // reader did not expect is worse than one that says it is scoped to none.
    if (report.regimes.length > 0) {
        const origin = report.regimeSource === 'flag' ? '--regime' : 'ProjectMethodBinding';
        console.log(chalk.gray(`Regimes: ${report.regimes.join(', ')} (from ${origin})`));
    } else {
        console.log(chalk.yellow(
            'Regimes: none declared. Every standard with regime standing is reported. '
            + 'Declare `regulatoryRegime` on the ProjectMethodBinding to scope this to your submission.'));
    }
    console.log('');

    for (const entry of ctx.unknownFlags) {
        console.log(chalk.yellow(
            `  ⚠ --regime ${entry} names no RegulatoryRegimeKind member. Known: ${report.regimeVocabulary.join(', ')}`));
    }
    for (const entry of ctx.declaredRejected) {
        console.log(chalk.yellow(
            `  ⚠ regulatoryRegime entry "${entry}" is not a qualified member and was ignored. `
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
