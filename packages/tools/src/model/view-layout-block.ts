// ─── A view's layout, as the SysML written in the view ──────────────────────
//
// `@MemoLayout`, `@MemoLayoutNode`, `@MemoLayoutPort`, `@MemoLayoutPortWall`,
// `@MemoLayoutEdge` and `@MemoLayoutNote` (ontology: `memo_viewpoints_definitions_layout`) are
// metadata usages inside a `view` body. This module is the one reader and the one
// writer of them, in both directions between those statements and the
// `DiagramLayout` the canvas works with.
//
// It reads the TEXT, not the compiled model, on purpose. A layout is saved at
// the end of a drag, and a model read would need a recompile to see its own
// write; the text is current the moment it is written, it reads the same from a
// pinned worktree, and the compiler still checks every write (the statements are
// ordinary SysML, so a bad one is refused before it reaches disk).
//
// The reader is a scanner, not a SysML parser, and says so: it knows comments,
// strings, quoted names and brace nesting, enough to know which `view` a
// statement sits in and where the statement ends. It reads only the shape this
// module writes — `@MemoLayoutX { :>> name = value; … }`, with a literal, an
// enum literal or a parenthesised list of numbers as the value. Anything else in
// a view body is left exactly as it was.
//
// `layoutBlindRevision` is the other half of "a drag is not an edit": the hash a
// source file is known by ignores these statements, so moving a box neither
// triggers a rebuild nor makes the next semantic edit of that file look stale.
// ─────────────────────────────────────────────────────────────────────────────

import { createHash } from 'node:crypto';
import type { DiagramLayout, DiagramNodeLayout, DiagramEdgeLayout, DiagramAnnotation } from '../protocol/messages.js';

type Side = 'top' | 'bottom' | 'left' | 'right';

/** The canvas fields the client keeps that `DiagramLayout` does not type. */
export type Canvas = NonNullable<DiagramLayout['canvas']> & {
    coordinateSpace?: string;
    layout?: { provider: string; providerVersion?: string; contractVersion?: string; preset?: string; seed?: number };
};
type Scalar = string | number | boolean | { literal: string } | number[];

/** One `@MemoLayout…` usage found in a view body. */
export interface LayoutStatement {
    /** The metadata definition, e.g. `MemoLayoutNode`. */
    definition: string;
    values: Record<string, Scalar>;
    /** Offsets into the scanned text: the `@` and one past the closing `}`. */
    start: number;
    end: number;
}

/** A `view` usage and the layout statements its body holds. */
export interface ScannedView {
    /** `package::…::view`, which is the view element's id. */
    id: string;
    /** Offset of the first character after the opening `{`. */
    bodyStart: number;
    /** Offset of the closing `}`. */
    bodyEnd: number;
    statements: LayoutStatement[];
}

