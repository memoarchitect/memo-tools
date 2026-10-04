// ─── SysIDE stage 1, incrementally ───────────────────────────────────────────
//
// Runs when a Python with SysIDE's API is configured (`MEMO_SYSIDE_PYTHON`),
// against a scratch copy of the temperature-alarm example. One process compiles
// after each edit, as `memo dev` does: the worker keeps the libraries loaded and
// exports again only the documents an edit reached
// (plans/memo-incremental-stage1.md). Incremental equals fresh: each model
// equals the one stage 2 builds from a one-shot export of the same files.
// ─────────────────────────────────────────────────────────────────────────────

import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { discoverProjectSources } from '../model/native-project.js';
import { modelToDTO } from '../model/semantic.js';
import { ApiModel } from '../stage2/api-model.js';
import { stage2FromHandoff } from '../stage2/stage2-from-handoff.js';
import type { CompileModelOptions } from '../toolchain/registry.js';
import { compileWithSyside } from '../toolchain/providers/syside-lowering.js';

const example = resolve(__dirname, '../../../../../memo/examples/temperature-alarm');
const python = process.env.MEMO_SYSIDE_PYTHON;
const script = resolve(__dirname, '../../python/memo_stage1_syside.py');
const FILE = 'model/catalog/temperature_alarm.sysml';

describe.runIf(Boolean(python) && existsSync(example))('SysIDE stage 1, compiled incrementally', () => {
    let root: string;
    let options: CompileModelOptions;
    beforeAll(() => {
        root = mkdtempSync(join(tmpdir(), 'memo-syside-incremental-'));
        cpSync(example, root, { recursive: true, filter: source => !source.includes(`${example}/.memo`) });
        const sources = discoverProjectSources(root);
        options = {
            config: { projectName: 'temperature-alarm', toolchain: { syside: { python } } } as CompileModelOptions['config'],
            projectDir: root,
            libraryDirs: [...new Set(sources.libraryRoots.map(r => r.sysmlDir))],
            projectFiles: new Set(sources.projectFiles.map(file => relative(root, file))),
            resolveProject: true,
            cacheDir: join(root, '.memo', 'stage1'),
        };
    });
    afterAll(() => rmSync(root, { recursive: true, force: true }));

    function fresh(): string {
        const out = join(root, 'fresh.json');
        execFileSync(python!, [script, ...options.libraryDirs.flatMap(dir => ['--library', dir]), '--out', out, root]);
        const api = new ApiModel(JSON.parse(readFileSync(out, 'utf8')));
        return JSON.stringify(modelToDTO(stage2FromHandoff(api, { ...options, resolveProject: true }).model));
    }

    async function compiled(): Promise<string> {
        const result = await compileWithSyside(options);
        expect(result.accepted).toBe(true);
        return JSON.stringify(modelToDTO(result.model!));
    }

    function edit(change: (text: string) => string): void {
        const file = join(root, FILE);
        writeFileSync(file, change(readFileSync(file, 'utf8')));
    }

    it('equals a fresh compile after each edit', async () => {
        expect(await compiled()).toBe(fresh());
        // A literal's value: the other documents are kept.
        edit(text => text.replace(/=\s*(\d+)\s*;/, (_, n: string) => `= ${Number(n) + 1};`));
        expect(await compiled()).toBe(fresh());
        // A declaration: what the others resolve may change, so all are sent again.
        edit(text => text.replace('{', '{ part def IncrementalProbe; '));
        expect(await compiled()).toBe(fresh());
        // A broken edit is refused, and the next good one still equals fresh.
        edit(text => `${text}\npackage broken { part p : NoSuchType; }\n`);
        expect((await compileWithSyside(options)).accepted).toBe(false);
        edit(text => text.replace(/\npackage broken \{[^\n]*\}\n$/, ''));
        expect(await compiled()).toBe(fresh());
    }, 120_000);
});
