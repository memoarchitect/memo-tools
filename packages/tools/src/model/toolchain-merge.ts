// ─── Layering toolchain settings ─────────────────────────────────────────────
//
// The toolchain is set from layers: the user's own settings, the project's
// settings file, and the command line, each beating the one before. A leaf of
// a higher layer replaces the same leaf below it, and one provider's flag does
// not discard another leaf of that provider's settings.
//
// `compiler` is the one leaf that stands for others: it fills the validator
// and the lowering roles. So a layer that names a compiler decides both roles
// for everything below it, and the explicit `validator` / `lowering` a lower
// layer set are dropped. Left in, they would beat the higher layer's compiler
// (an explicit role outranks the alias), and a flag would not override the
// project it was given to.
// ─────────────────────────────────────────────────────────────────────────────

import type { ToolchainConfig } from './config.js';

/** The roles `compiler` fills, by their settings keys. */
const COMPILER_ROLES = ['validator', 'lowering'] as const;

/** `overrides` on top of `base`, leaf by leaf. */
export function mergeToolchain(base: ToolchainConfig | undefined, overrides: ToolchainConfig | undefined): ToolchainConfig {
    const merged: ToolchainConfig = { ...(base ?? {}) };
    if (overrides && overrides.compiler !== undefined) {
        for (const role of COMPILER_ROLES) {
            if (overrides[role] === undefined) delete merged[role];
        }
    }
    for (const [key, value] of Object.entries(overrides ?? {})) {
        const existing = merged[key];
        merged[key] = value && typeof value === 'object' && existing && typeof existing === 'object'
            ? { ...existing as object, ...value as object }
            : value;
    }
    return merged;
}
