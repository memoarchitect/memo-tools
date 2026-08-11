// ─── Standard SysML textual notation for authored relationships ─────────────
//
// What the canvas writes when you draw an edge. One rule governs the whole
// module: **emit the notation the SysML v2 language already has for this
// relationship**, not a MEMO encoding of it. A succession drawn between two
// actions has to come out as `succession first a if g then b;`, because that is
// what a succession is in SysML — writing it as a typed `connection` would be a
// MEMO dialect that only MEMO can read back.
//
// Why the form table lives here rather than in the ontology: these are SysML
// *language productions*, fixed by the specification and by the grammar, not
// MEMO kinds. The ontology decides which relationships exist and what they may
// connect (`relationship-legality.ts` reads all of that from it); this module
// only decides how the chosen one is spelled. The one place the two meet is
// `notationFor`, which asks the ontology definition what native form it names
// and falls back to the general one.
// ─────────────────────────────────────────────────────────────────────────────

import type { RelationshipDefinitionDTO } from '../model/relationship-legality.js';

/** The SysML production a relationship is written as. */
export type RelationshipNotation = 'succession' | 'flow' | 'satisfy' | 'connection';

export interface RelationshipNotationRequest {
    /** Connection usage name, when the form carries one. */
    id: string;
    definition: RelationshipDefinitionDTO;
    sourceId: string;
    targetId: string;
    /** Guard expression, for the forms that accept one. */
    guard?: string;
    /** Item or information carried, for the forms that accept one. */
    flowItem?: string;
    /** Indentation of the line the declaration will occupy. */
    indent?: string;
}

/**
 * SysML metaclasses whose relationships have their own notation.
 *
 * Keyed by the metaclass the grammar produces, so the table and the parser
 * cannot drift apart silently: a form named here that the grammar does not
 * produce fails the notation round-trip test.
 */
const NATIVE_FORMS: Record<string, RelationshipNotation> = {
    SuccessionUsage: 'succession',
    FlowConnectionUsage: 'flow',
};

/**
 * Which notation to write this relationship in.
 *
 * The ontology names the SysML construct in `sysmlName`; a definition whose
 * name is a native relationship metaclass is written in that form, and
 * everything else is a typed connection usage, which is the general case.
 */
export function notationFor(definition: RelationshipDefinitionDTO): RelationshipNotation {
    // `satisfy` has a complete two-ended package-member form. The other native
    // requirement relations need an owning case or a typed allocation usage,
    // respectively, so their authoring paths are deliberately not guessed here.
    // A connection definition may remain in the ontology during the migration,
    // but its registry metadata is the authority for how a new satisfaction is
    // written.
    if (definition.nativeKeyword === 'satisfy') return 'satisfy';
    return NATIVE_FORMS[definition.sysmlName]
        ?? NATIVE_FORMS[`${definition.sysmlName}Usage`]
        ?? 'connection';
}

/** True when the form gives the relationship a name of its own. */
export function notationIsNameable(notation: RelationshipNotation): boolean {
    return notation === 'connection';
}

/**
 * Render one relationship as SysML source.
 *
 * Anonymous forms are not a defect of this module: SysML's succession and flow
 * productions do not take a declared name, so a relationship written in one is
 * addressable by position rather than by ID. `writeRelationship` reports that
 * back rather than inventing a name the language cannot carry.
 */
export function renderRelationship(request: RelationshipNotationRequest): string {
    const notation = notationFor(request.definition);
    switch (notation) {
        case 'succession':
            return renderSuccession(request);
        case 'flow':
            return renderFlow(request);
        case 'satisfy':
            return renderSatisfy(request);
        default:
            return renderConnection(request);
    }
}

/** `satisfy requirement by satisfyingElement;` */
function renderSatisfy(request: RelationshipNotationRequest): string {
    // The registry deliberately gives satisfaction the same direction as the
    // native form: requirement first, satisfying element second. That is also
    // the builder's `satisfiedBy` edge, so a write and rebuild is lossless.
    return `satisfy ${request.sourceId} by ${request.targetId};`;
}

/** `succession first source [if guard] then target;` */
function renderSuccession(request: RelationshipNotationRequest): string {
    const guard = request.guard?.trim();
    const first = guard ? `${request.sourceId} if ${guard}` : request.sourceId;
    return `succession first ${first} then ${request.targetId};`;
}

/** `flow of Item from source to target;` */
function renderFlow(request: RelationshipNotationRequest): string {
    const item = request.flowItem?.trim() || request.definition.sourceEnd.type || 'Item';
    return `flow of ${item} from ${request.sourceId} to ${request.targetId};`;
}

/** `connection id : Def connect srcEnd ::> source to tgtEnd ::> target;` */
function renderConnection(request: RelationshipNotationRequest): string {
    const { definition, sourceId, targetId } = request;
    const head = `connection ${request.id} : ${definition.sysmlName} connect `
        + `${definition.sourceEnd.name} ::> ${sourceId} to `
        + `${definition.targetEnd.name} ::> ${targetId}`;
    const item = request.flowItem?.trim();
    if (!item) return `${head};`;
    const inner = `${request.indent ?? '    '}    `;
    return `${head} {\n${inner}attribute transportedItem = ${JSON.stringify(item)};\n${request.indent ?? '    '}}`;
}
