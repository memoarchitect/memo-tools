// ─── memo migrate-layout ─────────────────────────────────────────────────────
//
// Move every diagram's layout out of its `.viewlayout` companion and into the
// `view` that declares it. Run once per model. The result is compiled before it
// is kept, and every sidecar whose entries all found a view is removed; git has
// the originals.
// ─────────────────────────────────────────────────────────────────────────────

import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import chalk from 'chalk';
import { loadProjectSettings } from '../model/config-loader.js';
import { findProjectRoot } from '../model/native-project.js';
import { deriveModelViews } from '../model/view-deriver.js';
import { planLayoutMigration, readLegacyLayouts } from '../model/view-layout-migration.js';
import { stage1CacheDir } from '../toolchain/project-model.js';
import { defaultRegistry } from '../toolchain/default-registry.js';
import { compileResolvedProject } from '../toolchain/operations.js';
import { withToolchainOverrides } from '../toolchain/schema.js';

export async function migrateLayoutCommand(
    projectDir: string | undefined, options: Record<string, unknown> & { dryRun?: boolean; map?: string[] } = {},
): Promise<void> {
    const root = findProjectRoot(resolve(projectDir || process.cwd()));
    if (!root) {
        console.error(chalk.red('❌ No MEMO project found (no memo.package.yaml entrypoint).'));
        process.exit(1);
    }
    let unreadable = 0;
    const entries = readLegacyLayouts(root, (sidecar, reason) => {
        unreadable += 1;
        console.log(chalk.yellow(`  ! ${sidecar}  is not valid YAML (${reason}); skipped, left in place`));
    });
    if (entries.length === 0) {
        console.log(unreadable > 0 ? chalk.yellow(`${unreadable} sidecar(s) could not be read and need fixing by hand.`)
            : chalk.green('✅ No .viewlayout sidecars to migrate.'));
        return;
    }
    const config = withToolchainOverrides(loadProjectSettings(root), options, defaultRegistry);
    const compile = (force: boolean) => compileResolvedProject({ config, projectDir: root, cacheDir: stage1CacheDir(root), force });
    const before = await compile(false);
    if (!before?.accepted || !before.model) {
        console.error(chalk.red('❌ The model does not compile, so its views cannot be told from each other. Fix that first.'));
        process.exit(1);
    }
    const { diagrams } = deriveModelViews(before.model, before.registries?.kindRegistry);
    const idMap: Record<string, string> = {};
    for (const pair of options.map ?? []) {
        const at = pair.indexOf('=');
        if (at < 1 || at === pair.length - 1) { console.error(chalk.red(`❌ --map wants old-id=view-id, got "${pair}".`)); process.exit(1); }
        idMap[pair.slice(0, at)] = pair.slice(at + 1);
    }
    const plan = planLayoutMigration(root, diagrams, entries, idMap);

    for (const outcome of plan.outcomes) {
        const where = `${outcome.entry.sidecar} · ${outcome.entry.diagramId}`;
        if (outcome.kind === 'migrated') console.log(`  ${chalk.green('→')} ${where}  into ${outcome.viewId} (${outcome.file})`);
        else if (outcome.kind === 'nothing-to-keep') console.log(chalk.gray(`  · ${where}  overrides nothing`));
        else if (outcome.kind === 'already-in-view') console.log(chalk.yellow(`  ! ${where}  ${outcome.viewId} already has layout statements; the sidecar entry is not applied`));
        else console.log(chalk.yellow(`  ! ${where}  ${outcome.reason}; left in place`));
    }
    const camera = plan.outcomes.filter(o => o.kind === 'migrated'
        && (o.entry.layout.canvas?.zoom !== undefined || o.entry.layout.canvas?.pan !== undefined)).length;
    if (camera > 0) console.log(chalk.gray(`  The saved camera (zoom, pan) of ${camera} view(s) is not kept: it is one person's window, not the drawing.`));
    if (options.dryRun) { console.log(chalk.gray('  Dry run: nothing written.')); return; }
    if (plan.rewrites.size === 0 && plan.removable.length === 0) return;

    const originals = new Map([...plan.rewrites.keys()].map(file => [file, readFileSync(resolve(root, file), 'utf8')]));
    for (const [file, text] of plan.rewrites) writeFileSync(resolve(root, file), text, 'utf8');
    const after = await compile(true);
    if (!after?.accepted) {
        for (const [file, text] of originals) writeFileSync(resolve(root, file), text, 'utf8');
        console.error(chalk.red('❌ The compiler did not accept the migrated model; every file was restored and no sidecar was removed.'));
        for (const d of (after?.diagnostics ?? []).filter(d => d.severity === 'error').slice(0, 5)) console.error(`  ${d.file ?? ''}: ${d.message}`);
        process.exit(1);
    }
    for (const sidecar of plan.removable) rmSync(resolve(root, sidecar), { force: true });
    console.log(chalk.green(`✅ ${plan.rewrites.size} file(s) changed, ${plan.removable.length} sidecar(s) removed.`));
}
