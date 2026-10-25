// ─── Relationship Writer ──────────────────────────────────────────────────────
//
// Persists model relationships as typed SysML connection usages, and removes
// them again. A relationship is a semantic model fact, so it is always written
// into project SysML — never into a diagram, layout sidecar, or UI state.
//
// Editing is outline-aware (plans/memo-write-back-from-handoff.md): the file's
// declarations are located in its source outline, the edit is applied by source
// offset so comments and unrelated declarations survive untouched, the result
// is compiled by the selected compiler and checked, and only then does it
// atomically replace the file.
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

import { assertWritable, readOnlyRootOf } from './write-guard.js';
import {
    existsSync, mkdirSync, readdirSync, readFileSync,
    realpathSync, renameSync, unlinkSync, writeFileSync,
} from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import type { MemoModelDTO, MemoRelationship } from '../model/semantic.js';
import type {
    RelationshipCreateRequest,
    RelationshipDefinitionDTO,
    RelationshipUpdateRequest,
} from '../model/relationship-legality.js';
import {
    StaleIrIdentityError,
    type IrIdentityIndex,
} from '../model/ir-identity.js';
import {
    notationFor, notationIsNameable, renderRelationship,
    type RelationshipNotation,
} from './sysml-notation.js';
import { shortNameOf } from '../model/element-index.js';
import type { OutlineSource } from '../authoring/outline-source.js';
import { bodyMembers, outlineNodes, type OutlineNode, type SourceOutline } from '../authoring/source-outline.js';

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
    /** Outlines of the project's files, from the selected compiler. */
    outlines: OutlineSource;
}

/** Why a particular file was chosen, for logging and for the UI to show. */
export type PlacementReason =
    | 'requested'
    | 'designated-package-file'
    | 'common-package-file'
    | 'source-element-file'
    | 'target-element-file'
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

export interface RelationshipUpdateResult {
    success: boolean;
    sourceFile?: string;
    declaration?: string;
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

    // Installed ontology and library content is read-only, and so is a package this project depends on:
    // a link whose source is one of its elements is written in the project, never in the package's file.
    const segments = rel.split(sep);
    if (segments.includes('node_modules')) return false;
    if (readOnlyRootOf(requested) || readOnlyRootOf(real)) return false;
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

    // 3b — the source is not writable here (a dependency's element) but the target is this project's own: its file.
    if (target?.file && accept(target.file) && exists(target.file)) {
        return { file: target.file, reason: 'target-element-file', willCreate: false };
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
    const base = `rel_${sanitize(type)}_${sanitize(shortNameOf(sourceId))}_${sanitize(shortNameOf(targetId))}`;
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
        // Declared names, not qualified ids: this generates the name that
        // goes INTO the source, and uniqueness is a property of what the file
        // says. A qualified id appears in no file.
        model.relationships.map(rel => rel.shortName ?? rel.id),
    );
    const declaration = generateRelationshipDeclaration(
        relationshipId, definition,
        // Source text names elements the way the source does: by the feature
        // path, never by the qualified id that addresses them in the model.
        // A dependency takes qualified names (kebnf:58), which resolve from any file; a connection's
        // ends are feature chains relative to the package that holds it.
        notation === 'typedDependency' ? request.sourceId : endpointPath(request.sourceId, model),
        notation === 'typedDependency' ? request.targetId : endpointPath(request.targetId, model),
        request.flowItem, request.guard);

    const outlines = options.outlines;
    const file = placement.file.replaceAll('\\', '/');
    let updated: string;
    if (!existsSync(absolutePath)) {
        updated = newRelationshipFile(placement.file, declaration);
    } else {
        const original = readFileSync(absolutePath, 'utf8');
        let outline: SourceOutline;
        try {
            outline = await outlines.outline(file, original);
        } catch (e) {
            return { success: false, error: `The target file cannot be edited (${message(e)})` };
        }
        const inserted = insertIntoPackage(outline, declaration);
        if (!inserted.ok) return { success: false, error: inserted.error };
        updated = inserted.text;
    }

