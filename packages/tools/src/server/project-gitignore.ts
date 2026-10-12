// ─── The project's own .gitignore ────────────────────────────────────────────
//
// A file MEMO writes for one person only (a personal dashboard, the role they
// chose) sits in the project where they can see it, never in a hidden folder,
// and is kept out of git by a line in the project's `.gitignore` that MEMO adds
// the first time it writes one.
// ─────────────────────────────────────────────────────────────────────────────

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Make sure the project's `.gitignore` carries `rule`.
 *
 * Appends one commented line, never rewrites the file. Already covered is
 * judged by an exact line match on the rule with and without a leading `/`
 * and a trailing `/`; anything cleverer is the user's own rule to keep.
 */
export function ensureGitIgnored(projectRoot: string, rule: string, comment: string): void {
    const path = resolve(projectRoot, '.gitignore');
    const existing = existsSync(path) ? readFileSync(path, 'utf8') : '';
    const bare = rule.replace(/^\//, '').replace(/\/$/, '');
    const spellings = new Set([bare, `${bare}/`, `/${bare}`, `/${bare}/`]);
    if (existing.split(/\r?\n/).some(line => spellings.has(line.trim()))) return;
    const lead = existing === '' || existing.endsWith('\n') ? '' : '\n';
    writeFileSync(path, `${existing}${lead}\n# ${comment}\n${rule}\n`, 'utf8');
}
