// ─── Standards Conformance Report ─────────────────────────────────────────────
//
// One computation, three outputs. `memo standards check`, the shipped
// standards-checklist.md template, and the Architect's gap badges all call
// `computeStandardsReport` and render the same numbers. There is deliberately
// no second place that decides what a gap is.
//
//   required(project)   clauses of every standard whose appliesToRegime
//                       intersects the regimes the project declares
//   claimed(project)    clauses targeted by a ConformsTo, or cited in the
//                       frontmatter of a document that exists in the project
//   evidenced(project)  claimed, where the claim also reaches verification,
//                       risk-control or approval evidence
//
// ─── Where this must NOT live ────────────────────────────────────────────────
//
// Not in a consistency rule. `memo_rules_coverage` is a deliberately empty
// package whose header states the reason: regulatory coverage is
// project-profile dependent, and a universal per-element constraint would
// force every project to implement every standard pack. Coverage is a REPORT.
// A red rule says "this model is wrong"; a gap says "this project has not
// claimed that clause yet", which is the normal state of a project in flight.
//
// ─── Why the library, not the element index ──────────────────────────────────
//
// The clause instances are ontology content. A consuming project resolves the
// ontology as a library root and its own model therefore holds the clause
// *definitions* through the registries but not the clause *instances* as
// elements — so `required()` is computed from the standards library reader,
// which reads the packs off disk in both the ontology repo and a consumer.
// `claimed()` comes from the project's own ConformsTo edges, whose endpoints
// name clauses by usage name or `id`; both are indexed here so an edge
// resolves whether or not the clause is in the element map.
// ─────────────────────────────────────────────────────────────────────────────

import type { MemoModel, MemoElement } from '../model/semantic.js';
import type { KindRegistry } from '../model/kind-registry.js';
import type {
    StandardsLibrary, RegulatoryStandardInfo, StandardClauseInfo, UnknownRegimeCitation,
} from './standards-library.js';
import { resolveClause } from './standards-library.js';
import { loadTemplate, parseFrontmatter } from './template-resolver.js';

// ─── Evidence ─────────────────────────────────────────────────────────────────

/**
 * The three evidence categories, anchored on ontology TYPE names rather than
 * on relationship names.
 *
 * A claim is evidenced when the claiming element is linked — by any relation,
 * in either direction — to an element of one of these types. Anchoring on the
 * type means a new relation that reaches a verification case counts without a
 * change here, and every subtype counts too, because membership is resolved
 * through the kind registry's supertype closure rather than by name equality.
 *
 * These three names are the one thing this file states about the ontology.
 * They are the plan's own definition of `evidenced` — "verification /
 * risk-control / approval evidence" — and MEMO has no evidence-category
 * concept to read them from. If one is ever added, this map is what it
 * replaces.
 */
const EVIDENCE_ANCHORS: Record<EvidenceCategory, string[]> = {
    verification: ['MemoVerificationCase', 'MemoEvidence'],
    'risk-control': ['RiskControlMeasure'],
    approval: ['ControlledArtifact'],
};

export type EvidenceCategory = 'verification' | 'risk-control' | 'approval';

export interface EvidenceRef {
    category: EvidenceCategory;
    /** Element the evidence link reaches. */
    elementId: string;
    elementName: string;
    elementKind: string;
    /** Relationship type the link was made with, e.g. "verifiedBy". */
    via: string;
}

// ─── Inputs ───────────────────────────────────────────────────────────────────

/** One `clauses:` citation from a document that exists in the project. */
export interface DocumentClauseCitation {
    /** Document id as the project knows it, e.g. "DOC-RMP-001". */
    documentId: string;
    documentTitle: string;
    /** Resolved standard designation. */
    designation: string;
    clauseNumber: string;
}

export interface StandardsReportInput {
    library: StandardsLibrary;
    /** The project's model. Absent means nothing is claimed — every clause is a gap. */
    model?: MemoModel;
    /** Resolves supertypes so an evidence anchor matches its subtypes. */
    kindRegistry?: KindRegistry;
    /**
     * Regimes to scope `required()` to. Empty or absent means the project
     * declared none, and every standard the library carries is reported —
     * stated as such rather than silently assuming a market.
     */
    regimes?: string[];
    /** Where `regimes` came from, for the report header. */
    regimeSource?: RegimeSource;
    /** Clause citations from documents that exist in the project. */
    documentClauses?: DocumentClauseCitation[];
}

