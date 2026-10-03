// ─── Source outline ──────────────────────────────────────────────────────────
//
// What a write-back needs to know about a file, and no more: where each
// declaration is, what it is called, where its body opens and closes, and its
// members (plans/memo-write-back-from-handoff.md). The writers used to read
// these from MEMO's syntax tree, which tied them to MEMO's grammar. An outline
// is built from a stage 1 handoff — every element states its byte range and
// qualified name — or, while MEMO's compiler exists, from MEMO's parse; the
// writers read the outline either way.
//
// Offsets are JavaScript string offsets into the file's text, the unit a splice
// is made in. A handoff states byte offsets; they are converted here.
// ─────────────────────────────────────────────────────────────────────────────

import type { ApiElement, ApiModel } from '../stage2/api-model.js';

/** What a writer does with a member: regenerate it, carry it, or address it. */
export type OutlineRole =
    | 'package' | 'attribute' | 'doc' | 'metadata' | 'expose' | 'import' | 'connection' | 'declaration';

export interface OutlineNode {
    /** The SysML metaclass, as the API names it: `PartUsage`, `AttributeUsage`, `Package`. */
    metaclass: string;
    role: OutlineRole;
    /** The name the declaration declares, when it declares one. */
    name?: string;
    /**
     * What addresses the declaration within its file: its owner's key and its
     * name — its qualified name, for a declaration in named owners — or, when
     * it declares no name, its place among the anonymous declarations of its
     * metaclass there (`P::@ConnectionUsage[1]`). A redefinition
     * (`attribute :>> x`) is named by the feature it redefines.
     */
    key: string;
    /** Offset of the declaration's first character. */
    start: number;
    /** Offset just past its last character. */
    end: number;
    /** Offset just past the body's `{`, and the offset of its `}`. */
    body?: { open: number; close: number };
    members: OutlineNode[];
    /** The features a metadata annotation sets (`providedId`, `label`). */
    fields: string[];
}

export interface SourceOutline {
    /** The file, as the caller named it. */
    file: string;
    text: string;
    roots: OutlineNode[];
}

/** Every node of an outline, depth first in source order. */
export function* outlineNodes(outline: SourceOutline | readonly OutlineNode[]): Generator<OutlineNode> {
    const stack = [...('roots' in outline ? outline.roots : outline)].reverse();
    while (stack.length > 0) {
        const node = stack.pop()!;
        yield node;
        stack.push(...[...node.members].reverse());
    }
}

/**
 * The members written inside a declaration's body. A compiler also places
 * features it reads from the declaration's head under it — the ends of
 * `connect a to b`, a flow's payload — and a writer must never move those.
 */
export function bodyMembers(node: OutlineNode): OutlineNode[] {
    const body = node.body;
    if (!body) return [];
    return node.members.filter(member => member.start >= body.open && member.end <= body.close);
}

// ─── Roles ───────────────────────────────────────────────────────────────────

const CONNECTIONS = new Set([
    'ConnectionUsage', 'InterfaceUsage', 'AllocationUsage', 'FlowUsage', 'SuccessionFlowUsage',
]);

function roleOf(metaclass: string): OutlineRole {
    if (metaclass === 'Package' || metaclass === 'LibraryPackage') return 'package';
    if (metaclass === 'AttributeUsage') return 'attribute';
    if (metaclass === 'Documentation') return 'doc';
    if (metaclass === 'MetadataUsage') return 'metadata';
    if (metaclass.endsWith('Expose')) return 'expose';
    if (metaclass.endsWith('Import')) return 'import';
    if (CONNECTIONS.has(metaclass)) return 'connection';
    return 'declaration';
}

// ─── Bodies ──────────────────────────────────────────────────────────────────

/**
 * The braces of a declaration's body: the first `{` at the top level of its
 * text and the `}` that closes it, skipping strings and comments. Undefined for
 * a declaration that ends in `;`.
 */
