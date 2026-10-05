// ─── Stage 1 output reuse ────────────────────────────────────────────────────
//
// `memo compile` keeps SysIDE's stage 1 output in `.memo/stage1/`, and a later
// compile or `memo validate` reuses it while every input is unchanged. The
// interpreter named here does not exist, so any attempt to actually compile
// throws: a result that comes back proves it came from the cache, and a throw
// proves the cache was (rightly) not trusted.
// ─────────────────────────────────────────────────────────────────────────────

import { cpSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { compileWithSyside, sysideInputKey, sysideLibraryKey } from '../toolchain/providers/syside-lowering.js';

const fixtureDir = resolve(import.meta.dirname, 'fixtures/stage2');
const NO_PYTHON = '/nonexistent/python-for-stage1-cache-test';

function project() {
    const dir = mkdtempSync(join(tmpdir(), 'memo-stage1-cache-'));
    cpSync(join(fixtureDir, 'api-model-src'), dir, { recursive: true });
    const cacheDir = join(dir, '.memo', 'stage1');
    cpSync(join(fixtureDir, 'api-model.stage1.json'), join(cacheDir, 'syside.json'));
    writeFileSync(join(cacheDir, 'syside.json.key'), sysideInputKey(NO_PYTHON, dir, sysideLibraryKey(NO_PYTHON, [])));
    const options = {
        config: { projectName: 'p', toolchain: { syside: { python: NO_PYTHON } } },
        projectDir: dir, libraryDirs: [], projectFiles: new Set(['model.sysml']), cacheDir,
    };
    return { dir, options };
}

describe('stage 1 output reuse', () => {
    it('reuses the output while every input is unchanged, without running the compiler', async () => {
        const { options } = project();
        const result = await compileWithSyside(options);
        expect(result.cached).toBe(true);
        expect(result.accepted).toBe(true);
        expect(result.model?.elements.has('Model::pump')).toBe(true);
    });

    it('compiles again once a model file changes', async () => {
        const { dir, options } = project();
        const file = join(dir, 'model.sysml');
        writeFileSync(file, `${readFileSync(file, 'utf8')}\n// edited\n`);
        await expect(compileWithSyside(options)).rejects.toThrow(/could not run/);
    });

    it('compiles again when asked to, however fresh the output', async () => {
        const { options } = project();
        await expect(compileWithSyside({ ...options, force: true })).rejects.toThrow(/could not run/);
    });

    it('keys on the files compiled, an include root outside the project among them', () => {
        const outside = mkdtempSync(join(tmpdir(), 'memo-stage1-include-'));
        const file = join(outside, 'ots.sysml');
        writeFileSync(file, 'package ots_lib;\n');
        const { dir } = project();
        const key = () => sysideInputKey(NO_PYTHON, dir, sysideLibraryKey(NO_PYTHON, []), [join(dir, 'model.sysml'), file]);
        const before = key();
        writeFileSync(file, 'package ots_lib { part def OtsPart; }\n');
        expect(key()).not.toBe(before);
    });
});
