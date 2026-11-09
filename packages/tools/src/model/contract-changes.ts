// ─── Whether a change breaks anyone ──────────────────────────────────────────
//
// `computeModelDiff` says what changed; this says what that does to the parties on either side of an item, a port
// or an interface. It judges language constructs and never names an ontology kind, so it holds for any model.
//
// A change it cannot judge is reported as `unknown`. It is never left out, because a change nobody was told about
// is the failure this exists to prevent. Parties come from the baseline: they are who uses the thing today.
//
// Pure and browser-safe, over the same shapes as the diff.
// ─────────────────────────────────────────────────────────────────────────────

import type { DiffElement, DiffInput, DiffRelationship, ModelDiff } from './model-diff.js';
import { definitionUses } from '../analysis/where-used.js';

export type ContractVerdict = 'breaking' | 'compatible' | 'unknown';
/** Who has to change for a breaking change. */
export type ContractSide = 'producers' | 'consumers' | 'both';

export interface ContractParty { id: string; name: string; role: 'producer' | 'consumer' | 'user' }

export interface ContractChange {
    subject: { id: string; name: string; kind: string };
    /** Stable, for a reader that keys on it: `attribute.removed`, `link.item-changed`. */
    code: string;
    verdict: ContractVerdict;
    breaks?: ContractSide;
    reason: string;
    parties: ContractParty[];
}

export interface ContractReport {
    changes: ContractChange[];
    summary: Record<ContractVerdict, number>;
}

/** What the model does not record, so a change to it cannot be judged here. */
export const CONTRACT_LIMITS = 'A multiplicity and the members of an enumeration are not in the model, so a change to either is not judged.';

type Rule = { verdict: ContractVerdict; breaks?: ContractSide };
const NEEDS_NEW_PRODUCER: Rule = { verdict: 'breaking', breaks: 'producers' };
const NEEDS_NEW_CONSUMER: Rule = { verdict: 'breaking', breaks: 'consumers' };
const NEEDS_BOTH: Rule = { verdict: 'breaking', breaks: 'both' };
const SAFE: Rule = { verdict: 'compatible' };
const CANNOT_TELL: Rule = { verdict: 'unknown' };

const leaf = (name: string) => name.slice(name.lastIndexOf(':') + 1);
const isDeclaredOnly = (value: string) => value.startsWith('<') && value.endsWith('>');
const CONTRACT_CONSTRUCTS: ReadonlySet<string> = new Set(['item', 'port', 'interface', 'flow']);
const CARRYING_LINKS: ReadonlySet<string> = new Set(['flow', 'interface']);

const isContract = (element: DiffElement) => element.isDefinition === true && CONTRACT_CONSTRUCTS.has(element.construct ?? '');

