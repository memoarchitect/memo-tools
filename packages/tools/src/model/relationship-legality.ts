// ─── Relationship Legality ────────────────────────────────────────────────────
//
// The single semantic authority for "may this relationship exist?", shared by
// the web client (Properties panel, diagram RelationshipPicker, canvas edge
// creation), the server persistence path, importers, and validation.
//
// Everything here is pure and dependency-free — no filesystem, no parser, no
// Langium AST — so the browser entrypoint can re-export it unchanged. Legality
// is derived from the ontology registries (RelationshipRegistry / KindRegistry),
// never from hardcoded relationship tables.
//
// Usage:
//   const dirs = legalRelationshipDirections(element, relDef, registries);
//   const targets = compatibleRelationshipTargets(element, relDef, 'outgoing', model, registries);
//   const result = validateRelationshipMutation(request, model, registries);
// ─────────────────────────────────────────────────────────────────────────────

import type { MemoElement, MemoModelDTO, MemoRelationship } from './semantic.js';

// ─── Serializable ontology DTOs ─────────────────────────────────────────────

/** Declared multiplicity on a connection end, e.g. `[0..1]`, `[1]`, `[*]`. */
export interface MultiplicityDTO {
    /** Lower bound (0 when unbounded-only, e.g. `[*]`). */
    lower: number;
    /** Upper bound; null means unbounded (`*`). */
    upper: number | null;
}

/** One end of a relationship definition. */
export interface RelationshipEndDTO {
    /** End name as declared in SysML, e.g. "control", "requiredElement". */
    name: string;
    /** Declared end type (a kind name). Undefined ends accept any kind. */
    type?: string;
    /** Declared multiplicity, when the ontology states one. */
    multiplicity?: MultiplicityDTO;
}

/**
 * Serializable projection of one RelationshipRegistry entry — the wire format
 * the web client uses to reason about legality without a parser.
 */
export interface RelationshipDefinitionDTO {
    /** Normalized camelCase name used on MemoRelationship.type, e.g. "satisfiedBy". */
    name: string;
    /** PascalCase SysML name of the `connection def`, e.g. "SatisfiedBy". */
    sysmlName: string;
    /** Human-readable label, e.g. "Satisfied By". */
    label: string;
    /** Doc comment from the connection definition, when present. */
    description?: string;
    /** Architecture layer the connection definition lives in. */
    layer: string;
    /** Abstract definitions are not directly instantiable. */
    isAbstract?: boolean;
    /**
     * Whether an element may be related to itself by this relation, from the
     * ontology's `isReflexive` attribute. Undefined means the ontology is
     * silent, and self-links are refused — see SELF_LINK_ALLOWED_BY_DEFAULT.
     */
    isReflexive?: boolean;
    /**
     * Whether the same ordered pair may carry more than one link of this type,
     * from the ontology's `isUnique` attribute. Undefined means the ontology is
     * silent, and repeats are refused — see DUPLICATES_ALLOWED_BY_DEFAULT.
     */
    isUnique?: boolean;
    /** First declared end — the source/from end. */
    sourceEnd: RelationshipEndDTO;
    /** Second declared end — the target/to end. */
    targetEnd: RelationshipEndDTO;
}

/** Serializable projection of one KindRegistry entry. */
export interface KindDefinitionDTO {
    name: string;
    label: string;
    layer: string;
    /** SysML v2 construct, e.g. "part def". */
    construct: string;
    /** Direct supertype, the basis for transitive conformance. */
    superType?: string;
    isAbstract?: boolean;
    /**
     * Ontology namespace segments derived from the source tree.
     * Example: ["assurance", "safety_risk", "analysis"].
     */
    namespace?: string[];
}

/** Both ontology registries in serializable form, as shipped to the client. */
export interface OntologyRegistriesDTO {
    relationships: RelationshipDefinitionDTO[];
    kinds: KindDefinitionDTO[];
}

/** Direction of a relationship relative to the selected element. */
export type RelationshipDirection = 'outgoing' | 'incoming';

// ─── Requests, diagnostics and results ──────────────────────────────────────

