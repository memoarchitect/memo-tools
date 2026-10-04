// ─── SysIDE as a stage 1 compiler ────────────────────────────────────────────
//
// The lowering half of `toolchain.compiler: syside`
// (plans/memo-compiler-stages-opensysml.md, milestone 3). SysIDE's Python API
// loads the project with the libraries its resolution selects and, only when the
// load is clean, hands over the OMG API JSON with an element index
// (`python/memo_stage1_syside.py`). Stage 2 builds the MEMO model from that
// handoff (`stage2/build-from-api.ts`); MEMO's own parser is not involved.
//
// The validator half is the existing `syside check` provider, unchanged, so the
// `validator-exceptions.json` register keeps its meaning. `memo validate` runs
// SysIDE once: stage 1's diagnostics are the validator's verdict whenever
// `compileServesValidator` says so.
//
// The Python API is licensed: it needs the same Modeler licence `syside check`
// does, found the same way (AGENTS.md, "The SysIDE licence").
// ─────────────────────────────────────────────────────────────────────────────

import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { createInterface } from 'node:readline';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { MEMOConfig } from '../../model/config.js';
import { modelToDTO } from '../../model/semantic.js';
import { findSysmlFiles } from '../../model/sysml-files.js';
import { SYSML_IR_VERSION } from '../../model/sysml-ir.js';
import { stage2FromHandoff } from '../../stage2/stage2-from-handoff.js';
import { ApiModel, type ApiIndexEntry, type Stage1Output } from '../../stage2/api-model.js';
import { providerSettings } from '../effective.js';
import { SYSMLC_IR_VERSION } from '../protocol.js';
import type {
    Availability,
    CompileModelOptions,
    CompileModelResult,
    LoweringDescriptor,
    LoweringRunResult,
    ProviderContext,
    ToolchainSchemaLeaf,
} from '../registry.js';
import { SYSIDE_PROVIDER_ID, parseSysideDiagnostics } from './syside.js';
import { discoverProjectSources } from '../../model/native-project.js';

interface SysidePythonConfig {
    python?: string;
}

const SETTINGS_SCHEMA: readonly ToolchainSchemaLeaf[] = [
    {
        path: `${SYSIDE_PROVIDER_ID}.python`,
        type: 'string',
        description: 'Python interpreter with SysIDE\'s licensed API, for stage 1 export. Defaults to `python3`.',
    },
];

/** The stage 1 export script, shipped beside the compiled library. */
const EXPORT_SCRIPT = fileURLToPath(new URL('../../../python/memo_stage1_syside.py', import.meta.url));

function python(config: MEMOConfig): string {
    return providerSettings<SysidePythonConfig>(config, SYSIDE_PROVIDER_ID)?.python
        ?? process.env.MEMO_SYSIDE_PYTHON ?? 'python3';
}

export type SysideCompileResult = CompileModelResult;

type SysideHandoff = Stage1Output & {
    diagnostics?: { text: string }[];
    /** A project's handoff whose libraries' handoff is written apart (`--serve`). */
    library?: { path: string };
};

type ServedDocument = NonNullable<Stage1Output['documents']>[number] & { index?: Stage1Output['index'] };
type ServedResponse = Omit<SysideHandoff, 'documents'> & {
    documents?: (ServedDocument | { file: string; kept: true })[];
    token?: number;
    error?: string;
};

/**
 * The export script in `--serve` mode, kept running for one interpreter: it
 * holds the libraries loaded between compiles and sends a project document
 * again only when it changed (plans/memo-incremental-stage1.md). `held` is
 * what it last sent, and `token` names that, so a document it reports as kept
 * is the one held.
 */
class SysideWorker {
    private readonly process: ChildProcessWithoutNullStreams;
    private readonly waiting: { resolve(response: ServedResponse): void; reject(error: Error): void }[] = [];
    private stderr = '';
    private failure?: Error;
    token: number | null = null;
    readonly held = new Map<string, ServedDocument>();