const LAYOUT_PREFIX = 'MemoLayout';
const DECLARATION_PREFIXES = /^(?:(?:#[\w:]+|@[\w:]+)\s+)*(?:(?:private|protected|public|abstract|standard|library|variation|individual|ref|in|out|inout|readonly|derived|end|constant)\s+)*/;
const DECLARATION = /^([A-Za-z]+)\s+(?:def\s+)?(?:<[^>]*>\s*)?('(?:[^'\\]|\\.)*'|[A-Za-z_]\w*(?:::[A-Za-z_]\w*)*)/;

interface Scope { name: string; isView: boolean; view?: ScannedView }

/**
 * Walk SysML text and report each `view` usage with the layout statements in
 * its body. Statements anywhere else (a part, a package) are not layout and are
 * ignored here, so they survive untouched.
 */
export function scanViewLayouts(text: string): ScannedView[] {
    return scan(text).views;
}

function scan(text: string): { views: ScannedView[]; rootBodyStart?: number } {
    const views: ScannedView[] = [];
    let rootBodyStart: number | undefined;
    const stack: Scope[] = [];
    let header = '';
    let i = 0;
    const n = text.length;

    const closeHeader = () => { header = ''; };

    while (i < n) {
        const c = text[i];
        const next = text[i + 1];
        // comments
        if (c === '/' && next === '/') { while (i < n && text[i] !== '\n') i++; continue; }
        if (c === '/' && next === '*') {
            const end = text.indexOf('*/', i + 2);
            i = end < 0 ? n : end + 2;
            continue;
        }
        // strings and quoted names belong to the header text
        if (c === '"' || c === "'") {
            const end = skipQuoted(text, i);
            header += text.slice(i, end);
            i = end;
            continue;
        }
        if (c === '@' && /MemoLayout/.test(text.slice(i + 1, i + 1 + LAYOUT_PREFIX.length + 1)) && inView(stack)) {
            const statement = readStatement(text, i);
            if (statement) {
                stack[stack.length - 1].view!.statements.push(statement);
                i = statement.end;
                closeHeader();
                continue;
            }
        }
        if (c === '{') {
            const scope = scopeFor(header);
            if (scope.isView) {
                const parents = stack.map(s => s.name).filter(Boolean);
                scope.view = {
                    id: [...parents, scope.name].join('::'),
                    bodyStart: i + 1, bodyEnd: i + 1, statements: [],
                };
                views.push(scope.view);
            }
            if (stack.length === 0 && rootBodyStart === undefined) rootBodyStart = i + 1;
            stack.push(scope);
            closeHeader();
            i++;
            continue;
        }
        if (c === '}') {
            const closed = stack.pop();
            if (closed?.view) closed.view.bodyEnd = i;
            closeHeader();
            i++;
            continue;
        }
        if (c === ';') { closeHeader(); i++; continue; }
        header += c;
        i++;
    }
    return { views, rootBodyStart };
}

const inView = (stack: Scope[]) => stack.length > 0 && stack[stack.length - 1].isView;

function scopeFor(header: string): Scope {
    const trimmed = header.trim().replace(DECLARATION_PREFIXES, '');
    const match = DECLARATION.exec(trimmed);
    if (!match) return { name: '', isView: false };
    const name = match[2].startsWith("'") ? match[2].slice(1, -1) : match[2];
    const isDefinition = /^\w+\s+def\b/.test(trimmed);
    return { name, isView: match[1] === 'view' && !isDefinition };
}

function skipQuoted(text: string, start: number): number {
    const quote = text[start];
    let i = start + 1;
    while (i < text.length && text[i] !== quote) i += text[i] === '\\' ? 2 : 1;
    return Math.min(i + 1, text.length);
}

/** `@MemoLayoutX { :>> a = 1; … }` starting at `start`, or undefined when it is not that shape. */
function readStatement(text: string, start: number): LayoutStatement | undefined {
    const head = /^@(MemoLayout\w*)\s*\{/.exec(text.slice(start, start + 64));
    if (!head) return undefined;
    const bodyStart = start + head[0].length;
    let i = bodyStart;
    while (i < text.length && text[i] !== '}') i += text[i] === '"' ? skipQuoted(text, i) - i : 1;
    if (text[i] !== '}') return undefined;
    const values = parseAssignments(text.slice(bodyStart, i));
    return values ? { definition: head[1], values, start, end: i + 1 } : undefined;
}

function parseAssignments(body: string): Record<string, Scalar> | undefined {
    const values: Record<string, Scalar> = {};
    let i = 0;
    const skipSpace = () => { while (i < body.length && /\s/.test(body[i])) i++; };
    for (;;) {
        skipSpace();
        if (i >= body.length) return values;
        const head = /^:>>\s*(\w+)\s*=\s*/.exec(body.slice(i));
        if (!head) return undefined;
        i += head[0].length;
        const parsed = readValue(body, i);
        if (!parsed) return undefined;
        values[head[1]] = parsed.value;
        i = parsed.end;
        skipSpace();
        if (body[i] !== ';') return undefined;
        i++;
    }
}

function readValue(body: string, i: number): { value: Scalar; end: number } | undefined {
    if (body[i] === '"') {
        const end = skipQuoted(body, i);
        return { value: unescapeString(body.slice(i + 1, end - 1)), end };
    }
    if (body[i] === '(') {
        const close = body.indexOf(')', i);
        if (close < 0) return undefined;
        const items = body.slice(i + 1, close).split(',').map(s => s.trim()).filter(Boolean);
        const numbers = items.map(Number);
        return numbers.some(Number.isNaN) ? undefined : { value: numbers, end: close + 1 };
    }
    const token = /^[^;\s]+/.exec(body.slice(i));
    if (!token) return undefined;
    const raw = token[0];
    const end = i + raw.length;
    if (raw === 'true' || raw === 'false') return { value: raw === 'true', end };
    if (/^-?\d+(\.\d+)?([eE][-+]?\d+)?$/.test(raw)) return { value: Number(raw), end };
    if (/^\w+(::\w+)+$/.test(raw)) return { value: { literal: raw.split('::').pop()! }, end };
    return undefined;
}

const unescapeString = (s: string) => s.replace(/\\(["\\nrt])/g, (_, ch: string) =>
    ch === 'n' ? '\n' : ch === 'r' ? '\r' : ch === 't' ? '\t' : ch);

// ─── statements ⇄ DiagramLayout ──────────────────────────────────────────────

const str = (v: Scalar | undefined): string | undefined => typeof v === 'string' ? v : undefined;
const num = (v: Scalar | undefined): number | undefined => typeof v === 'number' ? v : undefined;
const bool = (v: Scalar | undefined): boolean | undefined => typeof v === 'boolean' ? v : undefined;
const lit = <T extends string>(v: Scalar | undefined): T | undefined =>
    v && typeof v === 'object' && !Array.isArray(v) ? v.literal as T : undefined;

function put<T extends object>(target: T, key: keyof T, value: unknown) {
    if (value !== undefined) (target as Record<string, unknown>)[key as string] = value;
}

/** The layout a view's statements describe, or null when it has none. */
export function layoutFromStatements(statements: readonly LayoutStatement[]): DiagramLayout | null {
    if (statements.length === 0) return null;
    const layout: DiagramLayout = { nodes: {}, edges: {}, annotations: {} };
    const canvas: Canvas = {};
    for (const { definition, values: v } of statements) {
        switch (definition) {
            case 'MemoLayout':
                put(canvas, 'autoLayout', bool(v.autoLayout));
                put(canvas, 'grid', num(v.grid));
                put(canvas, 'snap', bool(v.snap));
                put(canvas, 'coordinateSpace', str(v.coordinateSpace));
                if (str(v.layoutProvider) !== undefined) {
                    canvas.layout = { provider: str(v.layoutProvider)! };
                    put(canvas.layout, 'providerVersion', str(v.layoutProviderVersion));
                    put(canvas.layout, 'contractVersion', str(v.layoutContractVersion));
                    put(canvas.layout, 'preset', str(v.layoutPreset));
                    put(canvas.layout, 'seed', num(v.layoutSeed));
                }
                break;
            case 'MemoLayoutNode': {
                const id = str(v.element);
                if (id === undefined) break;
                const node: DiagramNodeLayout = layout.nodes[id] ?? { x: 0, y: 0, ports: {} };
                node.x = num(v.x) ?? 0;
                node.y = num(v.y) ?? 0;
                // "" is the board; absent is a frame nobody recorded.
                if (v.parentElement !== undefined) node.parent = str(v.parentElement) || null;
                put(node, 'width', num(v.width));
                put(node, 'height', num(v.height));
                put(node, 'color', str(v.fillColor));
                put(node, 'borderColor', str(v.borderColor));
                put(node, 'textColor', str(v.textColor));
                put(node, 'fontSize', num(v.fontSize));
                put(node, 'fontWeight', num(v.fontWeight));
                put(node, 'textAlign', lit(v.textAlign));
                put(node, 'verticalAlign', lit(v.verticalAlign));
                put(node, 'opacity', num(v.opacity));
                layout.nodes[id] = node;
                break;
            }
            case 'MemoLayoutPort': {
                const id = str(v.element);
                const name = str(v.portName);
                if (id === undefined || name === undefined) break;
                const node = layout.nodes[id] ?? (layout.nodes[id] = { x: 0, y: 0, ports: {} });
                const port: NonNullable<DiagramNodeLayout['ports']>[string] = { x: num(v.x) ?? 0, y: num(v.y) ?? 0 };
                put(port, 'side', lit<Side>(v.side));
                put(port, 'size', num(v.size));
                (node.ports ??= {})[name] = port;
                break;
            }
            case 'MemoLayoutPortWall': {
                const port = str(v.portId);
                const wall = lit<Side>(v.wall);
                if (port && wall) (canvas.portWalls ??= {})[port] = wall;
                break;
            }
            case 'MemoLayoutEdge': {
                const id = str(v.edge);
                if (id === undefined) break;
                const edge: DiagramEdgeLayout = {};
                put(edge, 'color', str(v.color));
                put(edge, 'strokeWidth', num(v.strokeWidth));
                put(edge, 'labelVisible', bool(v.labelVisible));
                put(edge, 'style', lit(v.lineStyle));
                const route = Array.isArray(v.route) ? v.route : [];
                if (route.length >= 2) {
                    edge.points = [];
                    for (let k = 0; k + 1 < route.length; k += 2) edge.points.push({ x: route[k], y: route[k + 1] });
                }
                put(edge, 'source', str(v.sourceElement));
                put(edge, 'target', str(v.targetElement));
                put(edge, 'sourcePortId', str(v.sourcePortId));
                put(edge, 'targetPortId', str(v.targetPortId));
                put(edge, 'manualLanding', bool(v.manualLanding));
                put(edge, 'sourceSide', lit<Side>(v.sourceSide));
                put(edge, 'sourceT', num(v.sourceT));
                put(edge, 'targetSide', lit<Side>(v.targetSide));
                put(edge, 'targetT', num(v.targetT));
                layout.edges[id] = edge;
                break;
            }
            case 'MemoLayoutNote': {
                const id = str(v.noteId);
                if (id === undefined) break;
                const note: DiagramAnnotation = {
                    kind: (str(v.noteKind) ?? 'note') as DiagramAnnotation['kind'],
                    x: num(v.x) ?? 0, y: num(v.y) ?? 0, text: str(v.text) ?? '',
                };
                put(note, 'width', num(v.width));
                put(note, 'height', num(v.height));
                put(note, 'color', str(v.fillColor));
                layout.annotations![id] = note;
                break;
            }
        }
    }
    if (Object.keys(canvas).length > 0) layout.canvas = canvas;
    return layout;
}

const round = (n: number) => {
    const r = Math.round(n * 100) / 100;
    return Object.is(r, -0) ? 0 : r;
};
const q = (s: string) => `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\r/g, '\\r').replace(/\n/g, '\\n')}"`;

type Field = [name: string, value: string | undefined];

/** A hand-drawn route as x, y, x, y, …; absent unless every point is a finite pair. */
function routeLiteral(points: ReadonlyArray<{ x: number; y: number }> | undefined): string | undefined {
    if (!Array.isArray(points) || points.length === 0) return undefined;
    const flat = points.flatMap(p => [p?.x, p?.y]);
    return flat.every(v => typeof v === 'number' && Number.isFinite(v)) ? `(${flat.map(v => round(v as number)).join(', ')})` : undefined;
}

function statement(definition: string, fields: Field[], indent: string): string {
    const body = fields.filter(([, v]) => v !== undefined).map(([k, v]) => `:>> ${k} = ${v};`).join(' ');
    return `${indent}@${definition} { ${body} }`;
}

// The layout comes from a client, so nothing in it is trusted to be SysML: a number
// that is not finite would be written as text no compiler reads, and an enum literal
// outside its set would not resolve. Such a value is left out, not repaired.
const n = (v: unknown) => typeof v === 'number' && Number.isFinite(v) ? String(round(v)) : undefined;
const s = (v: unknown) => typeof v === 'string' ? q(v) : undefined;
const b = (v: unknown) => typeof v === 'boolean' ? String(v) : undefined;
const SIDES = new Set(['top', 'bottom', 'left', 'right']);
const LINE_STYLES = new Set(['solid', 'dashed', 'dotted']);
const ALIGNS = new Set(['left', 'center', 'right']);
const VERTICAL_ALIGNS = new Set(['top', 'middle', 'bottom']);
const literal = (type: string, allowed: Set<string>, v: unknown) =>
    typeof v === 'string' && allowed.has(v) ? `${type}::${v}` : undefined;
const side = (v: unknown) => literal('MemoLayoutSide', SIDES, v);

/**
 * The statements that state this layout, one per line, in a fixed order (so a
 * drag changes only the lines of the boxes that moved). Empty when the layout
 * holds nothing the model does not already say.
 *
 * Not written: the camera (`zoom`, `pan`), which is one person's window and not
 * the drawing, and the IBD display toggles, which the view declares as its own
 * attributes and which the canvas reads from there.
 */
export function layoutToStatements(layout: DiagramLayout, indent: string): string[] {
    const lines: string[] = [];
    const canvas = layout.canvas as Canvas | undefined;
    const canvasFields: Field[] = [
        ['autoLayout', canvas?.autoLayout === false ? 'false' : undefined],
        ['grid', n(canvas?.grid)],
        ['snap', b(canvas?.snap)],
        ['coordinateSpace', s(canvas?.coordinateSpace)],
        ['layoutProvider', s(canvas?.layout?.provider)],
        ['layoutProviderVersion', s(canvas?.layout?.providerVersion)],
        ['layoutContractVersion', s(canvas?.layout?.contractVersion)],
        ['layoutPreset', s(canvas?.layout?.preset)],
        ['layoutSeed', n(canvas?.layout?.seed)],
    ];
    if (canvasFields.some(([, v]) => v !== undefined)) lines.push(statement('MemoLayout', canvasFields, indent));

    for (const id of Object.keys(layout.nodes ?? {}).sort()) {
        const node = layout.nodes[id];
        if (n(node?.x) === undefined || n(node?.y) === undefined) continue;
        lines.push(statement('MemoLayoutNode', [
            ['element', q(id)],
            ['parentElement', node.parent === undefined ? undefined : q(typeof node.parent === 'string' ? node.parent : '')],
            ['x', n(node.x)], ['y', n(node.y)],
            ['width', n(node.width)], ['height', n(node.height)],
            ['fillColor', s(node.color)], ['borderColor', s(node.borderColor)], ['textColor', s(node.textColor)],
            ['fontSize', n(node.fontSize)], ['fontWeight', n(node.fontWeight)],
            ['textAlign', literal('MemoLayoutAlign', ALIGNS, node.textAlign)],
            ['verticalAlign', literal('MemoLayoutVerticalAlign', VERTICAL_ALIGNS, node.verticalAlign)],
            ['opacity', n(node.opacity)],
        ], indent));
        for (const name of Object.keys(node.ports ?? {}).sort()) {
            const port = node.ports![name];
            if (n(port?.x) === undefined || n(port?.y) === undefined) continue;
            lines.push(statement('MemoLayoutPort', [
                ['element', q(id)], ['portName', q(name)], ['x', n(port.x)], ['y', n(port.y)],
                ['side', side(port.side)], ['size', n(port.size)],
            ], indent));
        }
    }
    for (const id of Object.keys(canvas?.portWalls ?? {}).sort()) {
        lines.push(statement('MemoLayoutPortWall', [
            ['portId', q(id)], ['wall', side(canvas!.portWalls![id])],
        ], indent));
    }
    for (const id of Object.keys(layout.edges ?? {}).sort()) {
        const edge = layout.edges[id];
        const fields: Field[] = [
            ['color', s(edge.color)], ['strokeWidth', n(edge.strokeWidth)], ['labelVisible', b(edge.labelVisible)],
            ['lineStyle', literal('MemoLayoutLineStyle', LINE_STYLES, edge.style)],
            ['route', routeLiteral(edge.points)],
            ['sourceElement', s(edge.source)], ['targetElement', s(edge.target)],
            ['sourcePortId', s(edge.sourcePortId)], ['targetPortId', s(edge.targetPortId)],
            ['manualLanding', b(edge.manualLanding)],
            ['sourceSide', side(edge.sourceSide)], ['sourceT', n(edge.sourceT)],
            ['targetSide', side(edge.targetSide)], ['targetT', n(edge.targetT)],
        ];
        // An edge entry that overrides nothing says nothing.
        if (fields.every(([, v]) => v === undefined)) continue;
        lines.push(statement('MemoLayoutEdge', [['edge', q(id)], ...fields], indent));
    }
    for (const id of Object.keys(layout.annotations ?? {}).sort()) {
        const note = layout.annotations![id];
        if (typeof note?.kind !== 'string' || n(note.x) === undefined || n(note.y) === undefined) continue;
        lines.push(statement('MemoLayoutNote', [
            ['noteId', q(id)], ['noteKind', q(note.kind)], ['x', n(note.x)], ['y', n(note.y)],
            ['width', n(note.width)], ['height', n(note.height)], ['text', q(note.text)], ['fillColor', s(note.color)],
        ], indent));
    }
    return lines;
}

// ─── editing a source file ───────────────────────────────────────────────────

/** Remove every layout statement, with the line it sits on when it is alone there. */
function removeStatements(text: string, statements: readonly LayoutStatement[]): string {
    let out = text;
    for (const st of [...statements].sort((a, z) => z.start - a.start)) {
        let from = st.start;
        let to = st.end;
        const lineStart = out.lastIndexOf('\n', from - 1) + 1;
        const lineEnd = out.indexOf('\n', to);
        const before = out.slice(lineStart, from);
        const after = out.slice(to, lineEnd < 0 ? out.length : lineEnd);
        if (/^[ \t]*$/.test(before) && /^[ \t\r]*$/.test(after)) {
            from = lineStart;
            to = lineEnd < 0 ? out.length : lineEnd + 1;
        }
        out = out.slice(0, from) + out.slice(to);
    }
    return out;
}

/** The text with every view's layout statements removed; the text itself when there are none. */
export function stripLayout(text: string): string {
    if (!text.includes('@MemoLayout')) return text;
    const statements = scanViewLayouts(text).flatMap(view => view.statements);
    return statements.length === 0 ? text : removeStatements(text, statements);
}

/**
 * The revision a source file is known by, ignoring layout.
 *
 * Every place that asks "has this file changed" — the rebuild check, the
 * precondition on a semantic edit, the hash the client carries — uses this one
 * function, so a layout save is invisible to all of them and a semantic change
 * is visible to all of them.
 */
export function layoutBlindRevision(text: string): string {
    return createHash('sha256').update(stripLayout(text)).digest('hex').slice(0, 16);
}

/** Layout of every view in a file, keyed by the view's id. Views with none are absent. */
export function readFileLayouts(text: string): Record<string, DiagramLayout> {
    const layouts: Record<string, DiagramLayout> = {};
    if (!text.includes('@MemoLayout')) return layouts;
    for (const view of scanViewLayouts(text)) {
        const layout = layoutFromStatements(view.statements);
        if (layout) layouts[view.id] = layout;
    }
    return layouts;
}

/**
 * The text with one view's layout replaced. `layout` null (or one that holds
 * nothing) removes the view's statements. Returns undefined when the file has
 * no view of that id — a layout that cannot be written is not invented a home.
 */
export function replaceViewLayout(text: string, viewId: string, layout: DiagramLayout | null): string | undefined {
    const view = scanViewLayouts(text).find(candidate => candidate.id === viewId);
    if (!view) return undefined;
    const bodyIndent = indentOfBody(text, view);
    const lines = layout ? layoutToStatements(layout, bodyIndent) : [];
    const without = removeStatements(text, view.statements);
    if (lines.length === 0) return without;
    // Re-find the view: its offsets moved when the old statements went.
    const rescanned = scanViewLayouts(without).find(candidate => candidate.id === viewId)!;
    const closeLineStart = without.lastIndexOf('\n', rescanned.bodyEnd - 1) + 1;
    const closeIsOwnLine = /^[ \t]*$/.test(without.slice(closeLineStart, rescanned.bodyEnd));
    const block = lines.join('\n');
    const inserted = closeIsOwnLine
        ? `${without.slice(0, closeLineStart)}${block}\n${without.slice(closeLineStart)}`
        : `${without.slice(0, rescanned.bodyEnd)}\n${block}\n${without.slice(rescanned.bodyEnd)}`;
    return withLayoutImport(inserted);
}

const LAYOUT_PACKAGE = 'memo_viewpoints_definitions_layout';

/**
 * The statements are typed by metadata definitions in the ontology's layout
 * package, so the file that uses them must import it. Added once, to the file's
 * outermost package, where every view in the file can see it; never removed,
 * because other views in the file may use it and an unused import is harmless.
 */
/** Whether the file already imports the package the statements are typed by. */
export function importsLayoutPackage(text: string): boolean {
    return new RegExp(`\\bimport\\s+${LAYOUT_PACKAGE}::`).test(text);
}

function withLayoutImport(text: string): string {
    if (importsLayoutPackage(text)) return text;
    const { rootBodyStart } = scan(text);
    if (rootBodyStart === undefined) return text;
    const lineStart = text.lastIndexOf('\n', rootBodyStart - 1) + 1;
    const indent = `${/^[ \t]*/.exec(text.slice(lineStart))![0]}    `;
    return `${text.slice(0, rootBodyStart)}\n${indent}private import ${LAYOUT_PACKAGE}::*;${text.slice(rootBodyStart)}`;
}

/** The indentation the view's other members use, else one level in from the view. */
function indentOfBody(text: string, view: ScannedView): string {
    const firstMember = /\n([ \t]+)\S/.exec(text.slice(view.bodyStart, view.bodyEnd));
    if (firstMember) return firstMember[1];
    const declStart = text.lastIndexOf('\n', view.bodyStart) + 1;
    return `${/^[ \t]*/.exec(text.slice(declStart))![0]}    `;
}
