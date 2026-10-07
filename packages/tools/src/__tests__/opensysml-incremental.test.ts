// ─── OpenSysML stage 1, converting only the project's documents ──────────────
//
// Runs when a service built with the `convert_documents` capability is
// configured (`OPENSYSML_BINARY`, and `MEMO_OPENSYSML_CLIENT` for a Node client
// that sends it). Incremental equals fresh: after each edit the model built
// from the libraries' kept handoff plus a project-only conversion equals the
// one stage 2 builds from a conversion of the whole model
// (plans/memo-incremental-stage1.md).
// ─────────────────────────────────────────────────────────────────────────────

import { openSysMLFlags, openSysMLUnderTest } from './helpers/compile-source.js';
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { outlinesFromHandoff } from '../authoring/outline-source.js';
import { discoverProjectSources } from '../model/native-project.js';
import { modelToDTO } from '../model/semantic.js';
import { findSysmlFiles } from '../model/sysml-files.js';
import { ApiModel, type ApiElement } from '../stage2/api-model.js';
import { stage2FromHandoff } from '../stage2/stage2-from-handoff.js';
import type { CompileModelOptions } from '../toolchain/registry.js';
import { connectOpenSysML } from '../toolchain/providers/opensysml.js';
import { compileWithOpenSysML, forgetOpenSysMLSession, openSysMLHandoff, openSysMLLastConversion } from '../toolchain/providers/opensysml-lowering.js';

const opensysml = openSysMLUnderTest;
const example = resolve(__dirname, `../../../../../memo/examples/${process.env.MEMO_INCREMENTAL_EXAMPLE ?? 'temperature-alarm'}`);
const FILE = process.env.MEMO_INCREMENTAL_FILE ?? 'model/catalog/temperature_alarm.sysml';

