// ─── Markdown → Document IR ──────────────────────────────────────────────────
//
// Converts compiled DHF markdown (queries and directives already resolved by
// document-compiler) into the format-agnostic Document IR, so the existing
// export plugins (HTML, DOCX, Markdown) can render workbench documents and
// V2-pipeline documents alike.
//
// Handles the markdown subset the templates and query renderer emit:
// headings, pipe tables, lists, blockquotes, code fences, dividers, and
// paragraphs with bold/italic/code inline formatting.
// ─────────────────────────────────────────────────────────────────────────────

import type {
    DhfDocument, DhfDocumentSection, DhfBlock, DhfInline, DhfCell, DhfRow,
} from './document-ir.js';

export interface MarkdownDocMeta {
    documentId: string;
    title?: string;
    project?: string;
    organization?: string;
    version?: string;
    standards?: string[];
    authors?: string[];
}

const FRONTMATTER_RE = /^---\r?\n[\s\S]*?\r?\n---\r?\n?/;
const TABLE_SEPARATOR_RE = /^\|\s*:?-{2,}.*\|$/;

// ─── Inline parsing ──────────────────────────────────────────────────────────

/** Parse bold, italic, and code spans into DhfInline runs */
export function parseInlines(text: string): DhfInline[] {
    const out: DhfInline[] = [];
    // Tokenize on formatting delimiters; longest markers first
    const re = /(\*\*\*.+?\*\*\*|\*\*.+?\*\*|\*[^*]+\*|_[^_]+_|`[^`]+`)/g;
    let last = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
        if (m.index > last) out.push({ type: 'text', value: text.slice(last, m.index) });
        const tok = m[0];
        if (tok.startsWith('***')) out.push({ type: 'text', value: tok.slice(3, -3), bold: true, italic: true });
        else if (tok.startsWith('**')) out.push({ type: 'text', value: tok.slice(2, -2), bold: true });
        else if (tok.startsWith('`')) out.push({ type: 'text', value: tok.slice(1, -1), code: true });
        else out.push({ type: 'text', value: tok.slice(1, -1), italic: true });
        last = m.index + tok.length;
    }
    if (last < text.length) out.push({ type: 'text', value: text.slice(last) });
    return out.length > 0 ? out : [{ type: 'text', value: '' }];
}

// ─── Block parsing ───────────────────────────────────────────────────────────

function parseBlocks(lines: string[]): DhfBlock[] {
    const blocks: DhfBlock[] = [];
    let paragraph: string[] = [];
    const flush = () => {
        if (paragraph.length > 0) {
            blocks.push({ type: 'paragraph', content: parseInlines(paragraph.join(' ')) });
            paragraph = [];
        }
    };

    let i = 0;
    while (i < lines.length) {
        const trimmed = lines[i].trim();

        if (trimmed === '') { flush(); i++; continue; }

        // Sub-heading (### / ####) — sections themselves split at ##
        const heading = trimmed.match(/^(#{3,4})\s+(.+)$/);
        if (heading) {
            flush();
            blocks.push({ type: 'heading', level: heading[1].length as 3 | 4, text: heading[2].trim() });
            i++; continue;
        }

        // Divider
        if (/^(-{3,}|\*{3,})$/.test(trimmed)) { flush(); blocks.push({ type: 'divider' }); i++; continue; }

        // Code fence → monospace paragraph
        if (trimmed.startsWith('```')) {
            flush();
            const code: string[] = [];
            i++;
            while (i < lines.length && !lines[i].trim().startsWith('```')) { code.push(lines[i]); i++; }
            i++; // closing fence
            blocks.push({ type: 'paragraph', content: [{ type: 'text', value: code.join('\n'), code: true }] });
            continue;
        }

        // Blockquote → italic paragraph
        if (trimmed.startsWith('>')) {
            flush();
            const quote: string[] = [];
            while (i < lines.length && lines[i].trim().startsWith('>')) {
                quote.push(lines[i].trim().replace(/^>\s?/, ''));
                i++;
            }
            blocks.push({ type: 'paragraph', content: [{ type: 'text', value: quote.join(' '), italic: true }] });
            continue;
        }

        // Pipe table
        if (trimmed.startsWith('|') && trimmed.endsWith('|')) {
            flush();
            const raw: string[] = [];
            while (i < lines.length && lines[i].trim().startsWith('|') && lines[i].trim().endsWith('|')) {
                raw.push(lines[i].trim());
                i++;
            }
            const cellsOf = (row: string, header = false): DhfCell[] =>
                row.slice(1, -1).split('|').map(c => ({ content: parseInlines(c.trim()), header }));
            const hasHeader = raw.length > 1 && TABLE_SEPARATOR_RE.test(raw[1]);
            const bodyRows = (hasHeader ? raw.slice(2) : raw).filter(r => !TABLE_SEPARATOR_RE.test(r));
            blocks.push({
                type: 'table',
                headers: hasHeader ? cellsOf(raw[0], true) : [],
                rows: bodyRows.map((r): DhfRow => ({ cells: cellsOf(r) })),
            });
            continue;
        }

        // Lists
        const isUl = /^[-*]\s+/.test(trimmed);
        const isOl = /^\d+\.\s+/.test(trimmed);
        if (isUl || isOl) {
            flush();
            const itemRe = isUl ? /^[-*]\s+/ : /^\d+\.\s+/;
            const items: DhfInline[][] = [];
            while (i < lines.length && itemRe.test(lines[i].trim())) {
                items.push(parseInlines(lines[i].trim().replace(itemRe, '')));
                i++;
            }
            blocks.push({ type: 'list', ordered: isOl, items });
            continue;
        }

        paragraph.push(trimmed);
        i++;
    }
    flush();
    return blocks;
}

// ─── Entry point ─────────────────────────────────────────────────────────────

/**
 * Convert compiled markdown into a DhfDocument IR, sectioned at `##` headings.
 * Content before the first `##` becomes an untitled preamble section; a
 * leading `# Title` sets the document title unless meta.title is given.
 */
export function markdownToDhfDocument(markdown: string, meta: MarkdownDocMeta): DhfDocument {
    const body = markdown.replace(FRONTMATTER_RE, '');
    const lines = body.split(/\r?\n/);

    let title = meta.title ?? '';
    const sections: DhfDocumentSection[] = [];
    let current: { title: string; lines: string[] } = { title: '', lines: [] };
    let sectionIndex = 0;

    const pushCurrent = () => {
        const blocks = parseBlocks(current.lines);
        if (blocks.length > 0 || current.title) {
            sections.push({
                id: current.title
                    ? current.title.toLowerCase().replace(/[^\w\s-]/g, '').trim().replace(/\s+/g, '-')
                    : `section-${sectionIndex}`,
                title: current.title,
                blocks,
            });
            sectionIndex++;
        }
    };

    for (const line of lines) {
        const h1 = line.match(/^#\s+(.+)$/);
        if (h1 && !title) { title = h1[1].trim(); continue; }
        const h2 = line.match(/^##\s+(.+)$/);
        if (h2) {
            pushCurrent();
            current = { title: h2[1].trim(), lines: [] };
            continue;
        }
        current.lines.push(line);
    }
    pushCurrent();

    return {
        frontmatter: {
            documentId: meta.documentId,
            title: title || meta.documentId,
            project: meta.project,
            organization: meta.organization,
            version: meta.version,
            standards: meta.standards,
            authors: meta.authors,
            generatedAt: new Date().toISOString(),
        },
        sections,
        status: 'complete',
        totalElements: 0,
        totalGaps: 0,
    };
}