export type RegimeSource = 'project' | 'flag' | 'none';

// ─── Outputs ──────────────────────────────────────────────────────────────────

export type ClauseStatus = 'evidenced' | 'claimed' | 'gap';

export interface ClaimantRef {
    elementId: string;
    name: string;
    kind: string;
}

export interface ClauseRow {
    /** SysML usage name of the clause instance. */
    name: string;
    /** The `id` attribute, e.g. "STD-IEC-62304-5-2-2". */
    id?: string;
    clauseNumber: string;
    /** MEMO-authored scope phrase; absent where MEMO has no verified reading. */
    title?: string;
    normativeStrength?: string;
    status: ClauseStatus;
    /** Elements whose ConformsTo edge targets this clause. */
    claimants: ClaimantRef[];
    /** Documents whose frontmatter cites this clause. */
    documents: Array<{ documentId: string; documentTitle: string }>;
    evidence: EvidenceRef[];
}

export interface StandardTotals {
    clauses: number;
    claimed: number;
    evidenced: number;
    gaps: number;
}

export interface StandardRow {
    designation: string;
    edition?: string;
    issuer?: string;
    /** Regimes this standard has standing in. Empty = no regime mandates it. */
    regimes: string[];
    /**
     * True when a declared regime pulls this standard into `required()`.
     * False for a standard the project's regimes do not reach, and for a
     * method/reference standard no regime mandates — both are still reported,
     * because a project may legitimately claim clauses of either.
     */
    required: boolean;
    clauses: ClauseRow[];
    totals: StandardTotals;
}

export interface StandardsReport {
    /** Regimes the report was scoped to. */
    regimes: string[];
    regimeSource: RegimeSource;
    /** Every `RegulatoryRegimeKind` member, for a "did you mean" on a bad flag. */
    regimeVocabulary: string[];
    /** Standards a declared regime requires. */
    standards: StandardRow[];
    /**
     * Standards no declared regime requires: method and reference standards,
     * and packs outside the declared regimes. Reported separately rather than
     * dropped — a clause claimed here is still traceability, and a pack that
     * vanished from the output would look like a pack that does not exist.
     */
    unrequired: StandardRow[];
    /** Totals over `standards` only — the required set is what "gaps" means. */
    totals: StandardTotals;
    /** Defects in the packs themselves, surfaced rather than swallowed. */
    unknownRegimes: UnknownRegimeCitation[];
    orphanClauses: StandardClauseInfo[];
    /** True when the library could not be located at all. */
    libraryMissing: boolean;
    /**
     * False when no kind registry was available, so the evidence anchors could
     * not be widened to their subtypes.
     *
     * Without it a `MarkdownDocumentSource` is not recognised as a
     * `ControlledArtifact` and its approval does not count — the report
     * UNDER-states evidence. That is the safer direction to fail in, but it is
     * still a wrong number, so it is stated rather than left to be inferred
     * from a suspiciously low column.
     */
    evidenceResolvable: boolean;
}

// ─── Supertype closure ────────────────────────────────────────────────────────

/** Every kind that is, or specializes, one of `anchors`. */
function closureOf(anchors: string[], registry?: KindRegistry): Set<string> {
    const out = new Set<string>(anchors);
    if (!registry) return out;
    const stack = [...anchors];
    while (stack.length > 0) {
        const name = stack.pop()!;
        for (const derived of registry.getKind(name)?.derivedBy ?? []) {
            if (out.has(derived)) continue;
            out.add(derived);
            stack.push(derived);
        }
    }
    return out;
}

// ─── The computation ──────────────────────────────────────────────────────────

