// ─── memo sysand publish ────────────────────────────────────────────────────
//
// Validates and packages ontology/profile packages for SysAnd registry
// publication. In --dry-run mode (default until a real registry exists),
// validates metadata, collects SysML files, and reports the publishable
// .kpar artifact without writing anything.
//
// Works on any ontology project — discovers packages from the config chain.
// ─────────────────────────────────────────────────────────────────────────────

import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { basename, dirname, join, relative, resolve } from 'node:path';
import chalk from 'chalk';
import { findConfigFile } from '@memo/tools';
import { loadConfigChain, type ConfigChainEntry } from '../server/config-resolver.js';

export interface PublishOptions {
    dryRun?: boolean;
    package?: string;
}

interface PackageReport {
    name: string;
    version: string;
    projectType: string;
    configPath: string;
    sysmlFiles: string[];
    totalBytes: number;
    kparName: string;
    contentHash: string;
    errors: string[];
    warnings: string[];
    projectJson: Record<string, unknown>;
}

const FB2_REQUIRED_FIELDS = ['name', 'version'];

function collectSysmlFiles(dir: string): string[] {
    const out: string[] = [];
    if (!existsSync(dir)) return out;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const p = join(dir, entry.name);
        if (entry.isDirectory() && entry.name !== 'node_modules' && entry.name !== '.memo') {
            out.push(...collectSysmlFiles(p));
        } else if (entry.name.endsWith('.sysml')) {
            out.push(p);
        }
    }
    return out;
}

function computeContentHash(files: string[]): string {
    const hash = createHash('sha256');
    for (const f of [...files].sort()) {
        hash.update(readFileSync(f));
    }
    return hash.digest('hex').slice(0, 12);
}