/** A request to create one model relationship. */
export interface RelationshipCreateRequest {
    /** Correlates the response with the pending UI row. */
    requestId: string;
    /** Relationship type — camelCase name or PascalCase sysmlName. */
    type: string;
    /** Element occupying the relationship's source end. */
    sourceId: string;
    /** Element occupying the relationship's target end. */
    targetId: string;
    /** Direction the user chose, relative to the element they had selected. */
    direction: RelationshipDirection;
    /** Element the user had selected when they opened the dialog. */
    selectedElementId?: string;
    /** Requested owning package or project-relative file, when the user picked one. */
    owningFile?: string;
    /** Diagram the request was invoked from, when invoked from a diagram. */
    diagramId?: string;
    /** Optional item or information flow transported by the connector. */
    flowItem?: string;
}

/** A request to delete one model relationship. */
export interface RelationshipDeleteRequest {
    requestId: string;
    /** Stable relationship ID (the connection usage name). */
    relationshipId: string;
    /** Source file the caller believes owns it — checked against the model. */
    sourceFile?: string;
}

/** Machine-readable codes so callers can branch without matching on prose. */
export type RelationshipDiagnosticCode =
    | 'REL-001'   // unknown relationship type
    | 'REL-002'   // kind cannot occupy that end
    | 'REL-003'   // duplicate relationship
    | 'REL-004'   // endpoint multiplicity exceeded
    | 'REL-005'   // valid in the model, not permitted in the active view profile
    | 'REL-006'   // unknown element
    | 'REL-007'   // prohibited self-relationship
    | 'REL-008'   // wrong direction
    | 'REL-009'   // no writable project package can own the relationship
    | 'REL-010';  // relationship not found (delete)

/** One actionable validation failure. */
export interface RelationshipDiagnostic {
    code: RelationshipDiagnosticCode;
    message: string;
    /** 'error' blocks the mutation; 'warning' is advisory (view-profile fit). */
    severity: 'error' | 'warning';
}

/** Outcome of validating a mutation request. */
export interface RelationshipValidationResult {
    /** True when no error-severity diagnostic was raised. */
    valid: boolean;
    diagnostics: RelationshipDiagnostic[];
    /** Normalized camelCase relationship type, when the type resolved. */
    normalizedType?: string;
    /** The resolved definition, when the type resolved. */
    definition?: RelationshipDefinitionDTO;
}

// ─── Structural properties ──────────────────────────────────────────────────
//
// Read from the ontology, with a documented reading when it stays silent. The
// defaults are deliberately the restrictive ones: a relation that has not been
// characterized should not silently permit self-links or repeats. Both are
// stated once here rather than assumed at each call site.

/** How an undeclared `isReflexive` is read. */
export const SELF_LINK_ALLOWED_BY_DEFAULT = false;

/** How an undeclared `isUnique` is read (unique ⇒ duplicates refused). */
export const DUPLICATES_ALLOWED_BY_DEFAULT = false;

/** Whether this relation permits an element to be related to itself. */
export function allowsSelfLink(definition: RelationshipDefinitionDTO): boolean {
    return definition.isReflexive ?? SELF_LINK_ALLOWED_BY_DEFAULT;
}

/** Whether this relation permits the same ordered pair to be linked twice. */
export function allowsDuplicates(definition: RelationshipDefinitionDTO): boolean {
    // isUnique is stated positively in the ontology; duplicates are its inverse.
    if (definition.isUnique === undefined) return DUPLICATES_ALLOWED_BY_DEFAULT;
    return !definition.isUnique;
}

/**
 * How constrained a relation is, as the number of ends it types (0–2).
 *
 * Read off the ontology rather than a curated list: a relation that types both
 * ends says the most about what it connects, and one that types neither can
 * join anything. Callers order by this so precise relations are offered ahead
 * of general ones.
 */
export function relationshipSpecificity(definition: RelationshipDefinitionDTO): number {
    return (definition.sourceEnd.type ? 1 : 0) + (definition.targetEnd.type ? 1 : 0);
}

/**
 * True for a relation that can join any two elements because it types neither
 * end — MemoLink and anything else declared the same way. These are the
 * fallback when no specific relation carries the meaning, so they are offered
 * last rather than suppressed.
 */
export function isUniversalRelationship(definition: RelationshipDefinitionDTO): boolean {
    return relationshipSpecificity(definition) === 0;
}

/** Order definitions most-specific first, then alphabetically for stability. */
function bySpecificity(
    a: RelationshipDefinitionDTO,
    b: RelationshipDefinitionDTO,
): number {
    return relationshipSpecificity(b) - relationshipSpecificity(a)
        || a.label.localeCompare(b.label);
}

// ─── Registry lookup helpers ────────────────────────────────────────────────

