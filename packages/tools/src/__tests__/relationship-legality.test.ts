import { describe, it, expect } from 'vitest';
import {
    compatibleRelationshipTargets,
    describeRelationship,
    findRelationshipDefinition,
    isRelationshipVisibleInView,
    isUniversalRelationship,
    kindConformsTo,
    relationshipSpecificity,
    legalRelationshipDirections,
    legalRelationshipTypes,
    legalRelationshipsForElement,
    validateRelationshipDeletion,
    validateRelationshipMutation,
    type KindDefinitionDTO,
    type OntologyRegistriesDTO,
    type RelationshipCreateRequest,
} from '../model/relationship-legality.js';
import type { MemoElement, MemoModelDTO, MemoRelationship } from '../model/semantic.js';

// ─── Fixture ontology ───────────────────────────────────────────────────────
//
// A miniature of the MEMO shape: an abstract MemoPart root, two abstract
// mid-tier, and concrete kinds three levels down, so conformance has a real
// chain to walk rather than a single hop.

const kinds: KindDefinitionDTO[] = [
    { name: 'MemoPart', label: 'Memo Part', layer: 'core', construct: 'part def', isAbstract: true },
    { name: 'VerifiableElement', label: 'Verifiable Element', layer: 'core', construct: 'requirement def', isAbstract: true },
    // Requirement :> VerifiableElement (the requirement metaclass is separate from MemoPart)
    { name: 'Requirement', label: 'Requirement', layer: 'requirements', construct: 'requirement def', superType: 'VerifiableElement' },
    { name: 'SoftwareRequirement', label: 'Software Requirement', layer: 'requirements', construct: 'requirement def', superType: 'Requirement' },
    // SoftwareComponent :> LogicalComponent :> MemoPart
    { name: 'LogicalComponent', label: 'Logical Component', layer: 'logical', construct: 'part def', superType: 'MemoPart' },
    { name: 'SoftwareComponent', label: 'Software Component', layer: 'software', construct: 'part def', superType: 'LogicalComponent' },
    { name: 'VerificationCase', label: 'Verification Case', layer: 'verification', construct: 'verification def', superType: 'VerifiableElement' },
    // Deliberately outside both mid-tiers — conforms only to MemoPart.
    { name: 'OperationalActivity', label: 'Operational Activity', layer: 'operational', construct: 'action def', superType: 'MemoPart' },
];

const registries: OntologyRegistriesDTO = {
    kinds,
    relationships: [
        {
            name: 'memoRelationship', sysmlName: 'MemoRelationship', label: 'Memo Relationship',
            layer: 'core', isAbstract: true,
            sourceEnd: { name: 'from', type: 'MemoPart' },
            targetEnd: { name: 'to', type: 'MemoPart' },
        },
        {
            // A MEMO part satisfies a requirement — the element can only
            // ever be the source here.
            name: 'satisfiedBy', sysmlName: 'SatisfiedBy', label: 'Satisfied By',
            layer: 'requirements',
            description: 'A design element satisfies a requirement.',
            sourceEnd: { name: 'satisfyingElement', type: 'MemoPart' },
            targetEnd: { name: 'requiredElement', type: 'VerifiableElement' },
        },
        {
            name: 'verifiedBy', sysmlName: 'VerifiedBy', label: 'Verified By',
            layer: 'verification',
            sourceEnd: { name: 'verificationTarget', type: 'MemoPart' },
            targetEnd: { name: 'verificationCase', type: 'VerificationCase' },
        },
        {
            // Both ends accept MemoPart, so any element can take either end.
            name: 'tracesTo', sysmlName: 'TracesTo', label: 'Traces To',
            layer: 'core',
            sourceEnd: { name: 'tracingElement', type: 'MemoPart' },
            targetEnd: { name: 'tracedElement', type: 'MemoPart' },
        },
        {
            // A requirement may have at most one owner.
            name: 'ownedBy', sysmlName: 'OwnedBy', label: 'Owned By',
            layer: 'requirements',
            sourceEnd: { name: 'owner', type: 'MemoPart', multiplicity: { lower: 0, upper: 1 } },
            targetEnd: { name: 'ownedRequirement', type: 'Requirement' },
        },
        {
            // Neither end typed — the universal fallback, as MemoLink is declared.
            name: 'memoLink', sysmlName: 'MemoLink', label: 'Memo Link', layer: 'core',
            description: 'Generic association between any two model elements.',
            sourceEnd: { name: 'linkSource' },
            targetEnd: { name: 'linkTarget' },
        },
    ],
};

