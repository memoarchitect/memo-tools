// ─── The OpenSysML stage 1 store ─────────────────────────────────────────────
//
// A compile keeps the service's api-json text in `.memo/stage1/` for the next
// process (`memo validate` after `memo compile`), not a serialization of the
// handoff: on a large model that serialization cost more than the rest of
// MEMO's share of a compile, on every edit of a `memo dev` session. A reused
// compile rebuilds the handoff from the text and gives the model a fresh one
// gives.
// ─────────────────────────────────────────────────────────────────────────────

import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { discoverProjectSources } from '../model/native-project.js';
import { modelToDTO } from '../model/semantic.js';
import type { CompileModelOptions } from '../toolchain/registry.js';
import { compileWithOpenSysML } from '../toolchain/providers/opensysml-lowering.js';
import { openSysMLUnderTest } from './helpers/compile-source.js';

const opensysml = openSysMLUnderTest;
const example = resolve(__dirname, '../../../../../memo/examples/temperature-alarm');
const FILE = 'model/catalog/temperature_alarm.sysml';

describe.runIf(Boolean(opensysml) && existsSync(example))('the OpenSysML stage 1 store', () => {
    let root: string;
    let options: CompileModelOptions;
    const stage1 = () => join(root, '.memo', 'stage1');
    beforeAll(() => {
        root = mkdtempSync(join(tmpdir(), 'memo-opensysml-store-'));
        cpSync(example, root, { recursive: true, filter: source => !source.includes(`${example}/.memo`) });
        const sources = discoverProjectSources(root);
        options = {
            config: { projectName: 'x', toolchain: { compiler: 'opensysml', opensysml } } as unknown as CompileModelOptions['config'],
            projectDir: root,
            libraryDirs: [...new Set(sources.libraryRoots.map(r => r.sysmlDir))],
            projectFiles: new Set(sources.projectFiles.map(file => relative(root, file))),
            resolveProject: true,
            cacheDir: stage1(),
        };
    });
    afterAll(() => rmSync(root, { recursive: true, force: true }));

    const modelOf = (result: Awaited<ReturnType<typeof compileWithOpenSysML>>) => JSON.stringify(modelToDTO(result.model!));

    it('stores the conversion as the service wrote it, not the handoff', async () => {
        const first = await compileWithOpenSysML({ ...options, force: true });
        expect(first.accepted).toBe(true);
        expect(first.cached).toBe(false);
        expect(existsSync(join(stage1(), 'opensysml.api.json'))).toBe(true);
        expect(existsSync(join(stage1(), 'opensysml.json'))).toBe(false);
        // The text is api-json: an array of elements, as Convert returned it.
        expect(Array.isArray(JSON.parse(readFileSync(join(stage1(), 'opensysml.api.json'), 'utf8')))).toBe(true);
    }, 120_000);

    it('reuses it while nothing changed, rebuilding the same model', async () => {
        const fresh = await compileWithOpenSysML({ ...options, force: true });
        const reused = await compileWithOpenSysML(options);
        expect(reused.cached).toBe(true);
        expect(modelOf(reused)).toBe(modelOf(fresh));
        expect(reused.diagnostics).toEqual(fresh.diagnostics);
    }, 120_000);

    it('compiles again after an edit', async () => {
        await compileWithOpenSysML(options);
        const file = join(root, FILE);
        writeFileSync(file, readFileSync(file, 'utf8') + '\n// an edit\n');
        const after = await compileWithOpenSysML(options);
        expect(after.cached).toBe(false);
        expect(after.accepted).toBe(true);
    }, 120_000);

    it('compiles again when the stored conversion is gone, rather than serving half a model', async () => {
        await compileWithOpenSysML({ ...options, force: true });
        rmSync(join(stage1(), 'opensysml.api.json'));
        const again = await compileWithOpenSysML(options);
        expect(again.cached).toBe(false);
        expect(again.accepted).toBe(true);
    }, 120_000);
});