/** Index kind definitions by name for O(1) supertype walks. */
export function indexKinds(kinds: KindDefinitionDTO[]): Map<string, KindDefinitionDTO> {
    return new Map(kinds.map(k => [k.name, k]));
}

/**
 * Resolve a relationship definition by camelCase name or PascalCase sysmlName.
 * Callers may hold either form (the model uses camelCase, SysML source uses
 * PascalCase), so both resolve to the same definition.
 */
export function findRelationshipDefinition(
    type: string,
    registries: OntologyRegistriesDTO,
): RelationshipDefinitionDTO | undefined {
    if (!type) return undefined;
    return registries.relationships.find(r => r.name === type || r.sysmlName === type);
}

// ─── kindConformsTo ─────────────────────────────────────────────────────────

/**
 * True when `actualKind` may occupy an end declared as `expectedKind`.
 *
 * Conformance is transitive over the kind specialization chain, so
 * HardwareAssembly :> ArchitectureElement :> MemoPart conforms to all three.
 * An undefined or empty expected type accepts any kind (untyped end).
 */
export function kindConformsTo(
    actualKind: string,
    expectedKind: string | undefined,
    kindRegistry: Map<string, KindDefinitionDTO> | KindDefinitionDTO[],
): boolean {
    if (!expectedKind) return true;      // untyped end accepts anything
    if (!actualKind) return false;
    if (actualKind === expectedKind) return true;

    const index = Array.isArray(kindRegistry) ? indexKinds(kindRegistry) : kindRegistry;

    let current: string | undefined = actualKind;
    const seen = new Set<string>();
    while (current && !seen.has(current)) {
        if (current === expectedKind) return true;
        seen.add(current);
        current = index.get(current)?.superType;
    }
    return false;
}

// ─── legalRelationshipDirections ────────────────────────────────────────────

/**
 * Which ends of `definition` the element may occupy.
 *
 * 'outgoing' means the element can sit on the source end (element → other);
 * 'incoming' means it can sit on the target end (other → element). An element
 * whose kind conforms to both ends legally supports both directions.
 */
export function legalRelationshipDirections(
    selectedElement: Pick<MemoElement, 'kind'>,
    definition: RelationshipDefinitionDTO,
    registries: OntologyRegistriesDTO,
): RelationshipDirection[] {
    if (definition.isAbstract) return [];

    const kinds = indexKinds(registries.kinds);
    const directions: RelationshipDirection[] = [];
    if (kindConformsTo(selectedElement.kind, definition.sourceEnd.type, kinds)) directions.push('outgoing');
    if (kindConformsTo(selectedElement.kind, definition.targetEnd.type, kinds)) directions.push('incoming');
    return directions;
}

/**
 * Every relationship type the element can participate in, with the directions
 * it may take. This is what the Properties panel lists under Add Relationship
 * before the user has picked an opposite endpoint.
 */
export function legalRelationshipsForElement(
    selectedElement: Pick<MemoElement, 'kind'>,
    registries: OntologyRegistriesDTO,
): Array<{ definition: RelationshipDefinitionDTO; directions: RelationshipDirection[] }> {
    const result: Array<{ definition: RelationshipDefinitionDTO; directions: RelationshipDirection[] }> = [];
    for (const definition of registries.relationships) {
        const directions = legalRelationshipDirections(selectedElement, definition, registries);
        if (directions.length > 0) result.push({ definition, directions });
    }
    // Specific relations first; universal ones like MemoLink fall to the end.
    return result.sort((a, b) => bySpecificity(a.definition, b.definition));
}

// ─── legalRelationshipTypes ─────────────────────────────────────────────────

/** One legal (type, direction) pair between two concrete elements. */
export interface LegalRelationshipOption {
    definition: RelationshipDefinitionDTO;
    /** Direction relative to `sourceElement` — the first argument. */
    direction: RelationshipDirection;
    /** Element that ends up on the source end for this option. */
    sourceId: string;
    /** Element that ends up on the target end for this option. */
    targetId: string;
}

/**
 * All relationship types legal between two specific elements, in both
 * directions. Backs the target-first workflow: pick any element, then see only
 * the links that could actually connect the two.
 *
 * `direction` is stated relative to `sourceElement`, so an 'incoming' option
 * means sourceElement occupies the target end.
 */