/** The fixture registry without the universal relation, for isolation. */
const typedOnly: OntologyRegistriesDTO = {
    kinds,
    relationships: registries.relationships.filter(r => r.name !== 'memoLink'),
};

function element(id: string, kind: string, overrides: Partial<MemoElement> = {}): MemoElement {
    return {
        id,
        name: id,
        kind,
        construct: 'part',
        layer: kinds.find(k => k.name === kind)?.layer ?? 'core',
        file: `model/catalog/${id}.sysml`,
        attributes: {},
        ...overrides,
    };
}

const controller = element('infusionController', 'SoftwareComponent', { name: 'Infusion Controller', package: 'InfusionPump' });
const requirement = element('SR104', 'SoftwareRequirement', { name: 'SR-104', package: 'InfusionPump' });
const verification = element('vcDoseLimit', 'VerificationCase', { name: 'Dose Limit Test', package: 'InfusionPump' });
const activity = element('opAdministerDose', 'OperationalActivity', { name: 'Administer Dose', package: 'Operations' });

function modelWith(
    elements: MemoElement[],
    relationships: MemoRelationship[] = [],
): Pick<MemoModelDTO, 'elements' | 'relationships'> {
    return {
        elements: Object.fromEntries(elements.map(el => [el.id, el])),
        relationships,
    };
}

function relationship(
    id: string, type: string, sourceId: string, targetId: string,
): MemoRelationship {
    return {
        id, type, sourceId, targetId,
        sourceEnd: 'source', targetEnd: 'target',
        file: 'model/relationships.sysml',
        named: true,
    };
}

function createRequest(overrides: Partial<RelationshipCreateRequest> = {}): RelationshipCreateRequest {
    return {
        requestId: 'req-1',
        type: 'satisfiedBy',
        sourceId: controller.id,
        targetId: requirement.id,
        direction: 'outgoing',
        ...overrides,
    };
}

// ─── kindConformsTo ─────────────────────────────────────────────────────────

describe('kindConformsTo', () => {
    it('matches a kind against itself', () => {
        expect(kindConformsTo('Requirement', 'Requirement', kinds)).toBe(true);
    });

    it('matches through transitive specialization', () => {
        // SoftwareComponent :> LogicalComponent :> MemoPart
        expect(kindConformsTo('SoftwareComponent', 'LogicalComponent', kinds)).toBe(true);
        expect(kindConformsTo('SoftwareComponent', 'MemoPart', kinds)).toBe(true);
    });

    it('rejects a kind from a sibling branch', () => {
        expect(kindConformsTo('SoftwareComponent', 'VerifiableElement', kinds)).toBe(false);
        expect(kindConformsTo('OperationalActivity', 'LogicalComponent', kinds)).toBe(false);
    });

    it('does not match in the wrong direction along the chain', () => {
        // A MemoPart is not necessarily a SoftwareComponent.
        expect(kindConformsTo('MemoPart', 'SoftwareComponent', kinds)).toBe(false);
    });

    it('treats an untyped end as accepting any kind', () => {
        expect(kindConformsTo('Requirement', undefined, kinds)).toBe(true);
    });

    it('terminates on a cyclic supertype chain', () => {
        const cyclic: KindDefinitionDTO[] = [
            { name: 'A', label: 'A', layer: 'x', construct: 'part def', superType: 'B' },
            { name: 'B', label: 'B', layer: 'x', construct: 'part def', superType: 'A' },
        ];
        expect(kindConformsTo('A', 'Unrelated', cyclic)).toBe(false);
    });
});

