// ─── @memo/core/import — browser-safe import utilities ───────────────────────
//
// This barrel is safe to import in browser/Vite contexts. It only re-exports
// modules with zero Node.js dependencies so Rollup can bundle them without
// tripping over node: built-ins in other core modules.
// ─────────────────────────────────────────────────────────────────────────────

export * from './recipes.js';
export * from './column-mapper.js';
export * from './import-diff.js';
