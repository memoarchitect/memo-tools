// ─── memo conformance ────────────────────────────────────────────────────────
//
// Thin, like every command: the resolution and the comparison live in
// `conformance/`, which is the same implementation any other surface would
// call. This file marshals arguments, prints, and picks an exit code.
//
// Deliberately absent from `validate`, `dev`, `build` and Architect's refresh —
// see `conformance/run.ts`. It is a command you run, not a step something else
// runs for you.
// ─────────────────────────────────────────────────────────────────────────────

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import chalk from 'chalk';
import { findConfigFile, loadProjectSettings } from '../model/config-loader.js';
import { defaultRegistry } from '../toolchain/default-registry.js';
import { withToolchainOverrides } from '../toolchain/schema.js';
import {
    compareBnfBaseline,
    compareConformanceBaseline,
    compareDiffXmiBaseline,
    formatBaselineComparison,
    formatBnfCoverageReport,
    formatConformanceReport,
    formatDiffXmiReport,
    runBnfCoverage,
    runConformance,
    runDiffXmi,
    type BnfCoverageReport,
    type ConformanceReport,
    type DiffXmiReport,
} from '../conformance/index.js';
import { memoVersion } from '../version.js';
import { classifyConstraints } from '../validator/sysml-constraints.js';

export interface ConformanceCliOptions extends Record<string, unknown> {
    corpus?: string;
    unit?: string[];
    library?: string[];
    format?: 'text' | 'json';
    output?: string;
    /** A path, or `true` for the default location — `--baseline` takes an optional value. */
    baseline?: string | boolean;
    updateBaseline?: boolean;
    verify?: 'sources' | 'full' | 'skipped';
    dir?: string;
}

/**
 * Baselines live beside the corpus they were taken against.
 *
 * Not with the test fixtures: a baseline is only meaningful against one Release
 * pin, and keeping the two together means moving the pin puts the stale
 * baseline in the same diff. Neither is published — `files` in package.json is
 * an allowlist and lists neither.
 */
export function defaultBaselinePath(kind: 'run' | 'diff-xmi' | 'bnf'): string {
    return resolve(
        dirname(fileURLToPath(import.meta.url)),
        `../../../../corpus/baselines/${kind}.json`,
    );
}

/** `--baseline` may carry a path or nothing at all; both mean "gate on it". */
function baselinePath(options: ConformanceCliOptions, kind: 'run' | 'diff-xmi' | 'bnf'): string {
    return typeof options.baseline === 'string'
        ? resolve(options.baseline)
        : defaultBaselinePath(kind);
}

function loadFor(dir: string | undefined, options: Record<string, unknown>) {
    const projectDir = resolve(dir || process.cwd());
    const config = withToolchainOverrides(loadProjectSettings(projectDir), options, defaultRegistry);
    return { projectDir, config, settingsFile: findConfigFile(projectDir) };
}

function emit(text: string, json: unknown, options: ConformanceCliOptions): void {
    const payload = options.format === 'json' ? `${JSON.stringify(json, null, 2)}\n` : text;
    if (options.output) {
        mkdirSync(dirname(resolve(options.output)), { recursive: true });
        writeFileSync(resolve(options.output), payload);
        console.log(chalk.dim(`  written to ${options.output}`));
    } else {
        process.stdout.write(payload);
    }
}

/**
 * Compare against a baseline, or freeze a new one.
 *
 * Returns true when the caller should fail. A missing baseline is a failure
 * with an instruction, not a silent pass: "no baseline" and "baseline matched"
 * must never look the same in CI output.
 */
function gate<R>(
    report: R,
    path: string,
    update: boolean,
    compare: (baseline: R, current: R) => ReturnType<typeof compareConformanceBaseline>,
): boolean {
    if (update) {
        mkdirSync(dirname(path), { recursive: true });
        writeFileSync(path, `${JSON.stringify(report, null, 2)}\n`);
        console.log(chalk.yellow(`\n  baseline re-frozen at ${path} — review the diff before committing.\n`));
        return false;
    }
    if (!existsSync(path)) {
        console.error(chalk.red(`\n  No baseline at ${path}. Freeze one with --update-baseline.\n`));
        return true;
    }
    const comparison = compare(JSON.parse(readFileSync(path, 'utf-8')) as R, report);
    const text = formatBaselineComparison(comparison);
    const failed = !comparison.comparable || comparison.differences.length > 0;
    console.log(`\n  ${failed ? chalk.red(text) : chalk.green(text)}\n`);
    return failed;
}

export async function conformanceRunCommand(
    dir: string | undefined,
    options: ConformanceCliOptions = {},
): Promise<void> {
    const { projectDir, config } = loadFor(dir ?? options.dir, options);
    let report: ConformanceReport;
    try {
        report = await runConformance({
            config,
            projectDir,
            corpusDir: options.corpus,
            units: options.unit ?? [],
            registry: defaultRegistry,
            memoVersion: memoVersion(),
            verify: options.verify,
            onUnit: (unit, index, total) => {
                if (options.format !== 'json') {
                    console.error(chalk.dim(`  [${index + 1}/${total}] ${unit.id} (${unit.files.length} files)`));
                }
            },
        });
    } catch (error) {
        console.error(chalk.red(`\n  ${error instanceof Error ? error.message : String(error)}\n`));
        process.exitCode = 1;
        return;
    }

    emit(formatConformanceReport(report), report, options);

    if (options.baseline !== undefined || options.updateBaseline) {
        const path = baselinePath(options, 'run');
        if (gate(report, path, options.updateBaseline === true, compareConformanceBaseline)) {
            process.exitCode = 1;
        }
    }
}