// ─── Direction legality ─────────────────────────────────────────────────────

describe('legalRelationshipDirections', () => {
    it('offers only outgoing when the element fits the source end alone', () => {
        // SoftwareComponent is a MemoPart but not a VerifiableElement.
        const satisfiedBy = findRelationshipDefinition('satisfiedBy', registries)!;
        expect(legalRelationshipDirections(controller, satisfiedBy, registries)).toEqual(['outgoing']);
    });

    it('offers only incoming when the element fits the target end alone', () => {
        // SoftwareRequirement is a VerifiableElement but not a LogicalComponent.
        const satisfiedBy = findRelationshipDefinition('satisfiedBy', registries)!;
        expect(legalRelationshipDirections(requirement, satisfiedBy, registries)).toEqual(['incoming']);
    });

    it('offers both directions when the element fits both ends', () => {
        const tracesTo = findRelationshipDefinition('tracesTo', registries)!;
        expect(legalRelationshipDirections(controller, tracesTo, registries)).toEqual(['outgoing', 'incoming']);
    });

    it('never offers an abstract relationship definition', () => {
        const abstract = findRelationshipDefinition('memoRelationship', registries)!;
        expect(legalRelationshipDirections(controller, abstract, registries)).toEqual([]);
    });

    it('excludes abstract definitions from the element-wide list', () => {
        const offered = legalRelationshipsForElement(controller, registries);
        expect(offered.map(o => o.definition.name)).not.toContain('memoRelationship');
        expect(offered.map(o => o.definition.name)).toContain('satisfiedBy');
    });
});

// ─── Target-first flow ──────────────────────────────────────────────────────

describe('legalRelationshipTypes', () => {
    it('lists only relationships legal between the two kinds', () => {
        const options = legalRelationshipTypes(controller, requirement, registries);
        const names = options.map(o => o.definition.name);
        expect(names).toContain('satisfiedBy');
        expect(names).not.toContain('tracesTo');
        // A requirement is not a VerificationCase, so verifiedBy cannot apply
        // with the requirement on the target end.
        expect(names).not.toContain('verifiedBy');
    });

    it('states direction relative to the first element', () => {
        const options = legalRelationshipTypes(controller, requirement, registries);
        const satisfies = options.find(o => o.definition.name === 'satisfiedBy')!;
        expect(satisfies.direction).toBe('outgoing');
        expect(satisfies.sourceId).toBe(controller.id);
        expect(satisfies.targetId).toBe(requirement.id);
    });

    it('reverses source and target for an incoming option', () => {
        const options = legalRelationshipTypes(requirement, controller, registries);
        const satisfies = options.find(o => o.definition.name === 'satisfiedBy')!;
        expect(satisfies.direction).toBe('incoming');
        // The MemoPart still ends up on the satisfying end.
        expect(satisfies.sourceId).toBe(controller.id);
        expect(satisfies.targetId).toBe(requirement.id);
    });

    it('narrows to the typed relations that fit the pairing', () => {
        // OperationalActivity conforms only to MemoPart, so of the typed
        // relations only those with MemoPart source ends can apply.
        const options = legalRelationshipTypes(activity, verification, typedOnly);
        const outgoing = options.filter(o => o.direction === 'outgoing');
        expect(outgoing.map(o => o.definition.name).sort()).toEqual(['satisfiedBy', 'verifiedBy']);
    });

    it('returns nothing when no relationship can join the two kinds', () => {
        const isolated: OntologyRegistriesDTO = {
            kinds,
            relationships: [findRelationshipDefinition('satisfiedBy', registries)!],
        };
        // Two MEMO parts: neither can occupy the native requirement end.
        const other = element('pumpDriver', 'SoftwareComponent');
        expect(legalRelationshipTypes(controller, other, isolated)).toEqual([]);
    });
});

