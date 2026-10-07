// ─── OpenSysML as a stage 1 compiler ─────────────────────────────────────────
//
// The lowering half of `toolchain.compiler: opensysml`
// (plans/memo-compiler-stages-opensysml.md). OpenSysML's service parses the
// project and the library roots its resolution selects as one model
// (`ParseSources`) and, only when that model is clean, converts it to the OMG
// API JSON (`Convert` of the model hash). This module turns that JSON into the
// same `memo-stage1/1` handoff every external compiler's provider writes, and stage 2
// builds the MEMO model from it (`stage2/build-from-api.ts`); MEMO's own
// parser is not involved.
//
// What the handoff's index needs and the JSON states:
//   - each element's document: `sysx:sourceDocument` on the root it is owned
//     under, reached through its owner;
//   - its position: `sysx:sourceLine`/`sourceColumn`/`sourceEndLine`/
//     `sourceEndColumn`, 1-based with byte columns and an exclusive end, from
//     which the byte offsets are computed against the document's bytes;
//   - a standard library element it references: the element written under its
//     normative id, marked `isLibraryElement` and named by `qualifiedName`,
//     which becomes a `standard` index entry and is not exported.
//
// The validator half is the existing OpenSysML validator, so `memo validate`
// runs the service once: stage 1's diagnostics are the validator's verdict.
// ─────────────────────────────────────────────────────────────────────────────

import { createHash } from 'node:crypto';
import { closeSharedOpenSysMLConnection, sharedOpenSysMLConnection } from './opensysml-check.js';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import type { MEMOConfig } from '../../model/config.js';
import { modelToDTO } from '../../model/semantic.js';
import { findSysmlFiles } from '../../model/sysml-files.js';
import { SYSML_IR_VERSION } from '../../model/sysml-ir.js';
import { stage2FromHandoff } from '../../stage2/stage2-from-handoff.js';
import { ApiModel, STAGE1_FORMAT, type ApiElement, type ApiIndexEntry, type Stage1Output } from '../../stage2/api-model.js';
import type { Diagnostic } from '../diagnostic.js';
import { SYSMLC_IR_VERSION } from '../protocol.js';
import type {
    Availability,
    CompileModelOptions,
    CompileModelResult,
    LoweringDescriptor,
    LoweringRunResult,
    ProviderContext,
} from '../registry.js';
import {
    OPENSYSML_PROVIDER_ID,
    openSysMLSettingsKey,
    probeOpenSysML,
    toDiagnostic,
} from './opensysml.js';
import { discoverProjectSources } from '../../model/native-project.js';
import { findShipped, readShipped, shippedLibraryKey, writeShipped } from '../shipped-library.js';

/** Where a document of the model sits: its handoff file and role. */
interface DocumentPlace {
    file: string;
    role: 'project' | 'library';
    /** The absolute root `file` is relative to. */
    root: string;
}

/** What openSysMLHandoff needs beyond the JSON. */
export interface OpenSysMLHandoffOptions {
    projectDir: string;
    libraryDirs: readonly string[];
    providerVersion?: string;
    /** The bytes of a document, by the path the service was given, for byte offsets. */
    source(path: string): Buffer | undefined;
    /**
     * The model's one document, when it was parsed from one. OpenSysML writes
     * `sysx:sourceDocument` only for a model of several documents, so for one
     * every element is in this document.
     */
    soleDocument?: string;
}

const refs = (value: unknown): string[] =>
    (Array.isArray(value) ? value : [value]).map(item => ref(item)).filter((id): id is string => id !== undefined);

const ref = (value: unknown): string | undefined =>
    typeof value === 'object' && value !== null && typeof (value as { '@id'?: unknown })['@id'] === 'string'
        ? (value as { '@id': string })['@id'] : undefined;

const OWNER_PROPERTIES = ['owner', 'owningRelatedElement', 'owningRelationship', 'owningMembership', 'owningNamespace'];

/**
 * The `memo-stage1/1` handoff for OpenSysML's API JSON of a clean model: the
 * elements grouped by the document each is owned under, and the index of what
 * the standard JSON does not carry.
 */
