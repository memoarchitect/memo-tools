// ─── View write-back ─────────────────────────────────────────────────────────
//
// Declaring a view in SysML, instead of recording it in a JSON sidecar.
//
// A view IS model content, and MEMO says so everywhere else: `view … :
// MemoDiagramView { … }` is an ontology construct, `view-deriver.ts` turns one
// into a diagram, and `saveViewLayout()` keeps a view's layout in the
// `@MemoLayout…` statements of the view itself — and keeps none for a diagram
// with no `sourceFile`, which is to say one that was never declared.
//
// `diagram:create` was the one path that produced such a diagram. It appended a
// row to `.memo/user-diagrams.json`, so a view authored in the app was invisible
// to `memo validate` and to the selected compiler, absent from review, untracked by git
// wherever `.memo/` is ignored, and — having no source file — had nowhere to
// keep its layout either. Two mechanisms for one concept, and the
// authored half was the one the toolchain could not see.
//
// So creation writes the declaration, and everything downstream follows on its
// own: the file watcher recompiles, `view-deriver` produces the diagram with
// `sourceFile` set, and its layout is kept in the view's own statements.
//
// WHERE the declaration goes is not configured, it is learned. A project that
// already declares views of this kind has answered the question — same file,
// same package, same view definition, same `expose` and viewpoint conventions as
// its siblings. That is the rule `relationship-writer.ts` already applies to
// connections ("a package that already collects its links in one file keeps
// collecting them there"), applied to views. With no same-kind sibling, a file
// is created beside wherever the project keeps its other views, carrying that
// exemplar's imports. A project with no views at all is genuinely unanswerable
// and is refused — there is no sidecar to fall back to.
// ─────────────────────────────────────────────────────────────────────────────

import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve } from 'node:path';

import type { DiagramDTO, MatrixAxisDTO, MatrixDefinitionDTO, MemoElement, MemoModelDTO } from '../types/index.js';
import { insertIntoBody, locatePackages } from './package-source.js';
import { commitSource } from './persistor.js';
import type { OutlineSource } from '../authoring/outline-source.js';
import { outlineNodes } from '../authoring/source-outline.js';

export interface ViewWriteResult {
    success: boolean;
    /** Why the view could not be declared. Never a reason to write it elsewhere. */
    reason?: string;
    filePath?: string;
    identifier?: string;
    /** True when the declaration seeded a new file. */
    created?: boolean;
    /** The new view's qualified name: its element id once the model recompiles. */
    qualifiedName?: string;
}

/**
 * The ontology's view definition for a kind, used only when no sibling exists to
 * copy one from. `geometry` has a dedicated definition that fixes the kind;
 * everything else is a `MemoDiagramView` that declares its own `viewKind`.
 */
const VIEW_DEFINITION_FOR_KIND: Record<string, { def: string; declaresKind: boolean }> = {
    geometry: { def: 'MemoScreenLayoutView', declaresKind: false },
};

const viewDefinitionFor = (viewKind: string) =>
    VIEW_DEFINITION_FOR_KIND[viewKind] ?? { def: 'MemoDiagramView', declaresKind: true };

/** `IMS Login Screen` -> `ims_login_screen`, for a file name. */
const slug = (value: string) =>
    String(value).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'view';

const escape = (value: string) => String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"');

/** A SysML identifier not already taken in this model. */
function freeIdentifier(base: string, model: MemoModelDTO, packageName?: string): string {
    const cleaned = base.replace(/[^A-Za-z0-9_]/g, '') || 'view';
    const start = /^[A-Za-z_]/.test(cleaned) ? cleaned : `view${cleaned}`;
    // An element's id is its qualified name, so the name is free when neither
    // the bare form nor the form inside the target package is taken.
    const taken = (name: string) => Boolean(model.elements[name] || (packageName && model.elements[`${packageName}::${name}`]));
    if (!taken(start)) return start;
    let n = 2;
    while (taken(`${start}_${n}`)) n++;
    return `${start}_${n}`;
}

