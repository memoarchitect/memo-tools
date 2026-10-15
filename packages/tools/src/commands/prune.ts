// ─── memo prune ──────────────────────────────────────────────────────────────
//
// Removes the cached pinned worktrees (`.memo/pinned/`) and assemblies (`.memo/assembled/`) that a
// project has not used lately. Both are caches rebuilt on demand.
// ─────────────────────────────────────────────────────────────────────────────

import chalk from 'chalk';
import { relative } from 'node:path';
import { pruneBuilds } from '../model/pinned.js';

export async function pruneCommand(dir: string, options: { keep?: string | number; dryRun?: boolean }): Promise<void> {
    const keep = Number(options.keep ?? 5);
    if (!Number.isInteger(keep) || keep < 0) {
        console.error(chalk.red(`❌ --keep must be a whole number of builds to keep, not "${options.keep}".`));
        process.exit(1);
    }
    try {
        const { removed, kept } = await pruneBuilds(dir, { keep, dryRun: options.dryRun === true });
        for (const entry of removed) {
            console.log(`${options.dryRun ? 'would remove' : 'removed'} ${relative(process.cwd(), entry.dir) || entry.dir}`);
        }
        console.log(chalk.gray(`${removed.length} ${options.dryRun ? 'to remove' : 'removed'}, ${kept.length} kept (per kind: the ${keep} most recently used)`));
    } catch (error) {
        console.error(chalk.red(`❌ ${error instanceof Error ? error.message : String(error)}`));
        process.exit(1);
    }
}