export function legalRelationshipTypes(
    sourceElement: Pick<MemoElement, 'id' | 'kind'>,
    targetElement: Pick<MemoElement, 'id' | 'kind'>,
    registries: OntologyRegistriesDTO,
): LegalRelationshipOption[] {
    const kinds = indexKinds(registries.kinds);
    const options: LegalRelationshipOption[] = [];

    for (const definition of registries.relationships) {
        if (definition.isAbstract) continue;

        // Forward: sourceElement on the source end, targetElement on the target end.
        if (
            kindConformsTo(sourceElement.kind, definition.sourceEnd.type, kinds) &&
            kindConformsTo(targetElement.kind, definition.targetEnd.type, kinds)
        ) {
            options.push({
                definition,
                direction: 'outgoing',
                sourceId: sourceElement.id,
                targetId: targetElement.id,
            });
        }

        // Reverse: targetElement on the source end, sourceElement on the target end.
        if (
            kindConformsTo(targetElement.kind, definition.sourceEnd.type, kinds) &&
            kindConformsTo(sourceElement.kind, definition.targetEnd.type, kinds)
        ) {
            options.push({
                definition,
                direction: 'incoming',
                sourceId: targetElement.id,
                targetId: sourceElement.id,
            });
        }
    }

    // Specific relations first, so a universal fallback never displaces a
    // relation that actually carries the meaning.
    return options.sort((a, b) => bySpecificity(a.definition, b.definition));
}

// ─── compatibleRelationshipTargets ──────────────────────────────────────────

/** Filters applied to the opposite-endpoint search. */
export interface TargetFilter {
    /** Free text matched against element name, id and shortId. */
    query?: string;
    kind?: string;
    layer?: string;
    package?: string;
}

/** One candidate for the opposite endpoint, carrying its grouping keys. */
export interface RelationshipTargetCandidate {
    element: MemoElement;
    kind: string;
    layer: string;
    package?: string;
}

/**
 * Every element in the loaded model that may legally occupy the opposite end.
 *
 * Searches the complete model — not only what the active diagram shows — and
 * excludes the selected element itself, since self-relationships are prohibited.
 */
export function compatibleRelationshipTargets(
    selectedElement: Pick<MemoElement, 'id' | 'kind'>,
    definition: RelationshipDefinitionDTO,
    direction: RelationshipDirection,
    model: Pick<MemoModelDTO, 'elements'>,
    registries: OntologyRegistriesDTO,
    filter?: TargetFilter,
): RelationshipTargetCandidate[] {
    const kinds = indexKinds(registries.kinds);

    // Outgoing: the selected element holds the source end, so candidates must
    // conform to the target end — and the reverse for incoming.
    const oppositeEnd = direction === 'outgoing' ? definition.targetEnd : definition.sourceEnd;

    // The selected element must legally hold its own end, or nothing is offered.
    const ownEnd = direction === 'outgoing' ? definition.sourceEnd : definition.targetEnd;
    if (!kindConformsTo(selectedElement.kind, ownEnd.type, kinds)) return [];

    const query = filter?.query?.trim().toLowerCase();
    const candidates: RelationshipTargetCandidate[] = [];

    for (const element of Object.values(model.elements)) {
        if (element.id === selectedElement.id) continue;                  // no self-links
        if (!kindConformsTo(element.kind, oppositeEnd.type, kinds)) continue;
        if (filter?.kind && element.kind !== filter.kind) continue;
        if (filter?.layer && element.layer !== filter.layer) continue;
        if (filter?.package && element.package !== filter.package) continue;
        if (query) {
            const haystack = [element.name, element.id, element.shortId, element.kind]
                .filter(Boolean).join(' ').toLowerCase();
            if (!haystack.includes(query)) continue;
        }
        candidates.push({
            element,
            kind: element.kind,
            layer: element.layer,
            package: element.package,
        });
    }

    candidates.sort((a, b) =>
        a.layer.localeCompare(b.layer) ||
        a.kind.localeCompare(b.kind) ||
        a.element.name.localeCompare(b.element.name));

    return candidates;
}

/** Group candidates by kind within layer, for the picker's section headers. */
export function groupTargetsByKindAndLayer(
    candidates: RelationshipTargetCandidate[],
): Array<{ layer: string; kind: string; elements: MemoElement[] }> {
    const groups = new Map<string, { layer: string; kind: string; elements: MemoElement[] }>();
    for (const candidate of candidates) {
        const key = `${candidate.layer} ${candidate.kind}`;
        let group = groups.get(key);
        if (!group) {
            group = { layer: candidate.layer, kind: candidate.kind, elements: [] };
            groups.set(key, group);
        }
        group.elements.push(candidate.element);
    }
    return Array.from(groups.values());
}