function sanitizeName(name: string): string {
    return name.replace(/^@/, '').replace(/\//g, '-').replace(/[^a-zA-Z0-9_-]/g, '-');
}

function formatBytes(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function resolveSysmlDir(entry: ConfigChainEntry): string {
    const sourceDir = dirname(entry.configPath);

    // Check memo.package.yaml for sysmlDir
    const raw = readFileSync(entry.configPath, 'utf-8');
    const sysmlDirMatch = raw.match(/^sysmlDir:\s*["']?([^"'\n]+)["']?/m);
    if (sysmlDirMatch) {
        const resolved = resolve(sourceDir, sysmlDirMatch[1].trim());
        if (existsSync(resolved)) return resolved;
    }

    // Default: sysml/ subdirectory
    const sysmlDir = resolve(sourceDir, 'sysml');
    if (existsSync(sysmlDir)) return sysmlDir;

    // Fallback: look for .sysml files directly in the source dir
    const direct = collectSysmlFiles(sourceDir);
    if (direct.length > 0) return sourceDir;

    return sysmlDir;
}

function validatePackage(entry: ConfigChainEntry): PackageReport {
    const config = entry.config;
    const sourceDir = dirname(entry.configPath);
    const name = config.ontologyMetadata?.id || config.projectName || basename(sourceDir);
    const version = config.ontologyMetadata?.version || '0.0.0';

    const report: PackageReport = {
        name,
        version,
        projectType: config.projectType || 'unknown',
        configPath: entry.configPath,
        sysmlFiles: [],
        totalBytes: 0,
        kparName: `${sanitizeName(name)}-${version}.kpar`,
        contentHash: '',
        errors: [],
        warnings: [],
        projectJson: {},
    };

    // FB2: validate required metadata
    if (!config.ontologyMetadata?.id && !config.projectName) {
        report.errors.push('FB2: missing package name (set ontologyMetadata.id or projectName)');
    }
    if (!config.ontologyMetadata?.version) {
        report.warnings.push('FB2: no explicit version in ontologyMetadata (defaulting to 0.0.0)');
    }

    // Check .project.json if present
    const projectJsonPath = resolve(sourceDir, '.project.json');
    if (existsSync(projectJsonPath)) {
        try {
            const data = JSON.parse(readFileSync(projectJsonPath, 'utf-8'));
            report.projectJson = data;
            for (const field of FB2_REQUIRED_FIELDS) {
                if (!data[field]) {
                    report.errors.push(`FB2: .project.json missing required field "${field}"`);
                }
            }
        } catch (e: any) {
            report.errors.push(`FB2: .project.json parse error: ${e.message}`);
        }
    } else {
        report.projectJson = {
            type: 'ontology-package',
            name,
            version,
            license: config.ontologyMetadata?.license || 'UNLICENSED',
            usage: deriveUsage(config),
        };
        report.warnings.push('No .project.json found — would be generated from config');
    }

    // Collect SysML files
    const sysmlDir = resolveSysmlDir(entry);
    report.sysmlFiles = collectSysmlFiles(sysmlDir);

    if (report.sysmlFiles.length === 0) {
        report.errors.push(`No .sysml files found in ${relative(process.cwd(), sysmlDir) || sysmlDir}`);
        return report;
    }

    // Validate readability
    for (const f of report.sysmlFiles) {
        try {
            const content = readFileSync(f, 'utf-8');
            report.totalBytes += Buffer.byteLength(content, 'utf-8');
            if (content.trim().length === 0) {
                report.warnings.push(`Empty file: ${relative(sourceDir, f)}`);
            }
        } catch (e: any) {
            report.errors.push(`Cannot read ${relative(sourceDir, f)}: ${e.message}`);
        }
    }

    report.contentHash = computeContentHash(report.sysmlFiles);
    return report;
}

function deriveUsage(config: any): string[] {
    const usage = new Set<string>();
    if (config.projectType === 'ontology') {
        usage.add('kinds');
        usage.add('relationships');
    } else if (config.projectType === 'profile') {
        usage.add('rules');
        usage.add('viewpoints');
        usage.add('templates');
    } else if (config.projectType === 'library') {
        usage.add('library');
    }
    return Array.from(usage).sort();
}

export async function sysandPublishCommand(options: PublishOptions): Promise<void> {
    const cwd = process.cwd();

    console.log(chalk.bold('\n\u{1F4E6} memo sysand publish' + (options.dryRun ? ' --dry-run' : '') + '\n'));

    const configPath = findConfigFile(cwd);
    if (!configPath) {
        console.error(chalk.red('❌ No memo config found. Run from an ontology or profile package directory.'));
        process.exit(1);
    }

    const configChain = loadConfigChain(configPath);

    // Filter to publishable packages (ontology, profile, library — not device projects)
    let publishable = configChain.filter(entry => {
        const type = entry.config.projectType;
        return type === 'ontology' || type === 'profile' || type === 'library' ||
            !!entry.config.ontologyMetadata;
    });

    // If --package specified, filter to that one
    if (options.package) {
        publishable = publishable.filter(entry => {
            const id = entry.config.ontologyMetadata?.id || entry.config.projectName || '';
            return id === options.package || basename(dirname(entry.configPath)) === options.package;
        });
        if (publishable.length === 0) {
            console.error(chalk.red(`❌ Package "${options.package}" not found in config chain.`));
            process.exit(1);
        }
    }

    if (publishable.length === 0) {
        console.error(chalk.red('❌ No publishable packages found. Only ontology/profile/library packages can be published.'));
        process.exit(1);
    }

    // Validate each package
    let hasErrors = false;
    const reports: PackageReport[] = [];

    for (const entry of publishable) {
        const report = validatePackage(entry);
        reports.push(report);

        const status = report.errors.length > 0 ? chalk.red('FAIL') : chalk.green('PASS');
        console.log(`${status}  ${chalk.cyan(report.name)} ${chalk.gray(`(${report.projectType})`)}`);
        console.log(chalk.gray(`       ${report.sysmlFiles.length} files, ${formatBytes(report.totalBytes)}`));
        console.log(chalk.gray(`       artifact: ${report.kparName}`));

        if (report.contentHash) {
            console.log(chalk.gray(`       content hash: ${report.contentHash}`));
        }

        for (const w of report.warnings) {
            console.log(chalk.yellow(`       ⚠ ${w}`));
        }
        for (const e of report.errors) {
            console.log(chalk.red(`       ✖ ${e}`));
            hasErrors = true;
        }
        console.log('');
    }

    // Summary
    console.log(chalk.bold('── Summary ──'));
    const passed = reports.filter(r => r.errors.length === 0).length;
    const totalFiles = reports.reduce((sum, r) => sum + r.sysmlFiles.length, 0);
    const totalBytes = reports.reduce((sum, r) => sum + r.totalBytes, 0);

    console.log(`${passed}/${reports.length} packages ready to publish`);
    console.log(`${totalFiles} SysML files, ${formatBytes(totalBytes)} total`);

    if (hasErrors) {
        console.log(chalk.red('\n✖ Dry-run failed — fix errors above before publishing.\n'));
        process.exit(1);
    } else {
        console.log(chalk.green('\n✔ All packages pass dry-run. Ready for `sysand publish`.\n'));
        console.log(chalk.gray('Publishable artifacts:'));
        for (const r of reports) {
            console.log(chalk.gray(`  ${r.kparName}  (${r.contentHash})`));
        }
        console.log('');
    }
}
