// ─── Ontology registries from a stage 1 handoff ─────────────────────────────
//
// The kinds and relationships `KindRegistry.populateFromDocuments` and
// `RelationshipRegistry.populateFromDocuments` read from MEMO's own parse,
// read instead from the API JSON a stage 1 compiler wrote, so a project
// compiled by an external compiler needs no MEMO parser to know its ontology.
// Each walker mirrors its parse counterpart: the same definitions, the same
// fields, the layer and standard from the same (absolute) file path.
// ─────────────────────────────────────────────────────────────────────────────

import type { SysMLConstruct } from '../model/config.js';
import { KindRegistry, type KindRegistryEntry } from '../model/kind-registry.js';
import { resolveLayerFromPath, resolveNamespaceFromPath, resolveStandardFromPath } from '../model/layer-resolver.js';
import type { RelationshipEnd, RelationshipRegistryEntry } from '../model/relationship-registry.js';
import { pascalToCamelCase, pascalToLabel, RelationshipRegistry } from '../model/relationship-registry.js';
import type { MultiplicityDTO } from '../model/relationship-legality.js';
import type { ApiElement, ApiModel } from './api-model.js';
import { apiDefinitionFacts } from './build-from-api.js';
import { handoffFileOf } from './handoff-files.js';
import type { BuilderRegistries } from '../model/complete-model.js';

/** The definition metaclasses a kind is declared with, and the construct each is. */
const KIND_CONSTRUCTS: Record<string, SysMLConstruct> = {
    PartDefinition: 'part def',
    RequirementDefinition: 'requirement def',
    VerificationCaseDefinition: 'verification def',
    StateDefinition: 'state def',
    UseCaseDefinition: 'use case def',
    ActionDefinition: 'action def',
    ItemDefinition: 'item def',
    PortDefinition: 'port def',
    InterfaceDefinition: 'interface def',
    FlowDefinition: 'flow def',
    AttributeDefinition: 'attribute def',
    EnumerationDefinition: 'enum def',
};

const RELATIONSHIP_CONSTRUCTS: Record<string, string> = {
    ConnectionDefinition: 'connection def',
    AllocationDefinition: 'allocation def',
    // A ComponentExchange is an `interface def` and a FunctionalExchange a `flow def`: a usage typed by
    // one is written `interface x : Def connect a to b;` and `flow x : Def from a to b;`.
    InterfaceDefinition: 'interface def',
    FlowDefinition: 'flow def',
};

/**
 * The ends the language gives a construct when its definition declares none. An interface joins two
 * ports (`InterfaceEnd : PortUsage`, SysML-textual-bnf.kebnf:785); a flow joins two features, which
 * may be ports or parameters, so its ends say nothing.
 */
const DEFAULT_ENDS: Record<string, RelationshipEnd[]> = {
    'interface def': [{ name: 'source', construct: 'port' }, { name: 'target', construct: 'port' }],
};

/**
 * The ontology's marker for a typed dependency (`memo_core_relationships`): a
 * `metadata def` that specializes it declares a relation written as
 * `#Name dependency from <client> to <supplier>;`.
 */
export const TYPED_DEPENDENCY_MARKER = 'MemoTypedDependency';

/**
 * The ontology's base for a rule that checks the model (`constraint def X :> MemoConsistencyRule`). A
 * constraint that specializes it is a MEMO rule, loaded by the rule loader, not a constraint of the
 * system being modelled.
 */
export const RULE_MARKER = 'MemoConsistencyRule';
/** The `sysmlConstruct` of a typed dependency's registry entry. */
export const TYPED_DEPENDENCY_CONSTRUCT = 'metadata def';

/** Whether a definition specializes `name`, through any chain of supertypes. */
export function specializesByName(api: ApiModel, definition: ApiElement, name: string, seen = new Set<string>()): boolean {
    if (seen.has(definition['@id'])) return false;
    seen.add(definition['@id']);
    return api.superclassifiers(definition['@id']).some(general =>
        api.name(general['@id']) === name || specializesByName(api, general, name, seen));
}

/** A view definition the kind registry records the defaults of. */
export interface ApiViewDefinition {
    name: string;
    defaults: Record<string, string>;
    superType?: string;
}

