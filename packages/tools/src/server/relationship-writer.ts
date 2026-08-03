// ─── Relationship Writer ──────────────────────────────────────────────────────
//
// Persists model relationships as typed SysML connection usages, and removes
// them again. A relationship is a semantic model fact, so it is always written
// into project SysML — never into a diagram, layout sidecar, or UI state.
//
// Editing is CST-aware: the file is parsed, the edit is applied by source
// offset so comments and unrelated declarations survive untouched, the result
// is reparsed and validated, and only then does it atomically replace the file.
//
// Endpoints are addressed by **IR identity** when the caller quotes one (§6.2).
// A relationship names two elements, so a request built against a stale
// revision is a request to connect two things that may no longer be what the
// client thought they were — it is refused, loudly, rather than written against
// whatever now answers to those names.
//
// The notation is standard SysML, chosen in ./sysml-notation.ts: a succession
// is written `succession first a if g then b;`, not encoded as a MEMO-flavoured
// connection usage.
// ─────────────────────────────────────────────────────────────────────────────

import {
    existsSync, mkdirSync, readdirSync, readFileSync,
    realpathSync, renameSync, unlinkSync, writeFileSync,
} from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import type { MemoModelDTO, MemoRelationship } from '../model/semantic.js';
import type {
    RelationshipCreateRequest,
    RelationshipDefinitionDTO,
} from '../model/relationship-legality.js';
import { parseText } from '../model/parser-utils.js';
import {
    StaleIrIdentityError,
    type IrIdentityIndex,
} from '../model/ir-identity.js';
import {
    notationFor, notationIsNameable, renderRelationship,
    type RelationshipNotation,
} from './sysml-notation.js';
import {
    isConnectionUsage,
    isPackageDeclaration,
    type ConnectionUsage,
    type PackageDeclaration,
} from '../language/generated/ast.js';

// Project-layout conventions, not ontology semantics — these describe where a
// MEMO project keeps its files, so they are overridable per project rather than
// fixed in the engine.

/** Default file used when the project has no better home for a relationship. */
export const CANONICAL_RELATIONSHIP_FILE = 'model/catalog/relationships.sysml';

/** Directory segments holding view/presentation SysML — never a relationship home. */
export const DEFAULT_PRESENTATION_DIRS = ['views'];

/** Filenames a package uses to collect its relationships. */
export const DEFAULT_RELATIONSHIP_FILE_PATTERN = /relationships?\.sysml$/i;

export interface RelationshipWriterOptions {
    /** Absolute project root. Nothing outside it is ever written. */
    projectRoot: string;
    /**
     * Per-package designated relationship files, project-relative.
     * Keyed by package qualified name, from project configuration.
     */
    designatedFiles?: Record<string, string>;
    /** Configured canonical relationship file, project-relative. */
    canonicalFile?: string;
    /**
     * Absolute roots of installed ontology/library packages. Files under these
     * are read-only content and are never modified.
     */
    ontologyRoots?: string[];
    /**
     * Directory segments that hold view/presentation SysML. A relationship is a
     * model fact and is never written into one.
     */
    presentationDirs?: string[];
    /** Filenames treated as a package's relationship collection. */
    relationshipFilePattern?: RegExp;
    /**
     * Identity index of the current revision.
     *
     * Present whenever a compiled revision exists. Absent only before the first
     * successful lowering, and a request quoting an identity is then refused
     * rather than written blind.
     */
    irIndex?: IrIdentityIndex;
}

/** Why a particular file was chosen, for logging and for the UI to show. */
export type PlacementReason =
    | 'requested'
    | 'designated-package-file'
    | 'common-package-file'
    | 'source-element-file'
    | 'canonical-file'
    | 'canonical-file-created';

export interface RelationshipPlacement {
    /** Project-relative .sysml path that will own the relationship. */
    file: string;
    reason: PlacementReason;
    /** True when the file does not exist yet and will be created. */
    willCreate: boolean;
}