export async function conformanceDiffXmiCommand(
    dir: string | undefined,
    options: ConformanceCliOptions = {},
): Promise<void> {
    const { projectDir, config } = loadFor(dir ?? options.dir, options);
    let report: DiffXmiReport;
    try {
        report = await runDiffXmi({
            config,
            projectDir,
            corpusDir: options.corpus,
            libraries: options.library ?? [],
            registry: defaultRegistry,
            memoVersion: memoVersion(),
            verify: options.verify !== 'skipped',
            onLibrary: (source, index, total) => {
                if (options.format !== 'json') {
                    console.error(chalk.dim(`  [${index + 1}/${total}] ${source}`));
                }
            },
        });
    } catch (error) {
        console.error(chalk.red(`\n  ${error instanceof Error ? error.message : String(error)}\n`));
        process.exitCode = 1;
        return;
    }

    emit(formatDiffXmiReport(report), report, options);

    if (options.baseline !== undefined || options.updateBaseline) {
        const path = baselinePath(options, 'diff-xmi');
        if (gate(report, path, options.updateBaseline === true, compareDiffXmiBaseline)) {
            process.exitCode = 1;
        }
    }
}

// ─── memo conformance bnf ────────────────────────────────────────────────────
//
// Grammar coverage against the normative textual BNF (Track B B5). Reads two
// files and one grammar; no toolchain, no corpus parse, so it is instant.

export interface BnfCliOptions extends ConformanceCliOptions {
    /** List the syntactic productions that have no rule. */
    missing?: boolean;
    /** Grammar to score; defaults to MEMO's own. */
    grammar?: string;
}

export async function conformanceBnfCommand(
    dir: string | undefined,
    options: BnfCliOptions = {},
): Promise<void> {
    let report: BnfCoverageReport;
    try {
        report = runBnfCoverage({
            corpusDir: options.corpus,
            grammarPath: options.grammar ? resolve(options.grammar) : undefined,
            memoVersion: memoVersion(),
        });
    } catch (error) {
        console.error(chalk.red(`\n  ${error instanceof Error ? error.message : String(error)}\n`));
        process.exitCode = 1;
        return;
    }

    emit(formatBnfCoverageReport(report, { missing: options.missing }), report, options);

    if (options.baseline !== undefined || options.updateBaseline) {
        const path = baselinePath(options, 'bnf');
        if (gate(report, path, options.updateBaseline === true, compareBnfBaseline)) {
            process.exitCode = 1;
        }
    }
}

// ─── memo conformance rules ──────────────────────────────────────────────────
//
// The B4 scoreboard: MEMO's reimplemented well-formedness constraints against
// the 151 codes Syside publishes. Reads the vendored checklist, so it needs no
// external tool (§1.3 rule 1).

export interface RulesCliOptions extends ConformanceCliOptions {
    /** List the codes with no implementation, and why. */
    missing?: boolean;
}

export async function conformanceRulesCommand(
    _dir: string | undefined,
    options: RulesCliOptions = {},
): Promise<void> {
    const score = classifyConstraints();

    if (options.format === 'json') {
        emit('', {
            sysideVersion: score.sysideVersion,
            total: score.total,
            implemented: score.implemented.map(constraint => ({
                code: constraint.code,
                clause: constraint.clause,
                appliesTo: constraint.appliesTo,
                ...(constraint.limitation ? { limitation: constraint.limitation } : {}),
            })),
            byReason: score.byReason,
            unpublished: score.unpublished,
            unimplemented: score.unimplemented,
        }, options);
        return;
    }

    const lines: string[] = [''];
    lines.push(`checklist         ${score.sysideVersion}`);
    lines.push('');
    lines.push(`implemented       ${String(score.implemented.length).padStart(4)} / ${score.total}`);
    lines.push(`blocked           ${String(score.byReason.blocked).padStart(4)}   needs the resolution core or a workspace index (B3, B5)`);
    lines.push(`not yet written   ${String(score.byReason['not-yet']).padStart(4)}`);
    lines.push(`out of scope      ${String(score.byReason['out-of-scope']).padStart(4)}`);
    lines.push('');
    for (const constraint of score.implemented) {
        lines.push(`  ${constraint.code.padEnd(38)} ${constraint.clause}`);
        if (constraint.limitation) lines.push(chalk.yellow(`  ${' '.repeat(38)} partial — ${constraint.limitation}`));
    }
    if (score.unpublished.length > 0) {
        // A code MEMO invented is a §5.1.2 violation, not a bonus rule.
        lines.push('');
        lines.push(chalk.red(`  ${score.unpublished.length} implemented code(s) Syside does not publish: ${score.unpublished.join(', ')}`));
    }
    if (options.missing) {
        lines.push('');
        lines.push(`Not implemented (${score.unimplemented.length}):`);
        for (const entry of score.unimplemented) {
            lines.push(`  ${entry.code.padEnd(58)} ${entry.reason.padEnd(12)} ${entry.detail}`);
        }
    }
    lines.push('');
    emit(lines.join('\n'), score, options);
    if (score.unpublished.length > 0) process.exitCode = 1;
}
