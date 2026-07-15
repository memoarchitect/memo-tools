// ─── Markdown → IR Tests ─────────────────────────────────────────────────────

import { describe, it, expect } from 'vitest';
import { markdownToDhfDocument, parseInlines } from '../dhf/markdown-to-ir.js';
import type { DhfTable, DhfList, DhfParagraph } from '../dhf/document-ir.js';

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