export interface RelationshipWriteResult {
    success: boolean;
    /** Project-relative file actually written. */
    sourceFile?: string;
    /**
     * Stable ID (the connection usage name) of the created relationship.
     *
     * Absent for notations SysML does not name — see `notation`.
     */
    relationshipId?: string;
    /** SysML production the relationship was written in. */
    notation?: RelationshipNotation;
    /** The exact declaration text inserted. */
    declaration?: string;
    placementReason?: PlacementReason;
    error?: string;
    /** Set when the failure was a stale endpoint identity. */
    stale?: boolean;
}

export interface RelationshipRemoveResult {
    success: boolean;
    sourceFile?: string;
    /** The declaration removed, so the caller can offer an exact undo. */
    removedDeclaration?: string;
    error?: string;
}

// ─── Path guards ────────────────────────────────────────────────────────────

/**
 * Whether a project-relative path is a legal home for a model relationship.
 *
 * Rejects anything outside the project, non-.sysml files, installed ontology
 * content, and the diagram presentation section. Symlinks are resolved before
 * the containment check so an in-tree link cannot escape the project.
 */
export function isWritableRelationshipFile(
    relativePath: string,
    options: RelationshipWriterOptions,
): boolean {
    if (!relativePath || !relativePath.endsWith('.sysml')) return false;

    const projectRoot = realpathSync(resolve(options.projectRoot));
    const requested = resolve(projectRoot, relativePath);

    // Resolve symlinks for files that already exist; a new file is judged by
    // the real path of the closest existing ancestor directory.
    let real = requested;
    if (existsSync(requested)) {
        real = realpathSync(requested);
    } else {
        let dir = dirname(requested);
        while (!existsSync(dir) && dirname(dir) !== dir) dir = dirname(dir);
        real = join(realpathSync(dir), relative(dir, requested));
    }

    const rel = relative(projectRoot, real);
    if (rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) return false;

    // Installed ontology and library content is read-only.
    const segments = rel.split(sep);
    if (segments.includes('node_modules')) return false;
    for (const root of options.ontologyRoots ?? []) {
        const ontologyReal = existsSync(root) ? realpathSync(root) : resolve(root);
        const fromOntology = relative(ontologyReal, real);
        if (fromOntology && !fromOntology.startsWith('..') && !isAbsolute(fromOntology)) return false;
    }

    // A relationship is a model fact, not presentation — keep it out of views/.
    const presentationDirs = options.presentationDirs ?? DEFAULT_PRESENTATION_DIRS;
    if (segments.some(segment => presentationDirs.includes(segment))) return false;

    return true;
}

// ─── Ownership policy ───────────────────────────────────────────────────────

/**
 * Choose the file that will own a new relationship, deterministically:
 *
 *   1. the file the request explicitly asked for
 *   2. the designated relationship file of the active model package
 *   3. an existing relationships file in the nearest common package of both
 *      endpoints, else the source element's own file within that package
 *   4. the configured canonical relationship file, when it already exists
 *   5. the canonical file, created only because nothing above was suitable
 *
 * Every candidate passes isWritableRelationshipFile before it is considered.
 */
export function resolveRelationshipPlacement(
    request: Pick<RelationshipCreateRequest, 'sourceId' | 'targetId' | 'owningFile'>,
    model: Pick<MemoModelDTO, 'elements'>,
    options: RelationshipWriterOptions,
): RelationshipPlacement {
    const accept = (file: string) => isWritableRelationshipFile(file, options);
    const exists = (file: string) => existsSync(resolve(options.projectRoot, file));

    // 1 — explicit request.
    if (request.owningFile && accept(request.owningFile)) {
        return { file: request.owningFile, reason: 'requested', willCreate: !exists(request.owningFile) };
    }

    const source = model.elements[request.sourceId];
    const target = model.elements[request.targetId];

    // 2 — the active package's designated relationship file.
    const designated = options.designatedFiles ?? {};
    for (const pkg of [source?.package, target?.package]) {
        const file = pkg ? designated[pkg] : undefined;
        if (file && accept(file)) {
            return { file, reason: 'designated-package-file', willCreate: !exists(file) };
        }
    }

    // 3 — nearest writable common project package for both endpoints.
    if (source?.file && target?.file) {
        const commonDir = commonDirectory(source.file, target.file);
        const existingRelFile = findRelationshipFileIn(commonDir, options);
        if (existingRelFile && accept(existingRelFile)) {
            return { file: existingRelFile, reason: 'common-package-file', willCreate: false };
        }
        // The source element's own file, when it sits in that common package.
        if (withinDirectory(source.file, commonDir) && accept(source.file) && exists(source.file)) {
            return { file: source.file, reason: 'source-element-file', willCreate: false };
        }
    }

    // 4/5 — the canonical file, created only as a last resort.
    const canonical = options.canonicalFile ?? CANONICAL_RELATIONSHIP_FILE;
    return {
        file: canonical,
        reason: exists(canonical) ? 'canonical-file' : 'canonical-file-created',
        willCreate: !exists(canonical),
    };
}