    constructor(readonly interpreter: string, onExit: () => void) {
        this.process = spawn(interpreter, [EXPORT_SCRIPT, '--serve'], { stdio: ['pipe', 'pipe', 'pipe'] });
        // A command that compiles once exits without closing the worker, which
        // ends when its input does: the worker holds the process open only
        // while a request waits for it.
        this.hold(false);
        createInterface({ input: this.process.stdout }).on('line', line => {
            const next = this.waiting.shift();
            if (this.waiting.length === 0) this.hold(false);
            if (!next) return;
            try {
                next.resolve(JSON.parse(line) as ServedResponse);
            } catch (error) {
                next.reject(error as Error);
            }
        });
        this.process.stderr.on('data', (chunk: Buffer) => { this.stderr = (this.stderr + chunk.toString()).slice(-4000); });
        const fail = (error: Error) => {
            this.failure = error;
            onExit();
            for (const pending of this.waiting.splice(0)) pending.reject(error);
        };
        this.process.on('error', fail);
        // A worker that never started fails the request through `error`, not
        // through a write to its closed input.
        this.process.stdin.on('error', () => undefined);
        this.process.on('exit', code => fail(new Error(
            `exited with ${code}: ${this.stderr.trim().split('\n').slice(-3).join(' ') || 'no output'}`)));
    }

    private hold(held: boolean): void {
        for (const handle of [this.process, this.process.stdin, this.process.stdout, this.process.stderr]) {
            const counted = handle as unknown as { ref?(): void; unref?(): void };
            if (held) counted.ref?.(); else counted.unref?.();
        }
    }

    request(body: object): Promise<ServedResponse> {
        if (this.failure) return Promise.reject(this.failure);
        return new Promise((resolvePromise, reject) => {
            this.waiting.push({ resolve: resolvePromise, reject });
            this.hold(true);
            this.process.stdin.write(`${JSON.stringify({ ...body, known: this.token })}\n`);
        });
    }
}

const workers = new Map<string, SysideWorker>();
let requests: Promise<unknown> = Promise.resolve();

/** One request at a time per process: a worker answers in order, and `held` follows. */
function serve<T>(work: () => Promise<T>): Promise<T> {
    const run = requests.then(work, work);
    requests = run.catch(() => undefined);
    return run;
}

function workerFor(interpreter: string): SysideWorker {
    let worker = workers.get(interpreter);
    if (!worker) {
        const started: SysideWorker = new SysideWorker(interpreter, () => {
            if (workers.get(interpreter) === started) workers.delete(interpreter);
        });
        worker = started;
        workers.set(interpreter, worker);
    }
    return worker;
}

/** The libraries' handoffs read so far, by path: each is written once and never changes. */
const libraryHandoffs = new Map<string, SysideHandoff>();

function libraryHandoff(path: string): SysideHandoff {
    let handoff = libraryHandoffs.get(path);
    if (!handoff) {
        handoff = JSON.parse(readFileSync(path, 'utf8')) as SysideHandoff;
        libraryHandoffs.clear();
        libraryHandoffs.set(path, handoff);
    }
    return handoff;
}

/** A project's handoff joined with its libraries' handoff: what stage 2 reads. */
function joined(handoff: SysideHandoff): SysideHandoff {
    if (!handoff.library || !handoff.clean) return handoff;
    const library = libraryHandoff(handoff.library.path);
    return {
        ...handoff,
        documents: [...(library.documents ?? []), ...(handoff.documents ?? [])],
        index: { ...library.index, ...handoff.index },
    };
}

/** A project's stage 1 from the worker: every document whole, with its own index. */
interface Served {
    handoff: SysideHandoff;
    /** The project's documents, each with the index of what it declares. */
    documents: ServedDocument[];
    /** The documents the worker sent this time: the only ones whose stored copy is stale. */
    sent: ReadonlySet<string>;
}

/**
 * Stage 1 from the worker: the project's handoff with every document whole
 * (a kept one from what the worker sent before), and its index.
 */