    // Compile-before-commit: a file the selected compiler rejects never reaches disk.
    const checked = await verified(outlines, file, updated);
    if (typeof checked === 'string') {
        return { success: false, error: `The updated source was not accepted (${checked}); the file was left unchanged` };
    }
    // Where the compile states the edited outline, the declaration must be in
    // it. OpenSysML's content verdict states none: its acceptance of the file
    // with the generated declaration at a member position is the check.
    const written = !checked || (notationIsNameable(notation)
        ? findConnectionUsage(checked, relationshipId) !== undefined
        : containsDeclaration(checked, declaration));
    if (!written) {
        return {
            success: false,
            error: 'The relationship was not present after compiling; the file was left unchanged',
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
 * An endpoint as a feature chain that resolves from any package: the outermost owner by its qualified name, then
 * the nested names by `.` (`Pkg::a.b.port`). Every segment of an `OwnedFeatureChain` is a `[QualifiedName]`
 * (SysML-textual-bnf.kebnf:487-493), and a connector end is a reference subsetting of one (kebnf:463-465, 693-697).
 *
 * Written into SOURCE, so each nested segment is the name its declaration carries, never the qualified id that
 * addresses it. The declaration lands in a package of its own, which need not be the package of the features it
 * joins and need not import it; a bare `a.b` would then resolve nowhere.
 */
function endpointPath(elementId: string, model: Pick<MemoModelDTO, 'elements'>): string {
    const named = (id: string) => model.elements[id]?.shortName ?? shortNameOf(id);
    const nested = [] as string[];
    let outermost = elementId;
    const visited = new Set([elementId]);
    let owner = model.elements[elementId]?.owner;
    while (owner && !visited.has(owner) && model.elements[owner]) {
        nested.unshift(named(outermost));
        outermost = owner;
        visited.add(owner);
        owner = model.elements[owner]?.owner;
    }
    return [outermost, ...nested].join('.');
}

/**
 * Atomically replace one relationship declaration at the exact range supplied
 * by the current compiled model. This also supports anonymous SysML `flow` and
 * `succession` usages, which deliberately have no stable declared name.
 */
export async function updateRelationship(
    request: RelationshipUpdateRequest,
    relationship: MemoRelationship,
    definition: RelationshipDefinitionDTO,
    model: Pick<MemoModelDTO, 'elements'>,
    options: RelationshipWriterOptions,
): Promise<RelationshipUpdateResult> {
    try {
        assertFreshEndpoints(request, options.irIndex);
    } catch (e) {
        if (e instanceof StaleIrIdentityError) return { success: false, error: e.message };
        throw e;
    }
    if (!relationship.file || !isWritableRelationshipFile(relationship.file, options)) {
        return { success: false, error: `${relationship.file || 'The source file'} is not a writable project file` };
    }
    const absolutePath = resolve(options.projectRoot, relationship.file);
    if (!existsSync(absolutePath)) return { success: false, error: `${relationship.file} no longer exists` };
    const source = readFileSync(absolutePath, 'utf8');
    const outlines = options.outlines;
    const file = relativeFile(options.projectRoot, relationship.file);
    let outline: SourceOutline;
    try {
        outline = await outlines.outline(file, source);
    } catch (e) {
        return { success: false, error: `${relationship.file} cannot be edited (${message(e)})` };
    }
    const located = locateRelationship(outline, relationship);
    if (typeof located === 'string') return { success: false, error: located };

    const declaration = generateRelationshipDeclaration(
        declaredNameOf(relationship),
        definition,
        endpointPath(request.sourceId, model),
        endpointPath(request.targetId, model),
        relationship.flowItem,
        relationship.attributes?.guard,
    );
    const updated = source.slice(0, located.start) + declaration + source.slice(located.end);
    const checked = await verified(outlines, file, updated);
    if (typeof checked === 'string') {
        return { success: false, error: `The updated source was not accepted (${checked}); the file was left unchanged` };
    }
    const notation = notationFor(definition);
    const present = !checked || (notationIsNameable(notation)
        ? findConnectionUsage(checked, declaredNameOf(relationship)) !== undefined
        : containsDeclaration(checked, declaration));
    if (!present) return { success: false, error: 'The updated relationship was not present after compiling; the file was left unchanged' };

    try {
        atomicWrite(absolutePath, updated);
    } catch (e) {
        return { success: false, error: `Could not write ${relationship.file}: ${String(e)}` };
    }
    return { success: true, sourceFile: relationship.file, declaration };
}

// ─── Review a trace baseline ────────────────────────────────────────────────

/** One link whose baseline a person has reviewed, and the record and revision it is now made against. */
export interface BaselineReview {
    relationship: MemoRelationship;
    sourceRevision: string;
    /** The imported record the revision belongs to. */
    sourceIdentifier: string;
}

export interface BaselineReviewResult {
    success: boolean;
    sourceFiles?: string[];
    error?: string;
}

/**
 * Rewrite the `@TraceBaseline` inside each link to the revision it was reviewed
 * against. The edit is inside the statement's own range and nothing else moves,
 * so a `satisfy`, a `dependency` or a typed connection keeps whatever else it
 * says; `updateRelationship` regenerates the whole declaration and would drop
 * the body. Same route as every other write: the statement is located in the
 * file's outline, the result is compiled, and only then does the file change.
 * Every file is checked before any is written.
 *
 * A baseline always records both fields: with `sourceIdentifier` the link is
 * judged against that record alone, which is what lets a link between two
 * imported records be cleared at all.
 */
export async function reviewTraceBaselines(
    reviews: readonly BaselineReview[],
    options: RelationshipWriterOptions,
): Promise<BaselineReviewResult> {
    const byFile = new Map<string, BaselineReview[]>();
    const seen = new Set<string>();
    for (const review of reviews) {
        // One review per link: the same statement cannot be reviewed against two records at once.
        if (seen.has(review.relationship.id)) continue;
        seen.add(review.relationship.id);
        const file = review.relationship.file;
        if (!file || !isWritableRelationshipFile(file, options)) {
            return { success: false, error: `${file || 'The source file'} is not a writable project file` };
        }
        byFile.set(file, [...(byFile.get(file) ?? []), review]);
    }

    const pending: { file: string; absolutePath: string; text: string }[] = [];
    for (const [file, fileReviews] of byFile) {
        const absolutePath = resolve(options.projectRoot, file);
        if (!existsSync(absolutePath)) return { success: false, error: `${file} no longer exists` };
        const source = readFileSync(absolutePath, 'utf8');
        const relativePath = relativeFile(options.projectRoot, file);
        let outline: SourceOutline;
        try {
            outline = await options.outlines.outline(relativePath, source);
        } catch (e) {
            return { success: false, error: `${file} cannot be edited (${message(e)})` };
        }
        // A `dependency` that is also a `#refinement` is two links over one statement; edit it once.
        const edits = new Map<number, { start: number; end: number; review: BaselineReview }>();
        for (const review of fileReviews) {
            const located = locateRelationship(outline, review.relationship);
            if (typeof located === 'string') return { success: false, error: located };
            edits.set(located.start, { start: located.start, end: located.end, review });
        }
        let updated = source;
        for (const edit of [...edits.values()].sort((a, b) => b.start - a.start)) {
            const statement = updated.slice(edit.start, edit.end);
            const baseline = /@TraceBaseline\s*\{[^}]*\}/;
            if (!baseline.test(statement)) {
                return { success: false, error: `${edit.review.relationship.id} carries no @TraceBaseline to review` };
            }
            const written = `@TraceBaseline { :>> sourceRevision = ${JSON.stringify(edit.review.sourceRevision)}; `
                + `:>> sourceIdentifier = ${JSON.stringify(edit.review.sourceIdentifier)}; }`;
            updated = updated.slice(0, edit.start) + statement.replace(baseline, () => written) + updated.slice(edit.end);
        }
        const checked = await verified(options.outlines, relativePath, updated);
        if (typeof checked === 'string') {
            return { success: false, error: `The reviewed source was not accepted (${checked}); ${file} was left unchanged` };
        }
        pending.push({ file, absolutePath, text: updated });
    }

    try {
        for (const item of pending) atomicWrite(item.absolutePath, item.text);
    } catch (e) {
        return { success: false, error: `Could not write: ${String(e)}` };
    }
    return { success: true, sourceFiles: pending.map(item => item.file) };
}

/**
 * Insert a declaration as the last member of the file's final top-level
 * package, matching the indentation of the members already there. Everything
 * else in the file — comments, imports, unrelated declarations — is untouched
 * because only this one offset is edited.
 */
function insertIntoPackage(
    outline: SourceOutline,
    declaration: string,
): { ok: true; text: string } | { ok: false; error: string } {
    const source = outline.text;
    const packages = outline.roots.filter(node => node.role === 'package');
    if (packages.length === 0) {
        return { ok: false, error: 'The target file declares no package to own the relationship' };
    }
    const target = packages[packages.length - 1];
    if (!target.body) return { ok: false, error: 'The target package is not brace-delimited' };
    const closingBrace = target.body.close;
    const indent = memberIndent(source, target, closingBrace);

    // Keep the existing content up to the closing brace exactly as written, then
    // add the declaration on its own line just before it.
    const before = source.slice(0, closingBrace);
    const after = source.slice(closingBrace);
    const separator = before.endsWith('\n') ? '' : '\n';
    return { ok: true, text: `${before}${separator}${indent}${declaration}\n${after}` };
}

/** Indentation used by the package's existing members, defaulting to 4 spaces. */
function memberIndent(source: string, pkg: OutlineNode, closingBrace: number): string {
    const offset = bodyMembers(pkg)[0]?.start;
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
    relationship: Pick<MemoRelationship, 'id' | 'shortName' | 'file' | 'named' | 'sourceRange'>,
    options: RelationshipWriterOptions,
): Promise<RelationshipRemoveResult> {
    // An anonymous statement (`satisfy r by x;`) is addressed by the range the compile recorded for it,
    // as `updateRelationship` already does; one with neither a name nor a range cannot be.
    if (!relationship.named && !relationship.sourceRange) {
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
    const outlines = options.outlines;
    const file = relativeFile(options.projectRoot, relationship.file);
    let outline: SourceOutline;
    try {
        outline = await outlines.outline(file, source);
    } catch (e) {
        return { success: false, error: `${relationship.file} cannot be edited (${message(e)})` };
    }

    const located = relationship.named
        ? findConnectionUsage(outline, declaredNameOf(relationship))
        : locateRelationship(outline, relationship);
    if (typeof located === 'string') return { success: false, error: located };
    const usage = located;
    if (!usage) {
        return { success: false, error: `Relationship "${relationship.id}" was not found in ${relationship.file}` };
    }

    // One `dependency a to b, c;` is several links over one statement. Cutting it for one of them
    // would delete the others without a word, so it is refused: the source states more than one link.
    const header = source.slice(usage.start, usage.end).split(/[{;]/, 1)[0];
    if (/^\s*(?:#[\w:]+\s+)*dependency\b/.test(header) && header.includes(',')) {
        return {
            success: false,
            error: `${relationship.file} declares several links in this one dependency statement; ` +
                'remove the one you mean in the source, or split the statement first.',
        };
    }

    // Widen the cut to the whole line when the declaration is alone on it, so
    // deletion leaves no blank indented remnant.
    let start = usage.start;
    let end = usage.end;
    const lineStart = source.lastIndexOf('\n', start - 1) + 1;
    if (/^[ \t]*$/.test(source.slice(lineStart, start))) start = lineStart;
    const lineEnd = source.indexOf('\n', end);
    if (lineEnd >= 0 && /^[ \t]*$/.test(source.slice(end, lineEnd))) end = lineEnd + 1;

    const removedDeclaration = source.slice(usage.start, usage.end);
    const updated = source.slice(0, start) + source.slice(end);

    // Compile-before-commit, exactly as on the create path.
    const checked = await verified(outlines, file, updated);
    if (typeof checked === 'string') {
        return {
            success: false,
            error: `Removing the relationship left source that was not accepted (${checked}); ` +
                'the file was left unchanged',
        };
    }
    const stillThere = checked !== undefined && (relationship.named
        ? findConnectionUsage(checked, declaredNameOf(relationship)) !== undefined
        : containsDeclaration(checked, removedDeclaration));
    if (stillThere) {
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
 * Whether a file's outline contains exactly the declaration that was inserted.
 *
 * The confirmation for anonymous notations. A named connection can be looked up
 * by name; a succession cannot, so the check is that some declaration's own
 * source range *is* the text that was inserted — which proves both that it
 * survived the compile and that the compiler read it as one declaration rather
 * than as a fragment of something larger.
 */
function containsDeclaration(outline: SourceOutline, declaration: string): boolean {
    const wanted = declaration.trim();
    for (const node of outlineNodes(outline)) {
        if (outline.text.slice(node.start, node.end).trim() === wanted) return true;
    }
    return false;
}

/** Depth-first search for a named connection usage anywhere in the document. */
/**
 * The name a relationship is declared with in its source file.
 *
 * Its `id` is the QUALIFIED name and addresses it in the model; the file knows
 * only the last segment. Every one of this module's source edits matches on
 * the declaration, so every one of them wants this and not the id. `shortName`
 * is absent on an anonymous relationship, whose id is a positional `rel-N`
 * that matches no declaration either way.
 */
function declaredNameOf(relationship: Pick<MemoRelationship, 'id' | 'shortName'>): string {
    return relationship.shortName ?? shortNameOf(relationship.id);
}

/**
 * The connector usages a name can address: a typed `connection`, the `interface` and `flow` a
 * ComponentExchange and a FunctionalExchange are written as, and a named `binding`.
 */
const NAMED_CONNECTOR_METACLASSES: ReadonlySet<string> = new Set([
    'ConnectionUsage', 'InterfaceUsage', 'FlowUsage', 'FlowConnectionUsage', 'BindingConnectorAsUsage',
]);

/** A named connector usage anywhere in the file. */
function findConnectionUsage(outline: SourceOutline, name: string): OutlineNode | undefined {
    for (const node of outlineNodes(outline)) {
        if (NAMED_CONNECTOR_METACLASSES.has(node.metaclass) && node.name === name) return node;
    }
    return undefined;
}

/**
 * The declaration of a relationship the model holds, in the file as it is now:
 * a named one by its qualified name; an anonymous one by the source range the
 * compile recorded — in characters from MEMO's parse, in bytes from a handoff —
 * which must still hold a relationship statement exactly.
 */
function locateRelationship(
    outline: SourceOutline, relationship: Pick<MemoRelationship, 'id' | 'shortName' | 'named' | 'sourceRange'>,
): OutlineNode | string {
    const nodes = [...outlineNodes(outline)];
    if (relationship.named) {
        const found = nodes.filter(node => node.key === relationship.id);
        if (found.length === 1) return found[0];
    }
    const range = relationship.sourceRange;
    if (!range) return 'The relationship has no source range in the current model revision';
    const bytes = (offset: number) => Buffer.byteLength(outline.text.slice(0, offset), 'utf8');
    const matches = nodes.filter(node =>
        (node.start === range.offset && node.end - node.start === range.length)
        || (bytes(node.start) === range.offset && bytes(node.end) - bytes(node.start) === range.length));
    return matches.length === 1 ? matches[0] : 'The relationship source range is stale';
}

/** The file's outline after compiling the text, or why the compiler refused it. */
async function verified(outlines: OutlineSource, file: string, text: string): Promise<SourceOutline | undefined | string> {
    try {
        return await outlines.verify(file, text);
    } catch (e) {
        return message(e);
    }
}

function message(e: unknown): string {
    return e instanceof Error ? e.message : String(e);
}

function relativeFile(projectRoot: string, file: string): string {
    return (isAbsolute(file) ? relative(projectRoot, file) : file).replaceAll('\\', '/');
}

/**
 * Replace a file's contents atomically: write a sibling temp file, then rename
 * over the target. A crash mid-write leaves the original intact rather than a
 * half-written model file.
 */
function atomicWrite(absolutePath: string, contents: string): void {
    assertWritable(absolutePath);
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
