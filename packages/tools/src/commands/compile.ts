// ─── memo compile ────────────────────────────────────────────────────────────
//
// Stage 1 only: is this valid SysML? The compiler `toolchain.compiler` selects
// checks the project against the OMG specification and reports per line. A
// compiler that builds the model itself also writes its output, the
// API JSON handoff, to `.memo/stage1/`, where `memo validate` reuses it while
// the inputs are unchanged. MEMO's rules are not run here; that is
// `memo validate` (plans/memo-compiler-stages-opensysml.md).
//
// `--out` writes the compiled SysML model as one file, the selected compiler's
// own output: what analysis notebooks read (`python/memo_model.py`), so they
// follow `toolchain.compiler` like every other command.
// ─────────────────────────────────────────────────────────────────────────────

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import chalk from 'chalk';
import { loadProjectSettings } from '../model/config-loader.js';
import { findProjectRoot } from '../model/native-project.js';
import { stage1CacheDir } from '../toolchain/project-model.js';
import type { Diagnostic } from '../toolchain/diagnostic.js';
import { defaultRegistry } from '../toolchain/default-registry.js';
import { resolveToolchain } from '../toolchain/effective.js';
import { compileResolvedProject, runValidator } from '../toolchain/operations.js';
import { withToolchainOverrides } from '../toolchain/schema.js';
import type { Stage1Output } from '../stage2/api-model.js';
import { allSuperTypes } from '../sysml-ir/generated/sysml-metamodel.js';

export { stage1CacheDir };

function printDiagnostics(diagnostics: readonly Diagnostic[]): void {
    for (const d of diagnostics) {
        const where = `${d.file ?? ''}:${d.range?.start.line ?? '?'}:${d.range?.start.column ?? '?'}`;
        const line = `  ${where} ${d.severity}${d.code ? ` (${d.code})` : ''}: ${d.message}`;
        console.log(d.severity === 'error' ? chalk.red(line) : chalk.yellow(line));
    }
}

/** The format `memo compile --out` writes. */
export const COMPILED_MODEL_FORMAT = 'memo-compiled-model/1';

/**
 * The compiled model as one document: the compiler that built it, its
 * diagnostics, every document's SysML v2 API JSON with its role, the element
 * index, and each metaclass's supertypes from the SysML metamodel, so a reader
 * can ask for a metaclass and its subtypes without a metamodel of its own.
 */
export function compiledModelDocument(
    compiler: string,
    output: Stage1Output | undefined,
    providerVersion: string | undefined,
    accepted: boolean,
    diagnostics: readonly Diagnostic[],
): unknown {
    const documents = output?.documents ?? [];
    const metaclasses = new Set(documents.flatMap(document => document.elements.map(element => element['@type'])));
    return {
        format: COMPILED_MODEL_FORMAT,
        compiler,
        compilerVersion: providerVersion,
        accepted,
        diagnostics: diagnostics.map(d => ({
            severity: d.severity, message: d.message, code: d.code, file: d.file,
            line: d.range?.start.line, column: d.range?.start.column,
        })),
        documents,
        index: output?.index ?? {},
        supertypes: Object.fromEntries([...metaclasses].sort().map(name => [name, allSuperTypes(name)])),
    };
}

function writeCompiledModel(path: string, document: unknown): void {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify(document));
}

export async function compileCommand(
    projectDir?: string,
    options: Record<string, unknown> & { force?: boolean; out?: string } = {},
): Promise<void> {
    const root = findProjectRoot(resolve(projectDir || process.cwd()));
    if (!root) {
        console.error(chalk.red('❌ No MEMO project found (no memo.package.yaml entrypoint).'));
        process.exit(1);
    }
    const config = withToolchainOverrides(loadProjectSettings(root), options, defaultRegistry);
    const compiler = resolveToolchain(config, defaultRegistry).lowering;

    // The same compile `memo validate` and every other command asks for —
    // every library root a locator offers, the project resolved from it — so
    // the output it leaves in `.memo/stage1/` is the one they reuse.
    const started = performance.now();
    let result: Awaited<ReturnType<typeof compileResolvedProject>>;
    try {
        result = await compileResolvedProject({
            config, projectDir: root, cacheDir: stage1CacheDir(root), force: options.force === true,
        });
    } catch (error) {
        // A compiler that could not be run at all is a setup problem, not a
        // verdict on the model; say which, and never fall back to another.
        console.error(chalk.red(`❌ ${error instanceof Error ? error.message : error}`));
        process.exit(1);
    }
    const seconds = ((performance.now() - started) / 1000).toFixed(1);

    const out = typeof options.out === 'string' ? resolve(options.out) : undefined;
    if (!result) {
        if (out) {
            // MEMO's own compiler builds MEMO's model, not a SysML v2 one.
            console.error(chalk.red(`❌ The selected compiler (${compiler}) does not build a SysML v2 model, so there is `
                + 'nothing to write to --out. Select an external compiler with toolchain.compiler.'));
            process.exit(1);
        }
        // A compiler that leaves the model to MEMO's own builder: its check is
        // the selected validator's.
        const run = await runValidator({ config, projectDir: root, registry: defaultRegistry });
        printDiagnostics(run.diagnostics);
        console.log(run.accepted
            ? chalk.green(`✅ Valid SysML (${run.provider}, ${seconds}s)`)
            : chalk.red(`❌ ${run.diagnostics.filter(d => d.severity === 'error').length} error(s) (${run.provider})`));
        process.exit(run.accepted ? 0 : 1);
    }

    if (out) {
        writeCompiledModel(out, compiledModelDocument(
            compiler, result.api?.output, result.providerVersion, result.accepted && Boolean(result.model), result.diagnostics));
    }
    printDiagnostics(result.diagnostics);
    const origin = `${compiler}${result.providerVersion ? ` ${result.providerVersion}` : ''}${result.cached ? ', reused' : ''}, ${seconds}s`;
    if (!result.accepted || !result.model) {
        console.log(chalk.red(`❌ ${result.diagnostics.filter(d => d.severity === 'error').length} error(s) (${origin})`));
        process.exit(1);
    }
    console.log(chalk.green(
        `✅ Valid SysML (${origin}): ${result.model.elements.size} elements, ${result.model.relationships.length} relationships`));
}
