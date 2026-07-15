// ─── Importers ───────────────────────────────────────────────────────────────
//
// Import modules for migrating from legacy MBSE tools into MEMO.
//
// Supported sources:
//   - Sparx EA (.qea/.eap via JSON export)
//   - MagicDraw/Cameo (.mdzip/.mdxml via XMI/JSON)
//   - SysAnd projects (.project.json + SysML files)
//   - OWL/Turtle and JSON-LD ontologies
// ─────────────────────────────────────────────────────────────────────────────

export * from './ea-importer.js';
export * from './cameo-importer.js';
export * from './sysand-importer.js';
export * from './owl-importer.js';