describe.runIf(Boolean(opensysml) && existsSync(example))('OpenSysML stage 1, converting the project only', () => {
    let root: string;
    let options: CompileModelOptions;
    beforeAll(() => {
        root = mkdtempSync(join(tmpdir(), 'memo-opensysml-incremental-'));
        cpSync(example, root, { recursive: true, filter: source => !source.includes(`${example}/.memo`) });
        const sources = discoverProjectSources(root);
        options = {
            config: { projectName: 'x', toolchain: { compiler: 'opensysml', opensysml } } as unknown as CompileModelOptions['config'],
            projectDir: root,
            libraryDirs: [...new Set(sources.libraryRoots.map(r => r.sysmlDir))],
            projectFiles: new Set(sources.projectFiles.map(file => relative(root, file))),
            resolveProject: true,
            cacheDir: join(root, '.memo', 'stage1'),
        };
    });
    afterAll(() => rmSync(root, { recursive: true, force: true }));

    /** The outlines of the last `fresh()` model (a new handoff's elements, so none kept from an earlier compile). */
    let freshOutlines = '';
    let compiledOutlines = '';

    /** The model from one conversion of the whole model: what the provider did before. */
    async function fresh(): Promise<string> {
        const connection = await connectOpenSysML(options.config);
        try {
            const documents = [...new Set([
                ...options.libraryDirs.flatMap(dir => findSysmlFiles(dir)).map(file => resolve(file)),
                ...[...options.projectFiles].map(file => resolve(root, file)),
            ])];
            const parsed = await connection.rpc.parseSources({ documents: documents.map(file => ({ source: { case: 'filePath', value: file } })) });
            const converted = await connection.rpc.convert({ source: { case: 'modelHash', value: parsed.modelHash }, toFormat: 'api-json' });
            const handoff = openSysMLHandoff(JSON.parse(converted.content) as ApiElement[], {
                projectDir: root, libraryDirs: options.libraryDirs, providerVersion: connection.info?.version,
                source: path => (existsSync(path) ? readFileSync(path) : undefined),
            });
            const api = new ApiModel(handoff);
            freshOutlines = JSON.stringify(outlinesFromHandoff(root, api));
            return JSON.stringify(modelToDTO(stage2FromHandoff(api, { ...options }).model));
        } finally {
            await connection.close();
        }
    }

    async function compiled(): Promise<string> {
        const result = await compileWithOpenSysML({ ...options, force: true });
        expect(result.accepted).toBe(true);
        compiledOutlines = JSON.stringify(outlinesFromHandoff(root, result.api!));
        return JSON.stringify(modelToDTO(result.model!));
    }

    function edit(change: (text: string) => string): void {
        const file = join(root, FILE);
        writeFileSync(file, change(readFileSync(file, 'utf8')));
    }

    it('equals a whole-model conversion after each edit, and is faster', async () => {
        const times: number[] = [];
        const reached: string[] = [];
        const timed = async (): Promise<string> => {
            const start = performance.now();
            const model = await compiled();
            times.push(Math.round(performance.now() - start));
            reached.push(`${openSysMLLastConversion.converted}/${openSysMLLastConversion.of}`);
            return model;
        };
        expect(await timed()).toBe(await fresh());
        expect(compiledOutlines).toBe(freshOutlines);
        edit(text => text.replace(/=\s*(\d+)\s*;/, (_, n: string) => `= ${Number(n) + 1};`));
        expect(await timed()).toBe(await fresh());
        expect(compiledOutlines).toBe(freshOutlines);
        edit(text => text.replace('{', '{ part def IncrementalProbe; '));
        expect(await timed()).toBe(await fresh());
        expect(compiledOutlines).toBe(freshOutlines);
        edit(text => `${text}\npackage broken { part p : NoSuchType; }\n`);
        expect((await compileWithOpenSysML({ ...options, force: true })).accepted).toBe(false);
        edit(text => text.replace(/\npackage broken \{[^\n]*\}\n$/, ''));
        expect(await timed()).toBe(await fresh());
        expect(compiledOutlines).toBe(freshOutlines);
        // The service reports an edit narrow only once it has seen the documents twice; comments stay narrow.
        edit(text => `${text}\n// a comment\n`);
        expect(await timed()).toBe(await fresh());
        expect(compiledOutlines).toBe(freshOutlines);
        edit(text => `${text}\n// another comment\n`);
        expect(await timed()).toBe(await fresh());
        expect(compiledOutlines).toBe(freshOutlines);
        console.log('documents compile ms (first, value, declaration, repaired, comment, comment):', times.join(', '), '| converted:', reached.join(', '));
        // Only the documents the edit reached are converted; a service without `parse_sources_affected` converts them all.
        if (openSysMLLastConversion.incremental) expect(reached.slice(1).some(r => r.split('/')[0] !== r.split('/')[1])).toBe(true);
    }, 300_000);

    it('a new process reads what the last compile stored, document by document', async () => {
        const first = await compileWithOpenSysML({ ...options, force: true });
        expect(first.accepted).toBe(true);
        // A fresh process knows nothing of the service's model: it reads the store.
        forgetOpenSysMLSession();
        const again = await compileWithOpenSysML({ ...options });
        expect(again.cached).toBe(true);
        expect(JSON.stringify(modelToDTO(again.model!))).toBe(JSON.stringify(modelToDTO(first.model!)));
        // And its first edit, with no base to compare against, converts everything and is still the fresh model.
        edit(text => text.replace(/=\s*(\d+)\s*;/, (_, n: string) => `= ${Number(n) + 1};`));
        expect(await compiled()).toBe(await fresh());
        expect(openSysMLLastConversion.incremental).toBe(false);
        // A restart from the store, an edit, then an edit again: the store carries the pieces the second one reuses.
        edit(text => text.replace(/=\s*(\d+)\s*;/, (_, n: string) => `= ${Number(n) + 1};`));
        expect(await compiled()).toBe(await fresh());
        forgetOpenSysMLSession();
        expect(JSON.stringify(modelToDTO((await compileWithOpenSysML({ ...options })).model!))).toBe(await fresh());
    }, 300_000);
});
