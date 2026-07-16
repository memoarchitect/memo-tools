// ─── DHF DOCX Exporter ───────────────────────────────────────────────────────
//
// Renders Document IR to DOCX format. Uses a lightweight approach that
// generates the DOCX XML structure manually to avoid heavy dependencies.
// Falls back to Markdown if DOCX generation fails.
// ─────────────────────────────────────────────────────────────────────────────

import type { DhfExportPlugin, DhfExportResult } from '../export-plugin.js';
import type { DhfDocument, DhfBlock, DhfInline, DhfTable, DhfList } from '../document-ir.js';

export class DocxExportPlugin implements DhfExportPlugin {
    format = 'docx' as const;
    extension = '.docx';
    mimeType = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

    async render(doc: DhfDocument): Promise<DhfExportResult> {
        // Word-compatible HTML with MSO field codes (real TOC, page numbers).
        // The .doc extension opens directly in Word/LibreOffice/Pages — the
        // same approach pandoc and many eQMS tools use as a docx fallback.
        const html = renderWordCompatibleHtml(doc);
        return {
            format: 'docx',
            content: html,
            extension: '.doc',
            mimeType: 'application/msword',
        };
    }
}

/** Word field-code helper: renders an MSO field with a visible placeholder */
function msoField(code: string, placeholder: string): string {
    return `<!--[if supportFields]><span style="mso-element:field-begin"></span><span> ${code} </span><span style="mso-element:field-separator"></span><![endif]-->${placeholder}<!--[if supportFields]><span style="mso-element:field-end"></span><![endif]-->`;
}

/** Table-of-contents field — Word populates it on "Update Field" (F9) */
export function wordTocField(): string {
    return `<h2>Table of Contents</h2>\n<p>${msoField('TOC \\o "1-3" \\h \\z \\u',
        '<span style="color:#6B7280"><i>Right-click here and choose "Update Field" (or press F9) to generate the table of contents.</i></span>')}</p>`;
}

/** Footer with PAGE/NUMPAGES fields, referenced by the WordSection page setup */
export function wordPageFooter(): string {
    return `<div style="mso-element:footer" id="f1"><p class="MsoFooter" align="center" style="text-align:center">Page ${msoField('PAGE', '1')} of ${msoField('NUMPAGES', '1')}</p></div>`;
}

/** Page setup CSS enabling US Letter pages with the numbered footer */
export const WORD_SECTION_CSS = `
  @page WordSection1 { size: 8.5in 11.0in; margin: 1.0in; mso-header-margin: 0.5in; mso-footer-margin: 0.5in; mso-footer: f1; }
  div.WordSection1 { page: WordSection1; }
  p.MsoFooter { font-size: 9pt; color: #6B7280; }
`;

