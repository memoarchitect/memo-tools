// ─── memo publish ────────────────────────────────────────────────────
//
// A dry run of publishing the package or project you are in to a SysAnd
// registry: it stages exactly what `memo pack` stages (`stageSysandProject`:
// the SysML the package declares as its own, and the `.project.json` written
// from `memo.package.yaml` and its usages), checks that, and reports the
// artifact `memo pack` would build. Nothing is written into the project or
// uploaded; the staging copy is removed. Until a registry exists the dry run is
// the default, and the only mode.
// ─────────────────────────────────────────────────────────────────────────────

import { createHash } from 'node:crypto';
import { readFileSync, rmSync, statSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import chalk from 'chalk';
import { loadProjectSettings } from '../model/config-loader.js';
import { readPackageManifest } from '../model/package-manifest.js';
import { defaultRegistry } from '../toolchain/default-registry.js';
import { sysandPackageFileName, stageSysandProject, type StagedSysandProject } from '../toolchain/providers/sysand-project.js';
import { withToolchainOverrides } from '../toolchain/schema.js';

export interface PublishOptions {
    dryRun?: boolean;
    package?: string;
}

interface PackageReport {
    name: string;
    version: string;
    sysmlFiles: number;
    totalBytes: number;
    kparName: string;
    contentHash: string;
    usages: string[];
    errors: string[];
    warnings: string[];
}

function contentHash(staged: StagedSysandProject): string {
    const hash = createHash('sha256');
    for (const file of [...staged.files].sort()) hash.update(readFileSync(join(staged.dir, file)));
    return hash.digest('hex').slice(0, 12);
}

function formatBytes(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/** Check what `pack` would stage for the package in `projectDir`. */
export function reportStagedPackage(staged: StagedSysandProject, projectDir: string): PackageReport {
    const { info } = staged;
    const manifest = readPackageManifest(projectDir).manifest;
    const report: PackageReport = {
        name: info.name,
        version: info.version,
        sysmlFiles: staged.files.length,
        totalBytes: 0,
        kparName: sysandPackageFileName(info),
        contentHash: contentHash(staged),
        usages: info.usage.map(u => `${u.resource}${u.versionConstraint ? ` ${u.versionConstraint}` : ''}`),
        errors: [],
        warnings: [],
    };
    if (!manifest.name) report.errors.push('memo.package.yaml states no package name');
    if (!manifest.version) report.warnings.push(`memo.package.yaml states no version (the package would be ${info.version})`);
    if (info.publisher === 'untitled') report.warnings.push('memo.package.yaml states no publisher (sysand would write "untitled")');
    for (const file of staged.files) {
        const size = statSync(join(staged.dir, file)).size;
        report.totalBytes += size;
        if (size === 0) report.warnings.push(`Empty file: ${file}`);
    }
    return report;
}

export async function sysandPublishCommand(options: PublishOptions & Record<string, unknown>): Promise<void> {
    const cwd = process.cwd();

    console.log(chalk.bold('\n\u{1F4E6} memo publish --dry-run\n'));

    const config = withToolchainOverrides(loadProjectSettings(cwd), options, defaultRegistry);
    let staged: StagedSysandProject;
    try {
        // The same staging `memo pack` runs, so the dry run reports what pack would build.
        staged = await stageSysandProject(cwd, config);
    } catch (error) {
        console.error(chalk.red(`❌ ${error instanceof Error ? error.message : error}`));
        process.exit(1);
    }

    try {
        if (options.package && ![staged.info.name, config.projectName, basename(resolve(cwd))].includes(options.package)) {
            console.error(chalk.red(`❌ Package "${options.package}" is not the package here (${staged.info.name}).`));
            process.exitCode = 1;
            return;
        }
        const report = reportStagedPackage(staged, cwd);

        const status = report.errors.length > 0 ? chalk.red('FAIL') : chalk.green('PASS');
        console.log(`${status}  ${chalk.cyan(report.name)} ${chalk.gray(report.version)}`);
        console.log(chalk.gray(`       ${report.sysmlFiles} files, ${formatBytes(report.totalBytes)}`));
        console.log(chalk.gray(`       artifact: ${report.kparName}`));
        console.log(chalk.gray(`       content hash: ${report.contentHash}`));
        for (const usage of report.usages) console.log(chalk.gray(`       uses: ${usage}`));
        for (const w of report.warnings) console.log(chalk.yellow(`       ⚠ ${w}`));
        for (const e of report.errors) console.log(chalk.red(`       ✖ ${e}`));
        console.log('');

        console.log(chalk.bold('── Summary ──'));
        console.log(`${report.errors.length === 0 ? 1 : 0}/1 packages ready to publish`);
        console.log(`${report.sysmlFiles} SysML files, ${formatBytes(report.totalBytes)} total`);

        if (report.errors.length > 0) {
            console.log(chalk.red('\n✖ Dry-run failed — fix errors above before publishing.\n'));
            process.exitCode = 1;
        } else {
            console.log(chalk.green('\n✔ All packages pass dry-run. Ready for `sysand publish`.\n'));
            console.log(chalk.gray('Publishable artifacts:'));
            console.log(chalk.gray(`  ${report.kparName}  (${report.contentHash})\n`));
        }
    } finally {
        rmSync(staged.dir, { recursive: true, force: true });
    }
}
