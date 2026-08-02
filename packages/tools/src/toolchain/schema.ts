// ─── `--toolchain.*` options, generated from the schema ──────────────────────
//
// Every leaf under `toolchain.*` gets a CLI option, and it gets it by being in
// the schema — not by someone remembering to add a flag. A provider that
// contributes a settings leaf gets its flag for free, which is what makes
// "adding a provider touches one file" true of the CLI as well.
//
// Deliberately *only* the toolchain subtree. Whole-config CLI generation, an
// env-var layer, `--unset`, and array append/replace policy are all out of
// scope here.
// ─────────────────────────────────────────────────────────────────────────────

import { Option, type Command } from 'commander';
import type { MEMOConfig, ToolchainConfig } from '../model/config.js';
import type { ProviderRegistry, ToolchainSchemaLeaf } from './registry.js';

/** `toolchain.syside.executable` — the option name and the settings path. */
export function toolchainOptionName(leaf: ToolchainSchemaLeaf): string {
    return `toolchain.${leaf.path}`;
}

/** The flag string commander is given, e.g. `--toolchain.syside.executable <value>`. */
export function toolchainOptionFlag(leaf: ToolchainSchemaLeaf): string {
    const placeholder = leaf.type === 'boolean' ? '<true|false>'
        : leaf.type === 'enum' ? `<${(leaf.values ?? []).join('|') || 'value'}>`
            : '<value>';
    return `--${toolchainOptionName(leaf)} ${placeholder}`;
}

function optionDescription(leaf: ToolchainSchemaLeaf): string {
    const parts = [leaf.description];
    if (leaf.deprecated) parts.push(`(deprecated: ${leaf.deprecated})`);
    return parts.join(' ');
}

/**
 * Add every generated option to a command.
 *
 * Commander stores an option whose name contains dots under that exact key —
 * it only camel-cases across dashes — so `opts()['toolchain.syside.executable']`
 * is what comes back, and the settings path is recoverable without a lookup
 * table that could drift from the schema.
 */
export function applyToolchainCliOptions(command: Command, registry: ProviderRegistry): Command {
    for (const leaf of registry.schema()) {
        const option = new Option(toolchainOptionFlag(leaf), optionDescription(leaf));
        // Let commander reject a bad value at parse time, with its own message
        // and exit code. The roster it prints comes from the registry, so
        // `--toolchain.validator=nope` lists what is actually registered rather
        // than a stack trace or a copy of the roster written down here.
        const choices = leaf.type === 'boolean' ? ['true', 'false'] : leaf.values;
        if (choices) option.choices([...choices]);
        command.addOption(option);
    }
    return command;
}

export class ToolchainOptionError extends Error {}

function coerce(leaf: ToolchainSchemaLeaf, raw: string): string | boolean {
    if (leaf.type === 'boolean') {
        if (raw === 'true') return true;
        if (raw === 'false') return false;
        throw new ToolchainOptionError(
            `--${toolchainOptionName(leaf)} expects true or false, got "${raw}".`);
    }
    if (leaf.type === 'enum' && leaf.values && !leaf.values.includes(raw)) {
        // A role leaf's values are the registered providers, so this message is
        // the live roster and not a copy of one.
        throw new ToolchainOptionError(
            `--${toolchainOptionName(leaf)} expects one of ${leaf.values.join(', ')}, got "${raw}".`);
    }
    return raw;
}

/** Turn parsed CLI options into a partial `toolchain` block. */
export function toolchainOverridesFromCliOptions(
    options: Record<string, unknown>,
    registry: ProviderRegistry,
): ToolchainConfig {
    const overrides: ToolchainConfig = {};
    for (const leaf of registry.schema()) {
        const raw = options[toolchainOptionName(leaf)];
        if (raw === undefined) continue;
        setPath(overrides, leaf.path, coerce(leaf, String(raw)));
    }
    return overrides;
}

function setPath(target: Record<string, unknown>, path: string, value: unknown): void {
    const segments = path.split('.');
    let cursor: Record<string, unknown> = target;
    for (const segment of segments.slice(0, -1)) {
        const next = cursor[segment];
        cursor[segment] = next && typeof next === 'object' ? next : {};
        cursor = cursor[segment] as Record<string, unknown>;
    }
    cursor[segments[segments.length - 1]] = value;
}

/**
 * Apply overrides on top of loaded settings.
 *
 * A flag beats the settings file leaf by leaf, so `--toolchain.syside.diagnose`
 * does not discard a configured `--toolchain.syside.executable`.
 */
export function applyToolchainOverrides(config: MEMOConfig, overrides: ToolchainConfig): MEMOConfig {
    if (Object.keys(overrides).length === 0) return config;
    const merged: ToolchainConfig = { ...(config.toolchain ?? {}) };
    for (const [key, value] of Object.entries(overrides)) {
        const existing = merged[key];
        merged[key] = value && typeof value === 'object' && existing && typeof existing === 'object'
            ? { ...existing as object, ...value as object }
            : value;
    }
    return { ...config, toolchain: merged };
}

/** Convenience for a command: read its options, merge, hand back settings. */
export function withToolchainOverrides(
    config: MEMOConfig,
    options: Record<string, unknown>,
    registry: ProviderRegistry,
): MEMOConfig {
    return applyToolchainOverrides(config, toolchainOverridesFromCliOptions(options, registry));
}
