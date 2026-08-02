// ─── memo convert ────────────────────────────────────────────────────────────
//
// Restructure a project into the native catalog layout (design section 6.2).
//
// Dry-run is the DEFAULT, not a flag. Converting is the opt-in. This command
// rewrites a user's authored model in bulk, so the shape of the CLI is part of
// its safety: running it wrong prints a plan, and only `--write` touches a
// file. The planner in `project-conversion.ts` has no write path at all, so
// there is no branch on which dry-run can leak.
//
// Design reference: section 18.4, half A deliverable 1.
// ─────────────────────────────────────────────────────────────────────────────

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import chalk from 'chalk';
import {
    applyConversion,
    planConversion,
    readSourceFacts,
    renderPlan,
    type PlanOptions,
} from '../model/project-conversion.js';
import { discoverLibraryRoots } from '../model/native-project.js';
import { findSysmlFiles } from '../model/sysml-files.js';

export interface ConvertOptions {
    /** Apply the plan. Without it the command only reports. */
    write?: boolean;
    /** Include per-file content hunks in the report. */
    diff?: boolean;
    /** Machine-readable plan, for CI and for the corpus conversion script. */
    json?: boolean;
    /** Also rename in-place packages whose names do not mirror their location. */
    normalizeNames?: boolean;
}

/**
 * Index the viewpoint usages the reusable packages declare.
 *
 * A view says which viewpoint governs it; the conversion needs to know where
 * that viewpoint's own source lives so the project's `viewpoints/<group>/`
 * directory lines up with the ontology's. This reads the resolvable library
 * roots directly rather than going through full project resolution, because a
 * pre-conversion project may have no entrypoint to resolve from — which is
 * precisely the state the command exists to fix.
 */
function indexReusableViewpoints(projectRoot: string): PlanOptions {
    const viewpointDeclarations = new Map<string, string>();
    const viewpointPackages = new Map<string, string>();

    for (const root of discoverLibraryRoots(projectRoot)) {
        for (const file of findSysmlFiles(root.sysmlDir)) {
            let text: string;
            try { text = readFileSync(file, 'utf-8'); } catch { continue; }
            const facts = readSourceFacts(text);
            for (const usage of facts.viewpointUsages) {
                if (viewpointDeclarations.has(usage)) continue;
                viewpointDeclarations.set(usage, file);
                if (facts.packageName) viewpointPackages.set(usage, facts.packageName);
            }
        }
    }
    return { viewpointDeclarations, viewpointPackages };
}

export async function convertCommand(dir: string, options: ConvertOptions = {}): Promise<void> {
    const root = resolve(dir);
    if (!existsSync(root)) {
        console.error(chalk.red(`No such directory: ${root}`));
        process.exitCode = 1;
        return;
    }

    const plan = planConversion(root, {
        ...indexReusableViewpoints(root),
        normalizeNames: options.normalizeNames,
    });

    if (options.json) {
        console.log(JSON.stringify({
            projectRoot: plan.projectRoot,
            projectPrefix: plan.projectPrefix,
            alreadyConverted: plan.alreadyConverted,
            changes: plan.changes.map(c => ({
                from: c.from, to: c.to,
                fromPackage: c.fromPackage, toPackage: c.toPackage,
                rewritten: c.content !== undefined,
                reasons: c.reasons,
            })),
            newFiles: plan.newFiles.map(f => ({ path: f.path, reason: f.reason })),
            removals: plan.removals,
            packageRenames: Object.fromEntries(plan.packageRenames),
            collisions: plan.collisions,
            warnings: plan.warnings,
        }, null, 2));
        if (plan.collisions.length > 0) process.exitCode = 1;
        return;
    }

    console.log(renderPlan(plan, { diff: options.diff }));

    if (plan.collisions.length > 0) {
        console.error(chalk.red(
            `Refused: ${plan.collisions.length} collision(s). Nothing was written. ` +
            'Resolve the clashes above and run again.',
        ));
        process.exitCode = 1;
        return;
    }

    if (plan.alreadyConverted) return;

    if (!options.write) {
        console.log(chalk.dim('Dry run — nothing was written. Re-run with --write to apply.'));
        return;
    }

    const result = applyConversion(plan);
    console.log(chalk.green(
        `Converted: ${result.moved.length} moved, ${result.written.length} rewritten in place, ` +
        `${result.created.length} created, ${result.removed.length} removed.`,
    ));
    console.log(chalk.dim('Run `memo validate` and `syside check` to confirm the result parses.'));
}
