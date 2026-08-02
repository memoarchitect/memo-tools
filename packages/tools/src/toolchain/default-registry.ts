// ─── The registration surface ────────────────────────────────────────────────
//
// This is the whole of it. Adding a provider is one new adapter file plus one
// `register(...)` line here — a modularity test asserts exactly that, by
// registering a stub provider and checking nothing else had to change.
// ─────────────────────────────────────────────────────────────────────────────

import { ProviderRegistry } from './registry.js';
import {
    internalLoweringDescriptor,
    internalPackageDescriptor,
    internalValidatorDescriptor,
} from './providers/internal.js';
import { sysideValidatorDescriptor } from './providers/syside.js';
import { sysandPackageDescriptor } from './providers/sysand.js';

/**
 * Build a registry with the providers that ship with MEMO.
 *
 * Order is registration order, which is the order roles are listed in. It
 * carries no precedence: the default for a role is whichever descriptor claims
 * `isDefault`, not whichever registered first.
 */
export function createDefaultRegistry(): ProviderRegistry {
    return new ProviderRegistry()
        .register(internalValidatorDescriptor)
        .register(internalLoweringDescriptor)
        .register(internalPackageDescriptor)
        .register(sysideValidatorDescriptor)
        .register(sysandPackageDescriptor);
}

/** The registry commands use when they are not given one. */
export const defaultRegistry: ProviderRegistry = createDefaultRegistry();
