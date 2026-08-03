// @memoarchitect/sysmlc — MEMO's compiler as a tool.
//
// The protocol itself lives in `@memoarchitect/tools`, because both sides of a
// boundary have to agree on it and only one of them can own it. This package
// implements that protocol; it does not define it.

export { SysmlcServer, serveStdio, protocolCapability, packageVersion, IMPLEMENTATION_NAME } from './server.js';