/**
 * A `viewpoint` usage a library declares, and the stakeholders it is written
 * for (`ref :>> memoStakeholders = (safetyEngineer)`), by usage name.
 *
 * A project's views bind the library's viewpoints by name, and a library usage
 * is not a project element, so without this the stakeholders the ontology
 * authored never reach the viewpoint a view conforms to.
 */
export interface ApiViewpointUsage {
    name: string;
    stakeholders: string[];
}

/**
 * The top-level packages of the documents of one role: the library's are the
 * ontology the registries describe; a project's own definitions are added to a
 * copy of the registry (`withProjectExtensions`), as with MEMO's parse.
 */
function rootPackages(
    api: ApiModel,
    role: 'library' | 'project' = 'library',
    include?: (namespace: ApiElement) => boolean,
): ApiElement[] {
    const roots: ApiElement[] = [];
    for (const namespace of api.ofType('Namespace')) {
        if (api.owner(namespace['@id'])) continue; // a document's root namespace owns, it is not owned
        if (api.source(namespace['@id'])?.role !== role) continue;
        if (include && !include(namespace)) continue;
        for (const member of api.ownedMembers(namespace['@id'])) {
            if (member['@type'] === 'Package' || member['@type'] === 'LibraryPackage') roots.push(member);
        }
    }
    return roots;
}

/**
 * The names a definition specializes, first the one `superType` keeps: a
 * standard library type by its qualified name (`Connections::BinaryConnection`,
 * as the ontology writes it), any other by its own name.
 */
function superTypes(api: ApiModel, definition: ApiElement): string[] {
    return api.superclassifiers(definition['@id'])
        .map(general => (api.source(general['@id'])?.role === 'standard'
            ? api.qualifiedName(general['@id'])
            : api.name(general['@id'])) ?? '')
        .filter(Boolean);
}

/**
 * Whether a definition is declared `abstract`. A variation is abstract by the
 * metamodel (an enumeration definition among them), which some compilers
 * state; that is not the keyword the registry records.
 */
function declaredAbstract(definition: ApiElement): true | undefined {
    return definition.isAbstract === true && definition.isVariation !== true ? true : undefined;
}

/** The attribute usages a definition body declares, in declaration order. */
function attributeMembers(api: ApiModel, definition: ApiElement): ApiElement[] {
    return api.ownedMembers(definition['@id']).filter(m => m['@type'] === 'AttributeUsage');
}

/** Every kind and view definition the handoff declares under a package. */
export function apiKindEntries(
    api: ApiModel,
    fileOf: (element: ApiElement) => string,
    role: 'library' | 'project' = 'library',
    include?: (namespace: ApiElement) => boolean,
): {
    kinds: KindRegistryEntry[]; views: ApiViewDefinition[]; viewpoints: ApiViewpointUsage[];
} {
    const kinds: KindRegistryEntry[] = [];
    const views: ApiViewDefinition[] = [];
    const viewpoints: ApiViewpointUsage[] = [];
    const walk = (pkg: ApiElement, path: string[], file: string) => {
        const name = api.name(pkg['@id']);
        const here = name ? [...path, name] : path;
        for (const member of api.ownedMembers(pkg['@id'])) {
            const type = member['@type'];
            if (type === 'Package' || type === 'LibraryPackage') {
                walk(member, here, file);
                continue;
            }
            const memberName = api.declaredName(member['@id']);
            if (type === 'ViewDefinition') {
                if (!memberName) continue;
                const facts = apiDefinitionFacts(api, member).attributes;
                const defaults: Record<string, string> = {};
                for (const attribute of attributeMembers(api, member)) {
                    const key = api.name(attribute['@id']);
                    if (key && api.value(attribute['@id']) && facts[key] !== undefined) defaults[key] = facts[key];
                }
                views.push({ name: memberName, defaults, superType: superTypes(api, member)[0] });
                continue;
            }
            if (type === 'ViewpointUsage') {
                if (!memberName) continue;
                const stakeholders = (apiDefinitionFacts(api, member).attributes['memoStakeholders'] ?? '')
                    .split(',').map(name => name.trim()).filter(Boolean);
                viewpoints.push({ name: memberName, stakeholders });
                continue;
            }
            const construct = KIND_CONSTRUCTS[type];
            if (!construct || !memberName) continue;
            const declared: string[] = [];
            for (const attribute of attributeMembers(api, member)) {
                const attributeName = api.name(attribute['@id']);
                if (attributeName && !declared.includes(attributeName)) declared.push(attributeName);
            }
            const [superType, ...additional] = superTypes(api, member);
            kinds.push({
                name: memberName,
                label: memberName,
                layer: resolveLayerFromPath(file),
                sysmlConstruct: construct,
                superType: superType || undefined,
                // The rest of a multiple specialization is kept by simple name.
                additionalSuperTypes: additional.length
                    ? additional.map(name => name.split('::').pop() ?? name)
                    : undefined,
                standard: resolveStandardFromPath(file),
                isAbstract: declaredAbstract(member),
                namespace: resolveNamespaceFromPath(file),
                qualifiedName: [...here, memberName].join('::'),
                sourceFile: file,
                attributeNames: declared.length ? declared : undefined,
            });
        }
    };
    for (const pkg of rootPackages(api, role, include)) walk(pkg, [], fileOf(pkg));
    return { kinds, views, viewpoints };
}

