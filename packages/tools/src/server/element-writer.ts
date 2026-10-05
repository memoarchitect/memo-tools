import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, relative, resolve, sep } from 'node:path';
import type { MemoElement, MemoModelDTO } from '../model/semantic.js';
import type { OutlineSource } from '../authoring/outline-source.js';
import { outlineNodes, type OutlineNode } from '../authoring/source-outline.js';
import { shortNameOf } from '../model/element-index.js';

export interface ElementRemoveResult {
    success: boolean;
    elementId: string;
    sourceFiles?: string[];
    removedRelationshipIds?: string[];
    error?: string;
}

interface Cut { start: number; end: number }

const identifierPattern = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function relativeFile(projectRoot: string, file: string): string {
    return (relative(projectRoot, resolve(projectRoot, file))).replaceAll('\\', '/');
}

function projectFile(projectRoot: string, file: string): string | undefined {
    const absolute = resolve(projectRoot, file);
    const rel = relative(projectRoot, absolute);
    if (rel === '..' || rel.startsWith(`..${sep}`) || rel.startsWith('../') || rel.startsWith('..\\')) return undefined;
    return absolute;
}

/** Relationship statements a deletion may cut: they reference the element, they do not own it. */
const RELATIONSHIP_STATEMENTS = new Set([
    'ConnectionUsage', 'InterfaceUsage', 'AllocationUsage', 'FlowUsage', 'SuccessionFlowUsage',
    'SuccessionAsUsage', 'BindingConnectorAsUsage', 'Dependency',
]);

/** Whether a relationship statement names `name` at one of its ends. */
function namesEnd(text: string, name: string): boolean {
    const escaped = identifierPattern(name);
    return new RegExp(`(?:::>|\\b(?:connect|to|from|first|then|allocate|bind))\\s+${escaped}(?![A-Za-z0-9_])`).test(text);
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
    /** Outlines of the project's files, from the selected compiler. */
    outlines: OutlineSource,
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
    // A connection names an end by the element's declared name or by its
    // qualified id; either is a reference the deletion would leave dangling.
    const declaredName = shortNameOf(element.id);
    const endpoint = new RegExp(`::>\\s*(?:${identifierPattern(element.id)}|${identifierPattern(declaredName)})(?![A-Za-z0-9_-])`);
    const namedRelationships = new Set(connected.map(relationship => relationship.id));

    for (const file of files) {
        const absolute = projectFile(projectRoot, file);
        if (!absolute || !existsSync(absolute)) {
            return { success: false, elementId: element.id, error: `${file} is not a writable project file.` };
        }
        const source = readFileSync(absolute, 'utf8');
        let nodes: OutlineNode[];
        try {
            nodes = [...outlineNodes(await outlines.outline(relativeFile(projectRoot, file), source))];
        } catch (e) {
            return { success: false, elementId: element.id, error: `${file} cannot be edited: ${e instanceof Error ? e.message : String(e)}` };
        }
        const cuts: Cut[] = [];
        let found = false;
        for (const node of nodes) {
            const isRelationship = RELATIONSHIP_STATEMENTS.has(node.metaclass);
            // The element is the declaration its id names. A bare id, with no
            // namespace, is matched by its declared name.
            if (file === element.file && !isRelationship
                && (node.key === element.id || (!element.id.includes('::') && node.name === element.id))) {
                cuts.push(wholeLine(source, node.start, node.end));
                found = true;
                continue;
            }
            if (!isRelationship) continue;
            const text = source.slice(node.start, node.end);
            if (namedRelationships.has(node.key) || namesEnd(text, element.id) || namesEnd(text, declaredName)) {
                cuts.push(wholeLine(source, node.start, node.end));
            }
        }
        if (file === element.file && !found) {
            return { success: false, elementId: element.id, error: `Element "${element.id}" was not found in ${file}.` };
        }
        const updated = applyCuts(source, cuts);
        if (endpoint.test(updated)) {
            return { success: false, elementId: element.id, error: `${file} would still reference "${element.id}" after deletion.` };
        }
        prepared.set(file, { absolute, original: source, text: updated });
    }

    // The deletion is valid as a whole or not at all: one file's edit alone can
    // leave a reference to what another's removed.
    const edits = new Map([...prepared].map(([file, entry]) => [relativeFile(projectRoot, file), entry.text] as const));
    for (const file of prepared.keys()) {
        try {
            await outlines.verify(relativeFile(projectRoot, file), prepared.get(file)!.text, edits);
        } catch (e) {
            return { success: false, elementId: element.id, error: `Deleting the element would leave ${file} invalid (${e instanceof Error ? e.message : String(e)}).` };
        }
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