// ─── The universal relation ─────────────────────────────────────────────────
//
// MemoLink types neither end, which is what lets it cross metaclass families:
// MEMO's foundations (MemoPart, MemoAction, MemoPort, …) share no supertype, so
// a typed end can never join a part to an action.

describe('universal relationships', () => {
    const memoLink = findRelationshipDefinition('memoLink', registries)!;

    it('is recognised as universal, and typed relations are not', () => {
        expect(isUniversalRelationship(memoLink)).toBe(true);
        expect(isUniversalRelationship(findRelationshipDefinition('satisfiedBy', registries)!)).toBe(false);
    });

    it('scores lowest on specificity', () => {
        expect(relationshipSpecificity(memoLink)).toBe(0);
        expect(relationshipSpecificity(findRelationshipDefinition('satisfiedBy', registries)!)).toBe(2);
    });

    it('is legal in both directions for every kind', () => {
        for (const el of [controller, requirement, verification, activity]) {
            expect(legalRelationshipDirections(el, memoLink, registries)).toEqual(['outgoing', 'incoming']);
        }
    });

    it('joins two elements no typed relation can connect', () => {
        // An action and a port sit in different metaclass families entirely.
        const action = element('actDeliverBolus', 'OperationalActivity');
        const port = element('portDoseCmd', 'PortKindThatNoRelationTypes');
        const options = legalRelationshipTypes(action, port, registries);
        expect([...new Set(options.map(o => o.definition.name))]).toEqual(['memoLink']);
        // Both ends accept anything, so it is offered in both directions.
        expect(options.map(o => o.direction).sort()).toEqual(['incoming', 'outgoing']);

        // Without it, that pairing has nothing at all.
        expect(legalRelationshipTypes(action, port, typedOnly)).toEqual([]);
    });

    it('offers every other element in the model as a target', () => {
        const model = modelWith([controller, requirement, verification, activity]);
        const targets = compatibleRelationshipTargets(controller, memoLink, 'outgoing', model, registries);
        expect(targets.map(t => t.element.id).sort())
            .toEqual(['SR104', 'opAdministerDose', 'vcDoseLimit']);
    });

    it('still refuses a self-link and a duplicate', () => {
        const withExisting = modelWith(
            [controller, requirement],
            [relationship('rel_link', 'memoLink', controller.id, requirement.id)]);

        const selfLink = validateRelationshipMutation(
            createRequest({ type: 'memoLink', sourceId: controller.id, targetId: controller.id }),
            withExisting, registries);
        expect(selfLink.diagnostics.some(d => d.code === 'REL-007')).toBe(true);

        const duplicate = validateRelationshipMutation(
            createRequest({ type: 'memoLink' }), withExisting, registries);
        expect(duplicate.diagnostics.some(d => d.code === 'REL-003')).toBe(true);
    });

    it('validates as a normal relationship between any two kinds', () => {
        const model = modelWith([controller, activity]);
        const result = validateRelationshipMutation(
            createRequest({ type: 'memoLink', sourceId: controller.id, targetId: activity.id }),
            model, registries);
        expect(result.valid).toBe(true);
        expect(result.normalizedType).toBe('memoLink');
    });

    it('is offered last, behind every relation that carries meaning', () => {
        const forElement = legalRelationshipsForElement(controller, registries);
        expect(forElement.at(-1)!.definition.name).toBe('memoLink');

        const forPair = legalRelationshipTypes(controller, requirement, registries);
        expect(forPair.at(-1)!.definition.name).toBe('memoLink');
        // And it never displaces a typed relation from the front.
        expect(forPair[0].definition.name).not.toBe('memoLink');
    });
});

// ─── Compatible targets ─────────────────────────────────────────────────────

