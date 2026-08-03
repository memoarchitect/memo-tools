#!/usr/bin/env node
// ─── sysmlc ──────────────────────────────────────────────────────────────────
//
// MEMO's own compiler, shipped as a tool. Two modes and no more:
//
//   one-shot   `sysmlc check <dir>` and `sysmlc emit-ir <dir>` — for scripts,
//              CI, and anyone who wants to see what MEMO reads without running
//              MEMO. Pays Node's startup once, which is what one-shot is for.
//   server     `sysmlc serve --stdio` — LSP. What Architect's live refresh
//              talks to, and what an editor can talk to unchanged.
//
// The reason this exists at all is that in-process, a contract can be cheated:
// objects pass by reference, state is shared, serialization is skipped. Over a
// pipe none of that is possible, so the IR and the protocol become a boundary
// we meet before any third party does.
// ─────────────────────────────────────────────────────────────────────────────

import { resolve } from 'node:path';
import { Command } from 'commander';
import {
    SYSMLC_PROTOCOL_VERSION,
    checkProject,
    lowerProject,
    type ParseError,
    type SysmlcCheckOutput,
    type SysmlcEmitIrOutput,
} from '@memoarchitect/tools';
import { packageVersion, serveStdio } from '../server.js';

/**
 * `file:line:col: error: message` — the prefix every editor and CI annotator
 * already parses.
 *
 * No domain suffix here. A domain answers "whose complaint is this?", and that
 * depends on which role the caller put this compiler in — a question the
 * compiler is not the one to answer. MEMO stamps it; `sysmlc` reports what it
 * found.
 */
function formatGnu(error: ParseError): string {
    const where = error.line !== undefined
        ? `${error.file}:${error.line}:${error.column ?? 1}: `
        : error.file ? `${error.file}: ` : '';
    return `${where}error: ${error.message}`;
}

function report(errors: readonly ParseError[], payload: unknown, format: string): void {
    if (format === 'json') {
        process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
        return;
    }
    for (const error of errors) process.stdout.write(`${formatGnu(error)}\n`);
}

const program = new Command();
program
    .name('sysmlc')
    .description("MEMO's SysML v2 compiler")
    .version(packageVersion() ?? '0.0.0', '-V, --version')
    .option('--protocol-version', 'print the protocol version this build speaks and exit');

program
    .command('check')
    .description('Parse a project and report what the compiler could not read')
    .argument('[dir]', 'project directory', '.')
    .option('--format <gnu|json>', 'output format', 'gnu')
    .action(async (dir: string, options: { format: string }) => {
        const { accepted, parseErrors } = await checkProject(resolve(dir));
        const payload: SysmlcCheckOutput = {
            protocolVersion: SYSMLC_PROTOCOL_VERSION, accepted, parseErrors,
        };
        report(parseErrors, payload, options.format);
        // A rejected revision is a normal state, not a crash: exit 1 says "there
        // are errors", the way every compiler does.
        process.exitCode = accepted ? 0 : 1;
    });

program
    .command('emit-ir')
    .description('Lower a project and write its IR')
    .argument('[dir]', 'project directory', '.')
    .option('--format <json>', 'output format', 'json')
    .action(async (dir: string) => {
        const ir = await lowerProject(resolve(dir));
        const payload: SysmlcEmitIrOutput = { protocolVersion: SYSMLC_PROTOCOL_VERSION, ir };
        process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
        // Emitting is not gating (§1.1): partial IR for a broken revision is
        // exactly what the canvas needs to draw what *was* understood, so the IR
        // is written either way and the status says whether it is complete.
        process.exitCode = ir.accepted ? 0 : 1;
    });

program
    .command('serve')
    .description('Run as a language server')
    .option('--stdio', 'communicate over stdin/stdout', false)
    .action((options: { stdio: boolean }) => {
        if (!options.stdio) {
            process.stderr.write('sysmlc serve requires --stdio. No other transport is offered.\n');
            process.exitCode = 2;
            return;
        }
        serveStdio(packageVersion());
    });

if (process.argv.includes('--protocol-version')) {
    process.stdout.write(`${SYSMLC_PROTOCOL_VERSION}\n`);
} else {
    await program.parseAsync(process.argv);
}
