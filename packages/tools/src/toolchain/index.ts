// ─── The toolchain ───────────────────────────────────────────────────────────
//
// `memo-tools` is the tooling interface: the operations re-exported here are
// the single implementation behind both the `memo` CLI and Architect's server
// protocol. Architect never spawns a tool, never parses a tool's output, and
// never learns a provider's name.
//
// The registrations live in `default-registry.ts`; the adapters in
// `providers/`. Nothing outside `providers/` writes a provider ID.
// ─────────────────────────────────────────────────────────────────────────────

export * from './diagnostic.js';
export * from './registry.js';
export * from './effective.js';
export * from './schema.js';
export * from './operations.js';
export * from './default-registry.js';
export { whichExecutable, resolveExecutable, resolveProjectPath } from './process.js';