describe('compatibleRelationshipTargets', () => {
    const model = modelWith([controller, requirement, verification, activity]);

    it('offers only elements that fit the opposite end', () => {
        const satisfiedBy = findRelationshipDefinition('satisfiedBy', registries)!;
        const targets = compatibleRelationshipTargets(controller, satisfiedBy, 'outgoing', model, registries);
        // Only VerifiableElements qualify: the requirement and the verification case.
        expect(targets.map(t => t.element.id).sort()).toEqual(['SR104', 'vcDoseLimit']);
    });

    it('offers source-end candidates when the direction is incoming', () => {
        const satisfiedBy = findRelationshipDefinition('satisfiedBy', registries)!;
        const targets = compatibleRelationshipTargets(requirement, satisfiedBy, 'incoming', model, registries);
        expect(targets.map(t => t.element.id).sort()).toEqual(['infusionController', 'opAdministerDose']);
    });

    it('never offers the selected element itself', () => {
        const tracesTo = findRelationshipDefinition('tracesTo', registries)!;
        const targets = compatibleRelationshipTargets(controller, tracesTo, 'outgoing', model, registries);
        expect(targets.map(t => t.element.id)).not.toContain(controller.id);
    });

    it('offers nothing when the element cannot hold its own end', () => {
        const satisfiedBy = findRelationshipDefinition('satisfiedBy', registries)!;
        // A requirement cannot be the satisfying element.
        expect(compatibleRelationshipTargets(requirement, satisfiedBy, 'outgoing', model, registries)).toEqual([]);
    });

    it('searches the complete model, not only elements in the current diagram', () => {
        // The diagram shows one element; the search still reaches the rest.
        const diagramElementIds = [controller.id];
        const tracesTo = findRelationshipDefinition('tracesTo', registries)!;
        const targets = compatibleRelationshipTargets(controller, tracesTo, 'outgoing', model, registries);

        const offScreen = targets.filter(t => !diagramElementIds.includes(t.element.id));
        expect(offScreen.length).toBeGreaterThan(0);
        expect(targets.map(t => t.element.id)).toContain(activity.id);
    });

    it('filters by name, kind, layer and package', () => {
        const memoLink = findRelationshipDefinition('memoLink', registries)!;
        const byQuery = compatibleRelationshipTargets(controller, memoLink, 'outgoing', model, registries, { query: 'sr-104' });
        expect(byQuery.map(t => t.element.id)).toEqual(['SR104']);

        const byKind = compatibleRelationshipTargets(controller, memoLink, 'outgoing', model, registries, { kind: 'VerificationCase' });
        expect(byKind.map(t => t.element.id)).toEqual(['vcDoseLimit']);

        const byLayer = compatibleRelationshipTargets(controller, memoLink, 'outgoing', model, registries, { layer: 'operational' });
        expect(byLayer.map(t => t.element.id)).toEqual(['opAdministerDose']);

        const byPackage = compatibleRelationshipTargets(controller, memoLink, 'outgoing', model, registries, { package: 'Operations' });
        expect(byPackage.map(t => t.element.id)).toEqual(['opAdministerDose']);
    });

    it('matches a query against the ID and short ID as well as the name', () => {
        const withShortId = element('sr200', 'SoftwareRequirement', { name: 'Alarm limit', shortId: 'SW-REQ-4291' });
        const searchModel = modelWith([controller, withShortId]);
        const memoLink = findRelationshipDefinition('memoLink', registries)!;
        expect(compatibleRelationshipTargets(controller, memoLink, 'outgoing', searchModel, registries, { query: 'SW-REQ-4291' })
            .map(t => t.element.id)).toEqual(['sr200']);
    });
});

// ─── Mutation validation ────────────────────────────────────────────────────