// ─── Matrix declarations ─────────────────────────────────────────────────────
//
// A matrix is a `view` usage typed by MemoTraceabilityMatrixView or
// MemoDependencyMatrixView (SysML-textual-bnf.kebnf:1610 ViewUsage). Each axis
// is a redefinition of the part the definition declares —
// `part :>> rowAxis { attribute :>> query = "…"; }` (PartUsage :627,
// OwnedRedefinition :482, AttributeUsage :517) — the same shape a view's
// `selectionQuery` already takes, so the builder reads it with the code that
// reads that.

const MATRIX_PARTS = ['rowAxis', 'columnAxis', 'axis', 'criticalElements'] as const;
const MATRIX_ATTRIBUTES = ['linkTypes', 'dependencyTypes', 'containmentTypes', 'symmetric', 'ordering'] as const;

const stringList = (values: string[]) => `(${values.map(value => `"${escape(value)}"`).join(', ')})`;

/** A string literal that survives a multi-line query: the newline is written as the escape SysML defines. */
const stringLiteral = (value: string) => `"${escape(value).replace(/\r?\n/g, '\\n')}"`;

function axisLines(name: string, axis: MatrixAxisDTO | undefined): string[] {
    if (!axis || (!axis.query?.trim() && !(axis.elementIds?.length))) return [];
    return [
        `    part :>> ${name} {`,
        ...(axis.query?.trim() ? [`        attribute :>> query = ${stringLiteral(axis.query.trim())};`] : []),
        ...(axis.elementIds?.length ? [`        attribute :>> includeElementIds = ${stringList(axis.elementIds)};`] : []),
        '    }',
    ];
}

/** The body statements a matrix definition declares, at one level of indentation. */
export function matrixLines(matrix: MatrixDefinitionDTO | undefined): string[] {
    if (!matrix) return [];
    const list = (name: string, values: string[] | undefined) =>
        values?.length ? [`    attribute :>> ${name} = ${stringList(values)};`] : [];
    return [
        ...axisLines('rowAxis', matrix.rowAxis),
        ...axisLines('columnAxis', matrix.columnAxis),
        ...axisLines('axis', matrix.axis),
        ...list('linkTypes', matrix.linkTypes),
        ...list('dependencyTypes', matrix.dependencyTypes),
        ...list('containmentTypes', matrix.containmentTypes),
        ...(matrix.symmetric === undefined ? [] : [`    attribute :>> symmetric = ${matrix.symmetric};`]),
        ...(matrix.ordering ? [`    attribute :>> ordering = MatrixOrderingKind::${matrix.ordering};`] : []),
        ...axisLines('criticalElements', matrix.criticalElements),
    ];
}

/**
 * The top-level items of a declaration's body, as [start, end) offsets into the
 * body text. Strings and comments are skipped, so a `}` inside a query does not
 * close a block.
 */
function bodyItems(body: string): Array<[number, number]> {
    const items: Array<[number, number]> = [];
    let depth = 0;
    let start = -1;
    for (let i = 0; i < body.length; i++) {
        const c = body[i];
        if (c === '"' || c === "'") {
            const quote = c;
            for (i++; i < body.length && body[i] !== quote; i++) if (body[i] === '\\') i++;
            continue;
        }
        if (c === '/' && body[i + 1] === '/') { while (i < body.length && body[i] !== '\n') i++; continue; }
        if (c === '/' && body[i + 1] === '*') { i = body.indexOf('*/', i + 2); if (i < 0) break; i++; continue; }
        if (/\s/.test(c) && depth === 0 && start < 0) continue;
        if (start < 0) start = i;
        if (c === '{') depth++;
        else if (c === '}') {
            depth--;
            if (depth === 0) { items.push([start, i + 1]); start = -1; }
        } else if (c === ';' && depth === 0) { items.push([start, i + 1]); start = -1; }
    }
    return items;
}

/**
 * Replace the matrix statements of a view declaration, leaving everything else
 * (identity, viewpoint binding, group) as it was.
 */
