// ─── SysIDE stage 1, incrementally ───────────────────────────────────────────
//
// Runs when a Python with SysIDE's API is configured (`MEMO_SYSIDE_PYTHON`),
// against a scratch copy of the temperature-alarm example. One process compiles
// after each edit, as `memo dev` does: the worker keeps the libraries loaded and
// exports again only the documents an edit reached
// (plans/memo-incremental-stage1.md). Incremental equals fresh: each model
// equals the one stage 2 builds from a one-shot export of the same files.
// ─────────────────────────────────────────────────────────────────────────────

import { execFileSync, spawn } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { createInterface } from 'node:readline';
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

describe.runIf(Boolean(python))('the SysIDE stage 1 worker', () => {
    // An edit to one document can change another's export without touching its
    // text: here b.sysml redefines `rpm`, which a.sysml moves to a base definition.
    it('sends again a document whose export an edit elsewhere changed, and equals a one-shot export', async () => {
        const dir = mkdtempSync(join(tmpdir(), 'memo-syside-worker-'));
        try {
            const project = join(dir, 'project');
            mkdirSync(project);
            writeFileSync(join(project, 'a.sysml'), 'package A {\n    part def Engine { attribute rpm : ScalarValues::Integer; }\n}\n');
            writeFileSync(join(project, 'b.sysml'), 'package B {\n    private import A::*;\n    part e : Engine { attribute :>> rpm = 2; }\n}\n');
            const worker = spawn(python!, [script, '--serve'], { stdio: ['pipe', 'pipe', 'inherit'] });
            const lines = createInterface({ input: worker.stdout })[Symbol.asyncIterator]();
            let known: number | null = null;
            const held = new Map<string, unknown>();
            const request = async () => {
                worker.stdin.write(`${JSON.stringify({ project, libraries: [], libraryKey: 'none', libraryOut: join(dir, 'library.json'), known })}\n`);
                const response = JSON.parse((await lines.next()).value as string);
                known = response.token;
                const sent: string[] = [];
                const documents = response.documents.map((document: { file: string; kept?: boolean }) => {
                    if (document.kept) return held.get(document.file);
                    sent.push(document.file);
                    held.set(document.file, document);
                    return document;
                });
                return { sent, documents };
            };
            const oneShot = () => {
                const out = join(dir, 'one-shot.json');
                execFileSync(python!, [script, '--out', out, project]);
                return JSON.parse(readFileSync(out, 'utf8')).documents;
            };
            const elements = (documents: { file: string; elements: unknown }[]) =>
                Object.fromEntries(documents.map(d => [d.file, d.elements]));

            expect((await request()).sent.sort()).toEqual(['a.sysml', 'b.sysml']);
            expect((await request()).sent).toEqual([]);
            writeFileSync(join(project, 'a.sysml'), 'package A {\n    part def Base { attribute rpm : ScalarValues::Integer; }\n    part def Engine :> Base;\n}\n');
            const after = await request();
            expect(after.sent.sort()).toEqual(['a.sysml', 'b.sysml']);
            expect(elements(after.documents)).toEqual(elements(oneShot()));
            worker.stdin.end();
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    }, 60_000);
});
