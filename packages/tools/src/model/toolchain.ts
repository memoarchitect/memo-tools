import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { isAbsolute, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import type { MEMOConfig } from './config.js';
import { findOntologyPackageDirs, resolvePackageSysmlDir } from './ontology-loader.js';

export interface ToolInvocation {
    command: string;
    args: string[];
    provider: 'syside' | 'sysand';
}

function resolveProjectPath(value: string, projectDir: string): string {
    if (value === '~') return homedir();
    if (value.startsWith('~/')) return resolve(homedir(), value.slice(2));
    return isAbsolute(value) ? value : resolve(projectDir, value);
}

function resolveExecutable(value: string | undefined, fallback: string, projectDir: string): string {
    if (!value) return fallback;
    return value.includes('/') || value.includes('\\') || value.startsWith('~')
        ? resolveProjectPath(value, projectDir)
        : value;
}

export function buildCompilerInvocation(
    config: MEMOConfig,
    projectDir: string,
    includeDirs: string[] = [],
): ToolInvocation | undefined {
    const provider = config.toolchain?.compiler ?? 'internal';
    if (provider === 'internal') return undefined;
    if (provider !== 'syside') {
        throw new Error(`Unsupported compiler "${String(provider)}". Choose "internal" or "syside".`);
    }
    const tool = config.toolchain?.syside;
    const args = ['check', '--colour', 'no', '--diagnose', tool?.diagnose ?? 'project'];
    if (tool?.configFile) args.push('--config', resolveProjectPath(tool.configFile, projectDir));
    if (tool?.warningsAsErrors) args.push('--warnings-as-errors');
    for (const includeDir of [...new Set(includeDirs)]) args.push('--include', includeDir);
    args.push(projectDir);
    return {
        command: resolveExecutable(tool?.executable, 'syside', projectDir),
        args,
        provider,
    };
}

export function buildPackagerInvocation(
    config: MEMOConfig,
    projectDir: string,
    outputPath: string,
): ToolInvocation | undefined {
    const provider = config.toolchain?.packager ?? 'internal';
    if (provider === 'internal') return undefined;
    if (provider !== 'sysand') {
        throw new Error(`Unsupported packager "${String(provider)}". Choose "internal" or "sysand".`);
    }
    const tool = config.toolchain?.sysand;
    const args: string[] = [];
    if (tool?.configFile) args.push('--config-file', resolveProjectPath(tool.configFile, projectDir));
    args.push('build', outputPath);
    return {
        command: resolveExecutable(tool?.executable, 'sysand', projectDir),
        args,
        provider,
    };
}

export function runToolInvocation(invocation: ToolInvocation, cwd: string): void {
    const result = spawnSync(invocation.command, invocation.args, { cwd, stdio: 'inherit' });
    if (result.error) {
        const hint = result.error.message.includes('ENOENT')
            ? ` Configure toolchain.${invocation.provider}.executable or add it to PATH.`
            : '';
        throw new Error(`Could not run ${invocation.provider}: ${result.error.message}.${hint}`);
    }
    if (result.status !== 0) {
        throw new Error(`${invocation.provider} exited with status ${result.status ?? 'unknown'}.`);
    }
}

export function compileWithConfiguredTool(
    config: MEMOConfig,
    projectDir: string,
    configPath?: string,
): 'internal' | 'syside' {
    const includeDirs = configPath
        ? findOntologyPackageDirs(configPath).map(resolvePackageSysmlDir)
        : [];
    const invocation = buildCompilerInvocation(config, projectDir, includeDirs);
    if (!invocation) return 'internal';
    runToolInvocation(invocation, projectDir);
    return 'syside';
}

export function packageWithConfiguredTool(
    config: MEMOConfig,
    projectDir: string,
    outputPath: string,
): 'internal' | 'sysand' {
    const invocation = buildPackagerInvocation(config, projectDir, outputPath);
    if (!invocation) return 'internal';
    runToolInvocation(invocation, projectDir);
    if (!existsSync(outputPath)) {
        throw new Error(`${invocation.provider} completed but did not create ${outputPath}.`);
    }
    return 'sysand';
}