export function findBody(text: string, start: number, end: number): { open: number; close: number } | undefined {
    let depth = 0;
    let open = -1;
    for (let i = start; i < end; i++) {
        const c = text[i];
        if (c === '"' || c === "'") {
            for (i++; i < end && text[i] !== c; i++) if (text[i] === '\\') i++;
            continue;
        }
        if (c === '/' && text[i + 1] === '/') {
            while (i < end && text[i] !== '\n') i++;
            continue;
        }
        if (c === '/' && text[i + 1] === '*') {
            const close = text.indexOf('*/', i + 2);
            i = close < 0 ? end : close + 1;
            continue;
        }
        if (c === '{') {
            if (depth === 0 && open < 0) open = i;
            depth++;
        } else if (c === '}') {
            depth--;
            if (depth === 0 && open >= 0) return { open: open + 1, close: i };
        } else if (c === ';' && depth === 0 && open < 0) {
            return undefined;
        }
    }
    return undefined;
}

// ─── Keys ────────────────────────────────────────────────────────────────────

interface RawNode {
    metaclass: string;
    name?: string;
    start: number;
    end: number;
    members: RawNode[];
    fields: string[];
}

/** Turn raw nodes into outline nodes, keying each under its owner. */
function finish(text: string, raws: readonly RawNode[], ownerKey: string): OutlineNode[] {
    const anonymous = new Map<string, number>();
    return raws.map(raw => {
        let key: string;
        if (raw.name) key = ownerKey ? `${ownerKey}::${raw.name}` : raw.name;
        else {
            const n = anonymous.get(raw.metaclass) ?? 0;
            anonymous.set(raw.metaclass, n + 1);
            key = `${ownerKey ? `${ownerKey}::` : ''}@${raw.metaclass}[${n}]`;
        }
        return {
            metaclass: raw.metaclass,
            role: roleOf(raw.metaclass),
            ...(raw.name ? { name: raw.name } : {}),
            key,
            start: raw.start,
            end: raw.end,
            ...(() => { const body = findBody(text, raw.start, raw.end); return body ? { body } : {}; })(),
            members: finish(text, raw.members, key),
            fields: raw.fields,
        };
    });
}

// ─── From a stage 1 handoff ──────────────────────────────────────────────────

/** Byte offset → string offset, for one file's text. */
function byteToChar(text: string): (byte: number) => number {
    // eslint-disable-next-line no-control-regex
    if (!/[^\u0000-\u007f]/.test(text)) return byte => byte;
    const bytes = Buffer.from(text, 'utf8');
    return byte => bytes.subarray(0, byte).toString('utf8').length;
}

/**
 * The outline of one file from a handoff that compiled it.
 *
 * `absoluteFile` names the file as the handoff's index resolves it; `text` is
 * the file's bytes at the time of that compile, which the caller checks.
 * Elements the handoff gives no range — the ones a compiler implies rather than
 * reads — are not declarations; their ranged members are kept under the
 * nearest ranged owner.
 */
export function outlineFromHandoff(api: ApiModel, absoluteFile: string, file: string, text: string): SourceOutline {
    const toChar = byteToChar(text);
    const ranged = (element: ApiElement) => {
        const entry = api.source(element['@id']);
        return entry?.startByte !== undefined && entry.endByte !== undefined ? entry : undefined;
    };
    const visit = (element: ApiElement): RawNode[] => {
        const entry = ranged(element);
        const metaclass = String(element['@type']);
        // A metadata annotation's fields are `fields`, not declarations.
        const children = metaclass === 'MetadataUsage' ? [] : api.ownedMembers(element['@id']).flatMap(visit);
        if (!entry) return children;
        return [{
            metaclass,
            // `attribute :>> x = …` declares no name; the name it is written
            // with is the feature it redefines. `variant x;` is written with
            // the name of the feature it references.
            name: api.name(element['@id']) ?? variantName(api, element),
            start: toChar(entry.startByte!),
            end: toChar(entry.endByte!),
            members: children,
            fields: metaclass === 'MetadataUsage'
                ? api.ownedMembers(element['@id']).map(m => api.name(m['@id'])).filter((n): n is string => Boolean(n))
                : [],
        }];
    };
    const roots: RawNode[] = [];
    for (const namespace of api.ofType('Namespace')) {
        if (api.owner(namespace['@id']) || api.absoluteFile(namespace['@id']) !== absoluteFile) continue;
        for (const member of api.ownedMembers(namespace['@id'])) roots.push(...visit(member));
    }
    roots.sort((a, b) => a.start - b.start);
    return { file, text, roots: finish(text, roots, '') };
}

