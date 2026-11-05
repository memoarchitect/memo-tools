// ─── Relationship end scopes ─────────────────────────────────────────────────
//
// A relation with untyped ends can still be scoped by the ontology: `AllocatedTo`
// is `* -> *`, and CR-ONT-063 and CR-ONT-064 state where it may run as
// `sourcesOf(allocatedTo)->forAll(...)`. An authoring surface should not offer
// what those rules would flag, and the evaluator cannot run in a browser, so the
// server asks the rules once per kind and sends the kinds they refuse.
// ─────────────────────────────────────────────────────────────────────────────

import type { KindRegistry } from '../model/kind-registry.js';
import type { RelationshipEndScopes } from '../model/relationship-legality.js';
import type { MemoElement, MemoModel } from '../model/semantic.js';
import { usageKeyword } from '../model/semantic.js';
import { evaluateConstraintNode, type CompiledConstraint, type ConstraintNode } from './constraint-eval.js';

type EndsOf = { relationshipType: string; side: 'source' | 'target' };

/** Every `sourcesOf(rel)` and `targetsOf(rel)` a predicate quantifies over. */
function endsQuantified(node: ConstraintNode): EndsOf[] {
    const found: EndsOf[] = [];
    const walk = (value: unknown): void => {
        if (Array.isArray(value)) { value.forEach(walk); return; }
        if (!value || typeof value !== 'object') return;
        const candidate = value as { kind?: string } & Partial<EndsOf>;
        if (candidate.kind === 'endsOf' && candidate.relationshipType && candidate.side) {
            found.push({ relationshipType: candidate.relationshipType, side: candidate.side });
        }
        Object.values(value).forEach(walk);
    };
    walk(node);
    return found;
}

/**
 * A model holding one element of `kind`, linked to itself by `relationshipType`. `conforming` is the kind and its
 * ancestors, so `conformsTo` answers without the evaluator re-deriving every kind's extent per call: this runs once
 * per kind per rule on each rebuild, and doing that took seconds.
 */
function oneLinkModel(kind: string, construct: string | undefined, relationshipType: string, conforming: readonly string[]): MemoModel {
    const element = {
        id: 'subject', name: 'subject', kind, construct: usageKeyword(construct), layer: '', file: '', attributes: {},
    } as MemoElement;
    const link = { id: 'link', type: relationshipType, sourceId: element.id, targetId: element.id, sourceEnd: '', targetEnd: '', file: '' };
    return {
        elements: new Map([[element.id, element]]),
        relationships: [link],
        relationshipsByType: new Map([[relationshipType, [link]]]),
        elementsByKind: new Map(conforming.map(name => [name, [element]])),
        outgoing: new Map(), incoming: new Map(), errors: [],
    } as unknown as MemoModel;
}

/** A kind and everything it specializes. */
function kindAndAncestors(kind: string, kindRegistry: KindRegistry): string[] {
    const seen = new Set<string>();
    const pending = [kind];
    while (pending.length > 0) {
        const name = pending.pop()!;
        if (seen.has(name)) continue;
        seen.add(name);
        const entry = kindRegistry.getKind(name);
        if (entry?.superType) pending.push(entry.superType);
        pending.push(...(entry?.additionalSuperTypes ?? []));
    }
    return [...seen];
}

/**
 * The kinds each rule refuses at the relation ends it quantifies over. Only a rule about one end of a relation
 * says something about a kind at that end: a rule over both ends relates the two and is left to validation.
 */
export function relationshipEndScopes(
    constraints: readonly CompiledConstraint[],
    kindRegistry: KindRegistry | undefined,
    /** The model's elements: a usage typed by a library definition has a kind the registry does not hold. */
    elements: Iterable<Pick<MemoElement, 'kind' | 'construct'>> = [],
): RelationshipEndScopes {
    const scopes: RelationshipEndScopes = {};
    if (!kindRegistry) return scopes;
    const subjects = new Map<string, string | undefined>(kindRegistry.entries().map(entry => [entry.name, entry.sysmlConstruct]));
    for (const element of elements) if (!subjects.has(element.kind)) subjects.set(element.kind, element.construct);
    for (const constraint of constraints) {
        if (constraint.appliesToKind !== 'Model') continue;
        const ends = endsQuantified(constraint.ast);
        const relations = new Set(ends.map(end => end.relationshipType));
        if (ends.length === 0 || relations.size !== 1 || new Set(ends.map(end => end.side)).size !== 1) continue;
        const { relationshipType, side } = ends[0];
        const { ast, ...meta } = constraint;
        for (const [kind, construct] of subjects) {
            const model = oneLinkModel(kind, construct, relationshipType, kindAndAncestors(kind, kindRegistry));
            if (evaluateConstraintNode(meta, ast, model).length === 0) continue;
            const scope = scopes[relationshipType] ??= {};
            (scope[side] ??= []).push(kind);
        }
    }
    return scopes;
}