/** Every relationship type the handoff's connection and allocation definitions declare. */
export function apiRelationshipEntries(
    api: ApiModel,
    fileOf: (element: ApiElement) => string,
    include?: (namespace: ApiElement) => boolean,
    role: 'library' | 'project' = 'library',
): RelationshipRegistryEntry[] {
    const entries: RelationshipRegistryEntry[] = [];
    const walk = (pkg: ApiElement, layer: string) => {
        for (const member of api.ownedMembers(pkg['@id'])) {
            const type = member['@type'];
            if (type === 'Package' || type === 'LibraryPackage') {
                walk(member, layer);
                continue;
            }
            const sysmlName = api.declaredName(member['@id']);
            if (type === 'MetadataDefinition' && sysmlName && specializesByName(api, member, TYPED_DEPENDENCY_MARKER)) {
                // A typed dependency has a client and a supplier and nothing else to say about its ends.
                if (sysmlName !== TYPED_DEPENDENCY_MARKER) entries.push({
                    sysmlName,
                    name: pascalToCamelCase(sysmlName),
                    label: pascalToLabel(sysmlName),
                    layer,
                    sysmlConstruct: TYPED_DEPENDENCY_CONSTRUCT,
                    description: docOf(api, member),
                    nativeKeyword: 'dependency',
                    qualifiedName: api.qualifiedName(member['@id']),
                    superType: superTypes(api, member)[0] || undefined,
                    ends: [{ name: 'client' }, { name: 'supplier' }],
                });
                continue;
            }
            const construct = RELATIONSHIP_CONSTRUCTS[type];
            if (!construct || !sysmlName) continue;
            const ends: RelationshipEnd[] = [];
            const attributes: string[] = [];
            let isReflexive: boolean | undefined;
            let isUnique: boolean | undefined;
            let isConnector: boolean | undefined;
            for (const owned of api.ownedMembers(member['@id'])) {
                if (owned.isEnd === true) {
                    ends.push({
                        name: api.name(owned['@id']) ?? '',
                        type: api.types(owned['@id']).map(t => api.name(t['@id'])).find(Boolean),
                        multiplicity: multiplicityOf(api, owned),
                    });
                } else if (owned['@type'] === 'AttributeUsage') {
                    const name = api.name(owned['@id']);
                    if (name) attributes.push(name);
                    const value = api.value(owned['@id']);
                    const flag = value?.kind === 'boolean' ? value.value : undefined;
                    if (name === 'isReflexive') isReflexive = flag ?? isReflexive;
                    else if (name === 'isUnique') isUnique = flag ?? isUnique;
                    else if (name === 'isConnector') isConnector = flag ?? isConnector;
                }
            }
            if (ends.length === 0) ends.push(...(DEFAULT_ENDS[construct] ?? []));
            entries.push({
                sysmlName,
                name: pascalToCamelCase(sysmlName),
                label: pascalToLabel(sysmlName),
                layer,
                sysmlConstruct: construct,
                description: docOf(api, member),
                isAbstract: declaredAbstract(member),
                qualifiedName: api.qualifiedName(member['@id']),
                superType: superTypes(api, member)[0] || undefined,
                isReflexive,
                isUnique,
                isConnector,
                ends,
                attributes,
            });
        }
    };
    for (const pkg of rootPackages(api, role, include)) walk(pkg, resolveLayerFromPath(fileOf(pkg)));
    return entries;
}