export function openSysMLHandoff(elements: readonly ApiElement[], options: OpenSysMLHandoffOptions): Stage1Output {
    const byId = new Map(elements.map(element => [element['@id'], element]));
    const libraryRoots = options.libraryDirs.map(dir => resolve(dir));
    const projectDir = resolve(options.projectDir);
    const place = (path: string): DocumentPlace => {
        const absolute = resolve(projectDir, path);
        const root = libraryRoots.find(dir => absolute === dir || absolute.startsWith(dir + sep));
        return root
            ? { file: relative(root, absolute), role: 'library', root }
            : { file: relative(projectDir, absolute), role: 'project', root: projectDir };
    };

    const isLibraryReference = (element: ApiElement): boolean =>
        (element.isLibraryElement === true || element.isLibraryElement === 'true')
        && OWNER_PROPERTIES.every(property => ref(element[property]) === undefined);

    // The document an element is owned under, through its owners; a membership
    // owning a document's root (the root namespace's) goes with that root.
    const documentOf = new Map<string, string | undefined>();
    const findDocument = (element: ApiElement): string | undefined => {
        const trail: string[] = [];
        let current: ApiElement | undefined = element;
        let found: string | undefined;
        while (current) {
            const known = documentOf.get(current['@id']);
            if (known !== undefined || documentOf.has(current['@id'])) {
                found = known;
                break;
            }
            trail.push(current['@id']);
            const stated = current['sysx:sourceDocument'];
            if (typeof stated === 'string') {
                found = stated;
                break;
            }
            const owner = OWNER_PROPERTIES.map(property => ref(current![property])).find(id => id !== undefined);
            current = owner ? byId.get(owner) : undefined;
        }
        if (found === undefined) {
            const member = byId.get(ref(element.memberElement) ?? '');
            const memberDocument = member?.['sysx:sourceDocument'];
            if (typeof memberDocument === 'string') found = memberDocument;
        }
        for (const id of trail) documentOf.set(id, found);
        return found;
    };

    const index: Record<string, ApiIndexEntry> = {};
    const grouped = new Map<string, ApiElement[]>();
    const unplaced: ApiElement[] = [];
    for (const element of elements) {
        if (isLibraryReference(element)) {
            const qualifiedName = element.qualifiedName;
            index[element['@id']] = {
                role: 'standard',
                ...(typeof qualifiedName === 'string' ? { qualifiedName } : {}),
            };
            continue;
        }
        // A model of one document states none: everything but the root namespace,
        // which owns the document's roots and has no owner, is in that document.
        const hasOwner = OWNER_PROPERTIES.some(property => ref(element[property]) !== undefined);
        const document = options.soleDocument !== undefined
            ? (hasOwner ? options.soleDocument : undefined)
            : findDocument(element);
        if (document === undefined) {
            unplaced.push(element);
            continue;
        }
        const list = grouped.get(document) ?? [];
        list.push(element);
        grouped.set(document, list);
    }
    // The model's root namespace owns every document's roots and names nothing.
    // A handoff gives each document a root namespace of its own, owning that
    // document's roots, which is how stage 2 tells the project's packages from
    // the library's: each document gets a copy owning the memberships of its
    // roots, in the order the model's namespace lists them.
    for (const wrapper of unplaced) {
        const memberships = refs(wrapper.ownedRelationship);
        const byDocument = new Map<string, string[]>();
        for (const id of memberships) {
            const membership = byId.get(id);
            const document = !membership ? undefined : options.soleDocument ?? findDocument(membership);
            if (document === undefined) continue;
            const list = byDocument.get(document) ?? [];
            list.push(id);
            byDocument.set(document, list);
        }
        if (byDocument.size === 0) continue;
        let n = 0;
        for (const [document, owned] of byDocument) {
            const id = `${wrapper['@id']}.${n++}`;
            grouped.get(document)?.push({
                '@type': wrapper['@type'],
                '@id': id,
                elementId: id,
                ownedRelationship: owned.map(member => ({ '@id': member })),
            });
        }
    }

    const documents: NonNullable<Stage1Output['documents']> = [];
    for (const [path, list] of grouped) {
        const where = place(path);
        documents.push({ file: where.file, role: where.role, root: where.root, elements: list });
        const lineStarts = lineStartsOf(options.source(path));
        for (const element of list) {
            const entry: ApiIndexEntry = { file: where.file, role: where.role, root: where.root };
            const qualifiedName = element.qualifiedName;
            if (typeof qualifiedName === 'string') entry.qualifiedName = qualifiedName;
            const line = numberOf(element['sysx:sourceLine']);
            const column = numberOf(element['sysx:sourceColumn']);
            if (line !== undefined && column !== undefined) {
                entry.line = line;
                entry.column = column;
                const endLine = numberOf(element['sysx:sourceEndLine']);
                const endColumn = numberOf(element['sysx:sourceEndColumn']);
                const start = byteOffset(lineStarts, line, column);
                const end = endLine !== undefined && endColumn !== undefined ? byteOffset(lineStarts, endLine, endColumn) : undefined;
                if (start !== undefined && end !== undefined && end >= start) {
                    entry.startByte = start;
                    entry.endByte = end;
                }
            }
            index[element['@id']] = entry;
        }
    }
    return {
        format: STAGE1_FORMAT,
        provider: OPENSYSML_PROVIDER_ID,
        ...(options.providerVersion ? { providerVersion: options.providerVersion } : {}),
        clean: true,
        documents,
        index,
    };
}

