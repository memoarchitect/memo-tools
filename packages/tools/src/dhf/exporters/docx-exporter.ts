// ─── DHF DOCX Exporter ───────────────────────────────────────────────────────
//
// Renders Document IR to a real .docx file. The document itself is built in `docx-document.ts`, which the browser
// shares.
// ─────────────────────────────────────────────────────────────────────────────

import type { DhfExportPlugin, DhfExportResult } from '../export-plugin.js';
import type { DhfDocument } from '../document-ir.js';
import { docxToBytes } from './docx-document.js';

export class DocxExportPlugin implements DhfExportPlugin {
    format = 'docx' as const;
    extension = '.docx';
    mimeType = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

    async render(doc: DhfDocument): Promise<DhfExportResult> {
        return {
            format: 'docx',
            content: Buffer.from(await docxToBytes(doc)),
            extension: '.docx',
            mimeType: this.mimeType,
        };
    }
}