export function replaceMatrixStatements(declaration: string, matrix: MatrixDefinitionDTO | undefined, baseIndent = ''): string {
    const open = declaration.indexOf('{');
    const close = declaration.lastIndexOf('}');
    if (open < 0 || close < open) return declaration;
    const body = declaration.slice(open + 1, close);
    const owned = new RegExp(`^(part\\s*:>>\\s*(${MATRIX_PARTS.join('|')})\\b|attribute\\s*:>>\\s*(${MATRIX_ATTRIBUTES.join('|')})\\b)`);
    let kept = '';
    let cursor = 0;
    for (const [from, to] of bodyItems(body)) {
        if (owned.test(body.slice(from, to))) {
            kept += body.slice(cursor, from).replace(/[ \t]*$/, '');
            cursor = to;
            // swallow the rest of the line the removed item ended on
            const eol = body.indexOf('\n', cursor);
            if (eol >= 0 && body.slice(cursor, eol).trim() === '') cursor = eol + 1;
        }
    }
    kept += body.slice(cursor);
    const added = matrixLines(matrix).map(line => `${baseIndent}${line}`);
    const trimmed = kept.replace(/\s+$/, '');
    return `${declaration.slice(0, open + 1)}${trimmed}${added.length ? `\n${added.join('\n')}` : ''}\n${baseIndent}${declaration.slice(close)}`;
}

/**
 * The views this project already declares for a kind.
 *
 * Keyed on the DERIVED view kind rather than the definition's name, so a screen
 * layout finds its siblings whether they were declared as
 * `MemoScreenLayoutView` or as a `MemoDiagramView` with an explicit `viewKind`.
 * `null` asks for views of ANY kind — used when bootstrapping the first view of
 * a kind, where the question is only "where do views live".
 */
function siblingViews(model: MemoModelDTO, viewKind: string | null): MemoElement[] {
    const siblings: MemoElement[] = [];
    for (const diagram of model.diagrams ?? []) {
        if ((viewKind !== null && diagram.viewKind !== viewKind) || !diagram.sourceFile || !diagram.elementId) continue;
        const element = model.elements[diagram.elementId];
        if (element?.file) siblings.push(element);
    }
    return siblings;
}

/** The sibling file holding the most of them — the project's own answer. */
function conventionalHome(siblings: MemoElement[]): { file: string; members: MemoElement[] } | undefined {
    const byFile = new Map<string, MemoElement[]>();
    for (const sibling of siblings) byFile.set(sibling.file!, [...(byFile.get(sibling.file!) ?? []), sibling]);
    let best: { file: string; members: MemoElement[] } | undefined;
    for (const [file, members] of byFile) {
        if (!best || members.length > best.members.length) best = { file, members };
    }
    return best;
}

/**
 * Bootstrap a home for the FIRST view of a kind.
 *
 * With no same-kind sibling there is no file to join, but the project still
 * answers most of the question: views of other kinds show which directory holds
 * views, which package naming they use, and which imports a view needs for its
 * definition and viewpoint to resolve. Imports are copied verbatim rather than
 * guessed — guessing them is how a generated file ends up not compiling.
 */
function bootstrapHome(projectRoot: string, model: MemoModelDTO, diagram: DiagramDTO) {
    const anyView = siblingViews(model, null);
    if (anyView.length === 0) return undefined;
    const home = conventionalHome(anyView)!;
    const exemplar = home.members[0];
    const file = `${dirname(home.file)}/view_${slug(diagram.name)}.sysml`;
    // Package name follows the exemplar's, swapping its trailing segment: these
    // are `<project>_views_<area>`, and an unrelated name would break that.
    const parts = String(exemplar.package ?? 'views').split('::');
    const base = parts[parts.length - 1].replace(/[^A-Za-z0-9_]/g, '_');
    const pkg = `${base.replace(/_[^_]*$/, '')}_${slug(diagram.viewKind ?? 'view')}`;
    const imports = readFileSync(resolve(projectRoot, home.file), 'utf8')
        .split('\n')
        .filter(line => /^\s*(private\s+)?import\s/.test(line))
        .map(line => line.trim());
    return { file, pkg, imports, exemplar };
}

