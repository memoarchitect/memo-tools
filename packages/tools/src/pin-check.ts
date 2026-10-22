// ─── Pinned versus installed ────────────────────────────────────────────────────────────
//
// A project pins @memoarchitect/{architect,tools,ontology} in package.json, but what runs is
// whatever node_modules holds. When the two disagree (a pin bumped without `npm install`, a
// stale checkout), every command should say so before the user chases a ghost.
// ─────────────────────────────────────────────────────────────────────────────────────────

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

/** Print the warning for the project the working directory is in, when there is a mismatch. */
export function warnOnPinMismatch(cwd: string = process.cwd()): void {
    try {
        const config = findConfigFile(cwd);
        if (!config) return;
        const found = pinMismatches(dirname(config));
        if (found.length === 0) return;
        console.error(chalk.yellow('⚠ The installed MEMO packages do not match package.json:'));
        for (const { name, pinned, installed } of found) console.error(chalk.yellow(`    ${name}: pinned ${pinned}, installed ${installed}`));
        console.error(chalk.yellow('  Run `npm install` to match the pins, or `memo upgrade` to move to a newer release.\n'));
    } catch {
        // A warning must never stop the command it precedes.
    }
}
