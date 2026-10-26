// ─── Markdown → IR Tests ─────────────────────────────────────────────────────

import { describe, it, expect } from 'vitest';
import { markdownToDhfDocument, parseInlines } from '../dhf/markdown-to-ir.js';
import type { DhfTable, DhfList, DhfParagraph, DhfImage } from '../dhf/document-ir.js';
import { getPlugin } from '../dhf/export-plugin.js';
import { fitToPage, WORD_TEXT_WIDTH_PX } from '../dhf/exporters/docx-exporter.js';

const SAMPLE = `---
id: DOC-X
---

# Software Architecture Description

Intro paragraph with **bold** and \`code\`.

## 1. Purpose

This defines the architecture.

## 2. System Overview

| name | kind |
| --- | --- |
| GPCA_Software | SoftwareSystem |

- first item
- second item

### 2.1 Detail

1. one
2. two
`;

describe('markdownToDhfDocument', () => {
    const doc = markdownToDhfDocument(SAMPLE, { documentId: 'DOC-X', project: 'GPCA' });

    it('takes the title from the leading # heading', () => {
        expect(doc.frontmatter.title).toBe('Software Architecture Description');
        expect(doc.frontmatter.documentId).toBe('DOC-X');
        expect(doc.frontmatter.project).toBe('GPCA');
    });

    it('sections at ## headings with a preamble section', () => {
        expect(doc.sections.map(s => s.title)).toEqual(['', '1. Purpose', '2. System Overview']);
    });

    it('parses pipe tables into header and rows', () => {
        const table = doc.sections[2].blocks.find(b => b.type === 'table') as DhfTable;
        expect(table.headers.map(c => (c.content[0] as any).value)).toEqual(['name', 'kind']);
        expect(table.rows).toHaveLength(1);
        expect((table.rows[0].cells[0].content[0] as any).value).toBe('GPCA_Software');
    });

    it('parses unordered and ordered lists', () => {
        const lists = doc.sections[2].blocks.filter(b => b.type === 'list') as DhfList[];
        expect(lists[0].ordered).toBe(false);
        expect(lists[0].items).toHaveLength(2);
        expect(lists[1].ordered).toBe(true);
    });

    it('keeps sub-headings as level-3 heading blocks', () => {
        const heading = doc.sections[2].blocks.find(b => b.type === 'heading') as any;
        expect(heading.level).toBe(3);
        expect(heading.text).toBe('2.1 Detail');
    });

    it('parses inline formatting in the preamble', () => {
        const para = doc.sections[0].blocks[0] as DhfParagraph;
        const bold = para.content.find(i => (i as any).bold) as any;
        const code = para.content.find(i => (i as any).code) as any;
        expect(bold.value).toBe('bold');
        expect(code.value).toBe('code');
    });
});

describe('parseInlines', () => {
    it('handles mixed markers', () => {
        const runs = parseInlines('a **b** *c* `d` e') as any[];
        expect(runs.map(r => r.value)).toEqual(['a ', 'b', ' ', 'c', ' ', 'd', ' e']);
        expect(runs[1].bold).toBe(true);
        expect(runs[3].italic).toBe(true);
        expect(runs[5].code).toBe(true);
    });
});

describe('a picture on a line of its own', () => {
    const doc = markdownToDhfDocument('# T\n\nBefore.\n\n![heater <IBD>](../diagrams/heater.svg)\n\nAfter.\n', { documentId: 'D', title: 'T' });
    const blocks = doc.sections.flatMap(section => section.blocks);

    it('is an image block, between the paragraphs it sits among', () => {
        const at = blocks.findIndex(b => b.type === 'image');
        expect(blocks.slice(at - 1, at + 2).map(b => b.type)).toEqual(['paragraph', 'image', 'paragraph']);
        expect(blocks[at] as DhfImage).toEqual({ type: 'image', alt: 'heater <IBD>', src: '../diagrams/heater.svg' });
    });

    it('reaches Markdown and HTML as a picture, and Word as a named file', async () => {
        const md = (await getPlugin('md')!.render(doc)).content as string;
        const html = (await getPlugin('html')!.render(doc)).content as string;
        expect(md).toContain('![heater <IBD>](../diagrams/heater.svg)');
        expect(html).toContain('<img src="../diagrams/heater.svg" alt="heater &lt;IBD&gt;">');
        const word = await getPlugin('docx')!.render(doc);
        expect(word.extension).toBe('.docx');
        // A real .docx is a zip: it opens with the "PK" signature, not with markup.
        expect(Buffer.from(word.content).subarray(0, 2).toString('latin1')).toBe('PK');
    });
});

describe('a picture in a Word file', () => {
    // A 1x1 PNG.
    const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

    it('is shown at the size it was drawn, and shrunk to fit the text width, never enlarged', () => {
        // The PNG is drawn at twice its shown size.
        expect(fitToPage(400, 200)).toEqual({ width: 200, height: 100 });
        const wide = fitToPage(3000, 1500);
        expect(wide).toEqual({ width: WORD_TEXT_WIDTH_PX, height: 312 });
        expect(fitToPage(40, 20)).toEqual({ width: 20, height: 10 });
    });

    it('is carried inside the .docx when it has bytes, and named when it has none', async () => {
        const withBytes = markdownToDhfDocument('# T\n\n![view](d/v.png)\n', { documentId: 'D', title: 'T' });
        const image = withBytes.sections.flatMap(s => s.blocks).find(b => b.type === 'image') as DhfImage;
        image.data = { mime: 'image/png', base64: PNG, width: 2, height: 2 };
        const plugin = getPlugin('docx')!;
        const embedded = Buffer.from((await plugin.render(withBytes)).content).toString('latin1');
        expect(embedded).toContain('word/media/');
        delete image.data;
        const named = Buffer.from((await plugin.render(withBytes)).content).toString('latin1');
        expect(named).not.toContain('word/media/');
    });
});
