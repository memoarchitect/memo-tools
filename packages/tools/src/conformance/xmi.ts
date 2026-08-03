// ─── Reading the normative XMI ───────────────────────────────────────────────
//
// A purpose-built scanner for EMF's XMI output, not a general XML parser.
//
// Two reasons it is written rather than depended on. First, the input is
// regular: EMF emits elements, attributes and nesting, with no mixed content,
// no CDATA, no processing instructions past the declaration, and no comments.
// Second, `SI.sysmlx` is 16 MB and there are 94 of these; building a DOM to
// read four attributes per element costs an order of magnitude more memory than
// the answer is worth. This walks the text once and keeps only what the
// comparison asks about.
//
// The scanner is deliberately strict about what it does *not* understand: an
// input with anything outside that shape is reported, never guessed at.
// ─────────────────────────────────────────────────────────────────────────────

import { readFileSync } from 'node:fs';

/** One named element in a serialized library, with its containment path. */
export interface XmiElement {
    /** Dot-joined declared names from the root down, e.g. `Parts::Part`. */
    qualifiedName: string;
    /** Local declared name. */
    name: string;
    /** Metaclass, with the `sysml:` prefix stripped — `PartUsage`, `DataType`. */
    metatype: string;
    /** The Pilot's own element UUID. */
    elementId?: string;
    /**
     * True where the serialization marks the element as added by implication
     * rather than declared in the source. This is the one attribute that makes
     * `xmi.implied` a differential oracle rather than a second copy.
     */
    implied: boolean;
    /** Nesting depth, root elements at 0. */
    depth: number;
}

export interface XmiDocument {
    path: string;
    /** Named elements, in document order. */
    elements: XmiElement[];
    /** Named elements by qualified name; later duplicates are kept in `elements`. */
    byQualifiedName: Map<string, XmiElement>;
    /** Elements the file contains that carry no declared name. */
    anonymousCount: number;
}

export class XmiParseError extends Error {
    constructor(path: string, offset: number, detail: string) {
        super(`${path}: malformed XMI at byte ${offset}: ${detail}`);
        this.name = 'XmiParseError';
    }
}

const ENTITIES: Record<string, string> = {
    lt: '<', gt: '>', amp: '&', quot: '"', apos: "'",
};

export function decodeEntities(raw: string): string {
    return raw.replace(/&(#x[0-9A-Fa-f]+|#\d+|[A-Za-z]+);/g, (match, body: string) => {
        if (body.startsWith('#x')) return String.fromCodePoint(Number.parseInt(body.slice(2), 16));
        if (body.startsWith('#')) return String.fromCodePoint(Number.parseInt(body.slice(1), 10));
        return ENTITIES[body] ?? match;
    });
}

/**
 * End of the tag opened at `start`, skipping `>` inside attribute values.
 *
 * Not a hypothetical: the libraries' documentation bodies carry HTML, and XML
 * only requires `<` and `&` to be escaped — so `body="…&lt;/p>"` is well-formed
 * and a naive `indexOf('>')` cuts the tag in half. That produced an unclosed-
 * element error 9 KB into the first Kernel library.
 */
function endOfTag(text: string, start: number): number {
    let quote: string | undefined;
    for (let i = start; i < text.length; i += 1) {
        const char = text[i];
        if (quote) {
            if (char === quote) quote = undefined;
        } else if (char === '"' || char === "'") {
            quote = char;
        } else if (char === '>') {
            return i;
        }
    }
    return -1;
}

const ATTRIBUTE = /([A-Za-z_:][\w.:-]*)\s*=\s*"([^"]*)"/g;

function attributes(raw: string): Record<string, string> {
    const out: Record<string, string> = {};
    ATTRIBUTE.lastIndex = 0;
    for (let match = ATTRIBUTE.exec(raw); match; match = ATTRIBUTE.exec(raw)) {
        out[match[1]] = decodeEntities(match[2]);
    }
    return out;
}

/** `sysml:LibraryPackage` → `LibraryPackage`; a bare name is returned as-is. */
export function localName(qualified: string | undefined): string | undefined {
    if (!qualified) return undefined;
    const colon = qualified.indexOf(':');
    return colon >= 0 ? qualified.slice(colon + 1) : qualified;
}

/**
 * Read one XMI file into its named elements.
 *
 * Only elements carrying `declaredName` become entries. Everything else —
 * memberships, documentation bodies, feature chains — is containment structure
 * whose identity is a UUID, and comparing UUIDs across two independent
 * implementations compares nothing. What both sides can be held to is *which
 * named elements exist, of what metaclass, under what qualified name*.
 */
export function readXmi(path: string): XmiDocument {
    const text = readFileSync(path, 'utf-8');
    const elements: XmiElement[] = [];
    const byQualifiedName = new Map<string, XmiElement>();
    /** Declared-name stack: one entry per open element, undefined when unnamed. */
    const open: (string | undefined)[] = [];
    let anonymousCount = 0;

    let index = 0;
    while (index < text.length) {
        const start = text.indexOf('<', index);
        if (start < 0) break;
        // The XML declaration and any doctype carry nothing this reads.
        if (text.startsWith('<?', start) || text.startsWith('<!', start)) {
            const close = text.indexOf('>', start);
            if (close < 0) throw new XmiParseError(path, start, 'unterminated declaration');
            index = close + 1;
            continue;
        }
        const close = endOfTag(text, start);
        if (close < 0) throw new XmiParseError(path, start, 'unterminated tag');
        const body = text.slice(start + 1, close);
        index = close + 1;

        if (body.startsWith('/')) {
            if (open.length === 0) throw new XmiParseError(path, start, 'closing tag with nothing open');
            open.pop();
            continue;
        }

        const selfClosing = body.endsWith('/');
        const inner = selfClosing ? body.slice(0, -1) : body;
        const space = inner.search(/\s/);
        const attrs = space < 0 ? {} : attributes(inner.slice(space));
        const declaredName = attrs.declaredName;
        const path_ = declaredName
            ? [...open.filter((name): name is string => name !== undefined), declaredName]
            : undefined;

        if (path_) {
            const element: XmiElement = {
                qualifiedName: path_.join('::'),
                name: declaredName,
                metatype: localName(attrs['xsi:type']) ?? 'Element',
                elementId: attrs.elementId ?? attrs['xmi:id'],
                implied: attrs.isImpliedIncluded === 'true',
                depth: open.filter(name => name !== undefined).length,
            };
            elements.push(element);
            if (!byQualifiedName.has(element.qualifiedName)) {
                byQualifiedName.set(element.qualifiedName, element);
            }
        } else {
            anonymousCount += 1;
        }

        if (!selfClosing) open.push(declaredName);
    }

    if (open.length > 0) throw new XmiParseError(path, text.length, `${open.length} unclosed element(s)`);
    return { path, elements, byQualifiedName, anonymousCount };
}