// ─── validateRelationshipMutation ───────────────────────────────────────────

/** View profile the relationship would have to satisfy to be drawn. */
export interface ViewProfileContext {
    diagramId: string;
    /** Relationship types the view permits. Empty/undefined means unrestricted. */
    permittedRelationshipTypes?: string[];
    /** Elements the view selects. Empty/undefined means unrestricted. */
    elementIds?: string[];
}

/** Everything validation needs beyond the model and registries. */
export interface RelationshipMutationContext {
    /** Profile of the diagram the request came from, when there was one. */
    viewProfile?: ViewProfileContext;
    /** False when the project has no writable package able to own the link. */
    hasWritableOwner?: boolean;
}

/**
 * The complete legality check for a create request. The client runs this to
 * shape the UI; the server runs the identical function again before touching a
 * file, so a stale or hand-crafted request cannot bypass the ontology.
 */
export function validateRelationshipMutation(
    request: RelationshipCreateRequest,
    model: Pick<MemoModelDTO, 'elements' | 'relationships'>,
    registries: OntologyRegistriesDTO,
    context?: RelationshipMutationContext,
): RelationshipValidationResult {
    const diagnostics: RelationshipDiagnostic[] = [];
    const error = (code: RelationshipDiagnosticCode, message: string) =>
        diagnostics.push({ code, message, severity: 'error' });

    // REL-001 — the relationship type must exist in the ontology.
    const definition = findRelationshipDefinition(request.type, registries);
    if (!definition) {
        error('REL-001', `Unknown relationship type "${request.type}"`);
        return { valid: false, diagnostics };
    }
    if (definition.isAbstract) {
        error('REL-001', `Relationship type "${definition.sysmlName}" is abstract and cannot be instantiated`);
        return { valid: false, diagnostics, normalizedType: definition.name, definition };
    }

    const normalizedType = definition.name;

    // REL-006 — both endpoints must exist in the loaded model.
    const source = model.elements[request.sourceId];
    const target = model.elements[request.targetId];
    if (!source) error('REL-006', `Source element "${request.sourceId}" does not exist in the model`);
    if (!target) error('REL-006', `Target element "${request.targetId}" does not exist in the model`);
    if (!source || !target) return { valid: false, diagnostics, normalizedType, definition };

    // REL-007 — self-links, permitted only where the relation declares itself
    // reflexive. This is the ontology's call, not a universal truth: some
    // relations legitimately relate an element to itself.
    if (request.sourceId === request.targetId && !allowsSelfLink(definition)) {
        error('REL-007', `${source.name} cannot be related to itself by ${definition.label}`);
    }

    const kinds = indexKinds(registries.kinds);

    // REL-002 — each endpoint's kind must conform to its declared end type.
    if (!kindConformsTo(source.kind, definition.sourceEnd.type, kinds)) {
        error('REL-002', `${source.kind} cannot occupy the ${definition.sourceEnd.name} end of ${definition.label}`);
    }
    if (!kindConformsTo(target.kind, definition.targetEnd.type, kinds)) {
        error('REL-002', `${target.kind} cannot occupy the ${definition.targetEnd.name} end of ${definition.label}`);
    }

    // REL-008 — the stated direction must match the ends the elements occupy.
    // The request is always normalized to source→target, so the element the
    // user selected has to sit on the end its chosen direction implies.
    if (request.selectedElementId) {
        const expectedId = request.direction === 'outgoing' ? request.sourceId : request.targetId;
        if (request.selectedElementId !== expectedId) {
            error('REL-008', `Direction "${request.direction}" does not place ${
                model.elements[request.selectedElementId]?.name ?? request.selectedElementId
            } on the ${request.direction === 'outgoing' ? definition.sourceEnd.name : definition.targetEnd.name} end of ${definition.label}`);
        }
    }

    // REL-003 — repeats of the same ordered pair, refused unless the relation
    // declares itself non-unique.
    if (!allowsDuplicates(definition)) {
        const duplicate = model.relationships.find(rel =>
            rel.type === normalizedType &&
            rel.sourceId === request.sourceId &&
            rel.targetId === request.targetId);
        if (duplicate) {
            error('REL-003', `This exact relationship already exists (${duplicate.id})`);
        }
    }

    // REL-004 — declared end multiplicity caps how many links an endpoint takes.
    const sourceViolation = multiplicityViolation(
        definition, 'source', request, model, normalizedType);
    if (sourceViolation) error('REL-004', sourceViolation);
    const targetViolation = multiplicityViolation(
        definition, 'target', request, model, normalizedType);
    if (targetViolation) error('REL-004', targetViolation);

    // REL-009 — the relationship has to be expressible from a writable package.
    if (context?.hasWritableOwner === false) {
        error('REL-009', 'No writable project package can own this relationship');
    }

    // REL-005 — a warning, not an error: the model accepts the relationship, the
    // active view simply will not display it. Creation still proceeds.
    if (context?.viewProfile) {
        const permitted = context.viewProfile.permittedRelationshipTypes;
        if (permitted && permitted.length > 0 && !permitted.includes(normalizedType)) {
            diagnostics.push({
                code: 'REL-005',
                severity: 'warning',
                message: `The relationship is valid in the model but is not permitted in the active ${
                    context.viewProfile.diagramId} view`,
            });
        }
    }

    return {
        valid: !diagnostics.some(d => d.severity === 'error'),
        diagnostics,
        normalizedType,
        definition,
    };
}

