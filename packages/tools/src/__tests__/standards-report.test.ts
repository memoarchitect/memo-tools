// The clause coverage report — required, claimed, evidenced — and the
// ```memo-standards``` block that renders it into a DHF document.
//
// What these tests hold: a clause nobody claims must show up as a row, not as
// an absence. The hand-written matrix this work replaces could go empty and
// still read as a clean audit; the whole point of generating it is that an
// unclaimed clause is visible. Several tests below exist only to pin that.

import { describe, it, expect } from 'vitest';
import { loadStandardsLibrary } from '../dhf/standards-library.js';
import {
    computeStandardsReport, filterStandardsReport, readDeclaredRegimes,
    collectDocumentClauses, byClauseNumber,
    type StandardsReport,
} from '../dhf/standards-report.js';
import { renderStandardsBlock, parseMemoStandards, validateStandardsSpec } from '../dhf/standards-block.js';
import { createQueryContext } from '../dhf/query-engine.js';
import type { MemoModel, MemoElement, MemoRelationship } from '../model/semantic.js';
import type { ValidationResult, CompletenessReport } from '../validator/types.js';

const library = loadStandardsLibrary();

// ─── A small hand-built project ───────────────────────────────────────────────

function element(id: string, kind: string, attributes: Record<string, string> = {}): MemoElement {
    return {
        id, name: id, kind, construct: 'part', layer: 'requirements',
        file: 'test.sysml', attributes,
    };
}

function relationship(type: string, sourceId: string, targetId: string): MemoRelationship {
    return {
        id: `${type}-${sourceId}-${targetId}`, type, sourceId, targetId,
        sourceEnd: 'source', targetEnd: 'target', file: 'test.sysml',
    };
}

function model(elements: MemoElement[], relationships: MemoRelationship[]): MemoModel {
    const byId = new Map(elements.map(e => [e.id, e]));
    const byKind = new Map<string, MemoElement[]>();
    for (const el of elements) {
        byKind.set(el.kind, [...(byKind.get(el.kind) ?? []), el]);
    }
    const byType = new Map<string, MemoRelationship[]>();
    const outgoing = new Map<string, MemoRelationship[]>();
    const incoming = new Map<string, MemoRelationship[]>();
    for (const rel of relationships) {
        byType.set(rel.type, [...(byType.get(rel.type) ?? []), rel]);
        outgoing.set(rel.sourceId, [...(outgoing.get(rel.sourceId) ?? []), rel]);
        incoming.set(rel.targetId, [...(incoming.get(rel.targetId) ?? []), rel]);
    }
    return {
        elements: byId, relationships, errors: [],
        elementsByKind: byKind, elementsByLayer: new Map(),
        relationshipsByType: byType, outgoing, incoming,
    };
}

/**
 * A requirement claiming IEC 62304 §5.2.2 with a verification case behind it,
 * a second claiming §5.3 with nothing behind it, and an approved document the
 * §5.2.2 clause traces to. Clause usage names come from the real pack, because
 * a ConformsTo edge addresses a clause by the name the library carries.
 */
function sampleProject(): MemoModel {
    return model(
        [
            element('reqLogging', 'Requirement'),
            element('reqArch', 'SoftwareComponent'),
            element('vcLogging', 'MemoVerificationCase'),
            // Use ControlledArtifact directly: without a kind registry the
            // anchor closure is the anchor types themselves, not their subtypes.
            // MarkdownDocumentSource is a subtype that only resolves when a
            // registry widens the closure — the `evidenceResolvable` flag
            // documents exactly this degradation. Use the anchor kind here so
            // the test is honest about the no-registry path it runs on.
            element('docSrs', 'ControlledArtifact', {
                approvalStatus: 'approved', uri: 'dhf/documents/srs.md',
            }),
        ],
        [
            relationship('conformsTo', 'reqLogging', 'iec62304Clause5_2_2'),
            relationship('conformsTo', 'reqArch', 'iec62304Clause5_3'),
            relationship('verifiedBy', 'reqLogging', 'vcLogging'),
            relationship('tracesToDocument', 'iec62304Clause5_2_2', 'docSrs'),
        ],
    );
}

const iec62304 = (report: StandardsReport) =>
    report.standards.find(s => s.designation === 'IEC 62304:2006+AMD1:2015')!;

const clause = (report: StandardsReport, number: string) =>
    iec62304(report).clauses.find(c => c.clauseNumber === number)!;

function reportFor(regimes: string[] = ['CE']): StandardsReport {
    return computeStandardsReport({ library, model: sampleProject(), regimes, regimeSource: 'project' });
}

// ─── required / claimed / evidenced ───────────────────────────────────────────