async function servedHandoff(interpreter: string, projectDir: string, libraryDirs: readonly string[],
    libraryKey: string, libraryOut: string): Promise<Served> {
    return serve(async () => {
        const worker = workerFor(interpreter);
        let response: ServedResponse;
        try {
            response = await worker.request({ project: projectDir, libraries: libraryDirs, libraryKey, libraryOut });
        } catch (error) {
            throw new Error(`SysIDE stage 1 could not run with "${interpreter}": ${(error as Error).message}. `
                + `Set toolchain.${SYSIDE_PROVIDER_ID}.python to a Python with SysIDE's API.`);
        }
        if (response.error) throw new Error(`SysIDE stage 1 failed: ${response.error}`);
        if (!response.clean) return { handoff: response as SysideHandoff, documents: [], sent: new Set() };
        const documents: ServedDocument[] = [];
        const sent = new Set<string>();
        for (const document of response.documents ?? []) {
            const whole = 'kept' in document ? worker.held.get(document.file) : document;
            if (!whole) throw new Error(`SysIDE stage 1 kept ${document.file}, which this process does not hold`);
            if (!('kept' in document)) {
                worker.held.set(document.file, document);
                sent.add(document.file);
            }
            documents.push(whole);
        }
        worker.token = response.token ?? null;
        return { handoff: withDocuments(response as SysideHandoff, documents), documents, sent };
    });
}

/** A handoff carrying `documents` whole, their own indexes merged into its index. */
function withDocuments(handoff: SysideHandoff, documents: readonly ServedDocument[]): SysideHandoff {
    const index: Record<string, ApiIndexEntry> = { ...handoff.index };
    const whole = documents.map(({ index: own, ...rest }) => {
        Object.assign(index, own);
        return rest;
    });
    return { ...handoff, documents: whole, index };
}

/**
 * The stage 1 output kept in a cache directory: `syside.json` names the
 * project's documents, each stored apart (`syside-documents/`) so a compile
 * rewrites only the documents the worker sent, and the libraries' handoff.
 */
const DOCUMENTS_DIR = `${SYSIDE_PROVIDER_ID}-documents`;

type StoredHandoff = Omit<SysideHandoff, 'documents'> & {
    documents?: (ServedDocument | { file: string; role: 'project' | 'library'; root?: string; stored: string })[];
};

function storedName(file: string): string {
    return `${createHash('sha256').update(file).digest('hex').slice(0, 24)}.json`;
}

function store(cacheDir: string, served: Served): void {
    const directory = join(cacheDir, DOCUMENTS_DIR);
    mkdirSync(directory, { recursive: true });
    const names = new Set<string>();
    const listed = served.documents.map(document => {
        const name = storedName(document.file);
        names.add(name);
        if (served.sent.has(document.file) || !existsSync(join(directory, name))) {
            writeFileSync(join(directory, name), JSON.stringify(document));
        }
        return { file: document.file, role: document.role, root: document.root, stored: name };
    });
    for (const name of readdirSync(directory)) {
        if (!names.has(name)) rmSync(join(directory, name), { force: true });
    }
    const { documents: _whole, index: _merged, ...rest } = served.handoff;
    const standard = Object.fromEntries(Object.entries(served.handoff.index ?? {}).filter(([, entry]) => entry.role === 'standard'));
    const manifest: StoredHandoff = { ...rest, documents: listed, index: standard };
    writeFileSync(join(cacheDir, `${SYSIDE_PROVIDER_ID}.json`), JSON.stringify(manifest));
}

/** The stored handoff, its documents read back; undefined when any is missing. */
function stored(cacheDir: string): SysideHandoff | undefined {
    const manifest = JSON.parse(readFileSync(join(cacheDir, `${SYSIDE_PROVIDER_ID}.json`), 'utf8')) as StoredHandoff;
    if (manifest.library && !existsSync(manifest.library.path)) return undefined;
    const documents: ServedDocument[] = [];
    for (const document of manifest.documents ?? []) {
        if (!('stored' in document)) {
            documents.push(document);
            continue;
        }
        const path = join(cacheDir, DOCUMENTS_DIR, document.stored);
        if (!existsSync(path)) return undefined;
        documents.push(JSON.parse(readFileSync(path, 'utf8')) as ServedDocument);
    }
    return withDocuments(manifest as SysideHandoff, documents);
}