describe('validateRelationshipMutation', () => {
    const model = modelWith([controller, requirement, verification, activity]);

    it('accepts a well-formed relationship', () => {
        const result = validateRelationshipMutation(createRequest(), model, registries);
        expect(result.valid).toBe(true);
        expect(result.normalizedType).toBe('satisfiedBy');
        expect(result.diagnostics).toEqual([]);
    });

    it('REL-001 rejects an unknown relationship type', () => {
        const result = validateRelationshipMutation(createRequest({ type: 'satisfy' }), model, registries);
        expect(result.valid).toBe(false);
        expect(result.diagnostics[0].code).toBe('REL-001');
        expect(result.diagnostics[0].message).toContain('satisfy');
    });

    it('REL-001 rejects an abstract relationship type', () => {
        const result = validateRelationshipMutation(createRequest({ type: 'memoRelationship' }), model, registries);
        expect(result.valid).toBe(false);
        expect(result.diagnostics[0].code).toBe('REL-001');
    });

    it('normalizes a PascalCase type from the request', () => {
        const result = validateRelationshipMutation(createRequest({ type: 'SatisfiedBy' }), model, registries);
        expect(result.valid).toBe(true);
        expect(result.normalizedType).toBe('satisfiedBy');
    });

    it('REL-002 rejects an illegal source kind', () => {
        // A native requirement cannot be the satisfying MemoPart.
        const result = validateRelationshipMutation(
            createRequest({ sourceId: requirement.id }), model, registries);
        expect(result.valid).toBe(false);
        const diag = result.diagnostics.find(d => d.code === 'REL-002')!;
        expect(diag.message).toContain('SoftwareRequirement');
        expect(diag.message).toContain('satisfyingElement');
    });

    it('REL-002 rejects an illegal target kind', () => {
        const result = validateRelationshipMutation(
            createRequest({ targetId: activity.id }), model, registries);
        expect(result.valid).toBe(false);
        expect(result.diagnostics.some(d => d.code === 'REL-002')).toBe(true);
    });

    it('permits a repeat on a relation the ontology declares non-unique', () => {
        const repeatable: OntologyRegistriesDTO = {
            kinds,
            relationships: [{
                ...findRelationshipDefinition('satisfiedBy', registries)!,
                isUnique: false,
            }],
        };
        const withExisting = modelWith(
            [controller, requirement],
            [relationship('rel_existing', 'satisfiedBy', controller.id, requirement.id)]);
        const result = validateRelationshipMutation(createRequest(), withExisting, repeatable);
        expect(result.valid).toBe(true);
        expect(result.diagnostics.some(d => d.code === 'REL-003')).toBe(false);
    });

    it('REL-003 rejects a duplicate relationship', () => {
        const withExisting = modelWith(
            [controller, requirement],
            [relationship('rel_existing', 'satisfiedBy', controller.id, requirement.id)]);
        const result = validateRelationshipMutation(createRequest(), withExisting, registries);
        expect(result.valid).toBe(false);
        expect(result.diagnostics.find(d => d.code === 'REL-003')!.message).toContain('already exists');
    });

    it('allows the same pair with a different relationship type', () => {
        const withExisting = modelWith(
            [controller, requirement],
            [relationship('rel_existing', 'satisfiedBy', controller.id, requirement.id)]);
        const result = validateRelationshipMutation(
            createRequest({ type: 'memoLink' }), withExisting, registries);
        expect(result.valid).toBe(true);
    });

    it('allows the same type in the opposite direction', () => {
        const withExisting = modelWith(
            [controller, element('otherComponent', 'SoftwareComponent')],
            [relationship('rel_existing', 'tracesTo', controller.id, 'otherComponent')]);
        const result = validateRelationshipMutation(
            createRequest({ type: 'tracesTo', sourceId: 'otherComponent', targetId: controller.id }),
            withExisting, registries);
        expect(result.valid).toBe(true);
    });

    it('REL-004 enforces declared endpoint multiplicity', () => {
        // ownedBy declares owner [0..1]: the requirement already has one.
        const withOwner = modelWith(
            [controller, requirement, element('otherComponent', 'SoftwareComponent')],
            [relationship('rel_owner', 'ownedBy', controller.id, requirement.id)]);
        const result = validateRelationshipMutation(
            createRequest({ type: 'ownedBy', sourceId: 'otherComponent', targetId: requirement.id }),
            withOwner, registries);
        expect(result.valid).toBe(false);
        const diag = result.diagnostics.find(d => d.code === 'REL-004')!;
        expect(diag.message).toContain('maximum permitted owner');
    });

    it('permits the first link on a bounded end', () => {
        const result = validateRelationshipMutation(
            createRequest({ type: 'ownedBy' }), modelWith([controller, requirement]), registries);
        expect(result.valid).toBe(true);
    });

    it('does not bound an end with no declared multiplicity', () => {
        const many = [
            relationship('r1', 'satisfiedBy', controller.id, requirement.id),
            relationship('r2', 'satisfiedBy', 'c2', requirement.id),
            relationship('r3', 'satisfiedBy', 'c3', requirement.id),
        ];
        const model3 = modelWith(
            [controller, requirement, element('c2', 'SoftwareComponent'), element('c3', 'SoftwareComponent'), element('c4', 'SoftwareComponent')],
            many);
        const result = validateRelationshipMutation(
            createRequest({ sourceId: 'c4' }), model3, registries);
        expect(result.valid).toBe(true);
    });

    it('REL-006 rejects an endpoint that is not in the model', () => {
        const result = validateRelationshipMutation(
            createRequest({ targetId: 'ghostRequirement' }), model, registries);
        expect(result.valid).toBe(false);
        expect(result.diagnostics.find(d => d.code === 'REL-006')!.message).toContain('ghostRequirement');
    });

    it('REL-007 rejects a self-relationship when the ontology is silent', () => {
        const result = validateRelationshipMutation(
            createRequest({ type: 'tracesTo', sourceId: controller.id, targetId: controller.id }),
            model, registries);
        expect(result.valid).toBe(false);
        expect(result.diagnostics.some(d => d.code === 'REL-007')).toBe(true);
    });

    it('permits a self-relationship on a relation the ontology declares reflexive', () => {
        const reflexive: OntologyRegistriesDTO = {
            kinds,
            relationships: [{
                ...findRelationshipDefinition('tracesTo', registries)!,
                isReflexive: true,
            }],
        };
        const result = validateRelationshipMutation(
            createRequest({ type: 'tracesTo', sourceId: controller.id, targetId: controller.id }),
            model, reflexive);
        expect(result.valid).toBe(true);
        expect(result.diagnostics.some(d => d.code === 'REL-007')).toBe(false);
    });

    it('REL-008 rejects a direction that contradicts the endpoints', () => {
        // The selected element sits on the source end, but claims 'incoming'.
        const result = validateRelationshipMutation(
            createRequest({ selectedElementId: controller.id, direction: 'incoming' }),
            model, registries);
        expect(result.valid).toBe(false);
        expect(result.diagnostics.some(d => d.code === 'REL-008')).toBe(true);
    });

    it('accepts a correctly stated incoming direction', () => {
        const result = validateRelationshipMutation(
            createRequest({ selectedElementId: requirement.id, direction: 'incoming' }),
            model, registries);
        expect(result.valid).toBe(true);
    });

    it('REL-009 rejects when no writable package can own the relationship', () => {
        const result = validateRelationshipMutation(
            createRequest(), model, registries, { hasWritableOwner: false });
        expect(result.valid).toBe(false);
        expect(result.diagnostics.some(d => d.code === 'REL-009')).toBe(true);
    });

    it('REL-005 warns without blocking when the view profile excludes the type', () => {
        const result = validateRelationshipMutation(createRequest(), model, registries, {
            viewProfile: {
                diagramId: 'functional-flow',
                permittedRelationshipTypes: ['tracesTo'],
            },
        });
        // The model accepts it; only the view cannot draw it.
        expect(result.valid).toBe(true);
        const warning = result.diagnostics.find(d => d.code === 'REL-005')!;
        expect(warning.severity).toBe('warning');
        expect(warning.message).toContain('not permitted in the active');
    });

    it('does not warn when the view profile permits the type', () => {
        const result = validateRelationshipMutation(createRequest(), model, registries, {
            viewProfile: { diagramId: 'trace', permittedRelationshipTypes: ['satisfiedBy'] },
        });
        expect(result.diagnostics).toEqual([]);
    });

    it('rejects a stale request whose endpoint has since been renamed', () => {
        // The client held "SR104"; the model now only knows "SR105".
        const rebuilt = modelWith([controller, element('SR105', 'SoftwareRequirement')]);
        const result = validateRelationshipMutation(createRequest(), rebuilt, registries);
        expect(result.valid).toBe(false);
        expect(result.diagnostics.some(d => d.code === 'REL-006')).toBe(true);
    });

    it('rejects a hand-crafted request that bypassed the client filters', () => {
        // Nothing about the request came from the UI: unknown type, self-link.
        const result = validateRelationshipMutation(
            createRequest({ type: 'grantAccess', sourceId: controller.id, targetId: controller.id }),
            model, registries);
        expect(result.valid).toBe(false);
        expect(result.diagnostics[0].code).toBe('REL-001');
    });
});