function numberOf(value: unknown): number | undefined {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string' && /^\d+$/.test(value)) return Number(value);
    return undefined;
}

/** The byte offset each line starts at, for a document's bytes. */
function lineStartsOf(bytes: Buffer | undefined): number[] | undefined {
    if (!bytes) return undefined;
    const starts = [0];
    for (let i = 0; i < bytes.length; i++) if (bytes[i] === 0x0a) starts.push(i + 1);
    return starts;
}

/** The byte offset of a 1-based line and byte column, or undefined outside the document. */
function byteOffset(lineStarts: number[] | undefined, line: number, column: number): number | undefined {
    if (!lineStarts || line < 1 || line > lineStarts.length || column < 1) return undefined;
    return lineStarts[line - 1] + column - 1;
}

/**
 * Everything an OpenSysML stage 1 result depends on: how the service is
 * reached and the content of every SysML file it loads. A result is reused
 * only while this is unchanged; a service upgrade at the same path is not
 * seen, which is what `memo compile --force` is for.
 */
export function openSysMLInputKey(config: MEMOConfig, documents: readonly string[]): string {
    const hash = createHash('sha256');
    hash.update(`${OPENSYSML_PROVIDER_ID}\0${openSysMLSettingsKey(config)}\0`);
    for (const file of [...new Set(documents)].sort()) {
        hash.update(`\0${file}\0`);
        hash.update(readFileSync(file));
    }
    return hash.digest('hex');
}

/**
 * Stage 1 through OpenSysML, then stage 2. A stage 1 that reports an error
 * yields no model: stage 2 never runs on a failed stage 1 (plan, Decisions).
 */
export async function compileWithOpenSysML(options: CompileModelOptions): Promise<CompileModelResult> {
    const projectDir = resolve(options.projectDir);
    const { libraryDirs, projectFiles, registries, filePackages } = options;
    const libraryFiles = libraryDirs.flatMap(dir => findSysmlFiles(dir)).map(file => resolve(file));
    const documents = [...new Set([...libraryFiles, ...[...projectFiles].map(file => resolve(projectDir, file))])];

    const key = openSysMLInputKey(options.config, documents);
    const handoffOptions = openSysMLHandoffOptions(projectDir, libraryDirs, documents);
    let handoff: Stage1Output & { diagnostics?: Diagnostic[] } | undefined;
    let reused = false;
    if (options.cacheDir && !options.force) {
        handoff = readStoredStage1(options.cacheDir, key, handoffOptions);
        reused = Boolean(handoff);
    }
    if (!handoff) {
        const run = await runStage1(options.config, projectDir, libraryDirs, documents, libraryFiles, options.cacheDir);
        handoff = run.handoff;
        if (options.cacheDir) storeStage1(options.cacheDir, key, run);
    }
    const diagnostics = handoff.diagnostics ?? [];
    if (!handoff.clean) return { accepted: false, diagnostics, providerVersion: handoff.providerVersion, cached: reused };
    const api = new ApiModel(handoff);
    // The ontology is the handoff's, not MEMO's parse of it.
    const stage2 = stage2FromHandoff(api, {
        config: options.config, projectDir, projectFiles, resolveProject: options.resolveProject, provenance: options.provenance, registries, filePackages,
    });
    return { accepted: true, diagnostics, providerVersion: handoff.providerVersion, ...stage2, api, cached: reused };
}