/**
 * Stage 1 through SysIDE, then stage 2. A stage 1 that reports an error yields
 * no model: stage 2 never runs on a failed stage 1 (plan, Decisions).
 */
export async function compileWithSyside(options: CompileModelOptions): Promise<CompileModelResult> {
    const projectDir = resolve(options.projectDir);
    const { libraryDirs, projectFiles, registries, filePackages } = options;

    const interpreter = python(options.config);
    const libraryKey = sysideLibraryKey(interpreter, libraryDirs);
    const key = sysideInputKey(interpreter, projectDir, libraryKey);
    const cacheDir = options.cacheDir;
    const keyFile = cacheDir ? join(cacheDir, `${SYSIDE_PROVIDER_ID}.json.key`) : undefined;
    let handoff: SysideHandoff | undefined;
    let reused = false;
    if (cacheDir && keyFile && !options.force && existsSync(join(cacheDir, `${SYSIDE_PROVIDER_ID}.json`))
        && existsSync(keyFile) && readFileSync(keyFile, 'utf8') === key) {
        handoff = stored(cacheDir);
        reused = Boolean(handoff);
    }
    if (!handoff) {
        const libraryOut = join(cacheDir ?? scratchDir(), `${SYSIDE_PROVIDER_ID}-library-${libraryKey.slice(0, 16)}.json`);
        const served = await servedHandoff(interpreter, projectDir, libraryDirs, libraryKey, libraryOut);
        handoff = served.handoff;
        if (cacheDir && keyFile && handoff.clean) {
            mkdirSync(cacheDir, { recursive: true });
            // Tool output, never authored content: the directory ignores
            // itself, so no project has to know to add it to its .gitignore.
            const ignore = join(cacheDir, '.gitignore');
            if (!existsSync(ignore)) writeFileSync(ignore, '*\n');
            store(cacheDir, served);
            writeFileSync(keyFile, key);
            removeStaleLibraryHandoffs(cacheDir, libraryOut);
        }
    }
    const diagnostics = parseSysideDiagnostics(
        (handoff.diagnostics ?? []).map(d => d.text).join('\n'), handoff.providerVersion);
    if (!handoff.clean) return { accepted: false, diagnostics, providerVersion: handoff.providerVersion, cached: reused };
    const api = new ApiModel(joined(handoff));
    // The ontology is the handoff's, not MEMO's parse of it.
    const stage2 = stage2FromHandoff(api, {
        config: options.config, projectDir, projectFiles, resolveProject: options.resolveProject, provenance: options.provenance, registries, filePackages,
    });
    return { accepted: true, diagnostics, providerVersion: handoff.providerVersion, ...stage2, api, cached: reused };
}

let scratch: string | undefined;

/** Where the libraries' handoff goes for a compile with no cache directory: one per process. */
function scratchDir(): string {
    return (scratch ??= mkdtempSync(join(tmpdir(), 'memo-stage1-')));
}

/** Libraries' handoffs of earlier library content: only the current one is read. */
function removeStaleLibraryHandoffs(cacheDir: string, current: string): void {
    const prefix = `${SYSIDE_PROVIDER_ID}-library-`;
    for (const name of readdirSync(cacheDir)) {
        const path = join(cacheDir, name);
        if (name.startsWith(prefix) && path !== current && path !== `${current}.ids`) rmSync(path, { force: true });
    }
}

/**
 * What the libraries' part of a SysIDE stage 1 result depends on: the
 * interpreter, the export script, and the content of every library file.
 */
export function sysideLibraryKey(interpreter: string, libraryDirs: readonly string[]): string {
    const hash = createHash('sha256');
    hash.update(`${SYSIDE_PROVIDER_ID}\0${interpreter}\0`);
    hash.update(readFileSync(EXPORT_SCRIPT));
    const files = libraryDirs.flatMap(sysmlFilesUnder).map(file => resolve(file));
    for (const file of [...new Set(files)].sort()) {
        hash.update(`\0${file}\0`);
        hash.update(readFileSync(file));
    }
    return hash.digest('hex');
}