/** The name of the feature `variant x;` references: a variant member declares none. */
function variantName(api: ApiModel, element: ApiElement): string | undefined {
    const owning = api.element(String((element.owningRelationship as { '@id'?: string } | undefined)?.['@id'] ?? ''));
    if (owning?.['@type'] !== 'VariantMembership') return undefined;
    const referenced = api.related(element['@id'], ['ReferenceSubsetting'], 'referencedFeature')[0];
    return referenced ? api.name(referenced['@id']) : undefined;
}

// ─── From MEMO's parse ───────────────────────────────────────────────────────

/** MEMO's syntax-tree node types that do not carry the metaclass's own name. */
const PARSE_METACLASS: Record<string, string> = {
    PackageDeclaration: 'Package',
    PartMember: 'PartUsage',
    AttributeMember: 'AttributeUsage',
    RefMember: 'ReferenceUsage',
    DocComment: 'Documentation',
    MetadataApplication: 'MetadataUsage',
    PrefixMetadataAnnotation: 'MetadataUsage',
    ExposeMember: 'NamespaceExpose',
    ImportDeclaration: 'NamespaceImport',
    EnumDefinition: 'EnumerationDefinition',
    EnumLiteral: 'EnumerationUsage',
    FlowConnectionUsage: 'FlowUsage',
    AllocateUsage: 'AllocationUsage',
    MessageUsage: 'FlowUsage',
    BindingUsage: 'BindingConnectorAsUsage',
    SuccessionUsage: 'SuccessionAsUsage',
    ActorMember: 'PartUsage',
    StakeholderMember: 'PartUsage',
    SubjectMember: 'ReferenceUsage',
};

/**
 * The outline of one file from MEMO's parse of it: the same facts, read from
 * the syntax tree, so the writers work alike under MEMO's compiler. `root` is
 * the parsed document's model.
 */
export function outlineFromParse(root: { members?: unknown[] }, file: string, text: string): SourceOutline {
    // A key is the owner's key and the declared name, as `finish` makes it.
    const visit = (node: any): RawNode[] => {
        const cst = node?.$cstNode;
        if (!node || typeof node !== 'object' || !node.$type || !cst) return [];
        const metaclass = PARSE_METACLASS[node.$type] ?? node.$type;
        const name: string | undefined = typeof node.name === 'string' ? node.name : undefined;
        // A metadata annotation's fields are `fields`, not declarations.
        const children = metaclass === 'MetadataUsage' ? []
            : [...(node.members ?? []), ...(node.body ?? []), ...(node.usageBody ?? [])].flatMap(visit);
        return [{
            metaclass,
            name,
            start: cst.offset,
            end: cst.offset + cst.length,
            members: children,
            fields: metaclass === 'MetadataUsage'
                ? (node.body ?? []).map((field: any) => field.name).filter(Boolean)
                : [],
        }];
    };
    const roots = (root.members ?? []).flatMap(visit);
    return { file, text, roots: finish(text, roots, '') };
}

// ─── Editing an outline with its text ────────────────────────────────────────

/**
 * The outline of the text after replacing `[from, to)` with `inserted`, without
 * compiling it: a declaration inside the replaced range is gone, one after it
 * moves by the length difference, and one around it grows or shrinks. A writer
 * that removes a declaration and then inserts elsewhere in the same text needs
 * the outline of a text no compiler has seen.
 */
export function spliceOutline(outline: SourceOutline, from: number, to: number, inserted: string): SourceOutline {
    const delta = inserted.length - (to - from);
    const moved = (offset: number) => (offset >= to ? offset + delta : offset);
    const map = (nodes: readonly OutlineNode[]): OutlineNode[] => nodes
        .filter(node => !(to > from && node.start >= from && node.end <= to))
        .map(node => ({
            ...node,
            start: moved(node.start),
            end: moved(node.end),
            ...(node.body ? { body: { open: moved(node.body.open), close: moved(node.body.close) } } : {}),
            members: map(node.members),
        }));
    return {
        ...outline,
        text: outline.text.slice(0, from) + inserted + outline.text.slice(to),
        roots: map(outline.roots),
    };
}

/** An outline with nothing in it: the outline of an empty or new file. */
export function emptyOutline(file: string, text = ''): SourceOutline {
    return { file, text, roots: [] };
}
