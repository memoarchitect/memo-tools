// ─── Conformance ─────────────────────────────────────────────────────────────
//
// Oracles without a JVM: a pinned corpus of the OMG's own published artifacts,
// a run that counts what the selected toolchain says about them, and a
// differential comparison against the reference implementation's published
// computed output.
//
// Nothing here is reachable from `validate`, `dev`, `build`, or an Architect
// refresh, and a test asserts that rather than trusting it. Conformance grades
// MEMO against the OMG's files; it says nothing about the user's project, so no
// command that is about the user's project runs it.
// ─────────────────────────────────────────────────────────────────────────────

export * from './corpus.js';
export * from './xmi.js';
export * from './run.js';
export * from './diff-xmi.js';
export * from './baseline.js';
