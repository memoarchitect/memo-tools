// ─── Locating packages in source text ────────────────────────────────────────
//
// Shared by the element persistor and the package writer, because "put this
// declaration in that package" is one question with one answer whichever of
// them is asking. A package is found by parsing, never by matching its name in
// the file text: a comment mentioning the name is not a declaration, and two
// packages can differ only in their nesting.
// ─────────────────────────────────────────────────────────────────────────────

import { parseText } from '../model/parser-utils.js';

/** One level of body indentation, matching the layout the generator emits. */
export const INDENT = '    ';

/** A package declaration located in one file's source text. */
export interface LocatedPackage {
    qualifiedName: string;
    name: string;
    /** Offset of the declaration's first character. */
    start: number;
    /** Offset just past the declaration's closing brace. */
    end: number;
    /** Offset just past the body's opening brace. */
    bodyStart: number;
    /** Offset of the body's closing brace. */
    bodyEnd: number;
}

/** Every package declared in one file's source, with its qualified name. */
export async function locatePackages(source: string): Promise<LocatedPackage[]> {
    if (!source.trim()) return [];
    const { document, errors } = await parseText(source);
    if (errors.length > 0) return [];

    const found: LocatedPackage[] = [];
    const visit = (node: any, parent: string): void => {
        for (const member of node.members ?? []) {
            if (member.$type !== 'PackageDeclaration') continue;
            const qualifiedName = parent ? `${parent}::${member.name}` : member.name;
            const cst = member.$cstNode;
            if (cst) {
                const start = cst.offset;
                const end = cst.offset + cst.length;
                const bodyStart = source.indexOf('{', start);
                const bodyEnd = source.lastIndexOf('}', end - 1);
                if (bodyStart !== -1 && bodyEnd > bodyStart) {
                    found.push({ qualifiedName, name: member.name, start, end, bodyStart: bodyStart + 1, bodyEnd });
                }
            }
            visit(member, qualifiedName);
        }
    };
    visit(document.parseResult.value as any, '');
    return found;
}

/** Insert text as the last member of a package body, indented one level in. */
export function insertIntoBody(source: string, target: LocatedPackage, text: string): string {
    const lineStart = source.lastIndexOf('\n', target.start - 1) + 1;
    const lead = source.slice(lineStart, target.start);
    const indent = (/^[ \t]*$/.test(lead) ? lead : '') + INDENT;
    const body = text.replace(/\s+$/, '').split('\n')
        .map(line => (line ? indent + line : line)).join('\n');
    const before = source.slice(0, target.bodyEnd).replace(/[ \t]*$/, '');
    const separator = before.endsWith('\n') ? '' : '\n';
    const closingIndent = indent.slice(0, -INDENT.length);
    return `${before}${separator}${body}\n${closingIndent}${source.slice(target.bodyEnd)}`;
}

/** Replace a range, re-indenting the replacement to the line it starts on. */
export function spliceIndented(source: string, start: number, end: number, replacement: string): string {
    const lineStart = source.lastIndexOf('\n', start - 1) + 1;
    const lead = source.slice(lineStart, start);
    const indent = /^[ \t]*$/.test(lead) ? lead : '';
    const body = replacement.split('\n').map((line, i) => (i === 0 || !line ? line : indent + line)).join('\n');
    return source.slice(0, start) + body + source.slice(end);
}

/** Remove a range together with the blank line it would otherwise leave behind. */
export function removeLine(source: string, start: number, end: number): string {
    const lineStart = source.lastIndexOf('\n', start - 1) + 1;
    const leadingIsBlank = /^[ \t]*$/.test(source.slice(lineStart, start));
    const from = leadingIsBlank ? lineStart : start;
    let to = end;
    while (to < source.length && (source[to] === ' ' || source[to] === '\t')) to += 1;
    if (source[to] === '\n') to += 1;
    return source.slice(0, from) + source.slice(to);
}

/** Strip the common leading whitespace from every line of a block. */
export function dedent(text: string): string {
    const lines = text.split('\n');
    const indents = lines.slice(1).filter(line => line.trim())
        .map(line => line.match(/^[ \t]*/)?.[0].length ?? 0);
    const common = indents.length > 0 ? Math.min(...indents) : 0;
    return lines.map((line, i) => (i === 0 ? line : line.slice(common))).join('\n');
}
