// ─── Retired commands ────────────────────────────────────────────────────────
//
// One way of doing a thing (memo-meta plans/memo-tools-consolidation.md): a
// command that only repeated another is removed. A script still calling it
// must not succeed silently or fail with commander's bare "unknown command",
// so for one release the old name stays, hidden from help, and fails with the
// command that replaced it. Delete each entry in the release after its removal.
// ─────────────────────────────────────────────────────────────────────────────

import type { Command } from 'commander';
import chalk from 'chalk';

/**
 * Register `name` under `parent` as a removed command: hidden, accepting any
 * arguments, exiting 1 with the replacement named, or, for one nothing
 * replaces, the reason it went.
 */
export function retiredCommand(parent: Command, name: string, replacement: string | { reason: string }): void {
    const path = [...ancestry(parent), name].join(' ');
    parent
        .command(name, { hidden: true })
        .allowUnknownOption()
        .allowExcessArguments()
        .argument('[args...]')
        .action(() => {
            console.error(chalk.red(typeof replacement === 'string'
                ? `✖ \`${path}\` was removed; use \`${replacement}\`.`
                : `✖ \`${path}\` was removed: ${replacement.reason}`));
            process.exitCode = 1;
        });
}

function ancestry(command: Command): string[] {
    const names: string[] = [];
    for (let current: Command | null = command; current; current = current.parent) names.unshift(current.name());
    return names;
}