export function computeStandardsReport(input: StandardsReportInput): StandardsReport {
    const { library, model, kindRegistry, documentClauses = [] } = input;
    const regimes = input.regimes ?? [];
    const regimeSource = input.regimeSource ?? (regimes.length > 0 ? 'flag' : 'none');

    // ── Index every clause by both names an edge can address it with ────────
    const clauseByRef = new Map<string, { std: RegulatoryStandardInfo; clause: StandardClauseInfo }>();
    for (const std of library.standards.values()) {
        for (const clause of std.clauses.values()) {
            clauseByRef.set(clause.name, { std, clause });
            if (clause.id) clauseByRef.set(clause.id, { std, clause });
        }
    }

    // ── claimed(): ConformsTo edges ─────────────────────────────────────────
    /** clause usage name → claiming elements */
    const claimants = new Map<string, ClaimantRef[]>();
    for (const rel of model?.relationshipsByType.get('conformsTo') ?? []) {
        const hit = clauseByRef.get(rel.targetId);
        if (!hit) continue;
        const el = model?.elements.get(rel.sourceId);
        const list = claimants.get(hit.clause.name) ?? [];
        list.push({
            elementId: rel.sourceId,
            name: el?.name ?? rel.sourceId,
            kind: el?.kind ?? 'unknown',
        });
        claimants.set(hit.clause.name, list);
    }

    // ── claimed(): document frontmatter ─────────────────────────────────────
    const docsByClause = new Map<string, Array<{ documentId: string; documentTitle: string }>>();
    for (const cite of documentClauses) {
        const std = library.standards.get(cite.designation);
        const clause = std?.clauses.get(cite.clauseNumber);
        if (!clause) continue;
        const list = docsByClause.get(clause.name) ?? [];
        if (!list.some(d => d.documentId === cite.documentId)) {
            list.push({ documentId: cite.documentId, documentTitle: cite.documentTitle });
        }
        docsByClause.set(clause.name, list);
    }

    // ── evidenced(): what each element reaches ──────────────────────────────
    const anchorSets = new Map<EvidenceCategory, Set<string>>();
    for (const [category, anchors] of Object.entries(EVIDENCE_ANCHORS) as Array<[EvidenceCategory, string[]]>) {
        anchorSets.set(category, closureOf(anchors, kindRegistry));
    }

    const evidenceCache = new Map<string, EvidenceRef[]>();
    const evidenceFor = (elementId: string): EvidenceRef[] => {
        const cached = evidenceCache.get(elementId);
        if (cached) return cached;
        const found: EvidenceRef[] = [];
        if (model) {
            const links = [
                ...(model.outgoing.get(elementId) ?? []).map(r => ({ rel: r, otherId: r.targetId })),
                ...(model.incoming.get(elementId) ?? []).map(r => ({ rel: r, otherId: r.sourceId })),
            ];
            for (const { rel, otherId } of links) {
                const other = model.elements.get(otherId);
                if (!other) continue;
                for (const [category, kinds] of anchorSets) {
                    if (!kinds.has(other.kind)) continue;
                    // An unapproved controlled artifact is a document, not an
                    // approval. Evidence that has not been approved is exactly
                    // the thing an auditor is looking for the absence of.
                    if (category === 'approval' && !isApproved(other)) continue;
                    found.push({
                        category,
                        elementId: otherId,
                        elementName: other.name,
                        elementKind: other.kind,
                        via: rel.type,
                    });
                }
            }
        }
        evidenceCache.set(elementId, found);
        return found;
    };

    // ── Roll up per standard ────────────────────────────────────────────────
    const required: StandardRow[] = [];
    const unrequired: StandardRow[] = [];

    for (const std of [...library.standards.values()].sort((a, b) => a.designation.localeCompare(b.designation))) {
        const isRequired = regimes.length === 0
            ? std.regimes.length > 0
            : std.regimes.some(r => regimes.includes(r));

        const clauses: ClauseRow[] = [];
        for (const clause of [...std.clauses.values()].sort(byClauseNumber)) {
            const claimedBy = claimants.get(clause.name) ?? [];
            const documents = docsByClause.get(clause.name) ?? [];

            // Evidence attaches to the claiming element, and also to the
            // clause itself: gpca authors TracesToDocument from the clause to
            // the approved document, which is where a reviewer looks first.
            const evidence: EvidenceRef[] = [
                ...evidenceFor(clause.name),
                ...(clause.id ? evidenceFor(clause.id) : []),
                ...claimedBy.flatMap(c => evidenceFor(c.elementId)),
            ];

            const isClaimed = claimedBy.length > 0 || documents.length > 0;
            clauses.push({
                name: clause.name,
                id: clause.id,
                clauseNumber: clause.clauseNumber,
                title: clause.title,
                normativeStrength: clause.normativeStrength,
                status: !isClaimed ? 'gap' : evidence.length > 0 ? 'evidenced' : 'claimed',
                claimants: claimedBy,
                documents,
                evidence: dedupeEvidence(evidence),
            });
        }

        const row: StandardRow = {
            designation: std.designation,
            edition: std.edition,
            issuer: std.issuer,
            regimes: std.regimes,
            required: isRequired,
            clauses,
            totals: totalsOf(clauses),
        };
        (isRequired ? required : unrequired).push(row);
    }

    return {
        regimes,
        regimeSource,
        regimeVocabulary: library.regimeVocabulary,
        standards: required,
        unrequired,
        totals: required.reduce<StandardTotals>((acc, s) => ({
            clauses: acc.clauses + s.totals.clauses,
            claimed: acc.claimed + s.totals.claimed,
            evidenced: acc.evidenced + s.totals.evidenced,
            gaps: acc.gaps + s.totals.gaps,
        }), { clauses: 0, claimed: 0, evidenced: 0, gaps: 0 }),
        unknownRegimes: library.unknownRegimes,
        orphanClauses: library.orphanClauses,
        libraryMissing: library.sourceDir === null,
        // True when the kind registry was available and the evidence closure
        // could widen anchors to their subtypes. False means we under-state
        // evidence — the safer direction, but still wrong, so we say so.
        evidenceResolvable: !!kindRegistry,
    };
}