export function contractChanges<E extends DiffElement, R extends DiffRelationship>(
    diff: Pick<ModelDiff<E, R>, 'removed' | 'changed' | 'removedRels' | 'changedRels'>,
    before: DiffInput<E, R>,
    after: DiffInput<E, R>,
): ContractReport {
    const nameOf = (id: string) => before.elements[id]?.name || after.elements[id]?.name || leaf(id);
    const party = (id: string, role: ContractParty['role']): ContractParty => ({ id, name: nameOf(id), role });
    const distinct = (parties: ContractParty[]) => [...new Map(parties.map(p => [`${p.id} ${p.role}`, p])).values()];
    const relationships = [...before.relationships];
    const elements = Object.values(before.elements);

    /** Who uses a definition in the baseline. */
    const partiesOf = (definition: DiffElement): ContractParty[] => {
        const uses = definitionUses(definition.name || leaf(definition.id), elements, relationships, id => before.elements[id]);
        return distinct([
            ...uses.flows.flatMap(r => [party(r.sourceId, 'producer'), party(r.targetId, 'consumer')]),
            ...uses.typedLinks.flatMap(r => [party(r.sourceId, 'user'), party(r.targetId, 'user')]),
            ...uses.ports.map(e => party(e.owner!, 'user')),
            ...uses.parameters.map(p => party(p.element.id, p.direction === 'out' ? 'producer' : p.direction === 'in' ? 'consumer' : 'user')),
        ]);
    };
    const partiesOfLink = (r: DiffRelationship) => [party(r.sourceId, 'producer'), party(r.targetId, 'consumer')];

    const changes: ContractChange[] = [];
    const add = (subject: ContractChange['subject'], code: string, rule: Rule, reason: string, parties: ContractParty[]) =>
        changes.push({ subject, code, ...rule, reason, parties });
    const subjectOf = (e: DiffElement) => ({ id: e.id, name: e.name || leaf(e.id), kind: e.kind });

    for (const element of diff.removed) {
        if (!isContract(element)) continue;
        const parties = partiesOf(element);
        // Removed with nobody using it is a tidy-up, not an impact.
        if (parties.length > 0) add(subjectOf(element), 'definition.removed', NEEDS_BOTH, 'removed while still in use', parties);
    }

    for (const { element } of diff.changed) {
        if (!isContract(element)) continue;
        const was = before.elements[element.id]?.attributes ?? {};
        const now = after.elements[element.id]?.attributes ?? {};
        const parties = partiesOf(before.elements[element.id] ?? element);
        for (const key of [...new Set([...Object.keys(was), ...Object.keys(now)])].sort()) {
            const b = was[key];
            const a = now[key];
            if (b === a) continue;
            if (b === undefined) {
                if (isDeclaredOnly(a)) add(subjectOf(element), 'attribute.added', NEEDS_NEW_PRODUCER, `${key} added, so a producer now has to supply it`, parties);
                else add(subjectOf(element), 'attribute.added-with-value', SAFE, `${key} added with a value`, parties);
            } else if (a === undefined) {
                add(subjectOf(element), 'attribute.removed', NEEDS_NEW_CONSUMER, `${key} removed, so a consumer reading it has nothing to read`, parties);
            } else if (isDeclaredOnly(b) && isDeclaredOnly(a)) {
                add(subjectOf(element), 'attribute.retyped', NEEDS_BOTH, `${key} changed type from ${b} to ${a}`, parties);
            } else {
                add(subjectOf(element), 'attribute.value-changed', CANNOT_TELL, `${key} changed from ${b} to ${a}`, parties);
            }
        }
    }

    for (const id of Object.keys(before.elements)) {
        const b = before.elements[id];
        const a = after.elements[id];
        if (!a || !b.portSpec || !a.portSpec || b.portSpec.isConjugated === a.portSpec.isConjugated) continue;
        add(subjectOf(a), 'port.conjugation-changed', NEEDS_BOTH, 'the port was conjugated or unconjugated, so its directions reversed',
            b.owner ? [party(b.owner, 'user')] : []);
    }

    const linkSubject = (r: DiffRelationship) => ({ id: r.id, name: `${nameOf(r.sourceId)} → ${nameOf(r.targetId)}`, kind: r.kind ?? r.type });
    for (const r of diff.removedRels) {
        if (CARRYING_LINKS.has(r.type)) add(linkSubject(r), 'link.removed', NEEDS_BOTH, `${r.type} removed`, partiesOfLink(r));
    }
    for (const { relationship: r, before: was } of diff.changedRels) {
        if (!CARRYING_LINKS.has(r.type)) continue;
        const parties = partiesOfLink(was);
        const subject = linkSubject(r);
        if ((was.flowItem ?? '') !== (r.flowItem ?? '')) add(subject, 'link.item-changed', NEEDS_BOTH, `carries ${r.flowItem || '(nothing named)'} instead of ${was.flowItem || '(nothing named)'}`, parties);
        if ((was.kind ?? '') !== (r.kind ?? '')) add(subject, 'link.kind-changed', CANNOT_TELL, `declared as ${r.kind || '(no kind)'} instead of ${was.kind || '(no kind)'}`, parties);
        if ((was.sourceEnd ?? '') !== (r.sourceEnd ?? '') || (was.targetEnd ?? '') !== (r.targetEnd ?? '')
            || (was.sourcePortId ?? '') !== (r.sourcePortId ?? '') || (was.targetPortId ?? '') !== (r.targetPortId ?? '')) {
            add(subject, 'link.end-changed', NEEDS_BOTH, 'runs between different ports', parties);
        }
        if (JSON.stringify(was.attributes ?? {}) !== JSON.stringify(r.attributes ?? {})) add(subject, 'link.attribute-changed', CANNOT_TELL, 'an attribute of the link changed', parties);
    }

    const count = (verdict: ContractVerdict) => changes.filter(c => c.verdict === verdict).length;
    return { changes, summary: { breaking: count('breaking'), compatible: count('compatible'), unknown: count('unknown') } };
}
