// ─── memo ids rebase ─────────────────────────────────────────────────────────
//
// Make the ids this branch handed out distinct from the ones the branch it is going to land on handed
// out (see model/id-rebase.ts). Run it on the branch, after the merge or rebase has brought both
// registries together, naming the target: it keeps the target's ids, renumbers the branch's clashing
// ones, rewrites `memo.identity.yaml` and the authored `providedId` literals, and prints old to new.
// It does not touch text that merely mentions an id, because it cannot tell a mention of the branch's
// element from a mention of the target's; it lists the files that mention a renumbered id instead.
// ─────────────────────────────────────────────────────────────────────────────

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import chalk from 'chalk';
import { IDENTITY_FILENAME, parseIdentityRegistry, serializeIdentityRegistry } from '../model/identity-registry.js';
import { rebaseProvidedIds, rebaseRegistry, type IdChange } from '../model/id-rebase.js';
import { findProjectRoot } from '../model/native-project.js';
import { findSysmlFiles } from '../model/sysml-files.js';

const git = (cwd: string, args: string[]): string =>
    execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });

export interface IdsRebaseResult {
    changes: IdChange[];
    /** Files outside the registry and the sources that mention a renumbered id. */
    mentions: string[];
    wrote: boolean;
}

export async function idsRebase(projectDir: string, onto: string, options: { dryRun?: boolean } = {}): Promise<IdsRebaseResult> {
    const root = findProjectRoot(resolve(projectDir)) ?? resolve(projectDir);
    const prefix = git(root, ['rev-parse', '--show-prefix']).trim();
    let sha: string;
    try {
        sha = git(root, ['rev-parse', '--verify', '--quiet', `${onto}^{commit}`]).trim();
    } catch {
        throw new Error(`"${onto}" is not a commit or a ref of this repository`);
    }
    const atTarget = (path: string): string | undefined => {
        try { return git(root, ['show', `${sha}:${prefix}${path}`]); } catch { return undefined; }
    };

    // Short ids: the registry on each side.
    const registryPath = join(root, IDENTITY_FILENAME);
    const targetRegistry = parseIdentityRegistry(atTarget(IDENTITY_FILENAME) ?? '');
    const branchRegistry = existsSync(registryPath) ? parseIdentityRegistry(readFileSync(registryPath, 'utf8')) : {};
    const registry = rebaseRegistry(targetRegistry, branchRegistry);

    // Authored ids: the project's sources on each side.
    const branchFiles = findSysmlFiles(root).map(file => relative(root, file).replaceAll('\\', '/'));
    const branchTexts = new Map(branchFiles.map(file => [file, readFileSync(join(root, file), 'utf8')]));
    const targetTexts = new Map<string, string>();
    for (const file of git(root, ['ls-tree', '-r', '--name-only', sha, '--', prefix || '.']).split('\n').filter(f => f.endsWith('.sysml'))) {
        const local = prefix && file.startsWith(prefix) ? file.slice(prefix.length) : file;
        const text = atTarget(local);
        if (text !== undefined) targetTexts.set(local, text);
    }
    const provided = rebaseProvidedIds(targetTexts, branchTexts);

    const changes = [...registry.changes, ...provided.changes];
    const renamed = new Set(changes.map(change => change.from));
    const mentions: string[] = [];
    if (renamed.size > 0) {
        for (const [file, text] of branchTexts) {
            if (provided.files.has(file)) continue;
            if ([...renamed].some(id => new RegExp(`(?<![\\w-])${id}(?![\\w-])`).test(text))) mentions.push(file);
        }
    }

    if (!options.dryRun && changes.length > 0) {
        if (registry.changes.length > 0) writeFileSync(registryPath, serializeIdentityRegistry(registry.registry), 'utf8');
        for (const [file, text] of provided.files) writeFileSync(join(root, file), text, 'utf8');
    }
    return { changes, mentions, wrote: !options.dryRun && changes.length > 0 };
}

export async function idsRebaseCommand(dir: string, options: { onto?: string; dryRun?: boolean }): Promise<void> {
    if (!options.onto) {
        console.error(chalk.red('✖ Name the ref this branch will land on: memo ids rebase --onto <ref>'));
        process.exitCode = 1;
        return;
    }
    try {
        const result = await idsRebase(dir, options.onto, { dryRun: options.dryRun });
        if (result.changes.length === 0) {
            console.log(chalk.green(`✅ No id of this branch clashes with ${options.onto}.`));
            return;
        }
        for (const change of result.changes) console.log(`  ${change.from} → ${change.to}   ${chalk.gray(change.where)}`);
        for (const file of result.mentions) {
            console.log(chalk.yellow(`  ! ${file} mentions a renumbered id as text; check it names the element you meant`));
        }
        console.log(result.wrote
            ? chalk.green(`✅ ${result.changes.length} id(s) renumbered above ${options.onto}'s.`)
            : chalk.gray(`  Dry run: ${result.changes.length} id(s) would be renumbered; nothing written.`));
    } catch (error) {
        console.error(chalk.red(`✖ ${error instanceof Error ? error.message : error}`));
        process.exitCode = 1;
    }
}
