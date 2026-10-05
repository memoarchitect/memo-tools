// ─── Models from SysML text, through the selected compiler ───────────────────
//
// MEMO parses no SysML, so a test that needs a model from a few lines of source
// compiles them: the same stage 1 and stage 2 a project goes through. The source
// is written to a scratch project, compiled with no library roots, and the
// scratch removed. A test that uses it runs only where a compiler is configured
// (`compilerConfigured`).
//
// A kind a test models with has to be declared, as it must be in any SysML:
// `stubKinds` declares each at the root, where every document sees it.
// ─────────────────────────────────────────────────────────────────────────────

import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import type { MEMOConfig } from '../../model/config.js';
import type { BuilderRegistries } from '../../model/complete-model.js';
import type { MemoModel } from '../../model/semantic.js';
import type { ApiModel } from '../../stage2/api-model.js';
import { compileModelWithSelected } from '../../toolchain/operations.js';

/**
 * OpenSysML as this run configures it: the `sysml-grpc` to start, and a Node
 * client module only when one overrides the pinned `@openmbee/opensysml`
 * dependency (MEMO_OPENSYSML_CLIENT). Undefined without a service binary.
 */
export const openSysMLUnderTest: { binary: string; client?: string } | undefined = process.env.OPENSYSML_BINARY
    ? { binary: process.env.OPENSYSML_BINARY, ...(process.env.MEMO_OPENSYSML_CLIENT ? { client: process.env.MEMO_OPENSYSML_CLIENT } : {}) }
    : undefined;

/** The `memo` flags that select OpenSysML as this run configures it. */
export function openSysMLFlags(opensysml: { binary: string; client?: string }): string[] {
    return [
        '--toolchain.compiler=opensysml',
        `--toolchain.opensysml.binary=${opensysml.binary}`,
        ...(opensysml.client ? [`--toolchain.opensysml.client=${opensysml.client}`] : []),
    ];
}

/** Whether a stage 1 compiler is configured for this run of the suite. */
export const compilerConfigured = process.env.MEMO_TOOLCHAIN_COMPILER === 'syside'
    ? Boolean(process.env.MEMO_SYSIDE_PYTHON)
    : Boolean(openSysMLUnderTest);

/** One source document: its text, and the project-relative file it is written to. */
export interface SourceDocument {
    source: string;
    filePath: string;
}

export interface CompiledSource {
    model: MemoModel;
    api: ApiModel;
    /** The scratch project's root, removed once compiled: the handoff names files relative to it. */
    root: string;
}

/** The suite's compiler, as a project's own settings would name it. */
const baseConfig = (config?: Partial<MEMOConfig>): MEMOConfig => ({
    projectName: 'test',
    toolchain: { compiler: process.env.MEMO_TOOLCHAIN_COMPILER },
    ...config,
}) as MEMOConfig;

/** Declare each kind a test uses as a part definition at the root of the model. */
export function stubKinds(names: Iterable<string>): string {
    return [...new Set(names)].map(name => `part def ${name};`).join('\n');
}

/**
 * Compile documents and return the model stage 2 builds from them.
 * Throws the compiler's errors when stage 1 rejects the source.
 */
export async function compileSources(
    documents: readonly SourceDocument[],
    options: { config?: Partial<MEMOConfig>; registries?: BuilderRegistries; stubs?: string; asGiven?: boolean } = {},
): Promise<CompiledSource> {
    return withCompiled(documents, options, compiled => compiled);
}

/**
 * Compile documents and run `use` on the result while the scratch project still
 * exists: a handoff names files by paths under it, which an outline reads.
 */
export async function withCompiled<T>(
    documents: readonly SourceDocument[],
    options: { config?: Partial<MEMOConfig>; registries?: BuilderRegistries; stubs?: string; asGiven?: boolean },
    use: (compiled: CompiledSource) => T | Promise<T>,
): Promise<T> {
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'memo-source-')));
    try {
        const files = new Set<string>();
        for (const document of documents) {
            const relative = document.filePath.replace(/^[/\\]+/, '').replace(/[:*?"<>|]/g, '_') || 'test.sysml';
            // `asGiven` writes each document at its own project-relative path.
            const where = options.asGiven ? relative : join('model', relative);
            const target = join(root, where);
            mkdirSync(dirname(target), { recursive: true });
            writeFileSync(target, document.source, 'utf8');
            files.add(where);
        }
        if (options.stubs) {
            mkdirSync(join(root, 'model'), { recursive: true });
            writeFileSync(join(root, 'model', '__stubs.sysml'), options.stubs, 'utf8');
            files.add(join('model', '__stubs.sysml'));
        }
        const result = await compileModelWithSelected({
            config: baseConfig(options.config),
            projectDir: root,
            libraryDirs: [],
            projectFiles: files,
            registries: options.registries,
            provenance: false,
        });
        if (!result.accepted || !result.model || !result.api) {
            const errors = result.diagnostics.filter(d => d.severity === 'error').map(d => `${d.file ?? ''}:${d.range?.start.line ?? '?'} ${d.message}`);
            throw new Error(`the compiler rejected the test source:\n${errors.join('\n')}`);
        }
        return await use({ model: result.model, api: result.api, root });
    } finally {
        rmSync(root, { recursive: true, force: true });
    }
}

/** The model of one or more documents. */
export async function modelFromSources(
    documents: readonly SourceDocument[],
    options: { config?: Partial<MEMOConfig>; registries?: BuilderRegistries; stubs?: string; asGiven?: boolean } = {},
): Promise<MemoModel> {
    return (await compileSources(documents, options)).model;
}

// ─── A shipped example, compiled once ────────────────────────────────────────

import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadProjectModel, type ProjectModel } from '../../toolchain/project-model.js';

