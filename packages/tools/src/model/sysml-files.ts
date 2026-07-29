// ─── SysML source discovery ──────────────────────────────────────────────────
//
// One walker for every command that needs "the .sysml files in this project".
// It used to be copy-pasted into each command, which meant a directory learned
// to be skipped in one place and not the other thirteen.
// ─────────────────────────────────────────────────────────────────────────────

import { existsSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Directories that never contain project sources.
 *
 * `.venv`, `__pycache__`, `dist` and `.sysand` are build/tool output that can
 * hold copies of model files — parsing those reports duplicate elements and
 * phantom errors against files the author does not edit.
 */
const ALWAYS_SKIP = new Set([
    'node_modules', '.memo', '.git', '.sysand', '.venv', '__pycache__', 'dist',
]);

/**
 * Whether to skip a directory during the walk.
 *
 * A `samples/` directory beside `memo.package.yaml` is a project's own scratch
 * area — free-form SysML that is not part of the model and often does not
 * parse. Nested `model/samples/` in the bundled examples is real content, so
 * the rule is anchored to the package root rather than the name alone.
 */
function shouldSkipDirectory(parentDir: string, name: string): boolean {
    if (ALWAYS_SKIP.has(name)) return true;
    return name === 'samples' && existsSync(resolve(parentDir, 'memo.package.yaml'));
}

/** Every `.sysml` file under `dir`, skipping output and scratch directories. */
export function findSysmlFiles(dir: string): string[] {
    const files: string[] = [];
    try {
        for (const entry of readdirSync(dir, { withFileTypes: true })) {
            const full = resolve(dir, entry.name);
            if (entry.isDirectory()) {
                if (!shouldSkipDirectory(dir, entry.name)) files.push(...findSysmlFiles(full));
            } else if (entry.name.endsWith('.sysml')) {
                files.push(full);
            }
        }
    } catch {
        // Unreadable directory (permissions, races) — skip rather than fail the walk.
    }
    return files;
}
