// ─── MCP Module ──────────────────────────────────────────────────────────────
//
// Model Context Protocol server exposing the MEMO model to AI coding tools
// (Cursor, Claude Code, Windsurf). Served over stdio by `memo mcp`.
// ─────────────────────────────────────────────────────────────────────────────

export * from './server.js';
export * from './tools.js';
export * from './model-loader.js';
