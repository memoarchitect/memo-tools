// ─── memo compile ────────────────────────────────────────────────────────────
//
// Stage 1 only: is this valid SysML? The compiler `toolchain.compiler` selects
// checks the project against the OMG specification and reports per line. A
// compiler that builds the model itself (SysIDE) also writes its output, the
// API JSON handoff, to `.memo/stage1/`, where `memo validate` reuses it while
// the inputs are unchanged. MEMO's rules are not run here; that is
// `memo validate` (plans/memo-compiler-stages-opensysml.md).
// ─────────────────────────────────────────────────────────────────────────────

import { join, relative, resolve } from 'node:path';
import chalk from 'chalk';
import { loadProjectSettings } from '../model/config-loader.js';
import { findProjectRoot } from '../model/native-project.js';
import { loadOntologyRegistries } from '../model/ontology-loader.js';
import { findSysmlFiles } from '../model/sysml-files.js';
import type { Diagnostic } from '../toolchain/diagnostic.js';
import { defaultRegistry } from '../toolchain/default-registry.js';
import { resolveToolchain } from '../toolchain/effective.js';
import { compileModelWithSelected, runValidator } from '../toolchain/operations.js';
import { withToolchainOverrides } from '../toolchain/schema.js';

/** Where compilers keep stage 1 output between runs: tool state, never authored content. */
export function stage1CacheDir(projectRoot: string): string {
    return join(projectRoot, '.memo', 'stage1');
}

function printDiagnostics(diagnostics: readonly Diagnostic[]): void {
    for (const d of diagnostics) {
        const where = `${d.file ?? ''}:${d.range?.start.line ?? '?'}:${d.range?.start.column ?? '?'}`;
        const line = `  ${where} ${d.severity}${d.code ? ` (${d.code})` : ''}: ${d.message}`;
        console.log(d.severity === 'error' ? chalk.red(line) : chalk.yellow(line));
    }
}

export async function compileCommand(
    projectDir?: string,
    options: Record<string, unknown> & { force?: boolean } = {},
): Promise<void> {
    const root = findProjectRoot(resolve(projectDir || process.cwd()));
    if (!root) {
        console.error(chalk.red('❌ No MEMO project found (no memo.package.yaml entrypoint).'));
        process.exit(1);
    }
    const config = withToolchainOverrides(loadProjectSettings(root), options, defaultRegistry);
    const compiler = resolveToolchain(config, defaultRegistry).lowering;

    const loaded = await loadOntologyRegistries(root);
    const resolvedRoots = [...(loaded.resolution?.selectedRoots ?? []), ...(loaded.resolution?.unusedRoots ?? [])];
    const projectFiles = new Set(findSysmlFiles(root)
        .filter(file => !resolvedRoots.some(r => resolve(file).startsWith(r.sysmlDir)))
        .map(file => relative(root, file)));

    const started = performance.now();
    let result: Awaited<ReturnType<typeof compileModelWithSelected>>;
    try {
        result = await compileModelWithSelected({
            config, projectDir: root, registries: loaded.registries,
            libraryDirs: (loaded.resolution?.selectedRoots ?? []).map(r => r.sysmlDir),
            projectFiles, cacheDir: stage1CacheDir(root), force: options.force === true,
        });
    } catch (error) {
        // A compiler that could not be run at all is a setup problem, not a
        // verdict on the model; say which, and never fall back to another.
        console.error(chalk.red(`❌ ${error instanceof Error ? error.message : error}`));
        process.exit(1);
    }
    const seconds = ((performance.now() - started) / 1000).toFixed(1);

    if (!result) {
        // A compiler that leaves the model to MEMO's own builder: its check is
        // the selected validator's.
        const run = await runValidator({ config, projectDir: root, registry: defaultRegistry });
        printDiagnostics(run.diagnostics);
        console.log(run.accepted
            ? chalk.green(`✅ Valid SysML (${run.provider}, ${seconds}s)`)
            : chalk.red(`❌ ${run.diagnostics.filter(d => d.severity === 'error').length} error(s) (${run.provider})`));
        process.exit(run.accepted ? 0 : 1);
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
