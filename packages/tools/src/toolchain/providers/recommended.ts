// ─── The recommended compiler ────────────────────────────────────────────────
//
// The one place that says which stage 1 compiler MEMO recommends. Changing it is
// the whole switch: `memo-architect init` writes it into a new project, and the
// test suite (`vitest.config.ts`) and baseline capture (`scripts/capture-baseline.mjs`)
// run under it when nothing else is chosen. It is not a fallback: a project still
// names its own compiler, and a project that names none is an error.
//
// SysIDE since 2026-10-12 (user decision); the board row "Revisit the default
// compiler" says when to look again. No imports, so a config file can read it.
// ─────────────────────────────────────────────────────────────────────────────

export const RECOMMENDED_COMPILER = 'syside';