const examples = new Map<string, Promise<ProjectModel>>();

/**
 * One of the memo checkout's examples, compiled through the selected compiler:
 * its handoff holds the ontology and every extension a locator offers, so a
 * test of the ontology asks a compiled project rather than parsing a file.
 * Compiled once per process.
 */
export function compiledExample(name = 'temperature-alarm'): Promise<ProjectModel> {
    let project = examples.get(name);
    if (!project) {
        const root = resolve(__dirname, '../../../../../../memo/examples', name);
        project = loadProjectModel({ projectRoot: root, config: baseConfig(), cache: false });
        examples.set(name, project);
    }
    return project;
}

/** Whether the memo checkout's examples sit beside this repository. */
export const examplesPresent = existsSync(resolve(__dirname, '../../../../../../memo/examples/temperature-alarm'));

// ─── Outlines of a scratch directory ─────────────────────────────────────────

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { relative } from 'node:path';
import type { OutlineSource } from '../../authoring/outline-source.js';
import { emptyOutline, outlineFromHandoff } from '../../authoring/source-outline.js';

function sysmlFilesUnder(root: string, dir = root, out: string[] = []): string[] {
    for (const name of readdirSync(dir)) {
        const full = join(dir, name);
        if (statSync(full).isDirectory()) sysmlFilesUnder(root, full, out);
        else if (name.endsWith('.sysml')) out.push(relative(root, full).replaceAll('\\', '/'));
    }
    return out;
}

/**
 * An outline source for a directory of SysML a test wrote: every `.sysml` file
 * under it compiled together, the file asked about taken as `text`. `stubs` are
 * root-level declarations (kinds, relation definitions) the files use.
 */
export function directoryOutlines(projectRoot: string, stubs?: string): OutlineSource {
    const compileWith = async (file: string, text: string, also?: ReadonlyMap<string, string>) => {
        const replaced = new Map([...(also ?? [])]);
        replaced.set(file, text);
        const documents = sysmlFilesUnder(projectRoot)
            .filter(path => !replaced.has(path))
            .map(path => ({ filePath: path, source: readFileSync(join(projectRoot, path), 'utf8') }));
        for (const [path, source] of replaced) documents.push({ filePath: path, source });
        return compileSources(documents, { asGiven: true, stubs });
    };
    return {
        async outline(file, text) {
            if (!text.trim()) return emptyOutline(file, text);
            const { api, root } = await compileWith(file, text);
            return outlineFromHandoff(api, join(root, file), file, text);
        },
        async verify(file, text, also) {
            const { api, root } = await compileWith(file, text, also);
            return outlineFromHandoff(api, join(root, file), file, text);
        },
    };
}

// ─── Extra source compiled beside a shipped example ──────────────────────────

import { cpSync } from 'node:fs';

/**
 * Compile documents as part of a copy of one of the memo checkout's examples,
 * so they see the real ontology. `files` are written under the copy at the
 * project-relative paths given; the project is the example's own, extended.
 * `use` runs while the copy exists.
 */
export async function withExample<T>(
    files: Record<string, string>,
    use: (project: ProjectModel, root: string) => T | Promise<T>,
    example = 'temperature-alarm',
): Promise<T> {
    const source = resolve(__dirname, '../../../../../../memo/examples', example);
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'memo-example-')));
    try {
        cpSync(source, root, { recursive: true, filter: path => !path.includes('/.memo') });
        for (const [path, text] of Object.entries(files)) {
            mkdirSync(dirname(join(root, path)), { recursive: true });
            writeFileSync(join(root, path), text, 'utf8');
        }
        const project = await loadProjectModel({ projectRoot: root, config: baseConfig(), cache: false });
        return await use(project, root);
    } finally {
        rmSync(root, { recursive: true, force: true });
    }
}
