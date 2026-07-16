// ─── DHF Draft Assistant Engine (M74) ────────────────────────────────────────
//
// Uses LLM to fill gap sections in DHF documents. Generates boilerplate
// regulatory text, risk descriptions, and verification rationale.
// Human reviews before export.
// ─────────────────────────────────────────────────────────────────────────────

import type { QueryContext } from '../dhf/query-engine.js';
import type { DhfDocumentType } from '../dhf/document-registry.js';
import type { DhfDocument, DhfDocumentSection, DhfBlock } from '../dhf/document-ir.js';
import { text, heading, paragraph, list, table, divider } from '../dhf/document-ir.js';
import type { LLMProvider, ChatMessage } from './llm-provider.js';
import { serializeModelContext } from './model-context.js';

/** Options for DHF draft generation */
export interface DraftOptions {
    /** Target document type */
    documentType: DhfDocumentType;
    /** Existing compiled document (if available) — used to identify gaps */
    existingDocument?: DhfDocument;
    /** Specific section IDs to draft (default: all gap sections) */
    targetSections?: string[];
}

/** Result of a DHF draft operation */
export interface DraftResult {
    /** The document with LLM-drafted content merged in */
    document: DhfDocument;
    /** Sections that were drafted by LLM */
    draftedSections: string[];
    /** Summary of what was generated */
    summary: string;
    usage?: {
        promptTokens: number;
        completionTokens: number;
        totalTokens: number;
    };
}

const SYSTEM_PROMPT = `You are MEMO DHF Draft Assistant, an expert in medical device regulatory documentation. You write professional, standards-compliant content for Design History File (DHF) documents.

You are given:
1. A document type with its sections and standards references
2. The current model data (elements, relationships, validation status)
3. Sections that need content

Guidelines:
- Write in formal technical English appropriate for regulatory submissions.
- Reference specific model elements by name when describing risks, requirements, or components.
- Follow the section structure provided — generate content for each requested section.
- For risk management (ISO 14971): include hazard identification, risk estimation, risk evaluation, and risk control descriptions.
- For design verification (IEC 62304): reference specific test cases and verification methods.
- For traceability: show requirement-to-design-to-verification chains.
- Mark any assumptions clearly with [ASSUMPTION: ...].
- Mark any placeholders that need human review with [REVIEW: ...].
- Keep content factual and based on the model data provided.

Format your response as sections separated by markers:

=== SECTION: <section_id> ===
<section content in plain text with markdown formatting>

Use markdown within sections:
- **bold** for emphasis
- Bullet lists for enumerations
- Tables for structured data (pipe format)`;

/**
 * Draft DHF document sections using LLM.
 */