/** How a handoff is built from the service's conversion of these documents. */
function openSysMLHandoffOptions(projectDir: string, libraryDirs: readonly string[], documents: readonly string[]): OpenSysMLHandoffOptions {
    return {
        projectDir, libraryDirs,
        source: (path: string) => (existsSync(path) ? readFileSync(path) : undefined),
        ...(documents.length === 1 ? { soleDocument: documents[0] } : {}),
    };
}

/**
 * What a compile stores for the next process to reuse: the service's own
 * conversion text, written as it came, and what rebuilding the handoff from it
 * needs. Serializing the handoff instead costs a large model more than the
 * rest of MEMO's share of a compile, on every edit of a `memo dev` session; the
 * text is already a string, and the libraries' handoff has a file of its own.
 */
interface StoredStage1 {
    providerVersion?: string;
    clean: boolean;
    diagnostics: Diagnostic[];
    /**
     * `whole`: the conversion is the whole model's, in the content file;
     * `documents`: the project's documents, one file each (`pieces`), over the
     * libraries' handoff stored under libraryKey.
     */
    converted?: 'whole' | 'documents';
    libraryKey?: string;
    /** The project documents' pieces, by absolute path, in the order the handoff lists them. */
    pieces?: { path: string; file: string }[];
}

/**
 * One project document as the handoff holds it: its elements and the index
 * entries of them. A compile that converts only the documents an edit reached
 * replaces those documents' pieces and keeps the rest.
 */
interface ProjectPiece {
    document: NonNullable<Stage1Output['documents']>[number];
    index: Record<string, ApiIndexEntry>;
}

/**
 * What the last compile of a project in this process left: the service's model
 * it came from, and every project document's piece. The next compile asks the
 * service which documents an edit reached against that model, and converts
 * those. A service that has lost the model answers every document.
 */
interface ProjectSession {
    libraryKey: string;
    modelHash: string;
    pieces: Map<string, ProjectPiece>;
    /** The standard library elements the project references, from every conversion so far. */
    standard: Record<string, ApiIndexEntry>;
}

const sessions = new Map<string, ProjectSession>();

/** What the last compile that reached the service converted: of the project's documents, how many. */
export const openSysMLLastConversion: { converted: number; of: number; incremental: boolean } = { converted: 0, of: 0, incremental: false };

const sessionKeyOf = (config: MEMOConfig, projectDir: string): string => `${projectDir}\0${openSysMLSettingsKey(config)}`;

/** Drop what this process remembers of a project's compile (tests, and a service that failed). */
export function forgetOpenSysMLSession(): void {
    sessions.clear();
}

interface Stage1Run {
    handoff: Stage1Output & { diagnostics: Diagnostic[] };
    stored: StoredStage1;
    /** The service's api-json text the handoff was built from; absent when the model was not clean or was stored by document. */
    content?: string;
    /** The pieces a compile converted, to write; the rest are on disk already. */
    written?: Map<string, ProjectPiece>;
    /** Every project piece the handoff holds, for the store's manifest. */
    pieces?: Map<string, ProjectPiece>;
    standard?: Record<string, ApiIndexEntry>;
}

const STORED = `${OPENSYSML_PROVIDER_ID}.stage1.json`;
const CONTENT = `${OPENSYSML_PROVIDER_ID}.api.json`;
const KEY = `${OPENSYSML_PROVIDER_ID}.json.key`;

/** The directory of the per-document pieces. */
const PIECES = `${OPENSYSML_PROVIDER_ID}-documents`;
const STANDARD = '_standard.json';

const pieceFileOf = (path: string): string => `${createHash('sha1').update(path).digest('hex').slice(0, 20)}.json`;

