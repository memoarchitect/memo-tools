// ─── memo-architect mcp CLI Command ────────────────────────────────────────────────────
//
//   memo-architect mcp              — serve the model over MCP on stdio (read-only)
//   memo-architect mcp --write      — same, with the model-editing tools enabled
//   memo-architect mcp init         — connect Claude Code, Cursor and VS Code to it
//
// The serve path must keep stdout clean for JSON-RPC frames, so it prints
// nothing there. `init` is an ordinary command and prints normally.
// ─────────────────────────────────────────────────────────────────────────────

import { resolve } from 'node:path';
import chalk from 'chalk';
import { findConfigFile, findProjectRoot } from '../index.js';
import { AI_CLIENTS, connectAiClient } from '../mcp/clients.js';
import { startMcpServer } from '../mcp/server.js';

export interface McpServeOptions {
    project?: string;
    write?: boolean;
    version?: string;
}

export async function mcpCommand(options: McpServeOptions): Promise<void> {
    // Without --project the model is the one the working directory is in: a client starts a project's
    // servers in the project, which may be a folder below the model's root.
    const projectRoot = options.project
        ? resolve(options.project)
        : findProjectRoot(process.cwd()) ?? resolve(process.cwd());

    if (!findConfigFile(projectRoot)) {
        // stderr, not stdout — an MCP client is reading stdout as protocol.
        console.error(chalk.red(`No MEMO project found at ${projectRoot}.`));
        console.error(chalk.dim('Run `memo-architect init` there, or pass --project <path>.'));
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
    /** Let the tools propose model edits, which wait for approval in Architect. */
    write?: boolean;
    /** Skip writing the Cursor rules file. */
    noRules?: boolean;
}

/** The same connection Architect's Settings › Assistant makes, for every AI coding tool at once. */
export async function mcpInitCommand(options: McpInitOptions): Promise<void> {
    const projectRoot = resolve(options.project ?? process.cwd());

    if (!findConfigFile(projectRoot)) {
        console.error(chalk.red(`No MEMO project found at ${projectRoot}.`));
        console.error(chalk.dim('Run `memo-architect init` first.'));
        process.exit(1);
    }

    for (const client of AI_CLIENTS) {
        const status = connectAiClient(projectRoot, client.id, { proposesEdits: options.write === true, rules: !options.noRules });
        console.log(`Connected ${chalk.cyan(status.label)} (${status.file})`);
    }
    console.log('');
    console.log(options.write
        ? chalk.yellow('The tools may propose model edits. Each waits for you under AI Tools › Pending changes in Architect.')
        : chalk.dim('The tools can read and check the model. Re-run with --write to let them propose edits.'));
    console.log(chalk.dim('The same switches are in Architect under Settings › Assistant. Restart the tool to pick the server up.'));
}