// ─── Reading what the project's documents cite ────────────────────────────────

/** A document that exists in the project, as the workbench store hands it over. */
export interface ProjectDocument {
    id: string;
    title: string;
    /** Template the document was created from, e.g. "iso-14971/rmp". */
    templateId?: string;
    /** Raw markdown including frontmatter, when the document has its own. */
    content?: string;
}

/**
 * Resolve the clauses cited by documents that EXIST in the project.
 *
 * Existence is the point. The clause list a template carries says what a
 * document of that type would claim; only a document actually present in
 * `dhf/documents/` claims it. A checklist built from the template set would
 * report full coverage for a project that has written nothing.
 *
 * A document's own frontmatter wins over its template's, because the workbench
 * merges hand edits back into the file and a document that has narrowed or
 * extended its claim has said so there.
 */
export function collectDocumentClauses(
    docs: ProjectDocument[],
    library: StandardsLibrary,
    customTemplateDir?: string,
): DocumentClauseCitation[] {
    const out: DocumentClauseCitation[] = [];
    for (const doc of docs) {
        let standard: string | undefined;
        let clauses: string[] | undefined;

        if (doc.content) {
            const own = parseFrontmatter(doc.content).frontmatter;
            if (typeof own.standard === 'string') standard = own.standard;
            if (Array.isArray(own.clauses)) clauses = own.clauses.map(String);
        }
        if (!clauses && doc.templateId) {
            const tpl = loadTemplate(doc.templateId, customTemplateDir);
            if (tpl) {
                standard = standard ?? tpl.frontmatter.standard;
                clauses = Array.isArray(tpl.frontmatter.clauses)
                    ? tpl.frontmatter.clauses.map(String) : undefined;
            }
        }
        for (const entry of clauses ?? []) {
            const resolution = resolveClause(library, entry, standard);
            if (!resolution.ok) continue;
            out.push({
                documentId: doc.id,
                documentTitle: doc.title,
                designation: resolution.clause.designation,
                clauseNumber: resolution.clause.clauseNumber,
            });
        }
    }
    return out;
}

// ─── Reading the project's declared regimes ───────────────────────────────────

/**
 * The regimes a project declares on its `ProjectMethodBinding`.
 *
 * Not application settings: `MEMOConfig` carries how a command runs, never what
 * the model means, and `settings-boundary.ts` rejects semantic fields outright.
 * A submission target selects which clauses a project is answerable for, which
 * is squarely semantic, so it is declared in `model/catalog/project.sysml` like
 * the methodology selection beside it.
 *
 * The attribute arrives from the builder as the qualified members joined by
 * commas — `"RegulatoryRegimeKind::CE, RegulatoryRegimeKind::MDR"`. One
 * spelling only: an unqualified member is not a synonym, it is skipped and
 * reported, the same rule the enum carries everywhere else in MEMO.
 */