/** The first doc comment a definition states, one line, as the parse reader states it. */
function docOf(api: ApiModel, definition: ApiElement): string | undefined {
    return apiDefinitionFacts(api, definition).doc;
}

/**
 * The bounds an end declares (`[0..1]`, `[1..*]`, `[3]`, `[*]`), as the parse
 * reader states them: an exact bound pins both ends, `*` is an unbounded upper.
 */
function multiplicityOf(api: ApiModel, end: ApiElement): MultiplicityDTO | undefined {
    const range = api.ownedMembers(end['@id']).find(m => m['@type'] === 'MultiplicityRange');
    if (!range) return undefined;
    const bounds = api.ownedMembers(range['@id']);
    const value = (bound: ApiElement): number | null => {
        if (bound['@type'] === 'LiteralInfinity') return null;
        const literal = api.expression(bound['@id']);
        return literal.kind === 'number' ? literal.value : null;
    };
    if (bounds.length === 1) {
        const upper = value(bounds[0]);
        return upper === null ? { lower: 0, upper: null } : { lower: upper, upper };
    }
    if (bounds.length === 2) {
        return { lower: value(bounds[0]) ?? 0, upper: value(bounds[1]) };
    }
    return undefined;
}

/**
 * The ontology registries a stage 1 handoff states, completed as
 * `loadOntologyRegistries` completes MEMO's parse of the same files: kinds
 * placed through their supertypes and the reverse `derivedBy` links filled in.
 *
 * `roles` are the documents read. Resolution reads the project's own as well,
 * as `loadOntologyRegistries` does: its import closure includes the project's
 * packages, so a `connection def` the project declares is a relationship type
 * a view may select.
 */
export function apiOntologyRegistries(
    api: ApiModel,
    fileOf: (element: ApiElement) => string,
    include?: (namespace: ApiElement) => boolean,
    roles: readonly ('library' | 'project')[] = ['library'],
): {
    kindRegistry: KindRegistry; relationshipRegistry: RelationshipRegistry;
} {
    const kindRegistry = new KindRegistry();
    for (const role of roles) kindRegistry.populateFromApi(api, fileOf, include, role);
    kindRegistry.inheritPlacementFromSuperTypes();
    kindRegistry.computeDerivedBy();
    const relationshipRegistry = new RelationshipRegistry();
    for (const role of roles) relationshipRegistry.populateFromApi(api, fileOf, include, role);
    return { kindRegistry, relationshipRegistry };
}

/**
 * The registries stage 2 builds a handoff's model with: `base`'s (provenance,
 * which project resolution states), with the kinds and relationship types the
 * handoff itself declares in place of any MEMO's parse produced.
 */
export function handoffRegistries(
    api: ApiModel,
    base: BuilderRegistries | undefined,
    filePackages: ReadonlyMap<string, string> | undefined,
): BuilderRegistries {
    return { ...base, ...apiOntologyRegistries(api, handoffFileOf(api, filePackages)) };
}

/** How a relation places elements in a workspace (memo_core_relationships_workspace_membership). */
export type WorkspaceMembership = 'sourceFollowsTarget' | 'targetFollowsSource' | 'neither';

const WORKSPACE_MEMBERSHIP_VALUES: readonly string[] = ['sourceFollowsTarget', 'targetFollowsSource', 'neither'];

/**
 * The ontology's workspace-membership table: relation name to direction, from the
 * `WorkspaceMembershipEntry` usages the handoff holds. An entry whose direction is not one of
 * the enumeration's literals is left out, so a misspelling shows as a missing row.
 */
export function apiWorkspaceMembership(api: ApiModel): Map<string, WorkspaceMembership> {
    const table = new Map<string, WorkspaceMembership>();
    for (const usage of api.ofType('PartUsage')) {
        if (!api.types(usage['@id']).some(type => api.qualifiedName(type['@id'])?.endsWith('::WorkspaceMembershipEntry'))) continue;
        const { relation, direction } = apiDefinitionFacts(api, usage).attributes;
        const literal = direction?.split('::').pop();
        if (relation && literal && WORKSPACE_MEMBERSHIP_VALUES.includes(literal)) table.set(relation, literal as WorkspaceMembership);
    }
    return table;
}
