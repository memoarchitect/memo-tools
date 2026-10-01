// ─── OpenSysML as a stage 1 compiler ─────────────────────────────────────────
//
// The lowering half of `toolchain.compiler: opensysml`
// (plans/memo-compiler-stages-opensysml.md). OpenSysML's service parses the
// project and the library roots its resolution selects as one model
// (`ParseSources`) and, only when that model is clean, converts it to the OMG
// API JSON (`Convert` of the model hash). This module turns that JSON into the
// same `memo-stage1/1` handoff SysIDE's export script writes, and stage 2
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
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import type { MEMOConfig } from '../../model/config.js';
import { loadOntologyRegistries } from '../../model/ontology-loader.js';
import { modelToDTO } from '../../model/semantic.js';
import { findSysmlFiles } from '../../model/sysml-files.js';
import { SYSML_IR_VERSION } from '../../model/sysml-ir.js';
import { ApiModel, STAGE1_FORMAT, type ApiElement, type ApiIndexEntry, type Stage1Output } from '../../stage2/api-model.js';
import { buildMemoModelFromApi } from '../../stage2/build-from-api.js';
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
    connectOpenSysML,
    openSysMLSettingsKey,
    probeOpenSysML,
    toDiagnostic,
} from './opensysml.js';

/** Where a document of the model sits: its handoff file and role. */
interface DocumentPlace {
    file: string;
    role: 'project' | 'library';
}

/** What openSysMLHandoff needs beyond the JSON. */
export interface OpenSysMLHandoffOptions {
    projectDir: string;
    libraryDirs: readonly string[];
    providerVersion?: string;
    /** The bytes of a document, by the path the service was given, for byte offsets. */
    source(path: string): Buffer | undefined;
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
            ? { file: relative(root, absolute), role: 'library' }
            : { file: relative(projectDir, absolute), role: 'project' };
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
        const document = findDocument(element);
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
            const document = membership ? findDocument(membership) : undefined;
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
        documents.push({ file: where.file, role: where.role, elements: list });
        const lineStarts = lineStartsOf(options.source(path));
        for (const element of list) {
            const entry: ApiIndexEntry = { file: where.file, role: where.role };
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
    let { libraryDirs, projectFiles, registries } = options;
    if (!libraryDirs || !projectFiles || !registries) {
        const loaded = await loadOntologyRegistries(projectDir);
        registries ??= loaded.registries;
        const resolvedRoots = [...(loaded.resolution?.selectedRoots ?? []), ...(loaded.resolution?.unusedRoots ?? [])];
        libraryDirs ??= (loaded.resolution?.selectedRoots ?? []).map(root => root.sysmlDir);
        projectFiles ??= new Set(findSysmlFiles(projectDir)
            .filter(file => !resolvedRoots.some(root => resolve(file).startsWith(root.sysmlDir)))
            .map(file => relative(projectDir, file)));
    }
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
        handoff = await runStage1(options.config, projectDir, libraryDirs, documents);
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
    const model = buildMemoModelFromApi(api, options.config, registries, projectFiles);
    return { accepted: true, diagnostics, providerVersion: handoff.providerVersion, model, api, cached: reused };
}

/** Parse the model in the service and, when it is clean, convert it to the handoff. */
async function runStage1(
    config: MEMOConfig, projectDir: string, libraryDirs: readonly string[], documents: readonly string[],
): Promise<Stage1Output & { diagnostics: Diagnostic[] }> {
    const connection = await connectOpenSysML(config);
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
        const converted = await connection.rpc.convert({ source: { case: 'modelHash', value: parsed.modelHash }, toFormat: 'api-json' });
        if (converted.error) {
            diagnostics.push(...converted.diagnostics.map(d => toDiagnostic(d, version)));
            diagnostics.push({
                domain: 'sysml', provider: OPENSYSML_PROVIDER_ID, providerVersion: version, severity: 'error',
                message: `OpenSysML could not convert the model: ${converted.error}`,
            });
            return failed();
        }
        const elements = JSON.parse(converted.content) as ApiElement[];
        const handoff = openSysMLHandoff(elements, {
            projectDir, libraryDirs, providerVersion: version,
            source: path => (existsSync(path) ? readFileSync(path) : undefined),
        });
        return { ...handoff, diagnostics };
    } finally {
        await connection.close();
    }
}

export const openSysMLLoweringDescriptor: LoweringDescriptor = {
    id: OPENSYSML_PROVIDER_ID,
    role: 'lowering',
    capabilities: ['lower'],
    compileModel: compileWithOpenSysML,
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
                const result = await compileWithOpenSysML({
                    config: context.config, projectDir: context.projectDir, registries: context.registries,
                    libraryDirs: context.includeDirs,
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
