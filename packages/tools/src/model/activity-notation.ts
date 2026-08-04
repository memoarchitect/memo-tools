// ─── Activity notation roles ─────────────────────────────────────────────────
//
// Which activity symbol an element draws as. Same standard as
// `relationship-legality.ts`: pure, dependency-free, and derived from declared
// data rather than from a table of names in TypeScript.
//
// What this replaces. Architect's `actionflow-view.ts` classified nodes by
// comparing a normalised `kind` string against a ladder of spellings —
// `'decisionnode' || 'decisionnodeusage'`, `'acceptactionusage' ||
// 'acceptaction'`, and so on. Three problems with that, in increasing order of
// seriousness: it lived in the view rather than in the toolchain (§1.2.2); the
// spellings were a hardcoded kind list, which is exactly what the engine is not
// supposed to contain; and it could not answer a question the metamodel answers
// for free — that a `ForkNode` *is* a `ControlNode` *is* an `ActionUsage`.
//
// How it works instead. Three declared sources decide, and none of them is a
// list of names maintained here:
//
//   1. **The normative metamodel.** `SYSML_METACLASSES` is generated from
//      `SysML.ecore` (Track B B2), so the generalization graph — `ForkNode` →
//      `ControlNode` → `ActionUsage` — is data. A role is anchored on one
//      metaclass and matched with `conformsTo`, so every present and future
//      subtype of that anchor classifies correctly without being named.
//   2. **The metamodel again, for precedence.** Roles are tried most-specific
//      first, and "most specific" is computed from each anchor's supertype
//      depth rather than written down in an order someone has to maintain.
//   3. **The ontology.** An element whose `kind` is a MEMO ontology kind is
//      resolved by walking that kind's declared `superType` chain, so binding a
//      new kind to a notation role is an ontology edit and not a code change.
//
// What remains hardcoded, stated plainly rather than hidden. Two things, both
// irreducible today:
//
//   - **The role → anchor binding.** Notation is a mapping from semantics to
//      symbols; something has to state it. The normative graphical grammar
//      (`bnf/SysML-graphical-bnf.kgbnf`, vendored) names the productions —
//      `fork-node`, `decision-node`, `accept-action-node` — but binds them to
//      SVG images, not to metaclasses, so it cannot supply the anchor. Each
//      binding cites its production, and Session 5's notation work is where the
//      kgbnf becomes the source rather than the citation.
//   - **The two final-node roles.** SysML v2 has no `ActivityFinalNode` or
//      `FlowFinalNode` metaclass; they are UML and SysML v1 names that
//      importers still emit. They cannot come from the v2 metamodel because the
//      v2 metamodel does not have them, so they are declared as what they are —
//      legacy input spellings — instead of sitting in the same ladder as
//      metaclasses that do exist.
// ─────────────────────────────────────────────────────────────────────────────

import { SYSML_METACLASSES, allSuperTypes, conformsTo } from '@memoarchitect/sysml-ir';
import type { MemoElement } from './semantic.js';
import type { KindDefinitionDTO, OntologyRegistriesDTO } from './relationship-legality.js';

/** The activity symbols an action-flow view draws. */
export type ActivityNodeType =
    | 'action' | 'accept' | 'send' | 'fork' | 'join' | 'decision' | 'merge'
    | 'activityFinal' | 'flowFinal';

/** One notation role, anchored on the metaclass whose instances draw as it. */
export interface ActivityNotationRole {
    role: ActivityNodeType;
    /** SysML v2 metaclass; every subtype of it draws as this role. */
    metaclass: string;
    /** Production in `bnf/SysML-graphical-bnf.kgbnf`, where one names it. */
    bnfProduction?: string;
}

/**
 * Role bindings, unordered.
 *
 * Deliberately not written in precedence order — `activityRolesBySpecificity()`
 * derives that from the metamodel, so adding a binding cannot put it in the
 * wrong place.
 */
export const ACTIVITY_NOTATION_ROLES: readonly ActivityNotationRole[] = [
    { role: 'fork', metaclass: 'ForkNode', bnfProduction: 'fork-node' },
    { role: 'join', metaclass: 'JoinNode', bnfProduction: 'join-node' },
    { role: 'decision', metaclass: 'DecisionNode', bnfProduction: 'decision-node' },
    { role: 'merge', metaclass: 'MergeNode', bnfProduction: 'merge-node' },
    { role: 'send', metaclass: 'SendActionUsage', bnfProduction: 'send-action-node' },
    { role: 'accept', metaclass: 'AcceptActionUsage', bnfProduction: 'accept-action-node' },
    { role: 'activityFinal', metaclass: 'TerminateActionUsage' },
    { role: 'action', metaclass: 'ActionUsage', bnfProduction: 'action-node' },
    // Definitions draw as actions too, and `ActionDefinition` is not a subtype
    // of `ActionUsage` — the metamodel puts it under `OccurrenceDefinition` and
    // `Behavior` — so it needs its own anchor rather than being reached through
    // the usage one. A role with two anchors is exactly what the list shape is
    // for.
    { role: 'action', metaclass: 'ActionDefinition', bnfProduction: 'action-node' },
];

/**
 * Input spellings SysML v2 has no metaclass for.
 *
 * UML and SysML v1 final nodes. Kept because importers emit them and a diagram
 * that silently drops a final node is worse than one drawn from a legacy name;
 * kept *here*, apart from the metamodel-driven path, because pretending they
 * are metaclasses is how the old ladder became unreadable.
 */