/** Deepest directory containing both project-relative files. */
function commonDirectory(fileA: string, fileB: string): string {
    const a = dirname(fileA).split(/[\\/]/);
    const b = dirname(fileB).split(/[\\/]/);
    const common: string[] = [];
    for (let i = 0; i < Math.min(a.length, b.length); i++) {
        if (a[i] !== b[i]) break;
        common.push(a[i]);
    }
    return common.join(sep);
}

/** True when a project-relative file sits in or under a directory. */
function withinDirectory(file: string, dir: string): boolean {
    if (!dir) return true;
    const normalized = dirname(file).split(/[\\/]/).join(sep);
    return normalized === dir || normalized.startsWith(dir + sep);
}

/**
 * An existing relationships-named .sysml directly in a directory. Convention
 * over configuration: a package that already collects its links in one file
 * keeps collecting them there.
 */
function findRelationshipFileIn(
    dir: string,
    options: RelationshipWriterOptions,
): string | undefined {
    const absoluteDir = resolve(options.projectRoot, dir);
    if (!existsSync(absoluteDir)) return undefined;
    let entries: string[];
    try {
        const pattern = options.relationshipFilePattern ?? DEFAULT_RELATIONSHIP_FILE_PATTERN;
        entries = readdirSync(absoluteDir, { withFileTypes: true })
            .filter(e => e.isFile() && pattern.test(e.name))
            .map(e => e.name)
            .sort();
    } catch {
        return undefined;
    }
    if (entries.length === 0) return undefined;
    return dir ? `${dir}${sep}${entries[0]}` : entries[0];
}

// ─── ID generation ──────────────────────────────────────────────────────────

/**
 * A stable, explicit relationship ID. Named connection usages are what make a
 * relationship addressable for inspection, deletion, and deep links, so every
 * authored relationship gets one.
 */
export function generateRelationshipId(
    type: string,
    sourceId: string,
    targetId: string,
    taken: Iterable<string>,
): string {
    const sanitize = (value: string) => value.replace(/[^A-Za-z0-9_]/g, '_');
    const base = `rel_${sanitize(type)}_${sanitize(sourceId)}_${sanitize(targetId)}`;
    const used = new Set(taken);
    if (!used.has(base)) return base;
    let n = 2;
    while (used.has(`${base}_${n}`)) n++;
    return `${base}_${n}`;
}

/**
 * Render a relationship as SysML source.
 *
 * The form comes from the language, not from this module — see
 * `./sysml-notation.ts`. Kept as a named export because the shape "id,
 * definition, endpoints" is what every caller has.
 */
export function generateRelationshipDeclaration(
    id: string,
    definition: RelationshipDefinitionDTO,
    sourceId: string,
    targetId: string,
    flowItem?: string,
    guard?: string,
): string {
    return renderRelationship({ id, definition, sourceId, targetId, flowItem, guard });
}

// ─── Create ─────────────────────────────────────────────────────────────────

/**
 * Write a relationship into project SysML.
 *
 * The declaration is inserted inside the target package by source offset, the
 * whole updated file is reparsed, and the write is abandoned if the result does
 * not parse or does not contain the new connection.
 */