/** Write the pieces a compile converted, drop the files of documents that are gone, and the standard entries when they grew. */
function storePieces(cacheDir: string, run: Stage1Run): void {
    const dir = join(cacheDir, PIECES);
    mkdirSync(dir, { recursive: true });
    const keep = new Set(run.stored.pieces?.map(piece => piece.file));
    keep.add(STANDARD);
    for (const name of readdirSync(dir)) if (!keep.has(name)) rmSync(join(dir, name), { force: true });
    for (const [path, piece] of run.pieces ?? []) {
        const file = join(dir, pieceFileOf(path));
        if (run.written === undefined || run.written.has(path) || !existsSync(file)) writeFileSync(file, JSON.stringify(piece));
    }
    const standard = join(dir, STANDARD);
    // A conversion only adds to the standard entries, so a file with as many is the same.
    const count = Object.keys(run.standard ?? {}).length;
    if (run.written === undefined || !existsSync(standard) || (JSON.parse(readFileSync(standard, 'utf8')) as unknown[]).length !== count) {
        writeFileSync(standard, JSON.stringify(Object.entries(run.standard ?? {})));
    }
}

function libraryFileOf(cacheDir: string, libraryKey: string): string {
    return join(cacheDir, `${OPENSYSML_PROVIDER_ID}-library-${libraryKey.slice(0, 16)}.json`);
}

function storeStage1(cacheDir: string, key: string, run: Stage1Run): void {
    mkdirSync(cacheDir, { recursive: true });
    // Tool output, never authored content: the directory ignores
    // itself, so no project has to know to add it to its .gitignore.
    const ignore = join(cacheDir, '.gitignore');
    if (!existsSync(ignore)) writeFileSync(ignore, '*\n');
    // The handoff an earlier version stored whole, which nothing reads now.
    rmSync(join(cacheDir, `${OPENSYSML_PROVIDER_ID}.json`), { force: true });
    rmSync(join(cacheDir, KEY), { force: true });
    if (run.content !== undefined) writeFileSync(join(cacheDir, CONTENT), run.content);
    else rmSync(join(cacheDir, CONTENT), { force: true });
    if (run.pieces) storePieces(cacheDir, run);
    else if (run.stored.clean) rmSync(join(cacheDir, PIECES), { recursive: true, force: true });
    writeFileSync(join(cacheDir, STORED), JSON.stringify(run.stored));
    // Written last: a key on disk means everything it keys was written.
    writeFileSync(join(cacheDir, KEY), key);
}

/** The stage 1 a compile stored under key, rebuilt; undefined when anything it needs is missing. */
function readStoredStage1(cacheDir: string, key: string, options: OpenSysMLHandoffOptions): (Stage1Output & { diagnostics: Diagnostic[] }) | undefined {
    const keyFile = join(cacheDir, KEY);
    if (!existsSync(keyFile) || readFileSync(keyFile, 'utf8') !== key || !existsSync(join(cacheDir, STORED))) return undefined;
    const stored = JSON.parse(readFileSync(join(cacheDir, STORED), 'utf8')) as StoredStage1;
    if (!stored.clean) {
        return { format: STAGE1_FORMAT, provider: OPENSYSML_PROVIDER_ID, providerVersion: stored.providerVersion, clean: false, diagnostics: stored.diagnostics };
    }
    let library: Stage1Output | undefined;
    if (stored.converted === 'documents') {
        library = stored.libraryKey ? libraryHandoffs.get(stored.libraryKey) : undefined;
        const file = stored.libraryKey ? libraryFileOf(cacheDir, stored.libraryKey) : undefined;
        if (!library && file && existsSync(file)) library = JSON.parse(readFileSync(file, 'utf8')) as Stage1Output;
        if (!library) return undefined;
        libraryHandoffs.set(stored.libraryKey!, library);
        const dir = join(cacheDir, PIECES);
        if (!existsSync(join(dir, STANDARD))) return undefined;
        const pieces = new Map<string, ProjectPiece>();
        for (const { path, file } of stored.pieces ?? []) {
            if (!existsSync(join(dir, file))) return undefined;
            pieces.set(path, JSON.parse(readFileSync(join(dir, file), 'utf8')) as ProjectPiece);
        }
        const standard = Object.fromEntries(JSON.parse(readFileSync(join(dir, STANDARD), 'utf8')) as [string, ApiIndexEntry][]);
        return { ...overLibrary(library, projectOf(pieces, standard, stored.providerVersion)), diagnostics: stored.diagnostics };
    }
    if (stored.converted !== 'whole' || !existsSync(join(cacheDir, CONTENT))) return undefined;
    const elements = JSON.parse(readFileSync(join(cacheDir, CONTENT), 'utf8')) as ApiElement[];
    return { ...openSysMLHandoff(elements, { ...options, providerVersion: stored.providerVersion }), diagnostics: stored.diagnostics };
}