export async function draftDocument(
    ctx: QueryContext,
    provider: LLMProvider,
    options: DraftOptions,
): Promise<DraftResult> {
    const { documentType, existingDocument, targetSections } = options;

    // Determine which sections need drafting
    const sectionsToFill = determineSectionsToFill(documentType, existingDocument, targetSections);

    if (sectionsToFill.length === 0) {
        return {
            document: existingDocument || createEmptyDocument(documentType),
            draftedSections: [],
            summary: 'No sections needed drafting — all sections already have content.',
        };
    }

    const modelContext = serializeModelContext(ctx, { includeGaps: true });

    // Build the prompt
    const sectionList = sectionsToFill
        .map(s => `- ${s.id}: ${s.title}${s.required ? ' (required)' : ''}`)
        .join('\n');

    const messages: ChatMessage[] = [
        { role: 'system', content: SYSTEM_PROMPT },
        {
            role: 'user',
            content: `Document: ${documentType.title}
Standards: ${documentType.standards.join(', ')}
Relevant kinds: ${documentType.relevantKinds.join(', ')}
Relevant relationships: ${documentType.relevantRelationships.join(', ')}

Sections to draft:
${sectionList}

Model context:
${modelContext}

Please draft content for each section listed above.`,
        },
    ];

    const result = await provider.complete({
        messages,
        temperature: 0.3,
        maxTokens: 8192,
    });

    // Parse drafted sections from response
    const draftedContent = parseDraftResponse(result.content);
    const draftedSectionIds: string[] = [];

    // Merge drafted content into the document
    const baseSections = existingDocument?.sections
        || documentType.sections.map(s => ({
            id: s.id,
            title: s.title,
            blocks: [] as DhfBlock[],
            status: 'empty' as const,
        }));

    const mergedSections: DhfDocumentSection[] = baseSections.map(section => {
        const draft = draftedContent.get(section.id);
        if (draft && (section.status === 'empty' || section.blocks.length === 0)) {
            draftedSectionIds.push(section.id);
            return {
                ...section,
                blocks: convertMarkdownToBlocks(draft, section.title),
                status: 'partial' as const,
                gapCount: 0,
            };
        }
        return section;
    });

    const doc: DhfDocument = {
        frontmatter: existingDocument?.frontmatter || {
            documentId: documentType.id,
            title: documentType.title,
            version: '1.0-DRAFT',
            standards: documentType.standards,
            project: ctx.projectName,
            generatedAt: new Date().toISOString(),
        },
        sections: mergedSections,
        status: 'partial',
        totalElements: ctx.totalElements(),
        totalGaps: 0,
    };

    return {
        document: doc,
        draftedSections: draftedSectionIds,
        summary: draftedSectionIds.length > 0
            ? `Drafted ${draftedSectionIds.length} section(s): ${draftedSectionIds.join(', ')}. Please review [REVIEW] and [ASSUMPTION] markers before finalizing.`
            : 'No sections were drafted.',
        usage: result.usage,
    };
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function determineSectionsToFill(
    docType: DhfDocumentType,
    existing?: DhfDocument,
    targetSections?: string[],
): Array<{ id: string; title: string; required: boolean }> {
    return docType.sections.filter(s => {
        // If specific sections requested, only include those
        if (targetSections?.length && !targetSections.includes(s.id)) return false;

        // If existing document, skip sections that already have content
        if (existing) {
            const existingSection = existing.sections.find(es => es.id === s.id);
            if (existingSection && existingSection.blocks.length > 0 && existingSection.status !== 'empty') {
                return false;
            }
        }

        return true;
    });
}

function createEmptyDocument(docType: DhfDocumentType): DhfDocument {
    return {
        frontmatter: {
            documentId: docType.id,
            title: docType.title,
            version: '1.0',
            standards: docType.standards,
            project: 'MEMO Project',
            generatedAt: new Date().toISOString(),
        },
        sections: docType.sections.map(s => ({
            id: s.id,
            title: s.title,
            blocks: [],
            status: 'empty' as const,
        })),
        status: 'empty',
        totalElements: 0,
        totalGaps: 0,
    };
}

/** Parse LLM response into section content map */
function parseDraftResponse(content: string): Map<string, string> {
    const sections = new Map<string, string>();
    const parts = content.split(/===\s*SECTION:\s*(\S+)\s*===/);

    // parts[0] is before first marker, then alternating id/content
    for (let i = 1; i < parts.length; i += 2) {
        const sectionId = parts[i].trim();
        const sectionContent = (parts[i + 1] || '').trim();
        if (sectionContent) {
            sections.set(sectionId, sectionContent);
        }
    }

    // If no section markers found, treat entire content as a single block
    if (sections.size === 0 && content.trim()) {
        sections.set('_fallback', content.trim());
    }

    return sections;
}

/** Convert simple markdown text into DhfBlock[] */
function convertMarkdownToBlocks(markdown: string, sectionTitle: string): DhfBlock[] {
    const blocks: DhfBlock[] = [];
    const lines = markdown.split('\n');

    let i = 0;
    while (i < lines.length) {
        const line = lines[i];

        // Skip empty lines
        if (!line.trim()) { i++; continue; }

        // Heading
        const headingMatch = line.match(/^(#{1,4})\s+(.+)/);
        if (headingMatch) {
            blocks.push(heading(headingMatch[1].length as 1 | 2 | 3 | 4, headingMatch[2].trim()));
            i++;
            continue;
        }

        // Table (pipe format) — collect consecutive pipe lines
        if (line.trim().startsWith('|')) {
            const tableLines: string[] = [];
            while (i < lines.length && lines[i].trim().startsWith('|')) {
                tableLines.push(lines[i]);
                i++;
            }
            const tableBlock = parseMarkdownTable(tableLines);
            if (tableBlock) blocks.push(tableBlock);
            continue;
        }

        // List item
        if (line.match(/^\s*[-*]\s+/)) {
            const listItems: string[] = [];
            while (i < lines.length && lines[i].match(/^\s*[-*]\s+/)) {
                listItems.push(lines[i].replace(/^\s*[-*]\s+/, ''));
                i++;
            }
            blocks.push(list(listItems.map(item => [text(item)])));
            continue;
        }

        // Numbered list
        if (line.match(/^\s*\d+\.\s+/)) {
            const listItems: string[] = [];
            while (i < lines.length && lines[i].match(/^\s*\d+\.\s+/)) {
                listItems.push(lines[i].replace(/^\s*\d+\.\s+/, ''));
                i++;
            }
            blocks.push(list(listItems.map(item => [text(item)]), true));
            continue;
        }

        // Horizontal rule
        if (line.match(/^---+\s*$/)) {
            blocks.push(divider());
            i++;
            continue;
        }

        // Regular paragraph — collect until empty line
        const paraLines: string[] = [];
        while (i < lines.length && lines[i].trim() && !lines[i].match(/^[#|]/) && !lines[i].match(/^\s*[-*]\s+/) && !lines[i].match(/^\s*\d+\.\s+/)) {
            paraLines.push(lines[i]);
            i++;
        }
        if (paraLines.length > 0) {
            const content = paraLines.join(' ');
            blocks.push(paragraph(...parseInlineFormatting(content)));
        }
    }

    return blocks;
}

/** Parse inline markdown formatting into DhfInline[] */
function parseInlineFormatting(content: string): Array<ReturnType<typeof text>> {
    // Simple: just return as plain text for now
    // Bold/italic parsing could be added later
    return [text(content)];
}

/** Parse markdown pipe table into DhfTable block */
function parseMarkdownTable(lines: string[]): DhfBlock | null {
    if (lines.length < 2) return null;

    const parseRow = (line: string) =>
        line.split('|').filter(c => c.trim()).map(c => c.trim());

    const headerCells = parseRow(lines[0]);
    // Skip separator line (---+)
    const dataLines = lines.slice(2).filter(l => !l.match(/^\s*\|[\s-|]+\|\s*$/));

    const rows = dataLines.map(line => {
        const cells = parseRow(line);
        return cells.map(c => [text(c)] as ReturnType<typeof text>[]);
    });

    return table(headerCells, rows);
}
