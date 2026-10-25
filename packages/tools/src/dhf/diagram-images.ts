// ─── Diagram pictures in a generated document ────────────────────────────────
//
// `{{diagram:ref}}` compiles to a note (`diagramNote`). An exporter that has a renderer replaces the
// note by the picture of the view. MEMO Tools has no renderer of its own: the one that draws a view is
// the Architect canvas, so Architect supplies a `DiagramRenderer` and this module only places what it
// returns. Without one, or for a view it cannot draw, the note stays and the export says so.
// ─────────────────────────────────────────────────────────────────────────────

import { relative } from 'node:path';
import { diagramNoteRefs, replaceDiagramNotes } from './document-compiler.js';

/** A picture of one view, written under the renderer's output directory. */
export interface DiagramImage {
    /** Absolute path of the image file. */
    file: string;
}

/**
 * Draws views. `refs` are the `{{diagram:ref}}` texts of the documents; `outDir` is where the files go.
 * A ref it cannot draw is left out of `images` and named in `warnings`.
 */
export type DiagramRenderer = (refs: string[], outDir: string) => Promise<{ images: Record<string, DiagramImage>; warnings: string[] }>;

/** The pictures drawn so far in one export, so a view used by several documents is drawn once. */
export class DiagramPictures {
    private readonly drawn = new Map<string, DiagramImage | undefined>();
    readonly warnings: string[] = [];

    constructor(private readonly render: DiagramRenderer, private readonly outDir: string) {}

    /** `markdown` with each diagram note replaced by an image link relative to `documentDir`. */
    async embed(markdown: string, documentDir: string): Promise<string> {
        const wanted = diagramNoteRefs(markdown).filter(ref => !this.drawn.has(ref));
        if (wanted.length > 0) {
            try {
                const { images, warnings } = await this.render(wanted, this.outDir);
                for (const ref of wanted) this.drawn.set(ref, images[ref]);
                this.warnings.push(...warnings);
            } catch (error) {
                for (const ref of wanted) this.drawn.set(ref, undefined);
                this.warnings.push(`Diagrams were not drawn: ${error instanceof Error ? error.message : String(error)}`);
            }
        }
        return replaceDiagramNotes(markdown, ref => {
            const image = this.drawn.get(ref);
            if (!image) return undefined;
            return `![${ref}](${relative(documentDir, image.file).split('\\').join('/')})`;
        });
    }
}
