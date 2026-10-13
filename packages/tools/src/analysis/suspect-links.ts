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

import type { MemoModel } from '../model/semantic.js';

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

/** Every baselined link whose imported end has moved or been withdrawn. */
export function computeSuspectLinks(model: MemoModel): SuspectLink[] {
    const suspects: SuspectLink[] = [];
    for (const relationship of model.relationships) {
        const baseline = relationship.attributes?.['sourceRevision'];
        if (baseline === undefined) continue;
        for (const end of ['source', 'target'] as const) {
            const elementId = end === 'source' ? relationship.sourceId : relationship.targetId;
            const attributes = model.elements.get(elementId)?.attributes;
            if (!attributes || attributes[IDENTIFIER] === undefined) continue;
            const current = attributes[REVISION];
            const base = { relationshipId: relationship.id, relationshipType: relationship.type, elementId, end, baseline, current };
            if (attributes['sourceWithdrawn'] === 'true') suspects.push({ ...base, reason: 'source-withdrawn' });
            else if (current !== baseline) suspects.push({ ...base, reason: 'revision-moved' });
        }
    }
    return suspects;
}
