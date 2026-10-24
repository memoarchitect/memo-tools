// ─── The default compiler ────────────────────────────────────────────────────
//
// The compiler that fills the validator and lowering roles when a project, the
// user and the command line all leave them unnamed. The open-source one, so a
// clone validates without a licence; SysIDE is chosen by saying so. It is not
// `recommended.ts`: that one is what `init` writes and the test suite runs
// under. No imports, so `effective.ts` can read it without naming a provider.
// ─────────────────────────────────────────────────────────────────────────────

export const DEFAULT_COMPILER = 'opensysml';