describe('the three sets', () => {
    it('requires every clause of a standard the declared regimes reach', () => {
        const report = reportFor(['CE']);
        expect(iec62304(report).required).toBe(true);
        expect(iec62304(report).totals.clauses).toBeGreaterThan(10);
    });

    it('renders an unclaimed clause as a gap row rather than omitting it', () => {
        // The Phase 4 decision, pinned. An unclaimed clause is the evidence an
        // auditor came for; a report that drops it makes an unstarted project
        // and a finished one look the same.
        const report = reportFor();
        const unclaimed = iec62304(report).clauses.filter(c => c.status === 'gap');
        expect(unclaimed.length).toBeGreaterThan(0);
        expect(iec62304(report).clauses).toHaveLength(iec62304(report).totals.clauses);
    });

    it('counts a ConformsTo edge as a claim', () => {
        expect(clause(reportFor(), '5.3').claimants.map(c => c.elementId)).toEqual(['reqArch']);
    });

    it('counts a claim with no evidence as claimed, not evidenced', () => {
        expect(clause(reportFor(), '5.3').status).toBe('claimed');
        expect(clause(reportFor(), '5.3').evidence).toEqual([]);
    });

    it('counts verification and approval reached from the claim as evidence', () => {
        const row = clause(reportFor(), '5.2.2');
        expect(row.status).toBe('evidenced');
        expect(row.evidence.map(e => e.category).sort()).toEqual(['approval', 'verification']);
    });

    it('does not count an unapproved controlled document as approval evidence', () => {
        // Evidence that has not been approved is exactly what an auditor is
        // looking for the absence of, so a draft must not read as evidenced.
        const draft = model(
            [
                element('reqLogging', 'Requirement'),
                element('docSrs', 'MarkdownDocumentSource', { approvalStatus: 'draft' }),
            ],
            [
                relationship('conformsTo', 'reqLogging', 'iec62304Clause5_2_2'),
                relationship('tracesToDocument', 'iec62304Clause5_2_2', 'docSrs'),
            ],
        );
        const report = computeStandardsReport({ library, model: draft, regimes: ['CE'] });
        expect(clause(report, '5.2.2').status).toBe('claimed');
    });

    it('counts a clause cited by a document that exists in the project', () => {
        const citations = collectDocumentClauses(
            [{ id: 'DOC-RMP-001', title: 'Risk Management Plan', templateId: 'iso-14971/rmp' }],
            library,
        );
        expect(citations).toEqual([{
            documentId: 'DOC-RMP-001', documentTitle: 'Risk Management Plan',
            designation: 'ISO 14971:2019', clauseNumber: '4.4',
        }]);

        const report = computeStandardsReport({
            library, model: sampleProject(), regimes: ['CE'], documentClauses: citations,
        });
        const iso14971 = report.standards.find(s => s.designation === 'ISO 14971:2019')!;
        expect(iso14971.clauses.find(c => c.clauseNumber === '4.4')?.status).toBe('claimed');
    });

    it('reports every clause as a gap when the project has no model', () => {
        const report = computeStandardsReport({ library, regimes: ['CE'] });
        expect(report.totals.claimed).toBe(0);
        expect(report.totals.gaps).toBe(report.totals.clauses);
    });
});

// ─── Regime scoping ───────────────────────────────────────────────────────────

describe('regime scoping', () => {
    it('pulls 21 CFR Part 820 into a 510(k) report and leaves it out of a CE one', () => {
        const ce = computeStandardsReport({ library, regimes: ['CE'] });
        const fda = computeStandardsReport({ library, regimes: ['FDA_510k'] });
        expect(ce.standards.map(s => s.designation)).not.toContain('21 CFR Part 820');
        expect(fda.standards.map(s => s.designation)).toContain('21 CFR Part 820');
        expect(fda.standards.map(s => s.designation)).not.toContain('ISO 13485:2016');
    });

    it('puts a standard no regime mandates outside the required set', () => {
        const report = computeStandardsReport({ library, regimes: ['CE'] });
        expect(report.unrequired.map(s => s.designation)).toContain('IEC 60812:2018');
        // …and never counts its clauses as gaps the project owes.
        expect(report.standards.map(s => s.designation)).not.toContain('IEC 60812:2018');
    });

    it('reports every regime-bearing standard when no regime is declared', () => {
        const report = computeStandardsReport({ library, regimes: [] });
        expect(report.regimeSource).toBe('none');
        expect(report.standards.length).toBe(library.standards.size - report.unrequired.length);
    });

    it('reads the project declaration only in its qualified spelling', () => {
        const declared = readDeclaredRegimes(model(
            [element('binding', 'ProjectMethodBinding', {
                regulatoryRegime: 'RegulatoryRegimeKind::CE, MDR, RegulatoryRegimeKind::FDA_510k',
            })],
            [],
        ));
        // `MDR` unqualified is not a synonym — one spelling, and the rejected
        // entry is reported rather than silently matched or silently dropped.
        expect(declared.regimes).toEqual(['CE', 'FDA_510k']);
        expect(declared.rejected).toEqual(['MDR']);
    });
});

