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
    const cached = options.cacheDir ? join(options.cacheDir, `${OPENSYSML_PROVIDER_ID}.json`) : undefined;
    const keyFile = cached ? `${cached}.key` : undefined;
    let handoff: Stage1Output & { diagnostics?: Diagnostic[] };
    let reused = false;
    if (cached && keyFile && !options.force && existsSync(cached) && existsSync(keyFile)
        && readFileSync(keyFile, 'utf8') === key) {
        handoff = JSON.parse(readFileSync(cached, 'utf8'));
        reused = true;
    } else {
        handoff = await runStage1(options.config, projectDir, libraryDirs, documents, libraryFiles, options.cacheDir);
        if (cached && keyFile && options.cacheDir) {
            mkdirSync(options.cacheDir, { recursive: true });
            // Tool output, never authored content: the directory ignores
            // itself, so no project has to know to add it to its .gitignore.
            const ignore = join(options.cacheDir, '.gitignore');
            if (!existsSync(ignore)) writeFileSync(ignore, '*\n');
            writeFileSync(cached, JSON.stringify(handoff));
            writeFileSync(keyFile, key);
        }
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

/** The capability that limits a conversion to named documents. */
const CONVERT_DOCUMENTS = 'convert_documents';

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
): Promise<Stage1Output & { diagnostics: Diagnostic[] }> {
    // The session's service: a rebuild in `memo dev` does not start another,
    // and the service's parse cache serves the documents that did not change.
    const connection = await sharedOpenSysMLConnection(config);
    try {
        const version = connection.info?.version;
        const parsed = await connection.rpc.parseSources({
            documents: documents.map(file => ({ source: { case: 'filePath', value: file } })),
        });
        const diagnostics = parsed.diagnostics.map(d => toDiagnostic(d, version));
        if (parsed.error) {
            diagnostics.push({ domain: 'sysml', provider: OPENSYSML_PROVIDER_ID, providerVersion: version, severity: 'error', message: parsed.error });
        }
        const failed = (): Stage1Output & { diagnostics: Diagnostic[] } =>
            ({ format: STAGE1_FORMAT, provider: OPENSYSML_PROVIDER_ID, providerVersion: version, clean: false, diagnostics });
        if (diagnostics.some(d => d.severity === 'error')) return failed();
        const handoffOptions = {
            projectDir, libraryDirs, providerVersion: version,
            source: (path: string) => (existsSync(path) ? readFileSync(path) : undefined),
            ...(documents.length === 1 ? { soleDocument: documents[0] } : {}),
        };
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
            return JSON.parse(converted.content) as ApiElement[];
        };

        if (!connection.info?.has?.(CONVERT_DOCUMENTS) || libraryFiles.length === 0) {
            const elements = await convert();
            return elements ? { ...openSysMLHandoff(elements, handoffOptions), diagnostics } : failed();
        }

        // The libraries are converted once per library content; each compile
        // converts the project's documents, and the libraries' elements they
        // reference keep the ids those were written under.
        const libraryKey = libraryKeyOf(config, libraryFiles);
        let library = libraryHandoffs.get(libraryKey);
        const stored = cacheDir ? join(cacheDir, `${OPENSYSML_PROVIDER_ID}-library-${libraryKey.slice(0, 16)}.json`) : undefined;
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
        libraryHandoffs.set(libraryKey, library);
        const libraryPaths = new Set(libraryFiles);
        // An empty list would write every document: a project with none of its own converts nothing.
        const own = documents.filter(file => !libraryPaths.has(file));
        const projectElements = own.length > 0 ? await convert(own) : [];
        if (!projectElements) return failed();
        const project = openSysMLHandoff(projectElements, handoffOptions);
        return {
            ...project,
            documents: [...(library.documents ?? []), ...(project.documents ?? [])],
            index: { ...library.index, ...project.index },
            diagnostics,
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
