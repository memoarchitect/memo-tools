// ─── memo upgrade ───────────────────────────────────────────────────────────────────────
//
// Moves a project to one release of the three packages that ship together:
// @memoarchitect/architect, tools and ontology, pinned to the exact version. A range would let a fresh
// `npm install` drift from the release the lock was made with; the command names the versions.
//
// The lock step runs the installed `memo-architect`, not this process, so the new
// release regenerates memo.lock.yaml.
// ─────────────────────────────────────────────────────────────────────────────

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import chalk from 'chalk';
import { findConfigFile } from '@memoarchitect/tools';

const SCOPE = '@memoarchitect';
const PACKAGES = ['architect', 'tools', 'ontology'] as const;
type PackageName = (typeof PACKAGES)[number];
export type UpgradeVersions = Record<PackageName, string>;

export interface UpgradeOptions {
    /** Align package.json to what is installed; install nothing new. */
    syncOnly?: boolean;
    /** Print the plan and change nothing. */
    dryRun?: boolean;
}

/**
 * What package.json carries for a release: the exact version, no range. A project pins the release it was
 * made and locked with, so `npm install` lands on that one and not on a later patch.
 */
export function exactPin(version: string): string {
    return version;
}

/** The version of `name` that npm would install when asked for `target` (the latest when absent). */
function npmVersion(cwd: string, name: PackageName, target?: string): string {
    return npm(cwd, ['view', `${SCOPE}/${name}${target ? `@${target}` : ''}`, 'version']).trim().split('\n').pop()!;
}

function npm(cwd: string, args: string[], inherit = false): string {
    if (inherit) console.log(chalk.gray(`> npm ${args.join(' ')}`));
    return execFileSync('npm', args, { cwd, encoding: 'utf8', stdio: inherit ? 'inherit' : ['ignore', 'pipe', 'inherit'] }) ?? '';
}

function readJson(path: string): any {
    return JSON.parse(readFileSync(path, 'utf8'));
}

/** What the installed Architect declares for tools and ontology: the pair it was tested with. */
export function installedVersions(projectRoot: string): UpgradeVersions {
    const path = join(projectRoot, 'node_modules', SCOPE, 'architect', 'package.json');
    if (!existsSync(path)) throw new Error(`${SCOPE}/architect is not installed. Run \`npm install\` first.`);
    const architect = readJson(path);
    const tools = architect.dependencies?.[`${SCOPE}/tools`];
    const ontology = architect.dependencies?.[`${SCOPE}/ontology`];
    if (!tools || !ontology) throw new Error(`The installed ${SCOPE}/architect does not declare tools and ontology dependencies.`);
    return { architect: architect.version, tools, ontology };
}

function writePins(projectRoot: string, versions: UpgradeVersions): void {
    const path = join(projectRoot, 'package.json');
    const pkg = readJson(path);
    pkg.dependencies ??= {};
    for (const name of PACKAGES) pkg.dependencies[`${SCOPE}/${name}`] = exactPin(versions[name]);
    writeFileSync(path, `${JSON.stringify(pkg, null, 2)}\n`, 'utf8');
}

export async function upgradeCommand(target: string | undefined, options: UpgradeOptions = {}): Promise<void> {
    const configPath = findConfigFile(process.cwd());
    if (!configPath) {
        console.error(chalk.red('❌ No memo config found. Run from inside a MEMO project.'));
        process.exit(1);
    }
    const projectRoot = dirname(configPath);
    if (!existsSync(join(projectRoot, 'package.json'))) {
        console.error(chalk.red(`❌ No package.json in ${projectRoot}; upgrade needs an npm project.`));
        process.exit(1);
    }

    try {
        let versions: UpgradeVersions;
        if (options.syncOnly) {
            versions = installedVersions(projectRoot);
            console.log(`Aligning package.json to the installed Architect ${versions.architect} (tools ${versions.tools}, ontology ${versions.ontology})`);
            if (options.dryRun) return;
            writePins(projectRoot, versions);
            npm(projectRoot, ['install'], true);
        } else {
            const architect = npmVersion(projectRoot, 'architect', target);
            console.log(`Target release: ${architect}`);
            if (options.dryRun) {
                console.log(chalk.gray(`  would install ${PACKAGES.map(name => `${SCOPE}/${name}@${architect}`).join(' ')}`));
                return;
            }
            npm(projectRoot, ['install', '--save-exact', ...PACKAGES.map(name => `${SCOPE}/${name}@${architect}`)], true);
            versions = installedVersions(projectRoot);
            // Architect names the tools and ontology it was built against; follow it when they differ.
            if (versions.tools !== architect || versions.ontology !== architect) {
                console.log(`Architect declares tools ${versions.tools} and ontology ${versions.ontology}; installing those.`);
                npm(projectRoot, ['install', '--save-exact', `${SCOPE}/tools@${versions.tools}`, `${SCOPE}/ontology@${versions.ontology}`], true);
                versions = installedVersions(projectRoot);
            }
            writePins(projectRoot, versions);
            npm(projectRoot, ['install'], true);
        }

        console.log(chalk.gray('> memo-architect lock'));
        execFileSync('npx', ['memo-architect', 'lock'], { cwd: projectRoot, stdio: 'inherit' });

        console.log(chalk.green(`\n✅ Upgraded to ${versions.architect}`));
        console.log(chalk.gray(`   ${SCOPE}/architect ${exactPin(versions.architect)}`));
        console.log(chalk.gray(`   ${SCOPE}/tools     ${exactPin(versions.tools)}`));
        console.log(chalk.gray(`   ${SCOPE}/ontology  ${exactPin(versions.ontology)}`));
        console.log(chalk.gray('   Next: memo validate .  (and read the release notes if the ontology changed)'));
    } catch (e) {
        console.error(chalk.red(`❌ Upgrade failed: ${e instanceof Error ? e.message : e}`));
        process.exit(1);
    }
}
