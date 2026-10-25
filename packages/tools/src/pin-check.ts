// ─── Pinned versus installed ────────────────────────────────────────────────────────────
//
// A project pins @memoarchitect/{architect,tools,ontology} in package.json, but what runs is
// whatever node_modules holds. When the two disagree (a pin bumped without `npm install`, a
// stale checkout), every command should say so before the user chases a ghost.
// ─────────────────────────────────────────────────────────────────────────────────────────

import { execFileSync } from 'node:child_process';
import { existsSync, lstatSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import chalk from 'chalk';
import { findConfigFile } from '@memoarchitect/tools';

const PACKAGES = ['architect', 'tools', 'ontology'];

export interface PinMismatch { name: string; pinned: string; installed: string }

const parse = (version: string): [number, number, number] | undefined => {
    const m = /^(\d+)\.(\d+)\.(\d+)/.exec(version);
    return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : undefined;
};

/**
 * Whether `installed` is inside `range`, for the forms a MEMO pin takes: exact, `^`, `~`.
 * A range this does not understand (a tag, a URL, `>=`) is accepted: no warning beats a wrong one.
 */
export function satisfiesPin(range: string, installed: string): boolean {
    const m = /^([\^~]?)(\d+\.\d+\.\d+)$/.exec(range.trim());
    const have = parse(installed);
    if (!m || !have) return true;
    const base = parse(m[2])!;
    const atLeast = have[0] > base[0] || (have[0] === base[0] && (have[1] > base[1] || (have[1] === base[1] && have[2] >= base[2])));
    if (m[1] === '') return have.join('.') === base.join('.');
    if (!atLeast) return false;
    if (m[1] === '~') return have[0] === base[0] && have[1] === base[1];
    // Caret: the leftmost non-zero segment may not change.
    if (base[0] > 0) return have[0] === base[0];
    if (base[1] > 0) return have[0] === 0 && have[1] === base[1];
    return have[0] === 0 && have[1] === 0 && have[2] === base[2];
}

/** The MEMO packages whose installed version falls outside the range package.json pins. */
export function pinMismatches(projectRoot: string): PinMismatch[] {
    const manifest = join(projectRoot, 'package.json');
    if (!existsSync(manifest)) return [];
    const pins = JSON.parse(readFileSync(manifest, 'utf8')).dependencies ?? {};
    const found: PinMismatch[] = [];
    for (const short of PACKAGES) {
        const name = `@memoarchitect/${short}`;
        const pinned: unknown = pins[name];
        const dir = join(projectRoot, 'node_modules', name);
        // A linked workspace checkout is a developer's own build; its version is not a pin to honour.
        if (typeof pinned !== 'string' || !existsSync(dir) || lstatSync(dir).isSymbolicLink()) continue;
        const installed: string | undefined = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')).version;
        if (installed && !satisfiesPin(pinned, installed)) found.push({ name, pinned, installed });
    }
    return found;
}

/** The lines that say which packages do not match. */
export function pinMismatchMessage(found: PinMismatch[]): string[] {
    return [
        'The installed MEMO packages do not match package.json:',
        ...found.map(({ name, pinned, installed }) => `    ${name}: pinned ${pinned}, installed ${installed}`),
    ];
}

/** Print the warning for the project the working directory is in, when there is a mismatch. */
export function warnOnPinMismatch(cwd: string = process.cwd()): void {
    try {
        const config = findConfigFile(cwd);
        if (!config) return;
        const found = pinMismatches(dirname(config));
        if (found.length === 0) return;
        for (const line of pinMismatchMessage(found)) console.error(chalk.yellow(line.startsWith(' ') ? line : `⚠ ${line}`));
        console.error(chalk.yellow('  Run `npm install` to match the pins, or `memo-architect upgrade` to move to a newer release.\n'));
    } catch {
        // A warning must never stop the command it precedes.
    }
}

/** What `offerNpmInstall` needs from its surroundings, so a test needs no terminal and no network. */
export interface InstallPromptEnvironment {
    interactive: boolean;
    ask: (question: string) => Promise<string>;
    install: (projectRoot: string) => void;
    log: (line: string) => void;
}

const terminalEnvironment = (): InstallPromptEnvironment => ({
    interactive: Boolean(process.stdin.isTTY && process.stdout.isTTY),
    ask: async question => {
        const { createInterface } = await import('node:readline/promises');
        const readline = createInterface({ input: process.stdin, output: process.stdout });
        try { return await readline.question(question); } finally { readline.close(); }
    },
    install: projectRoot => { execFileSync('npm', ['install'], { cwd: projectRoot, stdio: 'inherit' }); },
    log: line => console.error(line),
});

/**
 * At the start of the app: when what is installed is not what package.json pins, the app does not start. The user
 * is offered `npm install` instead; a yes installs and asks for a restart, because the server loads from those very
 * `node_modules` and must not have them replaced under it. A no, or no terminal to ask in (a preview launch, CI),
 * leaves the app stopped with the instruction, so nothing waits on an answer and nothing runs the wrong versions.
 *
 * `continue` means nothing differs and the app may start; every other outcome means it must not.
 */
export async function offerNpmInstall(
    cwd: string = process.cwd(),
    env: InstallPromptEnvironment = terminalEnvironment(),
): Promise<'continue' | 'installed' | 'declined' | 'no-terminal' | 'failed'> {
    let projectRoot: string;
    let found: PinMismatch[];
    try {
        const config = findConfigFile(cwd);
        if (!config) return 'continue';
        projectRoot = dirname(config);
        found = pinMismatches(projectRoot);
    } catch {
        return 'continue';
    }
    if (found.length === 0) return 'continue';
    for (const line of pinMismatchMessage(found)) env.log(line.startsWith(' ') ? line : `✖ ${line}`);
    if (!env.interactive) {
        env.log('Not starting. Run `npm install` to match the pins, or `memo-architect upgrade` to move to a newer release.');
        return 'no-terminal';
    }
    const answer = (await env.ask('Run `npm install` now to match them? [Y/n] ')).trim().toLowerCase();
    if (answer !== '' && answer !== 'y' && answer !== 'yes') {
        env.log('Not starting. Run `npm install`, or `memo-architect upgrade` to move to a newer release.');
        return 'declined';
    }
    try {
        env.install(projectRoot);
    } catch (error) {
        env.log(`npm install failed: ${error instanceof Error ? error.message : String(error)}`);
        return 'failed';
    }
    env.log('Installed. Start the app again so it runs the installed versions.');
    return 'installed';
}