/**
 * Check one end's declared upper bound against links already in the model.
 * Returns a message when adding this relationship would exceed it.
 */
function multiplicityViolation(
    definition: RelationshipDefinitionDTO,
    end: 'source' | 'target',
    request: RelationshipCreateRequest,
    model: Pick<MemoModelDTO, 'elements' | 'relationships'>,
    normalizedType: string,
): string | undefined {
    const endDef = end === 'source' ? definition.sourceEnd : definition.targetEnd;
    const upper = endDef.multiplicity?.upper;
    if (upper === undefined || upper === null) return undefined;   // undeclared or unbounded

    // A bound on the source end limits how many source elements one target may
    // have, and vice versa — it constrains the opposite endpoint's link count.
    const anchorId = end === 'source' ? request.targetId : request.sourceId;
    const existing = model.relationships.filter(rel =>
        rel.type === normalizedType &&
        (end === 'source' ? rel.targetId === anchorId : rel.sourceId === anchorId));

    if (existing.length >= upper) {
        const anchor = model.elements[anchorId];
        return `${anchor?.kind ?? 'Element'} ${anchor?.name ?? anchorId} already has the maximum permitted ${
            endDef.name} (${upper}) for ${definition.label}`;
    }
    return undefined;
}

/** Validate a delete request against the loaded model. */
export function validateRelationshipDeletion(
    request: RelationshipDeleteRequest,
    model: Pick<MemoModelDTO, 'relationships'>,
): { valid: boolean; diagnostics: RelationshipDiagnostic[]; relationship?: MemoRelationship } {
    const relationship = model.relationships.find(rel => rel.id === request.relationshipId);
    if (!relationship) {
        return {
            valid: false,
            diagnostics: [{
                code: 'REL-010',
                severity: 'error',
                message: `Relationship "${request.relationshipId}" was not found in the model`,
            }],
        };
    }
    return { valid: true, diagnostics: [], relationship };
}

// ─── Presentation helpers ───────────────────────────────────────────────────

/**
 * Plain-language preview of a pending relationship, e.g.
 * "Infusion Controller — satisfies → Software Requirement SR-104".
 * Shared so the Properties panel and the diagram picker word it identically.
 */
export function describeRelationship(
    definition: RelationshipDefinitionDTO,
    source: Pick<MemoElement, 'name' | 'kind'> | undefined,
    target: Pick<MemoElement, 'name' | 'kind'> | undefined,
    options?: { sourceId?: string; targetId?: string },
): string {
    const sourceLabel = source?.name ?? options?.sourceId ?? 'Unknown';
    const targetLabel = target ? `${target.kind} ${target.name}` : (options?.targetId ?? 'Unknown');
    return `${sourceLabel} — ${definition.label.toLowerCase()} → ${targetLabel}`;
}

/**
 * Whether an existing relationship should be drawn in a given view: both
 * endpoints selected by the view, and the type permitted by its profile.
 */
export function isRelationshipVisibleInView(
    relationship: Pick<MemoRelationship, 'type' | 'sourceId' | 'targetId'>,
    profile: ViewProfileContext,
): boolean {
    const permitted = profile.permittedRelationshipTypes;
    if (permitted && permitted.length > 0 && !permitted.includes(relationship.type)) return false;

    const elementIds = profile.elementIds;
    if (elementIds && elementIds.length > 0) {
        if (!elementIds.includes(relationship.sourceId)) return false;
        if (!elementIds.includes(relationship.targetId)) return false;
    }
    return true;
}
