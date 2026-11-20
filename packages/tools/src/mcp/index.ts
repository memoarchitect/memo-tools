// ─── MCP Module ──────────────────────────────────────────────────────────────
//
// Model Context Protocol server exposing the MEMO model to AI coding tools
// (Cursor, Claude Code, Windsurf). Served over stdio by `memo-architect mcp`.
// ─────────────────────────────────────────────────────────────────────────────

export * from './server.js';
export * from './tools.js';
export * from './model-loader.js';
export * from './clients.js';
export * from './architect-address.js';
export * from './prompts-and-resources.js';
