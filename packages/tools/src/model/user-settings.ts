// ─── The user's own toolchain settings ───────────────────────────────────────
//
// A project that names no compiler runs under the one the user's machine
// names, so switching compilers is one setting and touches no project. The
// layer sits below the project's settings file and the command line.
//
// It is still a setting somebody made: nothing here chooses for a user who
// did not. With the file, the variable and the project all silent, a command
// that needs a compiler fails (`ToolchainNotConfiguredError`).
//
//   $MEMO_CONFIG_DIR/settings.yaml, else $XDG_CONFIG_HOME/memo/settings.yaml,
//   else ~/.config/memo/settings.yaml:
//       toolchain:
//         compiler: <id>
//   MEMO_TOOLCHAIN_COMPILER=<id>   beats the file, for CI and scripts.
// ─────────────────────────────────────────────────────────────────────────────

import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { parse as parseYaml } from 'yaml';
import type { ToolchainConfig } from './config.js';
import { mergeToolchain } from './toolchain-merge.js';

export const USER_COMPILER_ENV = 'MEMO_TOOLCHAIN_COMPILER';

/** Where the user's settings file is, whether or not it exists. */
export function userSettingsPath(env: NodeJS.ProcessEnv = process.env): string {
    const dir = env.MEMO_CONFIG_DIR
        ?? (env.XDG_CONFIG_HOME ? join(env.XDG_CONFIG_HOME, 'memo') : join(homedir(), '.config', 'memo'));
    return join(dir, 'settings.yaml');
}

/** The user's `toolchain` settings: the file, then the compiler variable over it. */
export function userToolchain(env: NodeJS.ProcessEnv = process.env): ToolchainConfig {
    const path = userSettingsPath(env);
    let fromFile: ToolchainConfig = {};
    if (existsSync(path)) {
        try {
            const raw = parseYaml(readFileSync(path, 'utf8')) as { toolchain?: ToolchainConfig } | null;
            fromFile = raw?.toolchain && typeof raw.toolchain === 'object' ? raw.toolchain : {};
        } catch (error) {
            throw new Error(`The user settings file ${path} could not be read: ${error instanceof Error ? error.message : error}`);
        }
    }
    const compiler = env[USER_COMPILER_ENV]?.trim();
    return mergeToolchain(fromFile, compiler ? { compiler } : undefined);
}