// ─── Filtering ────────────────────────────────────────────────────────────────

describe('filtering', () => {
    it('makes the totals the totals of what it shows', () => {
        const gapsOnly = filterStandardsReport(reportFor(), { gapsOnly: true });
        expect(gapsOnly.totals.claimed).toBe(0);
        expect(gapsOnly.totals.clauses).toBe(gapsOnly.totals.gaps);
        for (const row of gapsOnly.standards) {
            expect(row.clauses.every(c => c.status === 'gap')).toBe(true);
        }
    });

    it('narrows to one standard by designation substring', () => {
        const narrowed = filterStandardsReport(reportFor(), { standard: '62304' });
        expect(narrowed.standards.map(s => s.designation)).toEqual(['IEC 62304:2006+AMD1:2015']);
    });
});

// ─── Clause ordering ──────────────────────────────────────────────────────────

describe('clause ordering', () => {
    it('puts §8 before §14', () => {
        // localeCompare ordered a rendered conformance matrix 10, 11, 14, 8, 9,
        // which reads as broken long before a reader works out why.
        const sorted = ['14', '8', '9', '10', '5.2.2', '5.2']
            .map(clauseNumber => ({ clauseNumber }))
            .sort(byClauseNumber)
            .map(c => c.clauseNumber);
        expect(sorted).toEqual(['5.2', '5.2.2', '8', '9', '10', '14']);
    });

    it('falls back to a string compare on a non-numeric segment', () => {
        const sorted = ['820.30(c)', '820.30', '820.20']
            .map(clauseNumber => ({ clauseNumber }))
            .sort(byClauseNumber)
            .map(c => c.clauseNumber);
        expect(sorted).toEqual(['820.20', '820.30', '820.30(c)']);
    });
});

// ─── The memo-standards block ─────────────────────────────────────────────────

const emptyValidation = { violations: [], passed: true } as unknown as ValidationResult;
const emptyCompleteness = { overall: 0, layers: [] } as unknown as CompletenessReport;

function contextFor(report: StandardsReport) {
    return createQueryContext(
        sampleProject(), emptyValidation, emptyCompleteness, { projectName: 'test' }, report,
    );
}

describe('memo-standards blocks', () => {
    it('renders a gap clause as a row, so `empty:` never speaks for it', () => {
        const report = reportFor();
        const rendered = renderStandardsBlock(
            { display: 'checklist', standard: '62304', empty: 'NOTHING SELECTED' },
            report, contextFor(report),
        );
        expect(rendered).toContain('❌ Gap');
        expect(rendered).not.toContain('NOTHING SELECTED');
    });

    it('uses `empty:` only when the selection itself resolves to nothing', () => {
        const report = reportFor();
        const rendered = renderStandardsBlock(
            { standard: 'ISO 9001', empty: 'NOTHING SELECTED' },
            report, contextFor(report),
        );
        expect(rendered).toContain('NOTHING SELECTED');
    });

    it('links a claiming element that has a resolvable uri and names one that does not', () => {
        const report = reportFor();
        const rendered = renderStandardsBlock(
            { display: 'checklist', standard: '62304' }, report, contextFor(report),
        );
        // A model element has no anchor in this document, so it renders as a
        // name and an id — a link that would 404 in the exported DOCX is worse
        // than no link at all.
        expect(rendered).toContain('**reqLogging** `reqLogging`');
    });

    it('shows no gap count for a standard no regime requires', () => {
        const report = reportFor();
        const rendered = renderStandardsBlock(
            { display: 'summary', scope: 'all' }, report, contextFor(report),
        );
        expect(rendered).toMatch(/IEC 60812:2018 \| _none_ \| \d+ \| \d+ \| \d+ \| — \|/);
    });

    it('says the report is unavailable rather than rendering an empty table', () => {
        const bare = createQueryContext(
            sampleProject(), emptyValidation, emptyCompleteness, { projectName: 'test' },
        );
        expect(bare.standardsReport).toBeUndefined();
    });

    it('rejects a directive it does not understand', () => {
        // A misspelled key that is ignored produces a table that looks
        // authoritative and is not — the same rule memo-query blocks carry.
        expect(() => validateStandardsSpec(parseMemoStandards('statuz: gaps')!))
            .toThrow(/unknown directive "statuz"/);
        expect(() => validateStandardsSpec(parseMemoStandards('status: unclaimed')!))
            .toThrow(/unknown status "unclaimed"/);
        expect(() => validateStandardsSpec(parseMemoStandards('scope: everything')!))
            .toThrow(/unknown scope "everything"/);
    });
});