// ─── Deletion validation ────────────────────────────────────────────────────

describe('validateRelationshipDeletion', () => {
    it('resolves an existing relationship', () => {
        const model = modelWith([controller, requirement],
            [relationship('rel_x', 'satisfiedBy', controller.id, requirement.id)]);
        const result = validateRelationshipDeletion({ requestId: 'r', relationshipId: 'rel_x' }, model);
        expect(result.valid).toBe(true);
        expect(result.relationship?.id).toBe('rel_x');
    });

    it('REL-010 rejects a relationship the model does not have', () => {
        const model = modelWith([controller, requirement], []);
        const result = validateRelationshipDeletion({ requestId: 'r', relationshipId: 'rel_gone' }, model);
        expect(result.valid).toBe(false);
        expect(result.diagnostics[0].code).toBe('REL-010');
    });
});

// ─── View visibility ────────────────────────────────────────────────────────

describe('isRelationshipVisibleInView', () => {
    const rel = relationship('rel_x', 'satisfiedBy', controller.id, requirement.id);

    it('shows a relationship whose type and endpoints the view permits', () => {
        expect(isRelationshipVisibleInView(rel, {
            diagramId: 'trace',
            permittedRelationshipTypes: ['satisfiedBy'],
            elementIds: [controller.id, requirement.id],
        })).toBe(true);
    });

    it('hides a valid model relationship the profile does not permit', () => {
        expect(isRelationshipVisibleInView(rel, {
            diagramId: 'functional-flow',
            permittedRelationshipTypes: ['tracesTo'],
            elementIds: [controller.id, requirement.id],
        })).toBe(false);
    });

    it('hides a relationship whose opposite endpoint is outside the view', () => {
        expect(isRelationshipVisibleInView(rel, {
            diagramId: 'trace',
            permittedRelationshipTypes: ['satisfiedBy'],
            elementIds: [controller.id],
        })).toBe(false);
    });

    it('treats an unrestricted view as showing everything', () => {
        expect(isRelationshipVisibleInView(rel, { diagramId: 'all' })).toBe(true);
    });
});

// ─── Preview text ───────────────────────────────────────────────────────────

describe('describeRelationship', () => {
    it('renders a plain-language preview', () => {
        const definition = findRelationshipDefinition('satisfiedBy', registries)!;
        expect(describeRelationship(definition, controller, requirement))
            .toBe('Infusion Controller — satisfied by → SoftwareRequirement SR-104');
    });

    it('falls back to IDs when an endpoint is missing', () => {
        const definition = findRelationshipDefinition('satisfiedBy', registries)!;
        expect(describeRelationship(definition, undefined, undefined, { sourceId: 'a', targetId: 'b' }))
            .toBe('a — satisfied by → b');
    });
});
