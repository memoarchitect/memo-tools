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

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { Document, parse as parseYaml, parseDocument } from 'yaml';
import type { ToolchainConfig } from './config.js';
import { mergeToolchain } from './toolchain-merge.js';

export const USER_COMPILER_ENV = 'MEMO_TOOLCHAIN_COMPILER';

/** Where the user's settings file is, whether or not it exists. */
export function userSettingsPath(env: NodeJS.ProcessEnv = process.env): string {
    const dir = env.MEMO_CONFIG_DIR
        ?? (env.XDG_CONFIG_HOME ? join(env.XDG_CONFIG_HOME, 'memo') : join(homedir(), '.config', 'memo'));
    return join(dir, 'settings.yaml');
}

/** The `toolchain` block of the user's settings file alone. */
export function userFileToolchain(env: NodeJS.ProcessEnv = process.env): ToolchainConfig {
    const path = userSettingsPath(env);
    if (!existsSync(path)) return {};
    try {
        const raw = parseYaml(readFileSync(path, 'utf8')) as { toolchain?: ToolchainConfig } | null;
        return raw?.toolchain && typeof raw.toolchain === 'object' ? raw.toolchain : {};
    } catch (error) {
        throw new Error(`The user settings file ${path} could not be read: ${error instanceof Error ? error.message : error}`);
    }
}

/** The compiler variable alone: a per-run choice that beats the project's, as the command line does. */
export function userEnvToolchain(env: NodeJS.ProcessEnv = process.env): ToolchainConfig {
    const compiler = env[USER_COMPILER_ENV]?.trim();
    return compiler ? { compiler } : {};
}

/** The user's `toolchain` settings: the file, then the compiler variable over it. */
export function userToolchain(env: NodeJS.ProcessEnv = process.env): ToolchainConfig {
    return mergeToolchain(userFileToolchain(env), userEnvToolchain(env));
}

// ─── Writing the user's settings ─────────────────────────────────────────────
//
// Architect's Compiler control edits the file with the YAML document model, so a user's
// comments and other keys stay where they were.

function readDocument(path: string): Document {
    if (!existsSync(path)) return new Document({});
    const document = parseDocument(readFileSync(path, 'utf8'));
    if (document.errors.length > 0) {
        throw new Error(`The user settings file ${path} could not be read: ${document.errors[0].message}`);
    }
    return document.contents === null ? new Document({}) : document;
}

/** Set a toolchain leaf (`compiler`, `opensysml.binary`) in the user's settings file. Returns the file. */
export function setUserToolchainSetting(path: string, value: string, env: NodeJS.ProcessEnv = process.env): string {
    const file = userSettingsPath(env);
    const document = readDocument(file);
    document.setIn(['toolchain', ...path.split('.')], value);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, document.toString());
    return file;
}

/** Remove a toolchain leaf from the user's settings file; false when it was not set. */
export function unsetUserToolchainSetting(path: string, env: NodeJS.ProcessEnv = process.env): boolean {
    const file = userSettingsPath(env);
    if (!existsSync(file)) return false;
    const document = readDocument(file);
    const steps = ['toolchain', ...path.split('.')];
    if (!document.hasIn(steps)) return false;
    document.deleteIn(steps);
    writeFileSync(file, document.toString());
    return true;
}
