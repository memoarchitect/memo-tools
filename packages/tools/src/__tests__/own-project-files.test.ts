// ─── A command reads what the project includes ──────────────────────────────
//
// `include` names a project's source roots. Export, `interfaces` and `anatomy`
// used to walk every `.sysml` file under the project directory instead, so a
// scratch folder beside the model, which `memo compile` and Architect ignore,
// failed the export. `ownProjectFiles` is the project's own files: its included
// sources and the library roots inside it.
// ─────────────────────────────────────────────────────────────────────────────

import { cpSync, existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { discoverProjectSources, ownProjectFiles } from '../model/native-project.js';

const example = resolve(__dirname, '../../../../../memo/examples/temperature-alarm');

describe.runIf(existsSync(example))('ownProjectFiles', () => {
    it('leaves out a .sysml file under the project that include does not name', () => {
        const base = realpathSync(mkdtempSync(join(tmpdir(), 'memo-own-files-')));
        try {
            cpSync(example, join(base, 'p'), { recursive: true, filter: source => !source.includes('/.memo') });
            mkdirSync(join(base, 'p', 'analysis'));
            const stray = join(base, 'p', 'analysis', 'scratch.sysml');
            writeFileSync(stray, 'package scratch { this does not parse }\n');

            const files = ownProjectFiles(join(base, 'p'));
            expect(files).not.toContain(stray);
            expect(files.length).toBeGreaterThan(0);
            for (const file of discoverProjectSources(join(base, 'p')).projectFiles) expect(files).toContain(file);
            expect(files.every(file => file.startsWith(join(base, 'p')))).toBe(true);
        } finally {
            rmSync(base, { recursive: true, force: true });
        }
    });
});
