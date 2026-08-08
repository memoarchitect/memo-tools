// ─── `memo-standards` blocks ──────────────────────────────────────────────────
//
// Renders the standards conformance report into a DHF document. A
// ```memo-standards``` block is not a query: `required(project)` is a
// computation over the clause library and the project's declared regimes, and
// no `memo-query` over the model can express it — the clauses a project has
// NOT claimed are, by definition, not in the model. That is precisely why the
// hand-written matrix this replaces could silently go empty.
//
//   ```memo-standards
//   display: checklist
//   standard: IEC 62304:2006+AMD1:2015
//   status: all
//   scope: required
//   empty: "IEC 62304 is not in the standards library."
//   ```
//
// ─── The empty-section decision (Phase 4) ────────────────────────────────────
//
// A clause with no claimants RENDERS, as a row with status `gap`. An empty
// "EMC Requirements" line is the gap evidence an auditor came for; hiding it
// would make an unstarted project and a complete one look alike, which is the
// failure this whole area exists to remove.
//
// So `empty:` never fires for unclaimed clauses. It fires only when the
// selection resolves to no clause at all — a `standard:` the library does not
// carry, or a `status:` filter that matches nothing. Those are different
// conditions with different fixes: one means "add the pack", the other means
// "nothing is in that state", and neither means "this project claims nothing".
// A block with no `empty:` says so in words rather than rendering a bare
// header.
// ─────────────────────────────────────────────────────────────────────────────

import * as yaml from 'yaml';
import type { QueryContext } from './query-engine.js';
import type { StandardsReport, StandardRow, ClauseRow, ClauseStatus } from './standards-report.js';
import { MemoQueryError } from './query-executor.js';

const STANDARDS_BLOCK_RE = /```memo-standards\n([\s\S]*?)```/g;

const KNOWN_KEYS = new Set(['display', 'standard', 'status', 'scope', 'empty']);
const KNOWN_DISPLAYS = new Set(['checklist', 'summary']);
const KNOWN_STATUSES = new Set(['all', 'gaps', 'claimed', 'evidenced']);
const KNOWN_SCOPES = new Set(['required', 'unrequired', 'all']);

export interface MemoStandardsSpec {
    /** `checklist` (per clause, the default) or `summary` (per standard). */
    display?: 'checklist' | 'summary';
    /** Designation substring. Absent selects every standard in scope. */
    standard?: string;
    /** Clause status filter. Default `all`. */
    status?: 'all' | 'gaps' | 'claimed' | 'evidenced';
    /**
     * Which standards to draw from. `required` (the default) is the ones a
     * declared regime pulls in; `unrequired` is the method and reference
     * standards no regime mandates, plus packs outside the declared regimes.
     */
    scope?: 'required' | 'unrequired' | 'all';
    /** Message when the SELECTION is empty — never when clauses are unclaimed. */
    empty?: string;
}

export function parseMemoStandards(blockContent: string): MemoStandardsSpec | null {
    try {
        const parsed = yaml.parse(blockContent);
        if (typeof parsed !== 'object' || parsed === null) return null;
        return parsed as MemoStandardsSpec;
    } catch {
        return null;
    }
}

/**
 * Reject a directive this renderer does not understand, in the same spirit as
 * `validateQuerySpec`: a misspelled key that is ignored produces a table that
 * looks authoritative and is not.
 */
export function validateStandardsSpec(spec: MemoStandardsSpec, source?: string): void {
    for (const key of Object.keys(spec)) {
        if (!KNOWN_KEYS.has(key)) {
            throw new MemoQueryError(
                `unknown directive "${key}" (known: ${[...KNOWN_KEYS].join(', ')})`, source);
        }
    }
    if (spec.display !== undefined && !KNOWN_DISPLAYS.has(spec.display)) {
        throw new MemoQueryError(
            `unknown display "${spec.display}" (known: ${[...KNOWN_DISPLAYS].join(', ')})`, source);
    }
    if (spec.status !== undefined && !KNOWN_STATUSES.has(spec.status)) {
        throw new MemoQueryError(
            `unknown status "${spec.status}" (known: ${[...KNOWN_STATUSES].join(', ')})`, source);
    }
    if (spec.scope !== undefined && !KNOWN_SCOPES.has(spec.scope)) {
        throw new MemoQueryError(
            `unknown scope "${spec.scope}" (known: ${[...KNOWN_SCOPES].join(', ')})`, source);
    }
}

// ─── Rendering ────────────────────────────────────────────────────────────────

const STATUS_LABEL: Record<ClauseStatus, string> = {
    evidenced: '✅ Evidenced',
    claimed: '🟡 Claimed',
    gap: '❌ Gap',
};

function selectStandards(report: StandardsReport, spec: MemoStandardsSpec): StandardRow[] {
    const pool = spec.scope === 'unrequired' ? report.unrequired
        : spec.scope === 'all' ? [...report.standards, ...report.unrequired]
        : report.standards;
    if (!spec.standard) return pool;
    const needle = spec.standard.toLowerCase();
    return pool.filter(s => s.designation.toLowerCase().includes(needle));
}

function selectClauses(row: StandardRow, spec: MemoStandardsSpec): ClauseRow[] {
    switch (spec.status ?? 'all') {
        case 'gaps': return row.clauses.filter(c => c.status === 'gap');
        case 'claimed': return row.clauses.filter(c => c.status !== 'gap');
        case 'evidenced': return row.clauses.filter(c => c.status === 'evidenced');
        default: return row.clauses;
    }
}

const escapeCell = (text: string): string => text.replace(/\|/g, '\\|');