/**
 * Write one view declaration into the project's own home for views of its kind.
 *
 * Returns `{ success: false, reason }` when the project declares no view at all,
 * which is the only case with no convention to infer. There is deliberately no
 * sidecar fallback: a view that cannot be declared is not created.
 */
/**
 * The view's `selectionQuery`, when it was created from one.
 *
 * A view declared from a matrix is defined by what it SELECTS — the kinds on
 * its axes and the relations drawn between them — not by the ids that happened
 * to match when it was saved. Writing the query means the view answers the
 * same question a year later against a model that has grown; writing the ids
 * would freeze the answer and quietly stop being true.
 */
export function selectionQueryLines(diagram: DiagramDTO): string[] {
    const kinds = diagram.elementKinds ?? [];
    const relationships = diagram.relationshipTypes ?? [];
    if (kinds.length === 0 && relationships.length === 0) return [];
    const list = (values: string[]) => values.map(value => `"${escape(value)}"`).join(', ');
    return [
        '    part :>> selectionQuery {',
        ...(kinds.length > 0 ? [`        attribute :>> includeElementKinds = (${list(kinds)});`] : []),
        ...(relationships.length > 0
            ? [`        attribute :>> includeRelationshipKinds = (${list(relationships)});`]
            : []),
        '    }',
    ];
}