export async function writeRelationship(
    request: RelationshipCreateRequest,
    definition: RelationshipDefinitionDTO,
    model: Pick<MemoModelDTO, 'elements' | 'relationships'>,
    options: RelationshipWriterOptions,
): Promise<RelationshipWriteResult> {
    // Endpoint identities first: a request built against a revision that has
    // moved on must not be written at all, so this precedes every file decision.
    try {
        assertFreshEndpoints(request, options.irIndex);
    } catch (e) {
        if (e instanceof StaleIrIdentityError) return { success: false, stale: true, error: e.message };
        throw e;
    }

    const placement = resolveRelationshipPlacement(request, model, options);
    if (!isWritableRelationshipFile(placement.file, options)) {
        return { success: false, error: `No writable project file can own this relationship (${placement.file})` };
    }

    const absolutePath = resolve(options.projectRoot, placement.file);
    const notation = notationFor(definition);
    const relationshipId = generateRelationshipId(
        definition.name,
        request.sourceId,
        request.targetId,
        model.relationships.map(rel => rel.id),
    );
    const declaration = generateRelationshipDeclaration(
        relationshipId, definition, request.sourceId, request.targetId, request.flowItem, request.guard);

    let updated: string;
    if (!existsSync(absolutePath)) {
        updated = newRelationshipFile(placement.file, declaration);
    } else {
        const original = readFileSync(absolutePath, 'utf8');
        const inserted = await insertIntoPackage(original, declaration);
        if (!inserted.ok) return { success: false, error: inserted.error };
        updated = inserted.text;
    }

    // Parse-before-commit: a file that does not parse never reaches disk.
    const { document, errors } = await parseText(updated);
    if (errors.length > 0) {
        return {
            success: false,
            error: `The updated source did not parse (${errors[0].message}); the file was left unchanged`,
        };
    }
    const written = notationIsNameable(notation)
        ? findConnectionUsage(document.parseResult.value as any, relationshipId) !== undefined
        : containsDeclaration(document.parseResult.value as any, updated, declaration);
    if (!written) {
        return {
            success: false,
            error: 'The relationship was not present after reparsing; the file was left unchanged',
        };
    }

    try {
        atomicWrite(absolutePath, updated);
    } catch (e) {
        return { success: false, error: `Could not write ${placement.file}: ${String(e)}` };
    }

    return {
        success: true,
        sourceFile: placement.file,
        // SysML's succession and flow productions take no declared name, so a
        // relationship written in one is addressed by position. Reporting an ID
        // it does not have would only make deletion fail later, further away.
        ...(notationIsNameable(notation) ? { relationshipId } : {}),
        notation,
        declaration,
        placementReason: placement.reason,
    };
}

/**
 * Refuse a request whose endpoints were named against an older revision.
 *
 * Only quoted identities are checked. A caller that quotes none is asking for
 * the by-name behaviour it always had, and gets it — the loud failure is for
 * callers that *did* name a revision and named a stale one, which is the case
 * where continuing would connect the wrong elements.
 */
function assertFreshEndpoints(
    request: Pick<RelationshipCreateRequest, 'sourceId' | 'targetId' | 'sourceIdentity' | 'targetIdentity'>,
    index: IrIdentityIndex | undefined,
): void {
    const ends: Array<['source' | 'target', string | undefined, string]> = [
        ['source', request.sourceIdentity, request.sourceId],
        ['target', request.targetIdentity, request.targetId],
    ];
    for (const [end, identityId, elementId] of ends) {
        if (!identityId) continue;
        if (!index) {
            throw new StaleIrIdentityError(
                identityId, 'no compiled revision is available to resolve the ' + end + ' endpoint against');
        }
        const record = index.byIdentity.get(identityId);
        if (!record) {
            throw new StaleIrIdentityError(identityId, `the ${end} endpoint is not in the current model revision`);
        }
        const named = record.memoElementId;
        if (named !== elementId) {
            throw new StaleIrIdentityError(
                identityId,
                `the ${end} endpoint now names ${named ? `"${named}"` : 'a declaration MEMO does not project'}, `
                + `not "${elementId}"`);
        }
    }
}

