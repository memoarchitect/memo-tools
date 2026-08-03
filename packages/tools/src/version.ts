// ─── This build's version ────────────────────────────────────────────────────
//
// Read from the package manifest rather than restated as a literal, so it
// cannot drift from what `scripts/sync-version.mjs` writes.
//
// It exists because a conformance result has to say which MEMO produced it —
// the same reason the result carries the Release commit. A number with no
// provenance on either side is not comparable to the next one.
// ─────────────────────────────────────────────────────────────────────────────

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

let cached: string | undefined;

export function memoVersion(): string {
    if (cached) return cached;
    try {
        const manifest = resolve(dirname(fileURLToPath(import.meta.url)), '../../../package.json');
        cached = (JSON.parse(readFileSync(manifest, 'utf-8')) as { version?: string }).version ?? 'unknown';
    } catch {
        cached = 'unknown';
    }
    return cached;
}
