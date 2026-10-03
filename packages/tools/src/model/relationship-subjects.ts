// ─── Rule subjects projected from named, typed relationships ─────────────────
//
// A named `flow` or `interface` usage that declares a domain type —
// `flow lfDose : FunctionalExchange from … to …` — is a first-class modelled
// thing: it carries a qualified identity, attributes of its own, and a kind an
// ontology declared. It is still an EDGE, so it is not in the elements map and
// nothing counting parts counts it as one.
//
// That left a gap. Rule subjects come from `elementsByKind`, so a rule written
// `appliesTo = "FunctionalExchange"` against a flow-def kind selected nothing
// at all — an empty subject set, reported as a clean pass. The architecture
// plan's §9.1 asks for "a single canonical identity for a named flow/interface
// that can also serve as a relationship target", implemented by "a unified
// entity index or a READ-ONLY FACADE over existing element/relationship
// indexes", and requires that it "must not require a second authored proxy
// part or independently mutable graph records".
//
// This module is that facade. It derives a `MemoElement` VIEW of each such
// relationship, on demand, from the relationship object itself. Nothing is
// stored, nothing is added to the canonical model, and the projection is
// recomputed from the edge every time — so the edge stays the one record and
// there is no second graph to keep in step. The canonical model that the
// census counts, the baselines freeze and the exports serialize is untouched.

import type { KindRegistry } from './kind-registry.js';
import { MEMO_CONSTRUCTS, usageKeyword } from './semantic.js';
import type { MemoConstruct, MemoElement, MemoModel, MemoRelationship } from './semantic.js';

/**
 * The construct a projected subject reports.
 *
 * Asked of the ontology first — a `flow def` projects `'flow'`, an
 * `interface def` projects `'interface'` — because the DEFINITION is what says
 * what the usage is, and the registry is where that is recorded. Without a
 * registry, or for a kind no ontology declares, the native keyword is the next
 * best answer: `flow`, `interface` and `connection` are all constructs in
 * their own right, so a `type` naming one is already the truth.
 *
 * `'part'` is never inferred here. A relationship that cannot be classified
 * projects nothing at all (see {@link relationshipSubjects}) rather than
 * arriving in the elements vocabulary as a structural thing, which is the
 * exact category mistake the native-exchange work exists to undo.
 */
function subjectConstruct(
    relationship: MemoRelationship,
    registry: KindRegistry | undefined,
): MemoConstruct | undefined {
    const declared = relationship.kind
        ? registry?.getKind(relationship.kind)?.sysmlConstruct
        : undefined;
    if (declared) return usageKeyword(declared);
    return (MEMO_CONSTRUCTS as readonly string[]).includes(relationship.type)
        ? relationship.type as MemoConstruct
        : undefined;
}

/** A subject's display name, by the precedence an element's has. */
function subjectName(relationship: MemoRelationship): string {
    const attributes = relationship.attributes ?? {};
    return attributes['label'] || attributes['name'] || attributes['title'] || relationship.shortName || relationship.id;
}

/**
 * Read-only `MemoElement` views of every named relationship that declares a
 * domain kind.
 *
 * Anonymous edges are excluded: their id is a positional `rel-N` that
 * addresses nothing and shifts on the next edit, so a violation reported
 * against one would name a subject no reader could find. Untyped edges are
 * excluded because they declare no kind, and a kind is what a rule selects on.
 */
export function relationshipSubjects(
    model: MemoModel,
    registry?: KindRegistry,
): MemoElement[] {
    const subjects: MemoElement[] = [];
    for (const relationship of model.relationships) {
        if (!relationship.named || !relationship.kind) continue;
        const construct = subjectConstruct(relationship, registry);
        if (!construct) continue;
        subjects.push({
            id: relationship.id,
            ...(relationship.shortName ? { shortName: relationship.shortName } : {}),
            // Named as an element is: its `@MemoIdentity` label first, so a
            // finding reads the same whether its subject is a part or an edge.
            name: subjectName(relationship),
            kind: relationship.kind,
            construct,
            layer: registry?.getKind(relationship.kind)?.layer ?? 'unknown',
            file: relationship.file,
            // The ends, under the names `linksOf` already gives them, so a
            // rule can ask what an edge connects the same way it asks what a
            // link connects: `allOfKind('MemoPort')->exists(id ==
            // subject.attributes.sourceId)`. Read off the edge each time, like
            // everything else here, so there is still one record. The ends
            // are written last: a body attribute that happened to be called
            // `sourceId` must not be able to move what the edge connects.
            attributes: {
                ...(relationship.attributes ?? {}),
                sourceId: relationship.sourceId,
                targetId: relationship.targetId,
            },
            ...(relationship.provenance ? { provenance: relationship.provenance } : {}),
        });
    }
    return subjects;
}

/**
 * The model a rule is evaluated against, with projected subjects merged into
 * `elementsByKind` only.
 *
 * `elements` is deliberately left alone. It is the parts index — what
 * `memo inspect` resolves, what the census counts, what an export serializes —
 * and an edge does not belong in it. `elementsByKind` is the SUBJECT SELECTOR,
 * which is a different question: "what does this rule run on?".
 *
 * A projected subject never displaces an element. If an id collides — which it
 * cannot today, since the relationship index rejects a flow competing with an
 * element for one qualified name — the element wins and the projection is
 * dropped, because the authored declaration is the one with a body to read.
 */
export function withRelationshipSubjects(
    model: MemoModel,
    registry?: KindRegistry,
): MemoModel {
    const projected = relationshipSubjects(model, registry);
    if (projected.length === 0) return model;

    const elementsByKind = new Map(model.elementsByKind);
    for (const subject of projected) {
        if (model.elements.get(subject.id)) continue;
        const extent = elementsByKind.get(subject.kind);
        elementsByKind.set(subject.kind, extent ? [...extent, subject] : [subject]);
    }
    return { ...model, elementsByKind };
}