export function readDeclaredRegimes(model: MemoModel | undefined): {
    regimes: string[];
    /** Entries that were not qualified members, verbatim. */
    rejected: string[];
} {
    const regimes: string[] = [];
    const rejected: string[] = [];
    for (const el of model?.elementsByKind.get('ProjectMethodBinding') ?? []) {
        const raw = el.attributes?.regulatoryRegime;
        if (!raw) continue;
        for (const entry of raw.split(',').map(s => s.trim()).filter(Boolean)) {
            const parts = entry.split('::');
            if (parts.length === 2 && parts[0] === 'RegulatoryRegimeKind') {
                if (!regimes.includes(parts[1])) regimes.push(parts[1]);
            } else {
                rejected.push(entry);
            }
        }
    }
    return { regimes, rejected };
}

// ─── Filters ──────────────────────────────────────────────────────────────────

export interface StandardsReportFilter {
    /** Substring of a designation, case-insensitive. */
    standard?: string;
    /** Keep only gap clauses (and only standards that have some). */
    gapsOnly?: boolean;
}

/**
 * Narrow a computed report. Filtering is separate from computing so the totals
 * a filtered view shows are the totals of what it shows — a `--gaps-only`
 * table whose "Clauses" column still counted the claimed ones would be a
 * different kind of lie than the one this whole area exists to remove.
 */
export function filterStandardsReport(report: StandardsReport, filter: StandardsReportFilter): StandardsReport {
    const matches = (row: StandardRow): boolean =>
        !filter.standard || row.designation.toLowerCase().includes(filter.standard.toLowerCase());

    const narrow = (rows: StandardRow[]): StandardRow[] => rows
        .filter(matches)
        .map(row => {
            if (!filter.gapsOnly) return row;
            const clauses = row.clauses.filter(c => c.status === 'gap');
            return { ...row, clauses, totals: totalsOf(clauses) };
        })
        .filter(row => !filter.gapsOnly || row.clauses.length > 0);

    const standards = narrow(report.standards);
    return {
        ...report,
        standards,
        unrequired: narrow(report.unrequired),
        totals: standards.reduce<StandardTotals>((acc, s) => ({
            clauses: acc.clauses + s.totals.clauses,
            claimed: acc.claimed + s.totals.claimed,
            evidenced: acc.evidenced + s.totals.evidenced,
            gaps: acc.gaps + s.totals.gaps,
        }), { clauses: 0, claimed: 0, evidenced: 0, gaps: 0 }),
    };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function isApproved(el: MemoElement): boolean {
    return (el.attributes?.approvalStatus ?? '').toLowerCase() === 'approved';
}

function totalsOf(clauses: ClauseRow[]): StandardTotals {
    const evidenced = clauses.filter(c => c.status === 'evidenced').length;
    const claimed = evidenced + clauses.filter(c => c.status === 'claimed').length;
    return { clauses: clauses.length, claimed, evidenced, gaps: clauses.length - claimed };
}

function dedupeEvidence(evidence: EvidenceRef[]): EvidenceRef[] {
    const seen = new Set<string>();
    return evidence.filter(e => {
        const key = `${e.category}|${e.elementId}|${e.via}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });
}

/**
 * Clause numbers sort numerically segment by segment, so §8 precedes §14.
 * `localeCompare` put IEC 60601-1 clause 14 above clause 8 in the Phase 3.0
 * conformance matrix; a compliance table ordered 10, 11, 14, 8, 9 reads as
 * broken long before a reader works out why. Non-numeric segments — 820.30(c),
 * V.A — fall back to a string compare within the segment.
 */
export function byClauseNumber(a: { clauseNumber: string }, b: { clauseNumber: string }): number {
    const as = a.clauseNumber.split('.');
    const bs = b.clauseNumber.split('.');
    for (let i = 0; i < Math.max(as.length, bs.length); i++) {
        const x = as[i], y = bs[i];
        if (x === undefined) return -1;
        if (y === undefined) return 1;
        const nx = Number.parseInt(x, 10), ny = Number.parseInt(y, 10);
        if (Number.isNaN(nx) || Number.isNaN(ny)) {
            if (x !== y) return x.localeCompare(y);
            continue;
        }
        if (nx !== ny) return nx - ny;
        if (x !== y) return x.localeCompare(y);
    }
    return 0;
}