const LEGACY_NODE_SPELLINGS: Readonly<Record<string, ActivityNodeType>> = {
    activityfinalnode: 'activityFinal',
    activityfinalnodeusage: 'activityFinal',
    flowfinalnode: 'flowFinal',
    flowfinalnodeusage: 'flowFinal',
};

/**
 * MEMO grammar literals for `ControlNodeUsage.controlKind`, bound to the
 * metaclasses they name.
 *
 * The four values come from MEMO's own Langium grammar, so they are not
 * derivable from `SysML.ecore` — but their targets are, and
 * `controlKindMetaclassesAreControlNodes()` asserts that these four are exactly
 * the metamodel's `ControlNode` subtypes. A fifth control node upstream fails
 * that check rather than silently going unclassified.
 */
export const CONTROL_KIND_METACLASS: Readonly<Record<string, string>> = {
    fork: 'ForkNode',
    join: 'JoinNode',
    decide: 'DecisionNode',
    merge: 'MergeNode',
};

/** True when the bindings above still match the metamodel's control nodes. */
export function controlKindMetaclassesAreControlNodes(): boolean {
    const declared = new Set(Object.values(CONTROL_KIND_METACLASS));
    const actual = Object.keys(SYSML_METACLASSES)
        .filter(name => name !== 'ControlNode' && conformsTo(name, 'ControlNode'));
    return actual.length === declared.size && actual.every(name => declared.has(name));
}

/**
 * Roles most-specific first, by supertype depth.
 *
 * `ForkNode` sits three levels below `ActionUsage`, so it is tried first and an
 * `ActionUsage` anchor never swallows a control node. Computed rather than
 * declared, because the metamodel already knows the answer.
 */
export function activityRolesBySpecificity(): ActivityNotationRole[] {
    return [...ACTIVITY_NOTATION_ROLES].sort(
        (a, b) => allSuperTypes(b.metaclass).length - allSuperTypes(a.metaclass).length);
}

/**
 * Spellings of `token` to try against the metamodel.
 *
 * The suffix rules exist because the same concept is written several ways
 * across importers and MEMO's own construct keywords — `DecisionNodeUsage`,
 * `decision`, `AcceptAction`. What makes this different from the ladder it
 * replaces is that *the metamodel decides* which candidate is real: a spelling
 * that does not name a metaclass simply does not match, and no spelling has to
 * be enumerated here.
 */
function metaclassCandidates(token: string): string[] {
    if (!token) return [];
    const base = token.replace(/[ _-]/g, '');
    const capitalized = base.charAt(0).toUpperCase() + base.slice(1);
    return [
        capitalized,
        `${capitalized}Usage`,
        `${capitalized}Node`,
        `${capitalized}ActionUsage`,
        capitalized.replace(/Usage$/, ''),
        capitalized.replace(/Definition$/, ''),
    ];
}

/** The metaclass a token names, if the metamodel has one. */
function resolveMetaclass(token: string | undefined): string | undefined {
    for (const candidate of metaclassCandidates(token ?? '')) {
        if (candidate in SYSML_METACLASSES) return candidate;
    }
    return undefined;
}

/** An ontology kind and everything it specializes, nearest first. */
function ontologyChain(kind: string, kinds: readonly KindDefinitionDTO[] | undefined): string[] {
    const byName = new Map((kinds ?? []).map(definition => [definition.name, definition]));
    const chain: string[] = [];
    let current: string | undefined = kind;
    while (current && !chain.includes(current)) {
        chain.push(current);
        current = byName.get(current)?.superType;
    }
    return chain;
}

/**
 * The activity symbol this element draws as, or `undefined` if it is not an
 * activity node at all.
 *
 * `registries` is optional: without it, classification uses the metamodel
 * alone, which is what a caller holding a bare element can do. With it, an
 * ontology kind reaches its role through its declared specialization chain —
 * which is the path a project extends.
 */
export function activityNodeType(
    element: MemoElement,
    registries?: OntologyRegistriesDTO,
): ActivityNodeType | undefined {
    // The metamodel's own discriminator first: a control node says what it is.
    const controlKind = element.attributes?.controlKind?.toLowerCase();
    const fromControlKind = controlKind ? CONTROL_KIND_METACLASS[controlKind] : undefined;

    const tokens = [
        ...(fromControlKind ? [fromControlKind] : []),
        ...ontologyChain(element.kind, registries?.kinds),
        // Native SysML nodes (AcceptActionUsage, DecisionNodeUsage, etc.) are
        // already represented by their metaclass name in `kind`; do not rely
        // on the generic `construct: action`, which would erase their symbol.
        element.kind,
        element.construct,
    ];

    const roles = activityRolesBySpecificity();
    for (const token of tokens) {
        const legacy = LEGACY_NODE_SPELLINGS[(token ?? '').replace(/[ _-]/g, '').toLowerCase()];
        if (legacy) return legacy;
        const metaclass = resolveMetaclass(token);
        if (!metaclass) continue;
        const match = roles.find(role => conformsTo(metaclass, role.metaclass));
        if (match) return match.role;
    }
    return undefined;
}

/** Control nodes flow through the graph but own no responsibility lane. */
export function isControlNode(element: MemoElement, registries?: OntologyRegistriesDTO): boolean {
    const role = activityNodeType(element, registries);
    if (role === 'activityFinal' || role === 'flowFinal') return true;
    const binding = ACTIVITY_NOTATION_ROLES.find(candidate => candidate.role === role);
    // "Is it a control node" is the metamodel's question, not a list of four
    // role names: `ControlNode` is a metaclass, and the anchors sit under it.
    return binding !== undefined && conformsTo(binding.metaclass, 'ControlNode');
}
