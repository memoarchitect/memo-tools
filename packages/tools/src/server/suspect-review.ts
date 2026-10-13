// ─── Resolving a request to review suspect links ─────────────────────────────
//
// A client names a link and the imported record it is suspect about. What the
// review writes is decided here, from the server's own model: the link must be
// suspect NOW, a withdrawn record has no revision to review against, and the
// revision written is the record's current one, not whatever the client held.
// ─────────────────────────────────────────────────────────────────────────────

import { computeSuspectLinks } from '../analysis/suspect-links.js';
import type { MemoModelDTO } from '../model/semantic.js';
import type { BaselineReview } from './relationship-writer.js';

export function resolveSuspectReviews(
    model: Pick<MemoModelDTO, 'elements' | 'relationships'>,
    requested: readonly { relationshipId: string; elementId: string }[],
): { reviews: BaselineReview[] } | { error: string } {
    const suspects = computeSuspectLinks(model);
    const reviews: BaselineReview[] = [];
    for (const { relationshipId, elementId } of requested) {
        const suspect = suspects.find(s => s.relationshipId === relationshipId && s.elementId === elementId);
        if (!suspect) return { error: `"${relationshipId}" is not suspect about "${elementId}" in the current model.` };
        // A withdrawn record has no revision to review against: the link is removed, not cleared.
        if (suspect.reason === 'source-withdrawn' || suspect.current === undefined) {
            return { error: `"${relationshipId}" points at a record withdrawn from its source; remove the link instead.` };
        }
        const relationship = model.relationships.find(r => r.id === relationshipId);
        const identifier = model.elements[elementId]?.attributes['externalReference.identifier'];
        if (!relationship || !identifier) return { error: `"${elementId}" is not an imported element.` };
        reviews.push({ relationship, sourceRevision: suspect.current, sourceIdentifier: identifier });
    }
    return { reviews };
}
