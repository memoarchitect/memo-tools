#!/usr/bin/env node
// The project commands, as memo-architect's program offers them.
//
// `memo` compiles and validates; creating a project, exporting, converting,
// inspecting and the rest are registered by `registerProjectCommands` on
// memo-architect's program. MEMO Tools' own scripts and tests drive the same
// registration through this stand-in, so they exercise the commands without
// depending on the Architect package (which depends on this one).
import { Command } from 'commander';
import { registerProjectCommands } from '../packages/tools/lib/cli/project-commands.js';

const program = new Command().name('memo-architect');
registerProjectCommands(program);
await program.parseAsync(process.argv);
