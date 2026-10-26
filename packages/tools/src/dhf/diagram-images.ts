// ─── Diagram pictures in a generated document ────────────────────────────────
//
// `{{diagram:ref}}` compiles to a note (`diagramNote`). An exporter that has a renderer replaces the
// note by the picture of the view. MEMO Tools has no renderer of its own: the one that draws a view is
// the Architect canvas, so Architect supplies a `DiagramRenderer` and this module only places what it
// returns. Without one, or for a view it cannot draw, the note stays and the export says so.
// ─────────────────────────────────────────────────────────────────────────────

import { existsSync, readFileSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import type { DhfDocument } from './document-ir.js';
import { diagramNoteRefs, replaceDiagramNotes } from './document-compiler.js';
import type { MemoModelDTO } from '../model/semantic.js';
import type { CompletenessReport, ValidationResult } from '../validator/types.js';

/**
 * What the renderer draws: the model the document was written from, not whatever the working directory holds.
 * A pinned release hands over its own commit's project (where its authored layouts are) and the model narrowed
 * to the variants it builds, so a picture shows what the document's text describes.
 */
export interface DiagramSource {
    projectRoot: string;
    model: MemoModelDTO;
    validation: ValidationResult;
    completeness: CompletenessReport;
}

/** A picture of one view, written under the renderer's output directory. */
export interface DiagramImage {
    /** Absolute path of the SVG file. */
    file: string;
    /** Absolute path of the same picture as PNG, for a format that cannot hold SVG (Word). */
    png?: string;
}

/**
 * Draws views. `refs` are the `{{diagram:ref}}` texts of the documents; `outDir` is where the files go.
 * A ref it cannot draw is left out of `images` and named in `warnings`.
 */
export type DiagramRenderer = (refs: string[], outDir: string, source: DiagramSource) => Promise<{ images: Record<string, DiagramImage>; warnings: string[] }>;

/** The pictures drawn so far in one export, so a view used by several documents is drawn once. */
export class DiagramPictures {
    private readonly drawn = new Map<string, DiagramImage | undefined>();
    readonly warnings: string[] = [];

    constructor(private readonly render: DiagramRenderer, private readonly outDir: string, private readonly source: DiagramSource) {}

    /**
     * `markdown` with each diagram note replaced by an image link relative to `documentDir`: the SVG, or the PNG for a
     * format that cannot hold SVG. A view with no picture in the wanted form keeps its note.
     */
    async embed(markdown: string, documentDir: string, form: 'svg' | 'png' = 'svg'): Promise<string> {
        const wanted = diagramNoteRefs(markdown).filter(ref => !this.drawn.has(ref));
        if (wanted.length > 0) {
            try {
                const { images, warnings } = await this.render(wanted, this.outDir, this.source);
                for (const ref of wanted) this.drawn.set(ref, images[ref]);
                this.warnings.push(...warnings);
            } catch (error) {
                for (const ref of wanted) this.drawn.set(ref, undefined);
                this.warnings.push(`Diagrams were not drawn: ${error instanceof Error ? error.message : String(error)}`);
            }
        }
        return replaceDiagramNotes(markdown, ref => {
            const image = this.drawn.get(ref);
            const file = form === 'png' ? image?.png : image?.file;
            if (!file) return undefined;
            return `![${ref}](${relative(documentDir, file).split('\\').join('/')})`;
        });
    }
}

/**
 * Give each PNG image block its bytes and pixel size, read from `documentDir`, so an exporter that must carry the
 * picture itself (Word) can. The size is the PNG's own (its IHDR chunk); a file that is missing or is not a PNG is
 * left as a link.
 */
export function attachImageData(doc: DhfDocument, documentDir: string): void {
    for (const section of doc.sections) {
        for (const block of section.blocks) {
            if (block.type !== 'image' || !/\.png$/i.test(block.src)) continue;
            const path = resolve(documentDir, block.src);
            if (!existsSync(path)) continue;
            const bytes = readFileSync(path);
            const isPng = bytes.length > 24 && bytes.readUInt32BE(0) === 0x89504e47;
            if (!isPng) continue;
            block.data = { mime: 'image/png', base64: bytes.toString('base64'), width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
        }
    }
}
