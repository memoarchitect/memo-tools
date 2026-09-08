// ─── View write-back ─────────────────────────────────────────────────────────
//
// Declaring a view in SysML, instead of recording it in a JSON sidecar.
//
// A view IS model content, and MEMO says so everywhere else: `view … :
// MemoDiagramView { … }` is an ontology construct, `view-deriver.ts` turns one
// into a diagram, and `viewLayoutPath()` keeps a view's layout in a
// `.viewlayout` companion BESIDE the .sysml file that declares it — falling
// back to the hidden `.memo/views/` directory only for a diagram with no
// `sourceFile`, which is to say only for a diagram that was never declared.
//
// `diagram:create` was the one path that produced such a diagram. It appended a
// row to `.memo/user-diagrams.json`, so a view authored in the app was invisible
// to `memo validate` and to `syside check`, absent from review, untracked by git
// wherever `.memo/` is ignored, and — having no source file — dragged its layout
// into the hidden store as well. Two mechanisms for one concept, and the
// authored half was the one the toolchain could not see.
//
// So creation writes the declaration, and everything downstream follows on its
// own: the file watcher recompiles, `view-deriver` produces the diagram with
// `sourceFile` set, and the layout companion lands next to the source.
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
import { dirname, resolve } from 'node:path';

import { parseText } from '../model/parser-utils.js';
import type { DiagramDTO, MemoElement, MemoModelDTO } from '../types/index.js';
import { insertIntoBody, locatePackages } from './package-source.js';
import { commitSource } from './persistor.js';

export interface ViewWriteResult {
    success: boolean;
    /** Why the view could not be declared. Never a reason to write it elsewhere. */
    reason?: string;
    filePath?: string;
    identifier?: string;
    /** True when the declaration seeded a new file. */
    created?: boolean;
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
function freeIdentifier(base: string, model: MemoModelDTO): string {
    const cleaned = base.replace(/[^A-Za-z0-9_]/g, '') || 'view';
    const start = /^[A-Za-z_]/.test(cleaned) ? cleaned : `view${cleaned}`;
    if (!model.elements[start]) return start;
    let n = 2;
    while (model.elements[`${start}_${n}`]) n++;
    return `${start}_${n}`;
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
    projectRoot: string, model: MemoModelDTO, diagram: DiagramDTO,
): Promise<ViewWriteResult> {
    const home = conventionalHome(siblingViews(model, diagram.viewKind ?? null));
    const bootstrap = home ? undefined : bootstrapHome(projectRoot, model, diagram);
    if (!home && !bootstrap) {
        return { success: false, reason: 'this project declares no view at all, so there is no convention to place one by' };
    }
    const exemplar = home ? home.members[0] : bootstrap!.exemplar;
    const targetFile = home ? home.file : bootstrap!.file;
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
        const seeded = await commitSource(absolute, targetFile, header);
        if (!seeded.success) return { success: false, reason: seeded.error };
    } else if (!existsSync(absolute)) {
        return { success: false, reason: `${targetFile} does not exist` };
    }

    const source = readFileSync(absolute, 'utf8');
    const packages = await locatePackages(source);
    const wanted = bootstrap ? bootstrap.pkg : exemplar.package;
    const target = packages.find(pkg => pkg.qualifiedName === wanted) ?? packages[0];
    if (!target) return { success: false, reason: `${targetFile} declares no package to hold the view` };

    // The primary element the view shows decides what it exposes. Siblings
    // expose their subject's whole package, which is what lets a screen view
    // pick up a region added later without another edit.
    const primary = model.elements[(diagram.elementIds ?? [])[0] ?? ''];
    const exposePackage = primary?.package
        ?? (exemplar.attributes?.expose as string | undefined)?.split(',')[0]?.replace(/::\*$/, '');
    if (!exposePackage) {
        return { success: false, reason: 'the view has no element whose package it could expose' };
    }

