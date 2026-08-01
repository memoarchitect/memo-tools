import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, relative, resolve, sep } from 'node:path';
import type { MemoElement, MemoModelDTO } from '../model/semantic.js';
import { parseText } from '../model/parser-utils.js';
import { isConnectionUsage } from '../language/generated/ast.js';

export interface ElementRemoveResult {
    success: boolean;
    elementId: string;
    sourceFiles?: string[];
    removedRelationshipIds?: string[];
    error?: string;
}

interface Cut { start: number; end: number }

const identifierPattern = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function projectFile(projectRoot: string, file: string): string | undefined {
    const absolute = resolve(projectRoot, file);
    const rel = relative(projectRoot, absolute);
    if (rel === '..' || rel.startsWith(`..${sep}`) || rel.startsWith('../') || rel.startsWith('..\\')) return undefined;
    return absolute;
}

function nodes(root: { members?: unknown[] }): any[] {
    const found: any[] = [];
    const stack = [...(root.members ?? [])];
    while (stack.length) {
        const node = stack.pop() as any;
        if (!node || typeof node !== 'object') continue;
        found.push(node);
        if (Array.isArray(node.members)) stack.push(...node.members);
    }
    return found;
}

function wholeLine(source: string, start: number, end: number): Cut {
    const lineStart = source.lastIndexOf('\n', start - 1) + 1;
    if (/^[ \t]*$/.test(source.slice(lineStart, start))) start = lineStart;
    const lineEnd = source.indexOf('\n', end);
    if (lineEnd >= 0 && /^[ \t]*$/.test(source.slice(end, lineEnd))) end = lineEnd + 1;
    return { start, end };
}

function applyCuts(source: string, cuts: Cut[]): string {
    return [...cuts]
        .sort((a, b) => b.start - a.start)
        .reduce((text, cut) => text.slice(0, cut.start) + text.slice(cut.end), source);
}

function atomicWrite(path: string, text: string): void {
    const temporary = resolve(dirname(path), `.${path.split(sep).pop()}.delete-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    writeFileSync(temporary, text, 'utf8');
    renameSync(temporary, path);
}

/** Remove one project-owned usage plus every connection that references it. */
export async function removeElement(
    element: MemoElement,
    model: MemoModelDTO,
    projectRoot: string,
): Promise<ElementRemoveResult> {
    if (!element.file) return { success: false, elementId: element.id, error: 'The element has no writable source file.' };
    const connected = model.relationships.filter(relationship =>
        relationship.sourceId === element.id || relationship.targetId === element.id);
    const unowned = connected.find(relationship => !relationship.file);
    if (unowned) {
        return {
            success: false,
            elementId: element.id,
            error: `Relationship "${unowned.id}" has no writable owner; deletion was cancelled to avoid a dangling reference.`,
        };
    }
    const files = new Set<string>([element.file, ...connected.map(relationship => relationship.file).filter((file): file is string => !!file)]);
    const prepared = new Map<string, { absolute: string; original: string; text: string }>();
    const endpoint = new RegExp(`::>\\s*${identifierPattern(element.id)}(?![A-Za-z0-9_-])`);

    for (const file of files) {
        const absolute = projectFile(projectRoot, file);
        if (!absolute || !existsSync(absolute)) {
            return { success: false, elementId: element.id, error: `${file} is not a writable project file.` };
        }
        const source = readFileSync(absolute, 'utf8');
        const parsed = await parseText(source);
        if (parsed.errors.length) {
            return { success: false, elementId: element.id, error: `${file} does not parse (${parsed.errors[0].message}).` };
        }
        const all = nodes(parsed.document.parseResult.value as any);
        const cuts: Cut[] = [];
        for (const node of all) {
            const cst = node.$cstNode;
            if (!cst) continue;
            if (file === element.file && !isConnectionUsage(node) && node.name === element.id) {
                cuts.push(wholeLine(source, cst.offset, cst.offset + cst.length));
                continue;
            }
            if (isConnectionUsage(node)) {
                const declaration = source.slice(cst.offset, cst.offset + cst.length);
                if (endpoint.test(declaration)) cuts.push(wholeLine(source, cst.offset, cst.offset + cst.length));
            }
        }
        if (file === element.file && !cuts.some(cut => source.slice(cut.start, cut.end).includes(element.id))) {
            return { success: false, elementId: element.id, error: `Element "${element.id}" was not found in ${file}.` };
        }
        const updated = applyCuts(source, cuts);
        if (endpoint.test(updated)) {
            return { success: false, elementId: element.id, error: `${file} would still reference "${element.id}" after deletion.` };
        }
        const reparsed = await parseText(updated);
        if (reparsed.errors.length) {
            return { success: false, elementId: element.id, error: `Deleting the element would leave ${file} invalid (${reparsed.errors[0].message}).` };
        }
        prepared.set(file, { absolute, original: source, text: updated });
    }

    const written: Array<{ absolute: string; original: string }> = [];
    try {
        for (const preparedFile of prepared.values()) {
            atomicWrite(preparedFile.absolute, preparedFile.text);
            written.push(preparedFile);
        }
    } catch (error) {
        for (const file of written.reverse()) {
            try { atomicWrite(file.absolute, file.original); } catch { /* best-effort rollback */ }
        }
        return { success: false, elementId: element.id, error: `Could not delete the element: ${String(error)}` };
    }
    return {
        success: true,
        elementId: element.id,
        sourceFiles: [...prepared.keys()],
        removedRelationshipIds: connected.map(relationship => relationship.id),
    };
}