/**
 * Everything a SysIDE stage 1 result depends on: the libraries' key
 * (`sysideLibraryKey`: the interpreter, the export script and every library
 * file) and the content of every project file. A result is reused only while
 * this is unchanged; a SysIDE upgrade in the same interpreter is not seen,
 * which is what `memo compile --force` is for.
 */
export function sysideInputKey(interpreter: string, projectDir: string, libraryKey: string): string {
    const hash = createHash('sha256');
    hash.update(`${SYSIDE_PROVIDER_ID}\0${interpreter}\0${libraryKey}\0`);
    for (const file of [...new Set(findSysmlFiles(projectDir).map(file => resolve(file)))].sort()) {
        hash.update(`\0${file}\0`);
        hash.update(readFileSync(file));
    }
    return hash.digest('hex');
}

function sysmlFilesUnder(dir: string): string[] {
    if (!existsSync(dir) || !statSync(dir).isDirectory()) return [];
    return readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) return ['node_modules', '.venv', 'site-packages', '.git'].includes(entry.name) ? [] : sysmlFilesUnder(path);
        return entry.name.endsWith('.sysml') ? [path] : [];
    });
}

export const sysideLoweringDescriptor: LoweringDescriptor = {
    id: SYSIDE_PROVIDER_ID,
    role: 'lowering',
    capabilities: ['lower'],
    settingsSchema: SETTINGS_SCHEMA,
    compileModel: compileWithSyside,
    // The Python load reports what `syside check --diagnose all` does, in the
    // same text (`full_message`), so it is the validator's verdict too, unless
    // a setting only the CLI reads is in effect: a syside.toml or a narrower
    // diagnose scope.
    compileServesValidator(config: MEMOConfig): boolean {
        const cli = providerSettings<{ configFile?: string; diagnose?: string }>(config, SYSIDE_PROVIDER_ID) ?? {};
        return !cli.configFile && (cli.diagnose ?? 'all') === 'all';
    },
    probe(context: ProviderContext): Availability {
        const interpreter = python(context.config);
        const check = spawnSync(interpreter, ['-c', 'import syside; print(syside.__version__)'], { encoding: 'utf8' });
        return check.status === 0
            ? { available: true, transport: 'process', executable: interpreter, version: check.stdout.trim() }
            : { available: false, transport: 'process', detail: `"${interpreter}" cannot import syside.` };
    },
    create(context: ProviderContext) {
        return {
            id: SYSIDE_PROVIDER_ID,
            role: 'lowering' as const,
            transport: 'process' as const,
            invocation: () => ({ command: python(context.config), args: [EXPORT_SCRIPT], provider: SYSIDE_PROVIDER_ID }),
            async run(): Promise<LoweringRunResult> {
                // Every library root a locator offers, the project resolved from
                // what was compiled: what each command compiles, so MEMO parses
                // nothing and `.memo/stage1/` is shared with them.
                const sources = discoverProjectSources(context.projectDir);
                const result = await compileWithSyside({
                    config: context.config,
                    projectDir: context.projectDir,
                    libraryDirs: [...new Set(sources.libraryRoots.map(root => root.sysmlDir))],
                    projectFiles: new Set(sources.projectFiles.map(file => relative(context.projectDir, file))),
                    resolveProject: true,
                    cacheDir: join(context.projectDir, '.memo', 'stage1'),
                });
                const model = result.model
                    ? modelToDTO(result.model)
                    : { elements: {}, relationships: [], errors: [], packages: [] } as unknown as ReturnType<typeof modelToDTO>;
                return {
                    provider: SYSIDE_PROVIDER_ID,
                    providerVersion: result.providerVersion,
                    transport: 'process',
                    accepted: result.accepted,
                    diagnostics: result.diagnostics,
                    registries: result.registries,
                    ir: {
                        irVersion: SYSMLC_IR_VERSION,
                        model,
                        parseErrors: [],
                        accepted: result.accepted,
                        // Stage 2 has no syntax tree to record; the standard JSON is the record.
                        sysml: { irVersion: SYSML_IR_VERSION, elements: [], diagnostics: [] },
                    },
                };
            },
        };
    },
};