    // A sibling's definition is authoritative; without one, derive it from the
    // kind so the declaration still states what it is.
    const derived = viewDefinitionFor(diagram.viewKind ?? '');
    const viewDef = home ? ((exemplar.attributes?.usageType as string) || derived.def) : derived.def;
    const viewpoint = diagram.viewpointId && diagram.viewpointId !== '__model'
        ? diagram.viewpointId
        : (exemplar.attributes?.viewpointDefinition as string | undefined);
    const group = exemplar.attributes?.group as string | undefined;

    // A screen layout is named for the screen it depicts — the existing
    // convention, and it reads well because there is one per screen. Any other
    // kind is named for the view; calling a sequence view `…ScreenLayout` would
    // simply be wrong.
    const camel = String(diagram.name).replace(/[^A-Za-z0-9]+(.)?/g, (_, c: string) => (c ? c.toUpperCase() : ''));
    const preferred = derived.def === 'MemoScreenLayoutView' && primary
        ? `${primary.id}Layout`
        : camel.charAt(0).toLowerCase() + camel.slice(1);
    const identifier = freeIdentifier(preferred, model);

    // Emitted at column 0: `insertIntoBody` indents the block one level into the
    // package body it is placed in.
    const body = [
        `view ${identifier} : ${viewDef} {`,
        `    expose ${exposePackage}::*;`,
        `    @MemoIdentity { :>> providedId = "${escape(diagram.id)}"; }`,
        `    attribute :>> name = "${escape(diagram.name)}";`,
        ...(!home && derived.declaresKind ? [`    attribute :>> viewKind = DiagramViewKind::${diagram.viewKind};`] : []),
        ...(group ? [`    attribute group = "${escape(group)}";`] : []),
        ...selectionQueryLines(diagram),
        ...(viewpoint ? [`    ref :>> viewpointDefinition = ${viewpoint};`] : []),
        '}',
    ].join('\n');

    const updated = insertIntoBody(readFileSync(absolute, 'utf8'), target, `${body}\n`);
    const committed = await commitSource(absolute, targetFile, updated);
    if (!committed.success) return { success: false, reason: committed.error };
    return { success: true, filePath: targetFile, identifier, created: !!bootstrap };
}

/** Every node in a parsed document, so a declaration can be found by name. */
function allNodes(root: any): any[] {
    const found: any[] = [];
    const stack: any[] = [...(root.members ?? [])];
    while (stack.length) {
        const node = stack.pop();
        if (!node || typeof node !== 'object') continue;
        found.push(node);
        for (const key of ['members', 'body']) {
            if (Array.isArray(node[key])) stack.push(...node[key]);
        }
    }
    return found;
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
    const parsed = await parseText(source);
    if (parsed.errors.length) {
        return { success: false, reason: `${view.file} does not parse (${parsed.errors[0].message})` };
    }
    const node = allNodes(parsed.document.parseResult.value as any)
        .find(candidate => candidate.name === view.id && candidate.$cstNode);
    if (!node) return { success: false, reason: `${view.id} was not found in ${view.file}` };

    const cst = node.$cstNode;
    const declaration = source.slice(cst.offset, cst.offset + cst.length);
    const indent = ' '.repeat((cst.offset - (source.lastIndexOf('\n', cst.offset - 1) + 1)) + 4);
    const exposeLines = packages.map(pkg => `${indent}expose ${pkg}::*;`).join('\n');
    // Drop the existing expose members, then re-state the set just inside the
    // opening brace, where every authored view puts them.
    const withoutExpose = declaration.replace(/^[ \t]*expose\s+[^;]+;[ \t]*\r?\n/gm, '');
    const brace = withoutExpose.indexOf('{');
    if (brace < 0) return { success: false, reason: `${view.id} has no body to expose into` };
    const rewritten = `${withoutExpose.slice(0, brace + 1)}\n${exposeLines}${withoutExpose.slice(brace + 1)}`;
    const updated = source.slice(0, cst.offset) + rewritten + source.slice(cst.offset + cst.length);

    const committed = await commitSource(absolute, view.file, updated);
    if (!committed.success) return { success: false, reason: committed.error };
    return { success: true, filePath: view.file, exposed: packages };
}