export async function writeViewDeclaration(
    projectRoot: string, model: MemoModelDTO, diagram: Omit<DiagramDTO, 'id' | 'auto'> & { id?: string },
    /** Outlines of the project's files, from the selected compiler. */
    outlines: OutlineSource,
): Promise<ViewWriteResult> {
    // A matrix names its package: the person chose a folder in the tree, and the
    // declaration goes into a file that declares it. Every other view learns its
    // home from the views the project already has.
    const chosen = diagram.package ? model.packages?.find(pkg => pkg.qualifiedName === diagram.package) : undefined;
    if (diagram.package && !chosen) {
        return { success: false, reason: `the package ${diagram.package} is not declared in this project` };
    }
    const home = chosen ? undefined : conventionalHome(siblingViews(model, diagram.viewKind ?? null));
    const bootstrap = chosen || home ? undefined : bootstrapHome(projectRoot, model, diagram as DiagramDTO);
    if (!chosen && !home && !bootstrap) {
        return { success: false, reason: 'this project declares no view at all, so there is no convention to place one by' };
    }
    const exemplar = chosen ? undefined : home ? home.members[0] : bootstrap!.exemplar;
    const targetFile = chosen ? chosen.file : home ? home.file : bootstrap!.file;
    const absolute = resolve(projectRoot, targetFile);

    if (bootstrap && !existsSync(absolute)) {
        mkdirSync(dirname(absolute), { recursive: true });
        const header = [
            `// ${diagram.viewKind} views. Declared here rather than recorded outside the model.`,
            `package ${bootstrap.pkg} {`,
            ...bootstrap.imports.map(line => `    ${line}`),
            '}',
            '',
        ].join('\n');
        const seeded = await commitSource(absolute, targetFile, header, outlines);
        if (!seeded.success) return { success: false, reason: seeded.error };
    } else if (!existsSync(absolute)) {
        return { success: false, reason: `${targetFile} does not exist` };
    }

    const source = readFileSync(absolute, 'utf8');
    let outline;
    try {
        outline = await outlines.outline(targetFile.replaceAll('\\', '/'), source);
    } catch (e) {
        return { success: false, reason: `${targetFile} cannot be edited: ${e instanceof Error ? e.message : String(e)}` };
    }
    const packages = locatePackages(outline);
    const wanted = chosen ? chosen.qualifiedName : bootstrap ? bootstrap.pkg : exemplar!.package;
    const target = packages.find(pkg => pkg.qualifiedName === wanted) ?? (chosen ? undefined : packages[0]);
    if (!target) return { success: false, reason: `${targetFile} declares no package to hold the view` };

    // A matrix selects by its axes and exposes nothing (ViewBodyItem makes
    // Expose optional, SysML-textual-bnf.kebnf:1618-1622). Every other view
    // exposes the package of the element it shows.
    const isMatrix = Boolean(diagram.viewDefinition && diagram.matrix);
    const primary = model.elements[(diagram.elementIds ?? [])[0] ?? ''];
    const exposePackage = isMatrix ? undefined : primary?.package
        ?? (exemplar?.attributes?.expose as string | undefined)?.split(',')[0]?.replace(/::\*$/, '');
    if (!isMatrix && !exposePackage) {
        return { success: false, reason: 'the view has no element whose package it could expose' };
    }

    // A sibling's definition is authoritative; without one, derive it from the
    // kind so the declaration still states what it is. A matrix names its own.
    const derived = viewDefinitionFor(diagram.viewKind ?? '');
    const viewDef = diagram.viewDefinition
        ?? (home && exemplar ? ((exemplar.attributes?.usageType as string) || derived.def) : derived.def);
    const viewpoint = diagram.viewpointId && diagram.viewpointId !== '__model' && diagram.viewpointId !== '__unassigned'
        ? diagram.viewpointId
        : (exemplar?.attributes?.viewpointDefinition as string | undefined);
    const group = exemplar?.attributes?.group as string | undefined;

    // A screen layout is named for the screen it depicts — the existing
    // convention, and it reads well because there is one per screen. Any other
    // kind is named for the view; calling a sequence view `…ScreenLayout` would
    // simply be wrong.
    const camel = String(diagram.name).replace(/[^A-Za-z0-9]+(.)?/g, (_, c: string) => (c ? c.toUpperCase() : ''));
    const preferred = derived.def === 'MemoScreenLayoutView' && primary
        ? `${primary.id}Layout`
        : camel.charAt(0).toLowerCase() + camel.slice(1);
    const identifier = freeIdentifier(preferred, model, target.qualifiedName);

    // Emitted at column 0: `insertIntoBody` indents the block one level into the
    // package body it is placed in. An id is written only when the caller has
    // one: Architect generates none, and the compiler assigns the element's.
    const identity = [
        ...(diagram.id ? [`:>> providedId = "${escape(diagram.id)}";`] : []),
        `:>> label = "${escape(diagram.name)}";`,
    ].join(' ');
    const body = [
        `view ${identifier} : ${viewDef} {`,
        ...(exposePackage ? [`    expose ${exposePackage}::*;`] : []),
        `    @MemoIdentity { ${identity} }`,
        ...(!home && !isMatrix && derived.declaresKind ? [`    attribute :>> viewKind = DiagramViewKind::${diagram.viewKind};`] : []),
        ...(group ? [`    attribute group = "${escape(group)}";`] : []),
        ...selectionQueryLines(diagram as DiagramDTO),
        ...matrixLines(diagram.matrix),
        ...(viewpoint ? [`    ref :>> viewpointDefinition = ${viewpoint};`] : []),
        '}',
    ].join('\n');

    const updated = insertIntoBody(source, target, `${body}\n`);
    const committed = await commitSource(absolute, targetFile, updated, outlines);
    if (!committed.success) return { success: false, reason: committed.error };
    return { success: true, filePath: targetFile, identifier, created: !!bootstrap, qualifiedName: `${target.qualifiedName}::${identifier}` };
}

/**
 * Change a matrix view's name or definition, in its own declaration.
 *
 * The name is the `label` of its `@MemoIdentity`, so a rename leaves the
 * element's identifier, and every reference to it, where it was. The axes and
 * options are the statements `matrixLines` writes; everything else in the
 * declaration is kept.
 */
