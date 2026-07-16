// ─── DHF Export Plugin Interface ─────────────────────────────────────────────
//
// Plugin interface for rendering Document IR to output formats.
// Built-in: HTML, Markdown, DOCX. PDF via optional puppeteer.
// ─────────────────────────────────────────────────────────────────────────────

import type { DhfDocument } from './document-ir.js';

/** Export format identifier */
export type DhfExportFormat = 'html' | 'md' | 'docx' | 'pdf';

/** Result of an export operation */
export interface DhfExportResult {
    format: DhfExportFormat;
    /** File content (string for text formats, Buffer for binary) */
    content: string | Buffer;
    /** Suggested file extension */
    extension: string;
    /** MIME type */
    mimeType: string;
}

/** Export plugin interface */
export interface DhfExportPlugin {
    format: DhfExportFormat;
    extension: string;
    mimeType: string;
    render(doc: DhfDocument): Promise<DhfExportResult>;
}

/** Registry of available export plugins */
const plugins = new Map<DhfExportFormat, DhfExportPlugin>();

export function registerPlugin(plugin: DhfExportPlugin): void {
    plugins.set(plugin.format, plugin);
}

export function getPlugin(format: DhfExportFormat): DhfExportPlugin | undefined {
    return plugins.get(format);
}

export function getAvailableFormats(): DhfExportFormat[] {
    return Array.from(plugins.keys());
}

// ─── Register built-in plugins on import ─────────────────────────────────────
import { HtmlExportPlugin } from './exporters/html-exporter.js';
import { MarkdownExportPlugin } from './exporters/markdown-exporter.js';
import { DocxExportPlugin } from './exporters/docx-exporter.js';

registerPlugin(new HtmlExportPlugin());
registerPlugin(new MarkdownExportPlugin());
registerPlugin(new DocxExportPlugin());
