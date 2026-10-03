// ─── Locating packages in source text ────────────────────────────────────────
//
// Shared by the element persistor and the package writer, because "put this
// declaration in that package" is one question with one answer whichever of
// them is asking. A package is found in the file's source outline, never by
// matching its name in the text.
// ─────────────────────────────────────────────────────────────────────────────

import { outlineNodes, type SourceOutline } from '../authoring/source-outline.js';

/** One level of body indentation, matching the layout the generator emits. */
export const INDENT = '    ';

/** A declaration with a body, located in one file's source text. */
export interface LocatedPackage {
    qualifiedName: string;
    name: string;
    /**
     * False for a usage that merely CAN hold a package.
     *
     * A grouping package is declared inside a usage body — `part scrHome :
     * UIElement { package grpHeader { … } }` — so creating one addresses the
     * part, which is a container without being a package.
     */
    isPackage: boolean;
    /** Offset of the declaration's first character. */
    start: number;
    /** Offset just past the declaration's closing brace. */
    end: number;
    /** Offset just past the body's opening brace. */
    bodyStart: number;
    /** Offset of the body's closing brace. */
    bodyEnd: number;
}

/** Every package declared in one file, with its qualified name. */
export function locatePackages(outline: SourceOutline): LocatedPackage[] {
    return locateContainers(outline).filter(container => container.isPackage);
}

/**
 * Every declaration in one file that can hold a package: the packages, and the
 * usages whose bodies may group with one.
 *
 * A usage is walked as well as recorded, because SysML puts a grouping package
 * inside a usage body and MEMO's own explorer offers to create one there. The
 * qualified name of such a package therefore runs through the usage that holds
 * it — `catalogPackage::scrHome::grpHeader` — which is what the SysML namespace
 * says it is, and what makes it addressable by name like any other package.
 *
 * Read from the file's source outline, never by matching a name in the text: a
 * comment mentioning the name is not a declaration, and two packages can
 * differ only in their nesting.
 */
export function locateContainers(outline: SourceOutline): LocatedPackage[] {
    const found: LocatedPackage[] = [];
    for (const node of outlineNodes(outline)) {
        // A declaration without a name or a body holds nothing and addresses nothing.
        if (!node.name || !node.body) continue;
        found.push({
            qualifiedName: node.key,
            name: node.name,
            isPackage: node.role === 'package',
            start: node.start,
            end: node.end,
            bodyStart: node.body.open,
            bodyEnd: node.body.close,
        });
    }
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
    const { from, to } = removedLine(source, start, end);
    return source.slice(0, from) + source.slice(to);
}

/** The range `removeLine` removes: the declaration, its indentation, and its line break. */
export function removedLine(source: string, start: number, end: number): { from: number; to: number } {
    const lineStart = source.lastIndexOf('\n', start - 1) + 1;
    const leadingIsBlank = /^[ \t]*$/.test(source.slice(lineStart, start));
    const from = leadingIsBlank ? lineStart : start;
    let to = end;
    while (to < source.length && (source[to] === ' ' || source[to] === '\t')) to += 1;
    if (source[to] === '\n') to += 1;
    return { from, to };
}

/** Strip the common leading whitespace from every line of a block. */
export function dedent(text: string): string {
    const lines = text.split('\n');
    const indents = lines.slice(1).filter(line => line.trim())
        .map(line => line.match(/^[ \t]*/)?.[0].length ?? 0);
    const common = indents.length > 0 ? Math.min(...indents) : 0;
    return lines.map((line, i) => (i === 0 ? line : line.slice(common))).join('\n');
}