/** Generate Word-compatible HTML that can be opened by Word/LibreOffice */
function renderWordCompatibleHtml(doc: DhfDocument): string {
    const { frontmatter, sections } = doc;
    const date = new Date(frontmatter.generatedAt).toLocaleDateString('en-US', {
        year: 'numeric', month: 'long', day: 'numeric',
    });

    let html = `<html xmlns:o="urn:schemas-microsoft-com:office:office"
  xmlns:w="urn:schemas-microsoft-com:office:word"
  xmlns="http://www.w3.org/TR/REC-html40">
<head>
<meta charset="UTF-8">
<meta name="ProgId" content="Word.Document">
<meta name="Generator" content="MEMO Architect">
<style>
  body { font-family: Calibri, Arial, sans-serif; font-size: 11pt; line-height: 1.5; margin: 2.54cm; }
  h1 { font-size: 18pt; font-weight: bold; color: #1B3A4B; border-bottom: 2pt solid #2DD4A8; padding-bottom: 6pt; }
  h2 { font-size: 14pt; font-weight: bold; color: #1B3A4B; margin-top: 18pt; border-bottom: 1pt solid #2DD4A8; padding-bottom: 4pt; }
  h3 { font-size: 12pt; font-weight: bold; color: #374151; margin-top: 12pt; }
  table { border-collapse: collapse; width: 100%; margin: 8pt 0; font-size: 10pt; }
  th, td { border: 1pt solid #d1d5db; padding: 4pt 8pt; text-align: left; }
  th { background: #f3f4f6; font-weight: bold; }
  .badge { font-weight: bold; font-size: 9pt; padding: 1pt 4pt; }
  .badge-success { color: #059669; background: #ecfdf5; }
  .badge-warning { color: #d97706; background: #fffbeb; }
  .badge-error { color: #dc2626; background: #fef2f2; }
  .badge-info { color: #2563eb; background: #eff6ff; }
  .metric-group { display: flex; gap: 16pt; margin: 8pt 0; }
  .metric { text-align: center; padding: 8pt; border: 1pt solid #e5e7eb; }
  .metric-value { font-size: 18pt; font-weight: bold; }
  .metric-label { font-size: 9pt; color: #6B7280; }
  ins { background: #dcfce7; color: #166534; text-decoration: none; }
  del { background: #fef2f2; color: #991b1b; }
  .footer { margin-top: 24pt; border-top: 1pt solid #e5e7eb; padding-top: 8pt; font-size: 9pt; color: #9ca3af; }
${WORD_SECTION_CSS}
</style>
</head>
<body>
<div class="WordSection1">
<h1>${esc(frontmatter.title)}</h1>
<p><b>${esc(frontmatter.project || '')}</b>
${frontmatter.organization ? ` &mdash; ${esc(frontmatter.organization)}` : ''}
 &mdash; ${date}
${frontmatter.version ? ` &mdash; v${esc(frontmatter.version)}` : ''}</p>
${frontmatter.standards ? `<p><i>Standards: ${frontmatter.standards.map(esc).join(', ')}</i></p>` : ''}
${wordTocField()}
`;

    for (const section of sections) {
        html += `<h2>${esc(section.title)}</h2>\n`;
        for (const block of section.blocks) {
            html += renderBlock(block) + '\n';
        }
    }

    if (frontmatter.approvers && frontmatter.approvers.length > 0) {
        html += '<h2>Approvals</h2>\n<table><tr><th>Name</th><th>Role</th><th>Date</th><th>Signature</th></tr>\n';
        for (const a of frontmatter.approvers) {
            html += `<tr><td>${esc(a.name)}</td><td>${esc(a.role)}</td><td>${esc(a.date || '________')}</td><td>________________</td></tr>\n`;
        }
        html += '</table>\n';
    }

    html += `<div class="footer">Generated by MEMO Architect &mdash; ${esc(frontmatter.generatedAt)}</div>\n</div>\n${wordPageFooter()}\n</body>\n</html>`;
    return html;
}

function esc(s: string): string {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function renderBlock(block: DhfBlock): string {
    switch (block.type) {
        case 'heading': return `<h${block.level + 1}>${esc(block.text)}</h${block.level + 1}>`;
        case 'paragraph': return `<p>${block.content.map(renderInline).join('')}</p>`;
        case 'table': return renderTable(block);
        case 'list': return renderList(block);
        case 'badge': return `<span class="badge badge-${block.variant}">${esc(block.label)}</span>`;
        case 'metric': return `<p><b>${esc(block.label)}:</b> ${esc(String(block.value))}</p>`;
        case 'metric-group': return `<div class="metric-group">${block.metrics.map(m =>
            `<div class="metric"><div class="metric-value">${esc(String(m.value))}</div><div class="metric-label">${esc(m.label)}</div></div>`
        ).join('')}</div>`;
        case 'progress': {
            const pct = block.max > 0 ? Math.round(block.value / block.max * 100) : 0;
            return `<p><b>${esc(block.label)}:</b> ${block.value}/${block.max} (${pct}%)</p>`;
        }
        case 'divider': return '<hr>';
        default: return '';
    }
}

function renderInline(inline: DhfInline): string {
    if (inline.type === 'xref') return `<b>${esc(inline.label)}</b>`;
    if (inline.type === 'badge') return `<span class="badge badge-${inline.variant}">${esc(inline.label)}</span>`;
    let s = esc(inline.value);
    if (inline.code) s = `<code>${s}</code>`;
    if (inline.bold) s = `<b>${s}</b>`;
    if (inline.italic) s = `<i>${s}</i>`;
    if (inline.change === 'added') s = `<ins>${s}</ins>`;
    if (inline.change === 'removed') s = `<del>${s}</del>`;
    return s;
}

function renderTable(t: DhfTable): string {
    let html = '<table><tr>';
    for (const h of t.headers) html += `<th>${h.content.map(renderInline).join('')}</th>`;
    html += '</tr>';
    for (const row of t.rows) {
        html += '<tr>';
        for (const cell of row.cells) html += `<td>${cell.content.map(renderInline).join('')}</td>`;
        html += '</tr>';
    }
    return html + '</table>';
}

function renderList(l: DhfList): string {
    const tag = l.ordered ? 'ol' : 'ul';
    return `<${tag}>${l.items.map(item => `<li>${item.map(renderInline).join('')}</li>`).join('')}</${tag}>`;
}
