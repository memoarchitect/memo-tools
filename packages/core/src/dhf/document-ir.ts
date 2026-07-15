// ─── DHF Document IR (Intermediate Representation) ──────────────────────────
//
// Format-agnostic AST for DHF documents. Templates compile to this IR,
// then export plugins render it to HTML, DOCX, PDF, or Markdown.
// ─────────────────────────────────────────────────────────────────────────────

/** Inline text with optional formatting */
export interface DhfText {
    type: 'text';
    value: string;
    bold?: boolean;
    italic?: boolean;
    code?: boolean;
    /** For redline: 'added' | 'removed' | undefined */
    change?: 'added' | 'removed';
}

/** A cross-reference to a model element */
export interface DhfXref {
    type: 'xref';
    elementId: string;
    label: string;
    kind?: string;
}

/** An inline badge (status indicator) */
export interface DhfInlineBadge {
    type: 'badge';
    label: string;
    variant: 'success' | 'warning' | 'error' | 'info' | 'neutral';
}

/** Inline content */
export type DhfInline = DhfText | DhfXref | DhfInlineBadge;

/** A table cell */
export interface DhfCell {
    content: DhfInline[];
    header?: boolean;
    colSpan?: number;
    rowSpan?: number;
    /** For redline rows */
    change?: 'added' | 'removed';
}

/** A table row */
export interface DhfRow {
    cells: DhfCell[];
    change?: 'added' | 'removed';
}

/** A paragraph block */
export interface DhfParagraph {
    type: 'paragraph';
    content: DhfInline[];
    change?: 'added' | 'removed';
}

/** A heading block */
export interface DhfHeading {
    type: 'heading';
    level: 1 | 2 | 3 | 4;
    text: string;
    id?: string;
}

/** A table block */
export interface DhfTable {
    type: 'table';
    headers: DhfCell[];
    rows: DhfRow[];
    caption?: string;
}

/** A list block */
export interface DhfList {
    type: 'list';
    ordered: boolean;
    items: DhfInline[][];
}

/** A status badge (for gap/coverage indicators) */
export interface DhfBadge {
    type: 'badge';
    label: string;
    variant: 'success' | 'warning' | 'error' | 'info' | 'neutral';
}

/** A metric card (for summary dashboards) */
export interface DhfMetric {
    type: 'metric';
    label: string;
    value: string | number;
    unit?: string;
    variant?: 'success' | 'warning' | 'error' | 'neutral';
}

/** A metric group */
export interface DhfMetricGroup {
    type: 'metric-group';
    metrics: DhfMetric[];
}

/** A progress bar */
export interface DhfProgress {
    type: 'progress';
    label: string;
    value: number;
    max: number;
    color?: string;
}

/** A horizontal rule / section break */
export interface DhfDivider {
    type: 'divider';
}

/** All block-level IR nodes */
export type DhfBlock =
    | DhfParagraph
    | DhfHeading
    | DhfTable
    | DhfList
    | DhfBadge
    | DhfMetric
    | DhfMetricGroup
    | DhfProgress
    | DhfDivider;

/** A section in a DHF document */
export interface DhfDocumentSection {
    id: string;
    title: string;
    blocks: DhfBlock[];
    /** Number of model elements referenced in this section */
    elementCount?: number;
    /** Number of gaps (missing traces/violations) in this section */
    gapCount?: number;
    /** Section status derived from gap analysis */
    status?: 'complete' | 'partial' | 'empty';
}

/** Frontmatter metadata for a DHF document */
export interface DhfFrontmatter {
    /** Document type ID (from registry) */
    documentId: string;
    /** Document title */
    title: string;
    /** Document version */
    version?: string;
    /** Applicable standards */
    standards?: string[];
    /** Organization name */
    organization?: string;
    /** Project name */
    project?: string;
    /** Document phase */
    phase?: string;
    /** Author(s) */
    authors?: string[];
    /** Approvers */
    approvers?: { name: string; role: string; date?: string }[];
    /** Generation timestamp */
    generatedAt: string;
    /** Custom metadata */
    custom?: Record<string, string>;
}

/** A complete DHF document in IR form */
export interface DhfDocument {
    frontmatter: DhfFrontmatter;
    sections: DhfDocumentSection[];
    /** Overall document status */
    status: 'complete' | 'partial' | 'empty';
    /** Total model elements referenced */
    totalElements: number;
    /** Total gaps found */
    totalGaps: number;
}

// ─── IR Builder Helpers ──────────────────────────────────────────────────────

export function text(value: string, opts?: { bold?: boolean; italic?: boolean; code?: boolean; change?: 'added' | 'removed' }): DhfText {
    return { type: 'text', value, ...opts };
}

export function xref(elementId: string, label: string, kind?: string): DhfXref {
    return { type: 'xref', elementId, label, kind };
}

export function heading(level: 1 | 2 | 3 | 4, title: string, id?: string): DhfHeading {
    return { type: 'heading', level, text: title, id };
}

export function paragraph(...content: DhfInline[]): DhfParagraph {
    return { type: 'paragraph', content };
}

export function table(headers: string[], rows: DhfInline[][][], caption?: string): DhfTable {
    return {
        type: 'table',
        headers: headers.map(h => ({ content: [text(h)], header: true })),
        rows: rows.map(cells => ({
            cells: cells.map(content => ({ content })),
        })),
        caption,
    };
}

export function list(items: DhfInline[][], ordered = false): DhfList {
    return { type: 'list', ordered, items };
}

export function badge(label: string, variant: DhfBadge['variant']): DhfInlineBadge {
    return { type: 'badge', label, variant };
}

export function metric(label: string, value: string | number, opts?: { unit?: string; variant?: DhfMetric['variant'] }): DhfMetric {
    return { type: 'metric', label, value, ...opts };
}

export function metricGroup(...metrics: DhfMetric[]): DhfMetricGroup {
    return { type: 'metric-group', metrics };
}

export function progress(label: string, value: number, max: number, color?: string): DhfProgress {
    return { type: 'progress', label, value, max, color };
}

export function divider(): DhfDivider {
    return { type: 'divider' };
}
