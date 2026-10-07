// ─── Source fingerprint ──────────────────────────────────────────────────────
//
// What a compile of a project read: every project and library file it
// compiles, by path and content, and the project's settings. A process that
// keeps a compiled model (`memo dev`) records the fingerprint taken before the
// compile; a model is current for exactly as long as the fingerprint is
// unchanged, whichever compiler built it.
// ─────────────────────────────────────────────────────────────────────────────

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { loadProjectSettings } from '@memoarchitect/tools';
import { discoverProjectSources } from '../model/native-project.js';

export function sourceFingerprint(projectDir: string): string {
    const sources = discoverProjectSources(projectDir);
    const hash = createHash('sha256');
    hash.update(JSON.stringify(loadProjectSettings(projectDir)));
    for (const file of [...new Set([...sources.projectFiles, ...sources.libraryFiles])].sort()) {
        hash.update('\0');
        hash.update(file);
        hash.update('\0');
        try {
            hash.update(readFileSync(file));
        } catch {
            hash.update('\0missing');
        }
    }
    return hash.digest('hex');
}