/** Body of a freshly created relationship file. */
function newRelationshipFile(relativePath: string, declaration: string): string {
    const packageName = relativePath
        .replace(/\.sysml$/, '')
        .replace(/[^A-Za-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '') || 'relationships';
    return `package ${packageName} {\n    ${declaration}\n}\n`;
}

/**
 * Insert a declaration as the last member of the file's final top-level
 * package, matching the indentation of the members already there. Everything
 * else in the file — comments, imports, unrelated declarations — is untouched
 * because only this one offset is edited.
 */
async function insertIntoPackage(
    source: string,
    declaration: string,
): Promise<{ ok: true; text: string } | { ok: false; error: string }> {
    const { document, errors } = await parseText(source);
    if (errors.length > 0) {
        return { ok: false, error: `The target file does not parse (${errors[0].message})` };
    }

    const model = document.parseResult.value as any;
    const packages = (model.members ?? []).filter(isPackageDeclaration) as PackageDeclaration[];
    if (packages.length === 0) {
        return { ok: false, error: 'The target file declares no package to own the relationship' };
    }

    const target = packages[packages.length - 1];
    const cst = target.$cstNode;
    if (!cst) return { ok: false, error: 'The target package has no source range' };

    // The package's own closing brace is the last '}' in its source range.
    const packageEnd = cst.offset + cst.length;
    const closingBrace = source.lastIndexOf('}', packageEnd - 1);
    if (closingBrace < 0) return { ok: false, error: 'The target package is not brace-delimited' };

    const indent = memberIndent(source, target, closingBrace);

    // Keep the existing content up to the closing brace exactly as written, then
    // add the declaration on its own line just before it.
    const before = source.slice(0, closingBrace);
    const after = source.slice(closingBrace);
    const separator = before.endsWith('\n') ? '' : '\n';
    return { ok: true, text: `${before}${separator}${indent}${declaration}\n${after}` };
}

/** Indentation used by the package's existing members, defaulting to 4 spaces. */
function memberIndent(source: string, pkg: PackageDeclaration, closingBrace: number): string {
    const firstMember = (pkg.members ?? [])[0] as any;
    const offset = firstMember?.$cstNode?.offset;
    if (typeof offset === 'number') {
        const lineStart = source.lastIndexOf('\n', offset - 1) + 1;
        const lead = source.slice(lineStart, offset);
        if (/^[ \t]*$/.test(lead)) return lead;
    }
    // Fall back to one level in from the closing brace's own indentation.
    const braceLineStart = source.lastIndexOf('\n', closingBrace - 1) + 1;
    const braceIndent = source.slice(braceLineStart, closingBrace);
    return /^[ \t]*$/.test(braceIndent) ? braceIndent + '    ' : '    ';
}

// ─── Delete ─────────────────────────────────────────────────────────────────

/**
 * Remove exactly one connection usage from its owning file.
 *
 * Only the declaration's own source range is cut — together with the whitespace
 * on its line — so neighbouring comments and declarations are preserved. Both
 * endpoint elements are left completely untouched.
 */
export async function removeRelationship(
    relationship: Pick<MemoRelationship, 'id' | 'file' | 'named'>,
    options: RelationshipWriterOptions,
): Promise<RelationshipRemoveResult> {
    if (!relationship.named) {
        return {
            success: false,
            error: `Relationship "${relationship.id}" is an anonymous connection and cannot be addressed for deletion. ` +
                'Give it a name in SysML first.',
        };
    }
    if (!relationship.file || !isWritableRelationshipFile(relationship.file, options)) {
        return { success: false, error: `${relationship.file || 'The source file'} is not a writable project file` };
    }

    const absolutePath = resolve(options.projectRoot, relationship.file);
    if (!existsSync(absolutePath)) {
        return { success: false, error: `${relationship.file} no longer exists` };
    }

    const source = readFileSync(absolutePath, 'utf8');
    const { document, errors } = await parseText(source);
    if (errors.length > 0) {
        return { success: false, error: `${relationship.file} does not parse (${errors[0].message})` };
    }

    const usage = findConnectionUsage(document.parseResult.value as any, relationship.id);
    const cst = usage?.$cstNode;
    if (!usage || !cst) {
        return { success: false, error: `Relationship "${relationship.id}" was not found in ${relationship.file}` };
    }

    // Widen the cut to the whole line when the declaration is alone on it, so
    // deletion leaves no blank indented remnant.
    let start = cst.offset;
    let end = cst.offset + cst.length;
    const lineStart = source.lastIndexOf('\n', start - 1) + 1;
    if (/^[ \t]*$/.test(source.slice(lineStart, start))) start = lineStart;
    const lineEnd = source.indexOf('\n', end);
    if (lineEnd >= 0 && /^[ \t]*$/.test(source.slice(end, lineEnd))) end = lineEnd + 1;

    const removedDeclaration = source.slice(cst.offset, cst.offset + cst.length);
    const updated = source.slice(0, start) + source.slice(end);

    // Parse-before-commit, exactly as on the create path.
    const reparsed = await parseText(updated);
    if (reparsed.errors.length > 0) {
        return {
            success: false,
            error: `Removing the relationship left invalid source (${reparsed.errors[0].message}); ` +
                'the file was left unchanged',
        };
    }
    if (findConnectionUsage(reparsed.document.parseResult.value as any, relationship.id)) {
        return { success: false, error: 'The relationship was still present after removal; the file was left unchanged' };
    }

    try {
        atomicWrite(absolutePath, updated);
    } catch (e) {
        return { success: false, error: `Could not write ${relationship.file}: ${String(e)}` };
    }

    return { success: true, sourceFile: relationship.file, removedDeclaration };
}

// ─── Shared helpers ─────────────────────────────────────────────────────────

/**
 * Whether a parsed document contains exactly the declaration that was inserted.
 *
 * The confirmation for anonymous notations. A named connection can be looked up
 * by name; a succession cannot, so the check is that some parsed node's own
 * source range *is* the text that was inserted — which proves both that it
 * survived the reparse and that the parser read it as one declaration rather
 * than as a fragment of something larger.
 */
function containsDeclaration(model: { members?: any[] }, source: string, declaration: string): boolean {
    const wanted = declaration.trim();
    const stack: any[] = [...(model.members ?? [])];
    while (stack.length > 0) {
        const node = stack.pop();
        if (!node || typeof node !== 'object') continue;
        const cst = node.$cstNode;
        if (cst && source.slice(cst.offset, cst.offset + cst.length).trim() === wanted) return true;
        if (Array.isArray(node.members)) stack.push(...node.members);
        if (Array.isArray(node.body)) stack.push(...node.body);
    }
    return false;
}

/** Depth-first search for a named connection usage anywhere in the document. */
function findConnectionUsage(model: { members?: any[] }, name: string): ConnectionUsage | undefined {
    const stack: any[] = [...(model.members ?? [])];
    while (stack.length > 0) {
        const node = stack.pop();
        if (!node || typeof node !== 'object') continue;
        if (isConnectionUsage(node) && node.name === name) return node;
        if (Array.isArray(node.members)) stack.push(...node.members);
        if (Array.isArray(node.body)) stack.push(...node.body);
    }
    return undefined;
}

/**
 * Replace a file's contents atomically: write a sibling temp file, then rename
 * over the target. A crash mid-write leaves the original intact rather than a
 * half-written model file.
 */
function atomicWrite(absolutePath: string, contents: string): void {
    const dir = dirname(absolutePath);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    const tempPath = `${absolutePath}.${process.pid}.tmp`;
    try {
        writeFileSync(tempPath, contents, 'utf8');
        renameSync(tempPath, absolutePath);
    } catch (e) {
        if (existsSync(tempPath)) {
            try { unlinkSync(tempPath); } catch { /* best effort cleanup */ }
        }
        throw e;
    }
}