export async function updateViewDeclaration(
    projectRoot: string, model: MemoModelDTO, diagram: DiagramDTO,
    change: { name?: string; matrix?: MatrixDefinitionDTO },
    outlines: OutlineSource,
): Promise<ViewWriteResult> {
    const view = model.elements[diagram?.elementId ?? ''];
    if (!view?.file) return { success: false, reason: 'the view has no source file to edit' };
    const absolute = resolve(projectRoot, view.file);
    if (!existsSync(absolute)) return { success: false, reason: `${view.file} does not exist` };
    const source = readFileSync(absolute, 'utf8');
    const file = (isAbsolute(view.file) ? relative(projectRoot, view.file) : view.file).replaceAll('\\', '/');
    let outline;
    try {
        outline = await outlines.outline(file, source);
    } catch (e) {
        return { success: false, reason: `${view.file} cannot be edited: ${e instanceof Error ? e.message : String(e)}` };
    }
    const node = [...outlineNodes(outline)].find(candidate => candidate.key === view.id);
    if (!node) return { success: false, reason: `${view.id} was not found in ${view.file}` };

    let declaration = source.slice(node.start, node.end);
    if (change.matrix) {
        // The declaration is spliced from its first character, so the indentation
        // of the line it sits on is what the new statements must be offset by.
        const baseIndent = /^[ \t]*/.exec(source.slice(source.lastIndexOf('\n', node.start - 1) + 1, node.start))![0];
        declaration = replaceMatrixStatements(declaration, change.matrix, baseIndent);
    }
    if (change.name !== undefined) {
        const label = `:>> label = "${escape(change.name)}";`;
        declaration = /:>>\s*label\s*=\s*"(?:[^"\\]|\\.)*"\s*;/.test(declaration)
            ? declaration.replace(/:>>\s*label\s*=\s*"(?:[^"\\]|\\.)*"\s*;/, () => label)
            : declaration.replace(/@MemoIdentity\s*\{/, () => `@MemoIdentity { ${label}`);
    }
    const updated = source.slice(0, node.start) + declaration + source.slice(node.end);
    const committed = await commitSource(absolute, view.file, updated, outlines);
    if (!committed.success) return { success: false, reason: committed.error };
    return { success: true, filePath: view.file };
}

/**
 * Change WHAT a declared view shows, by editing its `expose` members.
 *
 * `diagram:update` carries the element ids a view should contain. A declared
 * view holds no list of ids — it holds `expose` paths, and
 * `resolveViewElementIds` derives the ids from them. So the update is applied
 * where the view actually says what it shows.
 *
 * Exposing the PACKAGE rather than each element is the convention every
 * authored view follows, and it is what makes a screen layout pick up a region
 * added later without another edit.
 */
export async function updateViewExpose(
    projectRoot: string, model: MemoModelDTO, diagram: DiagramDTO, elementIds: string[] | undefined,
    /** Outlines of the project's files, from the selected compiler. */
    outlines: OutlineSource,
): Promise<ViewWriteResult & { exposed?: string[] }> {
    const view = model.elements[diagram?.elementId ?? ''];
    if (!view?.file) return { success: false, reason: 'the view has no source file to edit' };

    const packages = [...new Set((elementIds ?? [])
        .map(id => model.elements[id]?.package)
        .filter((pkg): pkg is string => !!pkg))];
    if (packages.length === 0) {
        return { success: false, reason: 'none of those elements belongs to a package that could be exposed' };
    }

    const absolute = resolve(projectRoot, view.file);
    if (!existsSync(absolute)) return { success: false, reason: `${view.file} does not exist` };
    const source = readFileSync(absolute, 'utf8');
    const file = (isAbsolute(view.file) ? relative(projectRoot, view.file) : view.file).replaceAll('\\', '/');
    let outline;
    try {
        outline = await outlines.outline(file, source);
    } catch (e) {
        return { success: false, reason: `${view.file} cannot be edited: ${e instanceof Error ? e.message : String(e)}` };
    }
    // The view's id is its qualified name, which is its declaration's key.
    const node = [...outlineNodes(outline)].find(candidate => candidate.key === view.id);
    if (!node) return { success: false, reason: `${view.id} was not found in ${view.file}` };

    const declaration = source.slice(node.start, node.end);
    const indent = ' '.repeat((node.start - (source.lastIndexOf('\n', node.start - 1) + 1)) + 4);
    const exposeLines = packages.map(pkg => `${indent}expose ${pkg}::*;`).join('\n');
    // Drop the existing expose members, then re-state the set just inside the
    // opening brace, where every authored view puts them.
    const withoutExpose = declaration.replace(/^[ \t]*expose\s+[^;]+;[ \t]*\r?\n/gm, '');
    const brace = withoutExpose.indexOf('{');
    if (brace < 0) return { success: false, reason: `${view.id} has no body to expose into` };
    const rewritten = `${withoutExpose.slice(0, brace + 1)}\n${exposeLines}${withoutExpose.slice(brace + 1)}`;
    const updated = source.slice(0, node.start) + rewritten + source.slice(node.end);

    const committed = await commitSource(absolute, view.file, updated, outlines);
    if (!committed.success) return { success: false, reason: committed.error };
    return { success: true, filePath: view.file, exposed: packages };
}