/**
 * The claiming element, as a link where a link can actually resolve.
 *
 * A controlled document carries a `uri` (`dhf/documents/srs.md`), which is a
 * real relative target from a rendered DHF. A model element has no anchor in
 * this document, so it renders as its name and id instead of as a link that
 * would 404 in the exported DOCX. A broken link in an audit packet is worse
 * than a plain name.
 */
function claimCell(clause: ClauseRow, ctx: QueryContext): string {
    const parts: string[] = [];
    for (const claimant of clause.claimants) {
        const el = ctx.element(claimant.elementId);
        const uri = el?.attributes?.uri;
        parts.push(uri
            ? `[${claimant.name}](${uri})`
            : `**${claimant.name}** \`${claimant.elementId}\``);
    }
    for (const doc of clause.documents) {
        parts.push(`_${doc.documentTitle}_ \`${doc.documentId}\``);
    }
    return parts.length > 0 ? escapeCell(parts.join('<br>')) : '—';
}

function evidenceCell(clause: ClauseRow): string {
    if (clause.evidence.length === 0) return '—';
    const byCategory = new Map<string, string[]>();
    for (const e of clause.evidence) {
        const list = byCategory.get(e.category) ?? [];
        if (!list.includes(e.elementName)) list.push(e.elementName);
        byCategory.set(e.category, list);
    }
    return escapeCell([...byCategory.entries()]
        .map(([category, names]) => `${category}: ${names.join(', ')}`)
        .join('<br>'));
}

function renderChecklist(rows: StandardRow[], spec: MemoStandardsSpec, ctx: QueryContext): string {
    const out: string[] = [];
    for (const row of rows) {
        const clauses = selectClauses(row, spec);
        if (clauses.length === 0) continue;
        out.push(`\n**${row.designation}** — ${row.totals.clauses} clauses, `
            + `${row.totals.claimed} claimed, ${row.totals.evidenced} evidenced, `
            + `${row.required ? `${row.totals.gaps} gaps` : 'not required by the declared regimes'}\n`);
        out.push('| Clause | Scope | Status | Claimed by | Evidence |');
        out.push('| --- | --- | --- | --- | --- |');
        for (const clause of clauses) {
            out.push(`| §${clause.clauseNumber} | ${escapeCell(clause.title ?? '—')} `
                + `| ${STATUS_LABEL[clause.status]} | ${claimCell(clause, ctx)} | ${evidenceCell(clause)} |`);
        }
        out.push('');
    }
    return out.join('\n');
}

function renderSummary(rows: StandardRow[], spec: MemoStandardsSpec): string {
    const out = [
        '',
        '| Standard | Regimes | Clauses | Claimed | Evidenced | Gaps |',
        '| --- | --- | --- | --- | --- | --- |',
    ];
    for (const row of rows) {
        const clauses = selectClauses(row, spec);
        if (clauses.length === 0) continue;
        const regimes = row.regimes.length > 0 ? row.regimes.join(', ') : '_none_';
        out.push(`| ${escapeCell(row.designation)} | ${regimes} | ${row.totals.clauses} `
            + `| ${row.totals.claimed} | ${row.totals.evidenced} `
            + `| ${row.required ? row.totals.gaps : '—'} |`);
    }
    out.push('');
    return out.join('\n');
}

export function renderStandardsBlock(
    spec: MemoStandardsSpec,
    report: StandardsReport,
    ctx: QueryContext,
): string {
    const rows = selectStandards(report, spec);
    const anyClause = rows.some(row => selectClauses(row, spec).length > 0);
    if (!anyClause) {
        // Not "nothing is claimed" — nothing was SELECTED. See the header.
        return `\n_${spec.empty ?? (spec.standard
            ? `No standard matching "${spec.standard}" is in the clause library.`
            : spec.scope === 'unrequired'
                ? 'Every standard in the library is required by the declared regimes.'
                : 'No standards are in scope for the declared regimes.')}_\n`;
    }
    return (spec.display ?? 'checklist') === 'summary'
        ? renderSummary(rows, spec)
        : renderChecklist(rows, spec, ctx);
}

// ─── Block processing ─────────────────────────────────────────────────────────

export interface ProcessStandardsOptions {
    source?: string;
    onError?: 'throw' | 'annotate';
}

/**
 * Replace every ```memo-standards``` block with the rendered report.
 *
 * When the caller supplied no report — an Architect preview, a compile with no
 * model — the block says so in the document. It never renders an empty table:
 * "this project claims no clauses" and "the report was not computed" are
 * different statements, and only one of them is an audit finding.
 */
export function processMemoStandardsBlocks(
    content: string,
    ctx: QueryContext,
    options: ProcessStandardsOptions = {},
): string {
    const { source, onError = 'throw' } = options;
    let blockIndex = 0;

    return content.replace(STANDARDS_BLOCK_RE, (_match, blockContent: string) => {
        blockIndex++;
        const where = source
            ? `${source} (memo-standards block ${blockIndex})`
            : `memo-standards block ${blockIndex}`;

        const spec = parseMemoStandards(blockContent);
        if (!spec) {
            if (onError === 'throw') throw new MemoQueryError('block is not valid YAML', where);
            return `\n> ⚠️ **${where}** — block is not valid YAML\n`;
        }

        try {
            validateStandardsSpec(spec, where);
            if (!ctx.standardsReport) {
                return '\n> ⚠️ **Standards report not available in this view.** '
                    + 'Run `memo standards check` or export the DHF from the CLI to render clause coverage.\n';
            }
            return renderStandardsBlock(spec, ctx.standardsReport, ctx);
        } catch (error) {
            if (onError === 'throw') throw error;
            const message = error instanceof Error ? error.message : String(error);
            return `\n> ⚠️ **${message}**\n`;
        }
    });
}
