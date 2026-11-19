import type { SourceOutline } from '../authoring/source-outline.js';
import { insertIntoContainer } from './package-source.js';

/** Compute independent container insertions against one outline, then apply their ranges from the end. */
export function appendMembers(source: string, outline: SourceOutline, members: ReadonlyMap<string, string>): string | undefined {
    const edits: { start: number; end: number; text: string }[] = [];
    for (const [container, text] of members) {
        if (!text) continue;
        const proposed = insertIntoContainer(source, outline, container, text); if (proposed === undefined) return undefined;
        let start = 0; while (start < source.length && source[start] === proposed[start]) start++;
        let end = source.length, nextEnd = proposed.length;
        while (end > start && nextEnd > start && source[end - 1] === proposed[nextEnd - 1]) { end--; nextEnd--; }
        edits.push({ start, end, text: proposed.slice(start, nextEnd) });
    }
    return edits.sort((a, b) => b.start - a.start).reduce((text, edit) => text.slice(0, edit.start) + edit.text + text.slice(edit.end), source);
}
