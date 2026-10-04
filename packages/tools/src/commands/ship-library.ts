// ─── memo ship-library ───────────────────────────────────────────────────────
//
// Export a library set with the selected compiler and write the result where a
// package carries it (`<package>/stage1/`), so a project that resolves the same
// library set does not export it itself (toolchain/shipped-library.ts,
// plans/memo-incremental-stage1.md). Run by whoever releases the package, once
// per compiler it should serve: the compiler is the one `toolchain.compiler`
// selects, and MEMO chooses none.
// ─────────────────────────────────────────────────────────────────────────────

import { resolve } from 'node:path';
import chalk from 'chalk';
import { loadProjectSettings } from '../model/config-loader.js';
import { discoverLibraryRoots } from '../model/native-project.js';
import { defaultRegistry } from '../toolchain/default-registry.js';
import { resolveToolchain } from '../toolchain/effective.js';
import { withToolchainOverrides } from '../toolchain/schema.js';
import { SHIPPED_DIR } from '../toolchain/shipped-library.js';

export async function shipLibraryCommand(
    dir: string | undefined,
    options: Record<string, unknown> & { out?: string } = {},
): Promise<void> {
    const packageDir = resolve(dir || process.cwd());
    const config = withToolchainOverrides(loadProjectSettings(packageDir), options, defaultRegistry);
    const compiler = resolveToolchain(config, defaultRegistry).lowering;
    const descriptor = defaultRegistry.descriptor('lowering', compiler);
    if (!descriptor?.shipLibrary) {
        console.error(chalk.red(`❌ The selected compiler (${compiler}) does not export libraries, so there is nothing to ship.`));
        process.exit(1);
    }
    const libraryDirs = [...new Set(discoverLibraryRoots(packageDir).map(root => root.sysmlDir))];
    if (libraryDirs.length === 0) {
        console.error(chalk.red(`❌ No library roots found from ${packageDir} (no memo.manifest.yaml offers any).`));
        process.exit(1);
    }
    const outDir = resolve(typeof options.out === 'string' ? options.out : `${packageDir}/${SHIPPED_DIR}`);
    const started = performance.now();
    try {
        const written = await descriptor.shipLibrary(config, libraryDirs, outDir);
        for (const file of written) console.log(`  ${file}`);
        console.log(chalk.green(
            `✅ Shipped ${libraryDirs.length} library root(s) for ${compiler} (${((performance.now() - started) / 1000).toFixed(1)}s)`));
    } catch (error) {
        console.error(chalk.red(`❌ ${error instanceof Error ? error.message : error}`));
        process.exit(1);
    }
}
