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
    compareConformanceBaseline,
    compareDiffXmiBaseline,
    formatBaselineComparison,
    formatConformanceReport,
    formatDiffXmiReport,
    runConformance,
    runDiffXmi,
    type ConformanceReport,
    type DiffXmiReport,
} from '../conformance/index.js';
import { memoVersion } from '../version.js';

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
export function defaultBaselinePath(kind: 'run' | 'diff-xmi'): string {
    return resolve(
        dirname(fileURLToPath(import.meta.url)),
        `../../../../corpus/baselines/${kind}.json`,
    );
}

/** `--baseline` may carry a path or nothing at all; both mean "gate on it". */
function baselinePath(options: ConformanceCliOptions, kind: 'run' | 'diff-xmi'): string {
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
