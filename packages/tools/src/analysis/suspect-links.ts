// ─── Suspect links ────────────────────────────────────────────────────────────
//
// A MEMO-authored link to an imported element records the revision of that
// element it was made against (`@TraceBaseline { sourceRevision }`). The link
// is suspect when the element has since moved on. Status is derived here from
// attributes alone and never stored, so there is no flag to go stale; reviewing
// a link means rewriting its baseline to the element's current revision.
//
// Nothing here knows a kind or a relation type: an imported element is one that
// carries an `externalReference`, a baselined link is one that carries a
// `sourceRevision`.
// ─────────────────────────────────────────────────────────────────────────────

import type { MemoElement, MemoRelationship } from '../model/semantic.js';

export type SuspectReason = 'revision-moved' | 'source-withdrawn';

export interface SuspectLink {
    relationshipId: string;
    relationshipType: string;
    /** The imported element the link is suspect about. */
    elementId: string;
    /** Which end of the link that element is. */
    end: 'source' | 'target';
    /** The revision the link was made against. */
    baseline: string;
    /** The element's revision now; undefined when the source no longer carries it. */
    current: string | undefined;
    reason: SuspectReason;
}

const REVISION = 'externalReference.revision';
const IDENTIFIER = 'externalReference.identifier';

/** What a baseline says: the revision a link was made against, and the record it belongs to. */
export interface Baseline {
    sourceRevision: string;
    /** The imported element the revision belongs to; absent, every imported end is compared. */
    sourceIdentifier?: string;
}

/** An imported element as the comparison sees it. */
export interface ImportedRecord {
    identifier: string;
    revision: string | undefined;
    withdrawn: boolean;
}

/** The baseline a link carries, if it carries one. */
export function baselineOf(attributes: Record<string, string> | undefined): Baseline | undefined {
    const sourceRevision = attributes?.['sourceRevision'];
    if (sourceRevision === undefined) return undefined;
    const sourceIdentifier = attributes?.['sourceIdentifier'];
    return sourceIdentifier === undefined ? { sourceRevision } : { sourceRevision, sourceIdentifier };
}

/** The imported record an element is, if it is one. */
export function importedRecordOf(element: MemoElement | undefined): ImportedRecord | undefined {
    const identifier = element?.attributes[IDENTIFIER];
    if (!element || identifier === undefined) return undefined;
    return { identifier, revision: element.attributes[REVISION], withdrawn: element.attributes['sourceWithdrawn'] === 'true' };
}

/**
 * Whether a baseline is suspect against one imported record. The one predicate:
 * the queue (`computeSuspectLinks`) and an import's preview both ask it, so what
 * the preview says it will mark is what the queue then shows.
 */
export function suspectReason(baseline: Baseline, record: ImportedRecord): SuspectReason | undefined {
    if (baseline.sourceIdentifier !== undefined && baseline.sourceIdentifier !== record.identifier) return undefined;
    if (record.withdrawn) return 'source-withdrawn';
    return record.revision !== baseline.sourceRevision ? 'revision-moved' : undefined;
}

/** A model the computation can read: a built one, or the DTO a client holds. */
export interface SuspectModel {
    relationships: readonly MemoRelationship[];
    elements: ReadonlyMap<string, MemoElement> | Readonly<Record<string, MemoElement>>;
}

/** Every baselined link whose imported end has moved or been withdrawn. */
export function computeSuspectLinks(model: SuspectModel): SuspectLink[] {
    const elementOf = (id: string): MemoElement | undefined =>
        model.elements instanceof Map ? model.elements.get(id) : (model.elements as Record<string, MemoElement>)[id];
    const suspects: SuspectLink[] = [];
    for (const relationship of model.relationships) {
        const baseline = baselineOf(relationship.attributes);
        if (!baseline) continue;
        for (const end of ['source', 'target'] as const) {
            const elementId = end === 'source' ? relationship.sourceId : relationship.targetId;
            const record = importedRecordOf(elementOf(elementId));
            if (!record) continue;
            const reason = suspectReason(baseline, record);
            if (reason) {
                suspects.push({
                    relationshipId: relationship.id, relationshipType: relationship.type, elementId, end,
                    baseline: baseline.sourceRevision, current: record.revision, reason,
                });
            }
        }
    }
    return suspects;
}
