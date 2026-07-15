// ─── DHF Directive Parser ─────────────────────────────────────────────────────
//
// Parses MEMO directives from markdown content:
//   {{ref:ID.attr}}       — inline element attribute reference
//   {{project.key}}       — project metadata from memo.dhf.yaml
//   {{diagram:id}}        — embed diagram by ID
//   {{include:path}}      — include partial template
//   {{toc}}               — generate table of contents
//   {{glossary}}          — generate glossary of model terms
// ─────────────────────────────────────────────────────────────────────────────

/** All recognized directive types */
export type DirectiveKind =
    | 'ref'
    | 'project'
    | 'diagram'
    | 'include'
    | 'toc'
    | 'glossary';

export interface Directive {
    /** Raw matched text, e.g. "{{ref:HAZ-001.name}}" */
    raw: string;
    /** Character offset in the source string */
    offset: number;
    kind: DirectiveKind;
    /** For ref: the element ID */
    elementId?: string;
    /** For ref: the attribute name (name, id, layer, kind, doc, etc.) */
    attribute?: string;
    /** For project: the dot-separated key (company, product, version, …) */
    projectKey?: string;
    /** For diagram: the diagram/view ID */
    diagramId?: string;
    /** For include: the relative file path */
    includePath?: string;
}

// Match {{...}} tokens — greedy-safe (no nested braces)
const DIRECTIVE_RE = /\{\{([^{}]+)\}\}/g;

/**
 * Parse all directives found in a markdown string.
 * Returns directives in document order.
 */
export function parseDirectives(content: string): Directive[] {
    const results: Directive[] = [];
    let match: RegExpExecArray | null;

    DIRECTIVE_RE.lastIndex = 0;
    while ((match = DIRECTIVE_RE.exec(content)) !== null) {
        const raw = match[0];
        const inner = match[1].trim();
        const offset = match.index;

        const directive = parseInner(raw, inner, offset);
        if (directive) results.push(directive);
    }

    return results;
}

function parseInner(raw: string, inner: string, offset: number): Directive | null {
    // {{toc}} or {{glossary}} — keyword-only
    if (inner === 'toc') return { raw, offset, kind: 'toc' };
    if (inner === 'glossary') return { raw, offset, kind: 'glossary' };

    // {{ref:ID.attr}} or {{ref:ID}} (attr defaults to 'name')
    if (inner.startsWith('ref:')) {
        const rest = inner.slice(4);
        const dotIdx = rest.indexOf('.');
        if (dotIdx === -1) {
            return { raw, offset, kind: 'ref', elementId: rest, attribute: 'name' };
        }
        return {
            raw, offset, kind: 'ref',
            elementId: rest.slice(0, dotIdx),
            attribute: rest.slice(dotIdx + 1),
        };
    }

    // {{diagram:id}}
    if (inner.startsWith('diagram:')) {
        return { raw, offset, kind: 'diagram', diagramId: inner.slice(8) };
    }

    // {{include:path}}
    if (inner.startsWith('include:')) {
        return { raw, offset, kind: 'include', includePath: inner.slice(8).trim() };
    }

    // {{project.key}} — dot-separated path into project config
    if (inner.startsWith('project.')) {
        return { raw, offset, kind: 'project', projectKey: inner.slice(8) };
    }

    return null;
}

/**
 * Replace all resolved directives in a content string.
 * `resolver` receives each Directive and returns its replacement string (or the
 * original raw text if it should be left as-is).
 */
export function applyDirectives(
    content: string,
    resolver: (d: Directive) => string,
): string {
    const directives = parseDirectives(content);
    if (directives.length === 0) return content;

    let result = '';
    let cursor = 0;

    for (const d of directives) {
        result += content.slice(cursor, d.offset);
        result += resolver(d);
        cursor = d.offset + d.raw.length;
    }

    result += content.slice(cursor);
    return result;
}
