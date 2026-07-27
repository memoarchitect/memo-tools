// ─── memo mcp CLI Command ────────────────────────────────────────────────────
//
//   memo mcp              — serve the model over MCP on stdio (read-only)
//   memo mcp --write      — same, with the model-editing tools enabled
//   memo mcp init         — wire the server into Cursor / Claude Code
//
// The serve path must keep stdout clean for JSON-RPC frames, so it prints
// nothing there. `init` is an ordinary command and prints normally.
// ─────────────────────────────────────────────────────────────────────────────

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import chalk from 'chalk';
import { findConfigFile } from '../index.js';
import { startMcpServer } from '../mcp/server.js';

export interface McpServeOptions {
    project?: string;
    write?: boolean;
    version?: string;
}

export async function mcpCommand(options: McpServeOptions): Promise<void> {
    const projectRoot = resolve(options.project ?? process.cwd());

    if (!findConfigFile(projectRoot)) {
        // stderr, not stdout — an MCP client is reading stdout as protocol.
        console.error(chalk.red(`No MEMO project found at ${projectRoot}.`));
        console.error(chalk.dim('Run `memo init` there, or pass --project <path>.'));
        process.exit(1);
    }

    await startMcpServer({
        projectRoot,
        allowWrites: options.write === true,
        version: options.version,
    });
}

// ─── init ────────────────────────────────────────────────────────────────────

export interface McpInitOptions {
    project?: string;
    /** Register the server with edit tools enabled. */
    write?: boolean;
    /** Skip writing the Cursor rules file. */
    noRules?: boolean;
}

/** The MCP client entry MEMO registers. */
function serverEntry(projectRoot: string, write: boolean): Record<string, unknown> {
    const args = ['-y', '--package=@memoarchitect/tools', 'memo', 'mcp', '--project', projectRoot];
    if (write) args.push('--write');
    // npx rather than a bare `memo` so this works without a global install.
    return { command: 'npx', args };
}

/**
 * Merge our server into an MCP config file, preserving any other servers the
 * user has registered. Only the `memo` key is ever touched.
 */
function mergeMcpConfig(path: string, entry: Record<string, unknown>): 'created' | 'updated' {
    let config: Record<string, any> = {};
    let existed = false;

    if (existsSync(path)) {
        existed = true;
        try {
            config = JSON.parse(readFileSync(path, 'utf8'));
        } catch {
            throw new Error(`${path} is not valid JSON. Fix or remove it, then re-run.`);
        }
    }

    if (!config.mcpServers || typeof config.mcpServers !== 'object') config.mcpServers = {};
    config.mcpServers.memo = entry;

    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
    return existed ? 'updated' : 'created';
}

const CURSOR_RULES = `---
description: MEMO SysML v2 modelling conventions for this medical device project
globs:
  - "**/*.sysml"
alwaysApply: false
---

# MEMO model conventions

This project is a MEMO medical device model. The \`.sysml\` files are the
regulated source of truth — treat them as you would production code under
change control.

## Before you edit

- Call the \`memo_ontology\` MCP tool to see the element kinds and relationship
  types this project actually defines. Never invent a kind or relationship
  name; if what you need is missing, say so rather than approximating.
- Call \`memo_search_elements\` to find the exact id of anything you reference.
  Ids are SysML usage names and must match exactly.

## While you edit

- Every element belongs to exactly one architecture layer, determined by its
  kind. Do not move an element between layers as a side effect of another change.
- Relationships are typed. Use the relationship types from \`memo_ontology\`,
  with the direction the ontology specifies.
- Terms that come from a standard (ISO 14971 risk vocabulary, IEC 62304
  software safety classes) carry regulatory meaning. Use them exactly as the
  ontology defines them — never paraphrase a regulated term.

## After you edit

- Call \`memo_validate\` and resolve any new errors you introduced. Warnings
  that predate your change are not yours to fix unless asked.
- Traceability matters more than volume: a new requirement with no verification
  is a gap, not progress.
`;

export async function mcpInitCommand(options: McpInitOptions): Promise<void> {
    const projectRoot = resolve(options.project ?? process.cwd());

    if (!findConfigFile(projectRoot)) {
        console.error(chalk.red(`No MEMO project found at ${projectRoot}.`));
        console.error(chalk.dim('Run `memo init` first.'));
        process.exit(1);
    }

    const write = options.write === true;
    const entry = serverEntry(projectRoot, write);

    const mcpPath = resolve(projectRoot, '.cursor', 'mcp.json');
    const outcome = mergeMcpConfig(mcpPath, entry);
    console.log(`${outcome === 'created' ? 'Created' : 'Updated'} ${chalk.cyan('.cursor/mcp.json')}`);

    if (!options.noRules) {
        const rulesPath = resolve(projectRoot, '.cursor', 'rules', 'memo.mdc');
        mkdirSync(dirname(rulesPath), { recursive: true });
        const rulesExisted = existsSync(rulesPath);
        writeFileSync(rulesPath, CURSOR_RULES, 'utf8');
        console.log(`${rulesExisted ? 'Updated' : 'Created'} ${chalk.cyan('.cursor/rules/memo.mdc')}`);
    }

    console.log('');
    console.log(chalk.bold('MEMO is now available to Cursor.'));
    console.log(chalk.dim('Restart Cursor, then check Settings → MCP for the "memo" server.'));
    console.log('');
    console.log(write
        ? chalk.yellow('Editing tools are enabled — Cursor can write elements into your SysML source.')
        : chalk.dim('The server is read-only. Re-run with --write to let Cursor create elements.'));
    console.log('');
    console.log(chalk.dim('For Claude Code, register the same server with:'));
    console.log(chalk.dim(`  claude mcp add memo -- npx -y --package=@memoarchitect/tools memo mcp --project ${projectRoot}${write ? ' --write' : ''}`));
}