/**
 * Put display statements beside the view's other `attribute :>>` statements, as
 * an authored view reads; with none, at the end of the body.
 */
export function placeDisplayStatements(declaration: string, statements: string, indent: string): string {
    let at = -1;
    for (const other of declaration.matchAll(/^[ \t]*attribute\s+:>>[^;]*;[ \t]*\r?\n/gm)) at = other.index + other[0].length;
    if (at >= 0) return `${declaration.slice(0, at)}${statements}\n${declaration.slice(at)}`;
    const close = declaration.lastIndexOf('}');
    const before = declaration.slice(0, close).replace(/[ \t]*$/, '');
    return `${before}${before.endsWith('\n') ? '' : '\n'}${statements}\n${indent.slice(4)}${declaration.slice(close)}`;
}

/**
 * State how a view shows itself, in the view's own declaration.
 *
 * `display` maps an attribute the view declares (`portDisplay`, `connectionDisplay`, `flowAnimation`,
 * `showPortText`, `showConnectionText`) to the SysML value to write. Each is one `attribute :>> name = value;`
 * statement in the view's body, replaced when the view already says it and added when it does not. Only
 * those statements are touched: a view carries `expose` members, a selection query, identity and layout,
 * none of which a regenerated declaration would keep.
 */
export async function updateViewDisplay(
    projectRoot: string, model: MemoModelDTO, diagram: DiagramDTO, display: Record<string, string>,
    outlines: OutlineSource,
): Promise<ViewWriteResult> {
    const view = model.elements[diagram?.elementId ?? ''];
    if (!view?.file) return { success: false, reason: 'the view has no source file to edit' };
    const absolute = resolve(projectRoot, view.file);
    if (!existsSync(absolute)) return { success: false, reason: `${view.file} does not exist` };
    const source = readFileSync(absolute, 'utf8');
    const file = (isAbsolute(view.file) ? relative(projectRoot, view.file) : view.file).replaceAll('\\', '/');
    let outline;
    try {
        outline = await outlines.outline(file, source);
    } catch (e) {
        return { success: false, reason: `${view.file} cannot be edited: ${e instanceof Error ? e.message : String(e)}` };
    }
    const node = [...outlineNodes(outline)].find(candidate => candidate.key === view.id);
    if (!node) return { success: false, reason: `${view.id} was not found in ${view.file}` };

    let declaration = source.slice(node.start, node.end);
    const brace = declaration.indexOf('{');
    if (brace < 0) return { success: false, reason: `${view.id} has no body to state this in` };
    const indent = ' '.repeat((node.start - (source.lastIndexOf('\n', node.start - 1) + 1)) + 4);
    const names = Object.keys(display).filter(name => /^\w+$/.test(name));
    for (const name of names) {
        declaration = declaration.replace(new RegExp(`^[ \\t]*attribute\\s+:>>\\s*${name}\\s*=\\s*[^;]+;[ \\t]*\\r?\\n`, 'm'), '');
    }
    const statements = names.map(name => `${indent}attribute :>> ${name} = ${display[name]};`).join('\n');
    declaration = placeDisplayStatements(declaration, statements, indent);
    const updated = source.slice(0, node.start) + declaration + source.slice(node.end);
    const committed = await commitSource(absolute, view.file, updated, outlines);
    if (!committed.success) return { success: false, reason: committed.error };
    return { success: true, filePath: view.file };
}
