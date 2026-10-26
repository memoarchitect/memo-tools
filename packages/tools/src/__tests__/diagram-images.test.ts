import { describe, expect, it } from 'vitest';
import { DiagramPictures, diagramNote, diagramNoteRefs, replaceDiagramNotes, type DiagramRenderer, type DiagramSource } from '../dhf/index.js';

const source = { projectRoot: '/p', model: { elements: [] }, validation: {}, completeness: {} } as unknown as DiagramSource;
const doc = `# SAD\n\nIntro.${diagramNote('driveOverview')}Between.${diagramNote('servicingFlow')}End.${diagramNote('driveOverview')}`;

describe('a diagram reference in a generated document', () => {
    it('is found once per view, in order, and replaced by what the caller returns', () => {
        expect(diagramNoteRefs(doc)).toEqual(['driveOverview', 'servicingFlow']);
        const out = replaceDiagramNotes(doc, ref => (ref === 'servicingFlow' ? '![flow](f.svg)' : undefined));
        expect(out).toContain('![flow](f.svg)');
        expect(out).toContain('[Diagram: driveOverview]');
        expect(diagramNoteRefs(out)).toEqual(['driveOverview']);
    });

    it('draws each view once across documents, links relative to the document, and keeps the note for a view it could not draw', async () => {
        const asked: string[][] = [];
        const sources: DiagramSource[] = [];
        const render: DiagramRenderer = async (refs, outDir, given) => {
            asked.push(refs);
            sources.push(given);
            return {
                images: Object.fromEntries(refs.filter(r => r !== 'servicingFlow').map(r => [r, { file: `${outDir}/${r}.svg` }])),
                warnings: refs.includes('servicingFlow') ? ['servicingFlow has no stored layout'] : [],
            };
        };
        const pictures = new DiagramPictures(render, '/out/diagrams', source);
        const first = await pictures.embed(doc, '/out/system');
        const second = await pictures.embed(doc, '/out/risk');
        expect(first).toContain('![driveOverview](../diagrams/driveOverview.svg)');
        expect(first).toContain('[Diagram: servicingFlow]');
        expect(second).toContain('![driveOverview](../diagrams/driveOverview.svg)');
        expect(asked).toEqual([['driveOverview', 'servicingFlow']]);
        // The renderer draws the model the document was written from, not what the working directory holds.
        expect(sources).toEqual([source]);
        expect(pictures.warnings).toEqual(['servicingFlow has no stored layout']);
    });

    it('keeps every note, and says why, when the renderer fails', async () => {
        const pictures = new DiagramPictures(async () => { throw new Error('no browser'); }, '/out/diagrams', source);
        const out = await pictures.embed(doc, '/out/system');
        expect(diagramNoteRefs(out)).toEqual(['driveOverview', 'servicingFlow']);
        expect(pictures.warnings).toEqual(['Diagrams were not drawn: no browser']);
    });
});