/** The project's handoff from its documents' pieces. */
function projectOf(pieces: ReadonlyMap<string, ProjectPiece>, standard: Record<string, ApiIndexEntry>, providerVersion?: string): Stage1Output {
    const index: Record<string, ApiIndexEntry> = { ...standard };
    const documents: NonNullable<Stage1Output['documents']> = [];
    for (const piece of pieces.values()) {
        documents.push(piece.document);
        Object.assign(index, piece.index);
    }
    return { format: STAGE1_FORMAT, provider: OPENSYSML_PROVIDER_ID, ...(providerVersion ? { providerVersion } : {}), clean: true, documents, index };
}

/** The project's handoff over the libraries': their documents and indexes together. */
function overLibrary(library: Stage1Output, project: Stage1Output): Stage1Output {
    return {
        ...project,
        documents: [...(library.documents ?? []), ...(project.documents ?? [])],
        index: { ...library.index, ...project.index },
    };
}

/** The capability that limits a conversion to named documents. */
const CONVERT_DOCUMENTS = 'convert_documents';
/** The capability that answers which documents an edit reached, against a previous model. */
const PARSE_SOURCES_AFFECTED = 'parse_sources_affected';

/**
 * The libraries' handoffs of this process, by what they depend on: the
 * settings that reach the service and the content of every library file. A
 * session pays for converting the libraries once.
 */
const libraryHandoffs = new Map<string, Stage1Output>();

function libraryKeyOf(config: MEMOConfig, libraryFiles: readonly string[]): string {
    const hash = createHash('sha256');
    hash.update(`${OPENSYSML_PROVIDER_ID}-library\0${openSysMLSettingsKey(config)}\0`);
    for (const file of [...new Set(libraryFiles)].sort()) {
        hash.update(`\0${file}\0`);
        hash.update(readFileSync(file));
    }
    return hash.digest('hex');
}

/** What a shipped export of the libraries is keyed by, besides their content. */
function shippedKeyOf(serviceVersion: string | undefined, libraryDirs: readonly string[]): string {
    return shippedLibraryKey(OPENSYSML_PROVIDER_ID, `${serviceVersion ?? 'unknown'}\0qualified`,
        libraryDirs.map(dir => ({ dir, files: findSysmlFiles(dir) })));
}

/**
 * Convert the library set once and write it as the shipped file a package
 * carries (`memo ship-library`): the handoff `runStage1` would keep for it.
 */
export async function shipOpenSysMLLibrary(config: MEMOConfig, libraryDirs: readonly string[], outDir: string): Promise<string[]> {
    const files = [...new Set(libraryDirs.flatMap(dir => findSysmlFiles(dir)).map(file => resolve(file)))];
    const connection = await sharedOpenSysMLConnection(config);
    try {
        const version = connection.info?.version;
        const parsed = await connection.rpc.parseSources({ documents: files.map(file => ({ source: { case: 'filePath', value: file } })) });
        const errors = [...parsed.diagnostics.map(d => toDiagnostic(d, version)), ...(parsed.error ? [{ message: parsed.error, severity: 'error' }] : [])]
            .filter(d => d.severity === 'error');
        if (errors.length > 0) {
            throw new Error(`OpenSysML did not accept the libraries, so there is nothing to ship:\n${errors.map(d => d.message).join('\n')}`);
        }
        const converted = await connection.rpc.convert({ source: { case: 'modelHash', value: parsed.modelHash }, toFormat: 'api-json' });
        if (converted.error) throw new Error(`OpenSysML could not convert the libraries: ${converted.error}`);
        const handoff = openSysMLHandoff(JSON.parse(converted.content) as ApiElement[], {
            projectDir: resolve(libraryDirs[0] ?? '.'), libraryDirs, providerVersion: version,
            source: path => (existsSync(path) ? readFileSync(path) : undefined),
        });
        return [writeShipped(outDir, OPENSYSML_PROVIDER_ID, shippedKeyOf(version, libraryDirs), JSON.stringify(handoff), libraryDirs)];
    } catch (error) {
        closeSharedOpenSysMLConnection();
        throw error;
    }
}

/** Parse the model in the service and, when it is clean, convert it to the handoff. */
async function runStage1(
    config: MEMOConfig, projectDir: string, libraryDirs: readonly string[], documents: readonly string[],
    libraryFiles: readonly string[] = [], cacheDir?: string,
): Promise<Stage1Run> {
    // The session's service: a rebuild in `memo dev` does not start another,
    // and the service's parse cache serves the documents that did not change.
    const connection = await sharedOpenSysMLConnection(config);
    try {
        const version = connection.info?.version;
        // Converting only what an edit reached needs both capabilities, and the
        // libraries' handoff being the one the last compile built over.
        const byDocument = Boolean(connection.info?.has?.(CONVERT_DOCUMENTS)) && libraryFiles.length > 0;
        const libraryKey = byDocument ? libraryKeyOf(config, libraryFiles) : undefined;
        const sessionKey = sessionKeyOf(config, projectDir);
        let session = sessions.get(sessionKey);
        if (session && (!byDocument || session.libraryKey !== libraryKey || documents.length === 1)) session = undefined;
        const asking = session !== undefined && Boolean(connection.info?.has?.(PARSE_SOURCES_AFFECTED));
        const parsed = await connection.rpc.parseSources({
            documents: documents.map(file => ({ source: { case: 'filePath', value: file } })),
            ...(asking ? { baseModelHash: session!.modelHash } : {}),
        });
        const diagnostics = parsed.diagnostics.map(d => toDiagnostic(d, version));
        if (parsed.error) {
            diagnostics.push({ domain: 'sysml', provider: OPENSYSML_PROVIDER_ID, providerVersion: version, severity: 'error', message: parsed.error });
        }
        const failed = (): Stage1Run => ({
            handoff: { format: STAGE1_FORMAT, provider: OPENSYSML_PROVIDER_ID, providerVersion: version, clean: false, diagnostics },
            stored: { providerVersion: version, clean: false, diagnostics },
        });
        if (diagnostics.some(d => d.severity === 'error')) return failed();
        const handoffOptions = { ...openSysMLHandoffOptions(projectDir, libraryDirs, documents), providerVersion: version };
        // The conversion's text as the service wrote it, kept for the stage 1 store.
        let content: string | undefined;
        const convert = async (named?: string[]): Promise<ApiElement[] | undefined> => {
            const converted = await connection.rpc.convert({
                source: { case: 'modelHash', value: parsed.modelHash }, toFormat: 'api-json',
                ...(named ? { documents: named } : {}),
            });
            if (converted.error) {
                diagnostics.push(...converted.diagnostics.map(d => toDiagnostic(d, version)));
                diagnostics.push({
                    domain: 'sysml', provider: OPENSYSML_PROVIDER_ID, providerVersion: version, severity: 'error',
                    message: `OpenSysML could not convert the model: ${converted.error}`,
                });
                return undefined;
            }
            content = converted.content;
            return JSON.parse(converted.content) as ApiElement[];
        };

        if (!connection.info?.has?.(CONVERT_DOCUMENTS) || libraryFiles.length === 0) {
            const elements = await convert();
            if (!elements) return failed();
            return {
                handoff: { ...openSysMLHandoff(elements, handoffOptions), diagnostics },
                stored: { providerVersion: version, clean: true, diagnostics, converted: 'whole' },
                content,
            };
        }

        // The libraries are converted once per library content; each compile
        // converts the project's documents the edit reached, and the libraries'
        // elements they reference keep the ids those were written under.
        let library = libraryHandoffs.get(libraryKey!);
        const stored = cacheDir ? libraryFileOf(cacheDir, libraryKey!) : undefined;
        if (!library && stored && existsSync(stored)) library = JSON.parse(readFileSync(stored, 'utf8')) as Stage1Output;
        if (!library) {
            // The package that carries the libraries may carry their export.
            const shipped = findShipped(OPENSYSML_PROVIDER_ID, shippedKeyOf(version, libraryDirs), libraryDirs);
            if (shipped) library = JSON.parse(readShipped(shipped, libraryDirs)) as Stage1Output;
        }
        if (!library) {
            const elements = await convert([...new Set(libraryFiles)]);
            if (!elements) return failed();
            library = openSysMLHandoff(elements, handoffOptions);
            if (stored && cacheDir) {
                mkdirSync(cacheDir, { recursive: true });
                const prefix = `${OPENSYSML_PROVIDER_ID}-library-`;
                for (const name of readdirSync(cacheDir)) if (name.startsWith(prefix)) rmSync(join(cacheDir, name), { force: true });
                writeFileSync(stored, JSON.stringify(library));
            }
        }
        libraryHandoffs.set(libraryKey!, library);
        const libraryPaths = new Set(libraryFiles);
        // An empty list would write every document: a project with none of its own converts nothing.
        const own = documents.filter(file => !libraryPaths.has(file));
        // The documents the service says the edit reached, and any it holds no piece of.
        // A library document among them means the libraries' handoff is not the base's.
        const reached = asking && parsed.affected ? new Set(parsed.affected.map(name => resolve(projectDir, name))) : undefined;
        if (session && reached && [...reached].some(file => libraryPaths.has(file))) session = undefined;
        const previous = session && reached ? session : undefined;
        const toConvert = own.filter(file => !previous || reached!.has(file) || !previous.pieces.has(file));
        Object.assign(openSysMLLastConversion, { converted: toConvert.length, of: own.length, incremental: previous !== undefined });
        const pieces = new Map<string, ProjectPiece>();
        const written = new Map<string, ProjectPiece>();
        const standard: Record<string, ApiIndexEntry> = { ...(previous?.standard ?? {}) };
        if (toConvert.length > 0) {
            const projectElements = await convert(toConvert);
            if (!projectElements) return failed();
            const converted = openSysMLHandoff(projectElements, handoffOptions);
            for (const [id, entry] of Object.entries(converted.index ?? {})) if (entry.role === 'standard') standard[id] = entry;
            for (const document of converted.documents ?? []) {
                const index: Record<string, ApiIndexEntry> = {};
                for (const element of document.elements) {
                    const entry = converted.index?.[element['@id']];
                    if (entry) index[element['@id']] = entry;
                }
                written.set(resolve(document.root ?? projectDir, document.file), { document, index });
            }
        }
        for (const file of own) {
            const piece = written.get(file) ?? previous?.pieces.get(file);
            if (piece) pieces.set(file, piece);
        }
        content = undefined;
        sessions.set(sessionKey, { libraryKey: libraryKey!, modelHash: parsed.modelHash, pieces, standard });
        return {
            handoff: { ...overLibrary(library, projectOf(pieces, standard, version)), diagnostics },
            stored: {
                providerVersion: version, clean: true, diagnostics, converted: 'documents', libraryKey,
                pieces: [...pieces.keys()].map(path => ({ path, file: pieceFileOf(path) })),
            },
            pieces, written: previous ? written : undefined, standard,
        };
    } catch (error) {
        // A service that failed mid-call is not kept for the next one.
        closeSharedOpenSysMLConnection();
        throw error;
    }
}

export const openSysMLLoweringDescriptor: LoweringDescriptor = {
    id: OPENSYSML_PROVIDER_ID,
    role: 'lowering',
    capabilities: ['lower'],
    compileModel: compileWithOpenSysML,
    shipLibrary: shipOpenSysMLLibrary,
    // ParseSources reports what the OpenSysML validator does over the same
    // documents, so a compile is the validator's verdict too.
    compileServesValidator(): boolean {
        return true;
    },
    probe(context: ProviderContext): Availability {
        return probeOpenSysML(context.config);
    },
    create(context: ProviderContext) {
        return {
            id: OPENSYSML_PROVIDER_ID,
            role: 'lowering' as const,
            transport: 'process' as const,
            invocation: () => undefined,
            async run(): Promise<LoweringRunResult> {
                // Every library root a locator offers, the project resolved from
                // what was compiled: what each command compiles, so MEMO parses
                // nothing and `.memo/stage1/` is shared with them.
                const sources = discoverProjectSources(context.projectDir);
                const result = await compileWithOpenSysML({
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
                    provider: OPENSYSML_PROVIDER_ID,
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
