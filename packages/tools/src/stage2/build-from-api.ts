// ─── Stage 2: the MEMO graph from stage 1's API JSON ─────────────────────────
//
// `buildMemoModel` (model/builder.ts) reads MEMO's own Langium syntax trees. This
// builds the same graph from the OMG API JSON a SysML compiler hands stage 2,
// through `ApiModel`, so MEMO no longer needs a SysML parser of its own
// (plans/memo-compiler-stages-opensysml.md, milestone 2, slice 2d).
//
// It is being built one family at a time, each held to
// `scripts/diff-memo-graph.mjs` against the Langium builder's output. This slice
// is ELEMENTS: which declarations become MEMO elements, their ids, kinds,
// constructs, layers, attributes, docs, ports and parameters. Relationships
// (connections, flows, bindings, allocations, successions, satisfy/verify) are
// the next slice; `composes` edges synthesized from nesting come with them.
//
// The rules below are the Langium builder's, restated over the metamodel. Where
// one is a rule about MEMO (what becomes an element, what a kind is) it is kept;
// where it was a workaround for the grammar's shape it has no counterpart here,
// because the metamodel already says what the grammar had to infer.
// ─────────────────────────────────────────────────────────────────────────────

import { CONTROL_KIND_METACLASS } from '../model/activity-notation.js';
import { completeModel, type BuilderRegistries } from '../model/complete-model.js';
import type { MEMOConfig } from '../model/config.js';
import { toModelType } from '../model/naming.js';
import { LANGUAGE_NATIVE_RELATIONS, REFINEMENT_METADATA, pascalToCamelCase } from '../model/relationship-registry.js';
import { ElementIndex, qualifiedId } from '../model/element-index.js';
import { resolveLayerFromPath } from '../model/layer-resolver.js';
import type { ActionParameter, MemoConstruct, MemoElement, MemoModel, MemoPackageDTO, MemoRelationship, PortSpec } from '../model/semantic.js';
import { ApiModel, type ApiElement, type ApiValue } from './api-model.js';
import { textualName } from './sysml-names.js';

/** The definition metaclasses whose project declarations become elements, and their construct. */
const DEFINITION_CONSTRUCTS: Record<string, MemoConstruct> = {
    PartDefinition: 'part',
    PortDefinition: 'port',
    InterfaceDefinition: 'interface',
    ConnectionDefinition: 'connection',
    RequirementDefinition: 'requirement',
    VerificationCaseDefinition: 'verification',
    StateDefinition: 'state',
    AttributeDefinition: 'attribute',
    EnumerationDefinition: 'enumeration',
    UseCaseDefinition: 'use case',
};

/** The usage metaclasses a package member becomes an element as, and its construct. */
const USAGE_CONSTRUCTS: Record<string, MemoConstruct> = {
    PartUsage: 'part',
    RequirementUsage: 'requirement',
    ItemUsage: 'item',
    UseCaseUsage: 'use case',
    VerificationCaseUsage: 'verification',
    StateUsage: 'state',
    PortUsage: 'port',
    ViewUsage: 'view',
    ConcernUsage: 'concern',
};

/** Standard metadata whose field name differs from the flat key MEMO reads. */
const METADATA_KEY_ALIASES: Record<string, Record<string, string>> = {
    Rationale: { text: 'rationale' },
};

const lastSegment = (qualifiedName: string) => qualifiedName.slice(qualifiedName.lastIndexOf('::') + 2);

export interface ApiBuildResult {
    elements: ElementIndex;
}

export interface ApiModelBuildResult extends ApiBuildResult {
    relationships: MemoRelationship[];
    /** What stage 2 read in a way the author may not have meant; never a SysML error (stage 1 owns those). */
    diagnostics: string[];
}

/**
 * The finished MEMO model from a stage 1 handoff: what `buildMemoModel` returns
 * from MEMO's own parse, finished by the same `completeModel`.
 *
 * `unresolvedReferences` is left empty on purpose: it reports qualified names
 * that do not resolve, and stage 2 only ever runs on a stage 1 that resolved
 * everything.
 */
export function buildMemoModelFromApi(
    api: ApiModel,
    config: MEMOConfig,
    registries?: BuilderRegistries,
    /**
     * The files MEMO's project resolution counts as project source, relative to
     * the project root. A file the handoff carries as project content can still
     * be a resolved library root (a project's own `methodology/`), which
     * `memo validate` leaves out of the model; absent, every project file counts.
     */
    projectFiles?: ReadonlySet<string>,
): MemoModel {
    const builder = new ElementBuilder(api, registries, projectFiles);
    builder.run();
    builder.buildRelationships();
    return completeModel({
        elements: builder.elements,
        relationships: builder.relationships,
        errors: [],
        config,
        registries,
        packages: builder.packages(),
        lineOfRelationship: relationship => builder.lineOf(relationship),
    });
}

/** Build MEMO's elements AND relationships from a stage 1 handoff. */
export function buildFromApi(api: ApiModel, registries?: BuilderRegistries): ApiModelBuildResult {
    const builder = new ElementBuilder(api, registries);
    builder.run();
    builder.buildRelationships();
    return { elements: builder.elements, relationships: builder.relationships, diagnostics: builder.diagnostics };
}

/**
 * Build MEMO's elements from a stage 1 handoff. `registries` are the ontology's,
 * loaded exactly as `buildMemoModel`'s caller loads them.
 */
export function buildElementsFromApi(api: ApiModel, registries?: BuilderRegistries): ApiBuildResult {
    const builder = new ElementBuilder(api, registries);
    builder.run();
    return { elements: builder.elements };
}

/**
 * A definition's flat attribute map and doc comment, read exactly as the
 * builder reads them for model elements: declared attributes, then metadata
 * applications (`@MemoIdentity { :>> providedId = … }`) over them. The rule
 * loader reads ontology rules through this, so stage 2 needs no parser.
 */
export function apiDefinitionFacts(api: ApiModel, definition: ApiElement): { attributes: Record<string, string>; doc?: string } {
    const builder = new ElementBuilder(api);
    return { attributes: builder.attributesOf(definition), doc: builder.docOf(definition) };
}

class ElementBuilder {
    readonly elements = new ElementIndex();
    readonly relationships: MemoRelationship[] = [];
    readonly diagnostics: string[] = [];
    private counter = 0;
    /** The line each relationship is declared on, for end-kind findings. */
    private readonly relationshipLines = new Map<MemoRelationship, number>();
    /** API element → the MEMO element it became, including anonymous ones (a `terminate`). */
    private readonly idOf = new Map<string, string>();

    constructor(
        private readonly api: ApiModel,
        private readonly registries?: BuilderRegistries,
        private readonly projectFiles?: ReadonlySet<string>,
    ) {}

    run(): void {
        for (const root of this.projectRootPackages()) this.visitPackage(root, '', undefined);
        this.inheritKindsFromLocalDefinitions();
    }

    /** Top-level packages the project declares. */
    private projectRootPackages(): ApiElement[] {
        const roots: ApiElement[] = [];
        for (const element of this.api.projectElements()) {
            if (element['@type'] !== 'Namespace') continue; // a document's root namespace
            if (this.projectFiles && !this.projectFiles.has(this.file(element))) continue;
            for (const member of this.api.ownedMembers(element['@id'])) {
                if (member['@type'] === 'Package' || member['@type'] === 'LibraryPackage') roots.push(member);
            }
        }
        return roots;
    }

    private file(element: ApiElement): string {
        return this.api.source(element['@id'])?.file ?? '';
    }

    private visitPackage(pkg: ApiElement, parent: string, folder: string | undefined): void {
        const name = this.api.name(pkg['@id']) ?? '';
        const packageName = parent ? `${parent}::${name}` : name;
        const isLibrary = pkg['@type'] === 'LibraryPackage';
        // Only nested packages present as folders; the top-level package is the root.
        const folderLabel = parent ? this.folderLabel(pkg, name) : undefined;
        void folder;
        for (const member of this.api.ownedMembers(pkg['@id'])) {
            const type = member['@type'];
            if (type === 'Package' || type === 'LibraryPackage') {
                this.visitPackage(member, packageName, folderLabel);
                continue;
            }
            if (!this.api.name(member['@id'])) continue;
            const definition = DEFINITION_CONSTRUCTS[type];
            if (definition) {
                // A library package's definitions are types for other models,
                // not this model's content; they stay kinds.
                if (isLibrary) continue;
                this.definition(member, definition, packageName);
                continue;
            }
            if (type === 'ActionDefinition' || type === 'CalculationDefinition') { if (!isLibrary) this.actionDefinition(member, packageName); continue; }
            if (type === 'ItemDefinition') { if (!isLibrary) this.itemDefinition(member, packageName); continue; }
            if (type === 'ActionUsage' || type === 'CalculationUsage') { this.action(member, packageName, undefined); continue; }
            if (type === 'ViewpointUsage') { this.viewpoint(member, packageName, undefined); continue; }
            if (type === 'TransitionUsage') { this.transition(member, packageName, undefined); continue; }
            if (type === 'InterfaceUsage' && this.connectorEnds(member).length >= 2) continue; // an edge: next slice
            const construct = type === 'InterfaceUsage' ? 'interface' : USAGE_CONSTRUCTS[type];
            if (construct) {
                const id = this.usage(member, construct, packageName, undefined);
                const element = this.elements.get(id);
                if (element && folderLabel && ['part', 'requirement', 'item', 'verification'].includes(construct)) {
                    element.attributes['elementPackage'] = folderLabel;
                }
            }
        }
    }

    /** A folder's label: an explicit `Matrix folder:` doc line, else the package name tidied. */
    private folderLabel(pkg: ApiElement, name: string): string {
        const doc = this.doc(pkg);
        const match = doc?.match(/Matrix folder:\s*(.+)/);
        return match ? match[1].trim() : name.replace(/^folder_/, '').replace(/_/g, ' ');
    }

    // ─── Kinds ──────────────────────────────────────────────────────────────

    /** Registry first; a qualified name falls back to its last segment, as `resolveKindDef` does. */
    private resolveKind(typeName: string | undefined) {
        const registry = this.registries?.kindRegistry;
        if (!typeName || !registry) return { kind: typeName, layer: undefined as string | undefined };
        const entry = registry.getKind(typeName) ?? registry.getKind(lastSegment(typeName));
        return entry
            ? { kind: registry.getKind(typeName) ? typeName : lastSegment(typeName), layer: entry.layer as string | undefined }
            : { kind: typeName, layer: undefined };
    }

    /** The type a usage names, spelled as MEMO stores it: the type's own name. */
    private typeName(element: ApiElement): string | undefined {
        const type = this.api.types(element['@id'])[0];
        return type ? this.api.name(type['@id']) : undefined;
    }

    private superTypeName(element: ApiElement): string | undefined {
        const general = this.api.superclassifiers(element['@id'])[0];
        return general ? this.api.name(general['@id']) : undefined;
    }

    // ─── Declarations ───────────────────────────────────────────────────────

    private definition(def: ApiElement, construct: MemoConstruct, packageName: string, ownerId?: string): void {
        const shortName = this.api.name(def['@id'])!;
        const id = qualifiedId(shortName, packageName, ownerId);
        const superType = this.superTypeName(def);
        const resolved = superType ? this.resolveKind(superType) : undefined;
        const attributes = this.attributes(def);
        this.define({
            id, shortName, name: displayNameOf(attributes, shortName),
            kind: resolved?.kind ?? `${construct.charAt(0).toUpperCase()}${construct.slice(1)}Definition`,
            construct, layer: resolved?.layer || 'unknown', file: this.file(def), package: packageName || undefined,
            attributes, doc: this.doc(def), isDefinition: true, owner: ownerId,
        }, def);
        if (['part', 'port', 'interface', 'connection'].includes(construct)) {
            this.ports(def, packageName, id);
            this.nestedParts(def, packageName, id);
        }
    }

    private itemDefinition(def: ApiElement, packageName: string): void {
        const shortName = this.api.name(def['@id'])!;
        const superType = this.superTypeName(def);
        const resolved = superType ? this.resolveKind(superType) : undefined;
        const known = resolved?.layer && resolved.layer !== 'unknown';
        this.define({
            id: qualifiedId(shortName, packageName, undefined), shortName, name: shortName,
            kind: known ? resolved!.kind! : 'ItemDefinition', construct: 'item', isDefinition: true,
            layer: known ? resolved!.layer! : resolveLayerFromPath(this.file(def)),
            file: this.file(def), package: packageName || undefined, attributes: this.attributes(def), doc: this.doc(def),
        }, def);
    }

    private actionDefinition(def: ApiElement, packageName: string): void {
        const shortName = this.api.name(def['@id'])!;
        const id = qualifiedId(shortName, packageName, undefined);
        const behaviorKind = def['@type'] === 'CalculationDefinition' ? 'function' : 'action';
        const superType = this.superTypeName(def);
        const resolved = superType ? this.resolveKind(superType) : undefined;
        const known = resolved?.layer && resolved.layer !== 'unknown';
        const parameters = this.parameters(def);
        this.define({
            id, shortName, name: shortName,
            kind: known ? resolved!.kind! : behaviorKind === 'function' ? 'FunctionDefinition' : 'ActionDefinition',
            construct: 'action', isDefinition: true,
            layer: known ? resolved!.layer! : resolveLayerFromPath(this.file(def)),
            file: this.file(def), package: packageName || undefined,
            attributes: { ...this.attributes(def), behaviorKind }, doc: this.doc(def),
            parameters: parameters.length > 0 ? parameters : undefined,
        }, def);
        this.behaviorBody(def, packageName, id);
    }

    private usage(usage: ApiElement, construct: MemoConstruct, packageName: string, ownerId: string | undefined): string {
        const shortName = this.api.name(usage['@id'])!;
        const id = qualifiedId(shortName, packageName, ownerId);
        const typeName = this.typeName(usage);
        const resolved = typeName ? this.resolveKind(typeName) : undefined;
        const attributes = this.attributes(usage);
        if (typeName) attributes.usageType = typeName;
        if (construct === 'view') Object.assign(attributes, this.exposes(usage));
        Object.assign(attributes, this.viewMetadata(usage));

        const element: MemoElement = {
            id, shortName, name: displayNameOf(attributes, shortName),
            kind: resolved?.kind ?? 'Unknown', construct, layer: resolved?.layer || 'unknown',
            file: this.file(usage), package: packageName || undefined, attributes, doc: this.doc(usage), owner: ownerId,
        };
        if (construct === 'port') {
            const directed = this.directedFeatures(usage);
            const directions = new Set(directed.map(f => f.direction));
            element.portSpec = {
                type: typeName as string,
                direction: (this.direction(usage) ?? (directions.size === 1 ? directed[0]?.direction : undefined)) as PortSpec['direction'],
                isConjugated: this.api.ownedRelationships(usage['@id']).some(r => r['@type'] === 'ConjugatedPortTyping'),
            };
            element.parameters = directed;
        }
        this.define(element, usage);

        if (construct === 'port') this.ports(usage, packageName, id);
        if (construct === 'part' || construct === 'item') this.nestedParts(usage, packageName, id);
        if (construct === 'part') this.ports(usage, packageName, id);
        for (const member of this.api.ownedMembers(usage['@id'])) {
            if (member['@type'] === 'TransitionUsage') this.transition(member, packageName, id);
            else if (construct === 'state' && member['@type'] === 'StateUsage' && this.api.name(member['@id'])) {
                this.usage(member, 'state', packageName, id);
            }
        }
        return id;
    }

    private viewpoint(usage: ApiElement, packageName: string, ownerId: string | undefined): void {
        const id = this.usage(usage, 'viewpoint', packageName, ownerId);
        for (const member of this.api.ownedMembers(usage['@id'])) {
            if (member['@type'] === 'ViewpointUsage' && this.api.name(member['@id'])) this.viewpoint(member, packageName, id);
        }
    }

    /** An action usage. `ownerId` is a non-action owner (a part that performs it), which names it and is not its `parentAction`. */
    private action(usage: ApiElement, packageName: string, parentActionId: string | undefined, ownerId?: string): void {
        const shortName = this.api.name(usage['@id']);
        if (!shortName) return;
        const id = qualifiedId(shortName, packageName, parentActionId ?? ownerId);
        const behaviorKind = usage['@type'] === 'CalculationUsage' ? 'function' : 'action';
        const typeName = this.typeName(usage);
        let kind = behaviorKind === 'function' ? 'FunctionUsage' : 'ActionUsage';
        let layer = resolveLayerFromPath(this.file(usage));
        if (typeName) {
            const resolved = this.resolveKind(typeName);
            if (resolved.layer && resolved.layer !== 'unknown') { kind = resolved.kind!; layer = resolved.layer; }
        }
        const subsetted = this.api.subsetted(usage['@id'])[0];
        if (!typeName && subsetted && parentActionId && layer === 'unknown') {
            layer = this.elements.get(parentActionId)?.layer ?? layer;
        }
        const attributes = this.attributes(usage);
        attributes.behaviorKind = behaviorKind;
        if (typeName) { attributes.actionType = typeName; attributes.usageType = typeName; }
        if (subsetted) attributes.subsets = this.api.name(subsetted['@id']) ?? '';
        this.define({
            id, shortName, name: displayNameOf(attributes, shortName), kind, construct: 'action', layer,
            file: this.file(usage), package: packageName || undefined, attributes, doc: this.doc(usage),
            parentAction: parentActionId, owner: ownerId, parameters: this.parameters(usage),
        }, usage);
        this.behaviorBody(usage, packageName, id);
    }

    /** Nested steps of an action body: actions and control nodes. */
    private behaviorBody(owner: ApiElement, packageName: string, parentActionId: string): void {
        let terminates = 0;
        for (const member of this.api.ownedMembers(owner['@id'])) {
            const type = member['@type'];
            if (type === 'ActionUsage' || type === 'CalculationUsage') {
                if (this.direction(member)) continue; // a parameter, not a step
                this.action(member, packageName, parentActionId);
            } else if (type in CONTROL_METACLASS_KINDS) {
                const name = this.api.name(member['@id']);
                if (!name) continue;
                const controlKind = CONTROL_METACLASS_KINDS[type];
                this.define({
                    id: qualifiedId(name, packageName, parentActionId), shortName: name, name,
                    kind: CONTROL_KIND_METACLASS[controlKind], construct: 'action',
                    layer: resolveLayerFromPath(this.file(member)), file: this.file(member),
                    package: packageName || undefined, attributes: { controlKind }, parentAction: parentActionId,
                }, member);
            } else if (['AcceptActionUsage', 'SendActionUsage', 'TerminateActionUsage'].includes(type)) {
                const fallback = type === 'TerminateActionUsage' ? `terminate${terminates++ === 0 ? '' : terminates}` : undefined;
                const name = this.api.name(member['@id']) ?? fallback;
                if (!name) continue;
                const id = qualifiedId(name, packageName, parentActionId);
                // An accept's payload is its parameter: `accept order : Order`.
                const payload = type === 'AcceptActionUsage'
                    ? this.api.ownedRelationships(member['@id'])
                        .filter(r => r['@type'] === 'ParameterMembership')
                        .flatMap(r => this.api.ownedMembers(member['@id']).filter(m => m['@id'] === (r.memberElement as { '@id': string } | undefined)?.['@id']))[0]
                    : undefined;
                const payloadName = payload ? this.api.name(payload['@id']) : undefined;
                const payloadType = payload ? this.typeName(payload) : undefined;
                this.define({
                    id, shortName: name, name: this.api.name(member['@id']) ?? type,
                    kind: type === 'TerminateActionUsage' ? 'ActivityFinalNodeUsage' : type,
                    construct: 'action', layer: resolveLayerFromPath(this.file(member)), file: this.file(member),
                    package: packageName || undefined,
                    attributes: { ...(payloadName ? { payloadName } : {}), ...(payloadType ? { payloadType } : {}) },
                    parentAction: parentActionId,
                    parameters: payloadName ? [{ name: payloadName, direction: 'out', type: payloadType ?? 'Item' }] : undefined,
                }, member);
            }
        }
    }

    private transition(transition: ApiElement, packageName: string, ownerId: string | undefined): void {
        const shortName = this.api.name(transition['@id']);
        if (!shortName) return; // an anonymous transition is a control statement, not an element
        // The source is the transition's first member (`FeatureChainMember`,
        // SysML-textual-bnf.kebnf:1283): a Membership naming the state, or an
        // owned chain feature for `first a.b`. The target is the end of the
        // succession it owns (`then …`). Both are written as MEMO stores them,
        // the path from the state machine down.
        const attributes: Record<string, string> = { ...this.attributes(transition) };
        const path = (feature: ApiElement | undefined) => {
            if (!feature) return undefined;
            const steps = this.api.chain(feature['@id']);
            return (steps.length ? steps : [feature]).map(step => this.api.name(step['@id'])).join('.');
        };
        const first = this.api.ownedRelationships(transition['@id'])[0];
        let source: string | undefined;
        if (first?.['@type'] === 'Membership') {
            const member = first.memberElement as { '@id': string } | undefined;
            source = path(member ? this.api.element(member['@id']) : undefined);
        } else if (first?.['@type'] === 'OwningMembership') {
            const owned = (first.ownedRelatedElement as { '@id': string }[] | undefined)?.[0];
            source = path(owned ? this.api.element(owned['@id']) : undefined);
        }
        const succession = this.api.ownedMembers(transition['@id']).find(m => m['@type'] === 'SuccessionAsUsage');
        const targetEnd = succession ? this.connectorEnds(succession).at(-1) : undefined;
        const target = targetEnd
            ? path(this.api.related(targetEnd['@id'], ['ReferenceSubsetting'], 'referencedFeature')[0])
            : undefined;
        if (source) attributes.sourceState = source;
        if (target) attributes.targetState = target;
        const typeName = this.typeName(transition);
        const resolved = typeName ? this.resolveKind(typeName) : undefined;
        this.define({
            id: qualifiedId(shortName, packageName, ownerId), shortName, name: attributes.name || shortName,
            kind: resolved?.kind ?? 'Unknown', construct: 'transition', layer: resolved?.layer || 'unknown',
            file: this.file(transition), package: packageName || undefined, attributes, doc: this.doc(transition), owner: ownerId,
        }, transition);
    }

    /** Port usages an owner declares, each an element owned by it. */
    private ports(owner: ApiElement, packageName: string, ownerId: string): void {
        const owned: string[] = [];
        for (const member of this.api.ownedMembers(owner['@id'])) {
            if (member['@type'] !== 'PortUsage' || !this.api.name(member['@id'])) continue;
            const id = this.usage(member, 'port', packageName, ownerId);
            if (this.elements.has(id)) owned.push(id);
        }
        const element = this.elements.get(ownerId);
        if (owned.length > 0 && element) element.ownedPorts = owned;
    }

    /** Typed nested parts and undirected items: containment, owned by the owner. */
    private nestedParts(owner: ApiElement, packageName: string, ownerId: string): void {
        for (const member of this.api.ownedMembers(owner['@id'])) {
            const type = member['@type'];
            if (type === 'Package') { this.groupingPackage(member, packageName, ownerId); continue; }
            const isPart = type === 'PartUsage';
            const isItem = type === 'ItemUsage' && !this.direction(member);
            if (!isPart && !isItem) continue;
            // A connection definition's `end part source : T` is an end, not a part it contains.
            if (member.isEnd === true) continue;
            // Only a TYPED nested usage is containment; an untyped one is view metadata.
            if (!this.api.name(member['@id']) || this.api.types(member['@id']).length === 0) continue;
            if (this.api.redefined(member['@id']).length > 0 || this.isBinding(member)) continue;
            this.usage(member, isPart ? 'part' : 'item', packageName, ownerId);
        }
    }

    /** A package inside a usage groups; its members stay contained by the owner. */
    private groupingPackage(pkg: ApiElement, packageName: string, ownerId: string): void {
        const name = this.api.name(pkg['@id']);
        if (!name) return;
        this.define({
            id: qualifiedId(name, packageName, ownerId), shortName: name, name, kind: 'ElementPackage',
            construct: 'package', layer: this.elements.get(ownerId)?.layer ?? 'unknown',
            file: this.file(pkg), package: packageName, attributes: {}, owner: ownerId,
        }, pkg);
        for (const member of this.api.ownedMembers(pkg['@id'])) {
            const isPart = member['@type'] === 'PartUsage';
            const isItem = member['@type'] === 'ItemUsage' && !this.direction(member);
            if ((!isPart && !isItem) || !this.api.name(member['@id']) || this.api.types(member['@id']).length === 0) continue;
            const childId = this.usage(member, isPart ? 'part' : 'item', packageName, ownerId);
            const child = this.elements.get(childId);
            if (child) child.attributes['elementPackage'] = name;
        }
    }

    // ─── Features, values, metadata ─────────────────────────────────────────

    private direction(element: ApiElement): string | undefined {
        const direction = element.direction;
        return typeof direction === 'string' ? direction : undefined;
    }

    /** Directed item features: a port's payloads, an action's parameters. */
    private directedFeatures(owner: ApiElement): ActionParameter[] {
        return this.api.ownedMembers(owner['@id'])
            .filter(m => ['ItemUsage', 'ReferenceUsage', 'AttributeUsage', 'PartUsage'].includes(m['@type']) && this.direction(m))
            .map(m => {
                const type = this.typeName(m);
                const subsetted = this.api.subsetted(m['@id'])[0] ?? this.api.referenced(m['@id'])[0];
                return {
                    name: this.api.name(m['@id']) ?? '',
                    direction: this.direction(m) as ActionParameter['direction'],
                    type: type ?? (subsetted ? this.api.name(subsetted['@id']) : undefined) ?? 'Item',
                };
            });
    }

    private parameters(owner: ApiElement): ActionParameter[] {
        return this.directedFeatures(owner);
    }

    /**
     * The flat attribute map: every attribute or reference member with a value
     * (or a type, or a structured body flattened to dotted keys), then metadata
     * applications, which win over a directly declared attribute of the same name.
     */
    private attributes(owner: ApiElement): Record<string, string> {
        const attributes: Record<string, string> = {};
        for (const member of this.api.ownedMembers(owner['@id'])) {
            if (member['@type'] !== 'AttributeUsage' && member['@type'] !== 'ReferenceUsage') continue;
            if (this.direction(member) || this.isBinding(member)) continue;
            const name = this.api.name(member['@id']);
            if (!name) continue;
            const value = this.api.value(member['@id']);
            if (value) {
                attributes[name] = this.render(value);
                continue;
            }
            const type = this.typeName(member);
            if (type && this.api.redefined(member['@id']).length === 0) {
                attributes[name] = `<${type}>`;
                continue;
            }
            for (const [key, nested] of Object.entries(this.attributes(member))) attributes[`${name}.${key}`] = nested;
        }
        Object.assign(attributes, this.metadata(owner));
        return attributes;
    }

    /** `@Foo { :>> field = value; }` applications, lifted under each field's own name. */
    private metadata(owner: ApiElement): Record<string, string> {
        const attributes: Record<string, string> = {};
        for (const member of this.api.ownedMembers(owner['@id'])) {
            if (member['@type'] !== 'MetadataUsage') continue;
            const type = this.typeName(member) ?? '';
            const aliases = METADATA_KEY_ALIASES[type] ?? {};
            for (const [field, value] of Object.entries(this.attributes(member))) {
                if (value === '') continue;
                attributes[aliases[field] ?? field] = value;
            }
        }
        return attributes;
    }

    /**
     * A part or reference member that SUBSETS a feature is a binding, not
     * containment: `part x : T :> rulePolicy { … }` records `x = rulePolicy`, and
     * `ref vp :> viewpointDefinition = v;` adds `v` to `viewpointDefinition`
     * (comma-joined, since such a feature may be bound more than once).
     */
    private isBinding(member: ApiElement): boolean {
        return (member['@type'] === 'PartUsage' || member['@type'] === 'ReferenceUsage')
            && this.api.subsetted(member['@id']).length > 0 && this.api.redefined(member['@id']).length === 0;
    }

    /** View metadata members flattened onto the view: bindings and an untyped `part :>> x { … }` body. */
    private viewMetadata(owner: ApiElement): Record<string, string> {
        const attributes: Record<string, string> = {};
        for (const member of this.api.ownedMembers(owner['@id'])) {
            if (this.isBinding(member)) {
                const subsetted = this.api.name(this.api.subsetted(member['@id'])[0]['@id']) ?? '';
                const value = this.api.value(member['@id']);
                const [key, bound] = value ? [subsetted, this.render(value)] : [this.api.name(member['@id']) ?? '', subsetted];
                if (!key) continue;
                attributes[key] = attributes[key] ? `${attributes[key]},${bound}` : bound;
                continue;
            }
            if (member['@type'] !== 'PartUsage') continue;
            if (this.api.types(member['@id']).length > 0) continue; // typed: containment
            const name = this.api.name(member['@id']);
            if (!name) continue;
            for (const [key, value] of Object.entries(this.attributes(member))) attributes[`${name}.${key}`] = value;
        }
        return attributes;
    }

    /** A view's `expose` paths, comma-joined, as `resolveViewElementIds` reads them. */
    private exposes(view: ApiElement): Record<string, string> {
        const paths: string[] = [];
        for (const relationship of this.api.ownedRelationships(view['@id'])) {
            if (relationship['@type'] !== 'NamespaceExpose' && relationship['@type'] !== 'MembershipExpose') continue;
            let name: string | undefined;
            if (relationship['@type'] === 'NamespaceExpose') {
                const target = relationship.importedNamespace as { '@id': string } | undefined;
                name = target ? this.api.qualifiedName(target['@id']) : undefined;
                if (name) name += relationship.isRecursive ? '::**' : '::*';
            } else {
                // A membership expose names a membership; the element is its member.
                const membership = relationship.importedMembership as { '@id': string } | undefined;
                const member = membership ? this.api.element(membership['@id'])?.memberElement as { '@id': string } | undefined : undefined;
                // Written by qualified name: a short name can be ambiguous (two
                // views may each declare a `clinician`), a qualified name never is.
                name = member ? this.api.qualifiedName(member['@id']) : undefined;
                if (name && relationship.isRecursive) name += '::**';
            }
            if (name) paths.push(name);
        }
        return paths.length > 0 ? { expose: paths.join(',') } : {};
    }

    /** A value as MEMO's flat attribute map spells it. */
    private render(value: ApiValue): string {
        switch (value.kind) {
            case 'string': return value.value;
            case 'number': return renderNumber(value.value, value.rational);
            case 'boolean': return String(value.value);
            case 'sequence': return value.items.map(item => this.render(item)).filter(s => s.length > 0).join(', ');
            case 'reference': {
                // An enumeration literal is `Kind::member`, the one spelling MEMO
                // accepts; any other reference is the referenced element's name.
                const target = this.api.resolve(value.qualifiedName);
                const owner = target ? this.api.owner(target['@id']) : undefined;
                if (owner?.['@type'] === 'EnumerationDefinition') {
                    return `${textualName(this.api.name(owner['@id']) ?? '')}::${textualName(lastSegment(value.qualifiedName))}`;
                }
                return lastSegment(value.qualifiedName);
            }
            case 'chain': return value.steps.map(lastSegment).join('.');
            default: return '';
        }
    }

    /** The flat attribute map of any element, for readers outside the builder. */
    attributesOf(owner: ApiElement): Record<string, string> { return this.attributes(owner); }

    /** The doc comment of any element, for readers outside the builder. */
    docOf(owner: ApiElement): string | undefined { return this.doc(owner); }

    private doc(owner: ApiElement): string | undefined {
        const documentation = this.api.ownedMembers(owner['@id']).find(m => m['@type'] === 'Documentation');
        const body = documentation?.body;
        if (typeof body !== 'string' || !body.trim()) return undefined;
        return body.replace(/^\/\*\s*/, '').replace(/\s*\*\/$/, '').replace(/\n\s*\*\s?/g, ' ').replace(/\s*\n\s*/g, ' ').trim();
    }

    private connectorEnds(connector: ApiElement): ApiElement[] {
        return this.api.ownedMembers(connector['@id']).filter(m => m.isEnd === true
            || this.api.ownedRelationships(m['@id']).some(r => r['@type'] === 'ReferenceSubsetting'));
    }

    private define(element: MemoElement, node: ApiElement): void {
        this.elements.define(element, node);
        this.idOf.set(node['@id'], element.id);
    }

    // ─── Relationships ──────────────────────────────────────────────────────
    //
    // The Langium builder's order, for the reason it gives: a named flow,
    // binding or interface is an identity a later connection, allocation or
    // trace may name, so those land first.

    buildRelationships(): void {
        const project = [...this.api.projectElements()];
        const scoped = (types: string[], where: 'package' | 'package-or-action') => project
            .filter(e => types.includes(e['@type']))
            .map(e => ({ node: e, ...this.contextOf(e) }))
            .filter(c => c.inPackage || (where === 'package-or-action' && c.parentActionId));

        for (const c of scoped(['FlowUsage', 'SuccessionFlowUsage'], 'package-or-action')) this.flow(c.node, c.packageName, c.parentActionId);
        for (const c of scoped(['BindingConnectorAsUsage'], 'package')) this.binding(c.node, c.packageName);
        for (const c of scoped(['InterfaceUsage'], 'package')) this.interfaceEdge(c.node, c.packageName);
        for (const c of scoped(['ConnectionUsage'], 'package')) this.connection(c.node, c.packageName);
        for (const c of scoped(['SuccessionAsUsage'], 'package-or-action')) this.succession(c.node, c.packageName, c.parentActionId);
        for (const c of scoped(['TransitionUsage'], 'package-or-action')) {
            if (c.parentActionId && !this.api.declaredName(c.node['@id'])) this.guardedSuccession(c.node, c.packageName, c.parentActionId);
        }
        for (const c of scoped(['AllocationUsage'], 'package')) this.allocation(c.node, c.packageName);
        this.nativeTraces(project);
        this.composition();
    }

    /** The enclosing package (qualified) and, when directly in an action body, that action's element id. */
    private contextOf(node: ApiElement): { packageName: string; parentActionId?: string; inPackage: boolean } {
        const owner = this.api.owner(node['@id']);
        const packageName = this.packageOf(node);
        const ownerId = owner ? this.api.qualifiedName(owner['@id']) : undefined;
        const isPackage = owner?.['@type'] === 'Package' || owner?.['@type'] === 'LibraryPackage';
        const isAction = ownerId !== undefined && this.elements.get(ownerId)?.construct === 'action';
        return { packageName, parentActionId: isAction ? ownerId : undefined, inPackage: isPackage };
    }

    private packageOf(node: ApiElement): string {
        for (let current = this.api.owner(node['@id']); current; current = this.api.owner(current['@id'])) {
            if (current['@type'] === 'Package' || current['@type'] === 'LibraryPackage') return this.api.qualifiedName(current['@id']) ?? '';
        }
        return '';
    }

    /** The nearest enclosing element that is a MEMO element: what owns a native usage. */
    private nearestElement(node: ApiElement): string | undefined {
        for (let current = this.api.owner(node['@id']); current; current = this.api.owner(current['@id'])) {
            const id = this.api.qualifiedName(current['@id']);
            if (id && this.elements.has(id)) return id;
        }
        return undefined;
    }

    /** The steps a feature reference names: a chain's, or the feature itself. */
    private steps(feature: ApiElement | undefined): ApiElement[] {
        if (!feature) return [];
        const chain = this.api.chain(feature['@id']);
        return chain.length ? chain : [feature];
    }

    /**
     * Resolve a reference to the deepest MEMO element it names, as the Langium
     * builder's `resolvePath` does: what is left over (an action's parameter, a
     * port's payload) is the end label. A resolved head is passed as its
     * qualified name, which `resolvePath` matches exactly; one that is not an
     * element (an inherited feature) falls back to its name in context.
     */
    private endpoint(steps: ApiElement[], context: { packageName: string; ownerId?: string }): { id?: string; end: string } {
        if (steps.length === 0) return { end: '' };
        const names = steps.map(step => this.api.name(step['@id']) ?? '');
        const head = this.api.qualifiedName(steps[0]['@id']);
        const reference = head && this.elements.has(head) ? [head, ...names.slice(1)].join('.') : names.join('.');
        const walked = this.elements.resolvePath(reference, context);
        if (walked.element) return { id: walked.id, end: walked.end };
        if (walked.ambiguous) return { end: '' };
        // A named flow or connection is an identity too.
        const asRelationship = this.elements.lookupRelationship(head ?? names.join('.'), context)
            ?? this.elements.lookupRelationship(names.join('.'), context);
        if (asRelationship) return { id: asRelationship.id, end: '' };
        // An element the project does not hold (a clause instance in the
        // ontology) is kept by its name, as the Langium builder keeps it.
        return { id: names.at(-1) || undefined, end: '' };
    }

    /** The feature a connector end references, as steps. */
    private endSteps(end: ApiElement): ApiElement[] {
        const target = this.api.related(end['@id'], ['ReferenceSubsetting'], 'referencedFeature')[0];
        return this.steps(target);
    }

    private sourceRangeOf(node: ApiElement): { offset: number; length: number } | undefined {
        const source = this.api.source(node['@id']);
        return source?.startByte !== undefined && source.endByte !== undefined
            ? { offset: source.startByte, length: source.endByte - source.startByte } : undefined;
    }

    private push(relationship: MemoRelationship, named: boolean, node: ApiElement): void {
        const line = this.api.source(node['@id'])?.line;
        if (line !== undefined) this.relationshipLines.set(relationship, line);
        this.relationships.push(relationship);
        if (named) this.elements.defineRelationship(relationship, node);
    }

    private nextId(): string { return `rel-${++this.counter}`; }

    lineOf(relationship: MemoRelationship): number | undefined { return this.relationshipLines.get(relationship); }

    /** The packages the project declares, as `collectPackages` reports them. */
    packages(): MemoPackageDTO[] {
        const out: MemoPackageDTO[] = [];
        for (const element of this.api.projectElements()) {
            if (element['@type'] !== 'Package' && element['@type'] !== 'LibraryPackage') continue;
            const qualifiedName = this.api.qualifiedName(element['@id']);
            if (!qualifiedName) continue;
            const separator = qualifiedName.lastIndexOf('::');
            out.push({
                qualifiedName,
                name: separator === -1 ? qualifiedName : qualifiedName.slice(separator + 2),
                ...(separator === -1 ? {} : { parent: qualifiedName.slice(0, separator) }),
                file: this.file(element),
            });
        }
        return out.sort((a, b) => a.qualifiedName.localeCompare(b.qualifiedName));
    }

    private tagPorts(relationship: MemoRelationship): void {
        if (this.elements.get(relationship.sourceId)?.construct === 'port') relationship.sourcePortId = relationship.sourceId;
        if (this.elements.get(relationship.targetId)?.construct === 'port') relationship.targetPortId = relationship.targetId;
    }

    private flow(node: ApiElement, packageName: string, parentActionId?: string): void {
        // Ends: a flow end (`from a.b`) references `a` and owns a flow feature
        // redefining `b`; a message end is an event parameter referencing its part.
        const endFeatures = this.api.ownedMembers(node['@id']).filter(m => m.isEnd === true
            || (m['@type'] === 'EventOccurrenceUsage' && this.api.referenced(m['@id']).length > 0));
        if (endFeatures.length < 2) return;
        const pathOf = (end: ApiElement) => {
            const steps = this.endSteps(end);
            const flowFeature = this.api.ownedMembers(end['@id'])
                .map(m => this.api.redefined(m['@id'])[0]).find(Boolean);
            return flowFeature ? [...steps, flowFeature] : steps;
        };
        const context = { packageName, ownerId: parentActionId };
        const source = this.endpoint(pathOf(endFeatures[0]), context);
        const target = this.endpoint(pathOf(endFeatures[1]), context);
        if (!source.id || !target.id || !this.elements.hasEntity(source.id) || !this.elements.hasEntity(target.id)) {
            this.diagnostics.push(`flow '${this.api.name(node['@id']) ?? '(anonymous)'}' has an end naming no element`);
            return;
        }
        const name = this.api.declaredName(node['@id']);
        const payload = this.api.ownedMembers(node['@id']).find(m => m['@type'] === 'PayloadFeature');
        const kind = this.typeName(node);
        const relationship: MemoRelationship = {
            id: name ? qualifiedId(name, packageName || undefined, parentActionId) : this.nextId(),
            ...(name ? { shortName: name } : {}),
            type: 'flow', sourceId: source.id, sourceEnd: source.end, targetId: target.id, targetEnd: target.end,
            file: this.file(node), sourceRange: this.sourceRangeOf(node), named: name ? true : undefined,
            kind, attributes: this.attributes(node),
            flowItem: payload ? this.typeName(payload) : undefined,
        };
        this.push(relationship, Boolean(name), node);
    }

    private binding(node: ApiElement, packageName: string): void {
        const ends = this.connectorEnds(node);
        if (ends.length < 2) return;
        const context = { packageName };
        const source = this.endpoint(this.endSteps(ends[0]), context);
        const target = this.endpoint(this.endSteps(ends[1]), context);
        if (!source.id || !target.id || !this.elements.has(source.id) || !this.elements.has(target.id)) {
            this.diagnostics.push(`binding '${this.api.name(node['@id']) ?? '(anonymous)'}' has an end naming no element`);
            return;
        }
        const name = this.api.declaredName(node['@id']);
        const attributes = this.attributes(node);
        this.push({
            id: name ? qualifiedId(name, packageName || undefined, undefined) : this.nextId(),
            ...(name ? { shortName: name, named: true } : {}),
            type: 'bind', sourceId: source.id, sourceEnd: source.end, targetId: target.id, targetEnd: target.end,
            file: this.file(node),
            ...(name ? { sourceRange: this.sourceRangeOf(node) } : {}),
            ...(Object.keys(attributes).length ? { attributes } : {}),
        }, Boolean(name), node);
    }

    private interfaceEdge(node: ApiElement, packageName: string): void {
        const ends = this.connectorEnds(node);
        if (ends.length < 2) return; // an interface with no ends is an element
        const context = { packageName };
        const source = this.endpoint(this.endSteps(ends[0]), context);
        const target = this.endpoint(this.endSteps(ends[1]), context);
        if (!source.id || !target.id || !this.elements.has(source.id) || !this.elements.has(target.id)) {
            this.diagnostics.push(`interface '${this.api.name(node['@id'])}' has an end naming no element`);
            return;
        }
        const name = this.api.declaredName(node['@id']) ?? '';
        const relationship: MemoRelationship = {
            id: qualifiedId(name, packageName || undefined, undefined), shortName: name, type: 'interface',
            sourceId: source.id, sourceEnd: source.end || 'source', targetId: target.id, targetEnd: target.end || 'target',
            file: this.file(node), sourceRange: this.sourceRangeOf(node), named: true,
            kind: this.typeName(node), attributes: this.attributes(node),
        };
        this.tagPorts(relationship);
        this.push(relationship, true, node);
    }

    private connection(node: ApiElement, packageName: string): void {
        let ends = this.connectorEnds(node);
        if (ends.length < 2) {
            // `connection : T { …; connect a to b; }`: by the grammar the `connect`
            // in a body declares a separate, nested connection, and the outer one
            // relates nothing (plan, milestone 1 item c). MEMO's own compiler read
            // the nested ends as the outer's, and the examples rely on it, so this
            // reads them the same way and says so.
            const nested = this.api.ownedMembers(node['@id'])
                .find(m => m['@type'] === 'ConnectionUsage' && this.connectorEnds(m).length >= 2);
            if (!nested) return;
            ends = this.connectorEnds(nested);
            this.diagnostics.push(`${this.file(node)}:${this.api.source(node['@id'])?.line ?? '?'}: `
                + `a 'connect' inside a connection's body declares a nested connection; it is read as this `
                + `connection's ends. Move 'connect … to …' into the declaration.`);
        }
        const context = { packageName };
        const sourceSteps = this.endSteps(ends[0]);
        const targetSteps = this.endSteps(ends[1]);
        const source = this.endpoint(sourceSteps, context);
        const target = this.endpoint(targetSteps, context);
        if (!source.id || !target.id) return;
        const typeName = this.typeName(node);
        const name = this.api.declaredName(node['@id']);
        const attributes = this.attributes(node);
        const relationship: MemoRelationship = {
            id: name ? qualifiedId(name, packageName || undefined, undefined) : this.nextId(),
            ...(name ? { shortName: name } : {}),
            type: typeName ? toModelType(typeName) : 'connect',
            sourceId: source.id, sourceEnd: this.api.declaredName(ends[0]['@id']) ?? 'source',
            targetId: target.id, targetEnd: this.api.declaredName(ends[1]['@id']) ?? 'target',
            file: this.file(node), sourceRange: this.sourceRangeOf(node), named: name ? true : undefined,
            attributes, flowItem: attributes.transportedItem || attributes.flowItem || undefined,
        };
        this.tagPorts(relationship);
        this.push(relationship, Boolean(name), node);
    }

    private succession(node: ApiElement, packageName: string, parentActionId?: string): void {
        const ends = this.connectorEnds(node);
        if (ends.length === 0 && parentActionId) {
            // `then action b;`: the ends are implied by position — the occurrence
            // declared before the succession and the one declared after it.
            const [before, after] = this.neighbours(node);
            if (before && after) this.relationships.push({ id: this.nextId(), type: 'succession', sourceId: before,
                sourceEnd: '', targetId: after, targetEnd: '', file: this.file(node) });
            return;
        }
        if (ends.length < 2) return;
        const context = { packageName, ownerId: parentActionId, file: this.file(node) };
        const pseudo = (steps: ApiElement[], which: 'start' | 'done') =>
            steps.length === 1 && this.api.qualifiedName(steps[0]['@id']) === `Actions::Action::${which}`;
        const resolve = (written: ApiElement[]) => {
            const steps = this.performedSteps(written);
            if (pseudo(steps, 'start')) return parentActionId ? `${parentActionId}__start` : '__start';
            if (pseudo(steps, 'done')) return parentActionId ? `${parentActionId}__done` : '__done';
            const found = this.endpoint(steps, context);
            return found.id && this.elements.has(found.id) ? found.id : undefined;
        };
        const sourceId = resolve(this.endSteps(ends[0]));
        const targetId = resolve(this.endSteps(ends[1]));
        if (!sourceId || !targetId) return;
        this.relationships.push({
            id: this.nextId(), type: 'succession', sourceId, sourceEnd: '', targetId, targetEnd: '', file: this.file(node),
        });
    }

    /**
     * The steps a succession end reaches. `first actClean then …` written where
     * the body declares `perform actClean;` names that perform usage, by the
     * name it takes from the action it performs (SysML name resolution finds
     * the local member first); the step MEMO records is the performed action,
     * the feature the perform's reference subsetting references.
     */
    private performedSteps(steps: ApiElement[]): ApiElement[] {
        const last = steps.at(-1);
        if (!last || last['@type'] !== 'PerformActionUsage') return steps;
        const performed = this.api.related(last['@id'], ['ReferenceSubsetting'], 'referencedFeature')[0];
        if (!performed) return steps;
        const chain = this.api.chain(performed['@id']);
        return chain.length ? chain : [performed];
    }

    /** The MEMO elements declared immediately before and after a member of its owner. */
    private neighbours(node: ApiElement): [string | undefined, string | undefined] {
        const owner = this.api.owner(node['@id']);
        if (!owner) return [undefined, undefined];
        const members = this.api.ownedMembers(owner['@id']);
        const at = members.findIndex(m => m['@id'] === node['@id']);
        const step = (m: ApiElement) => this.idOf.get(m['@id']);
        const before = members.slice(0, at).reverse().map(step).find(Boolean);
        const after = members.slice(at + 1).map(step).find(Boolean);
        return [before, after];
    }

    /**
     * `succession first a if g then b;` is a guarded succession, which SysML
     * makes a TransitionUsage (SysML-textual-bnf.kebnf, GuardedSuccession). MEMO
     * records it as a succession whose source end is the guard, `[g]`.
     */
    private guardedSuccession(node: ApiElement, packageName: string, parentActionId: string): void {
        const context = { packageName, ownerId: parentActionId };
        const first = this.api.ownedRelationships(node['@id'])[0];
        const sourceFeature = first?.['@type'] === 'Membership'
            ? this.api.element((first.memberElement as { '@id': string } | undefined)?.['@id'] ?? '') : undefined;
        const succession = this.api.ownedMembers(node['@id']).find(m => m['@type'] === 'SuccessionAsUsage');
        const targetEnd = succession ? this.connectorEnds(succession).at(-1) : undefined;
        const source = this.endpoint(this.steps(sourceFeature), context);
        const target = targetEnd ? this.endpoint(this.endSteps(targetEnd), context) : { id: undefined };
        if (!source.id || !target.id || !this.elements.has(source.id) || !this.elements.has(target.id)) return;
        const guardMembership = this.api.ownedRelationships(node['@id'])
            .find(r => r['@type'] === 'TransitionFeatureMembership' && r.kind === 'guard');
        const guard = guardMembership
            ? this.expressionText(((guardMembership.ownedRelatedElement as { '@id': string }[] | undefined) ?? [])[0]?.['@id'])
            : undefined;
        this.relationships.push({ id: this.nextId(), type: 'succession', sourceId: source.id,
            sourceEnd: guard === undefined ? '' : `[${guard}]`, targetId: target.id, targetEnd: '', file: this.file(node) });
    }

    /** An expression as readable text, as MEMO labels a guard: `validUser == true`. */
    private expressionText(id: string | undefined): string | undefined {
        const expression = id ? this.api.element(id) : undefined;
        if (!expression) return undefined;
        switch (expression['@type']) {
            case 'LiteralBoolean': return String(expression.value);
            case 'LiteralInteger': case 'LiteralRational': return String(expression.value);
            case 'LiteralString': return `"${expression.value}"`;
            case 'FeatureReferenceExpression': case 'FeatureChainExpression': {
                const value = this.api.value(expression['@id']) ?? this.valueOfExpression(expression['@id']);
                return value && value.kind !== 'other' ? this.render(value) : undefined;
            }
            case 'OperatorExpression': {
                const operands = this.api.ownedRelationships(id!)
                    .filter(r => r['@type'] === 'ParameterMembership')
                    .flatMap(r => ((r.ownedRelatedElement as { '@id': string }[] | undefined) ?? []))
                    .map(operand => {
                        const bound = this.api.ownedRelationships(operand['@id']).find(r => r['@type'] === 'FeatureValue');
                        return this.expressionText(((bound?.ownedRelatedElement as { '@id': string }[] | undefined) ?? [])[0]?.['@id']);
                    });
                if (operands.some(o => o === undefined)) return undefined;
                const operator = String(expression.operator);
                return operands.length === 1 ? `${operator} ${operands[0]}` : operands.join(` ${operator} `);
            }
            default: return undefined;
        }
    }

    /** The value of a bare expression (not a feature's), through a throwaway feature-value reading. */
    private valueOfExpression(id: string): ApiValue | undefined {
        return this.api.expression(id);
    }

    private allocation(node: ApiElement, packageName: string): void {
        const ends = this.connectorEnds(node);
        if (ends.length < 2) return;
        const context = { packageName };
        const source = this.endpoint(this.endSteps(ends[0]), context);
        const target = this.endpoint(this.endSteps(ends[1]), context);
        if (!source.id || !target.id) return;
        const sourceElement = this.elements.get(source.id);
        if (sourceElement) sourceElement.allocatedTo = target.id;
        // A typed allocation keeps which allocation it is (`DeploysTo`,
        // `BuildsInto`); an unknown or absent type is the base allocation.
        const typeName = this.typeName(node);
        const typed = typeName ? pascalToCamelCase(typeName) : undefined;
        const registry = this.registries?.relationshipRegistry;
        const type = typed && registry?.has(typed) ? typed : 'allocatedTo';
        const ends2 = type === 'allocatedTo'
            ? LANGUAGE_NATIVE_RELATIONS.allocatedTo.ends
            : registry?.getRelType(type)?.ends ?? [];
        this.relationships.push({
            id: this.nextId(), type, sourceId: source.id, sourceEnd: ends2[0]?.name ?? 'source',
            targetId: target.id, targetEnd: ends2[1]?.name ?? 'target', file: this.file(node),
        });
    }

    private native(name: keyof typeof LANGUAGE_NATIVE_RELATIONS, sourceId: string, targetId: string, file: string): void {
        const [sourceEnd, targetEnd] = LANGUAGE_NATIVE_RELATIONS[name].ends;
        this.relationships.push({ id: this.nextId(), type: name, sourceId, sourceEnd: sourceEnd.name, targetId, targetEnd: targetEnd.name, file });
    }

    /**
     * The action a `perform` declares in place. `perform action n : T;` has no
     * reference subsetting (SysML-textual-bnf.kebnf:952-955, the second
     * alternative of PerformActionUsageDeclaration), so the usage is itself the
     * action performed: the abstract syntax's `performedAction` is the
     * `ownedReferenceSubsetting`'s feature if there is one and the usage itself
     * if not. It is an element of the model owned by the performer, and the
     * performer performs it. An unnamed one has no identity to hold.
     */
    private performedHere(node: ApiElement, owner: string | undefined): string | undefined {
        // The declared name: `perform action :>> clean;` takes its name from what it
        // redefines and declares none, so it is not a new element.
        const name = this.api.declaredName(node['@id']);
        if (!name || !owner) return undefined;
        const id = qualifiedId(name, this.packageOf(node), owner);
        if (!this.elements.has(id)) {
            const ownerIsAction = this.elements.get(owner)?.construct === 'action';
            this.action(node, this.packageOf(node), ownerIsAction ? owner : undefined, ownerIsAction ? undefined : owner);
        }
        return id;
    }

    /** `satisfy`, `verify`, `perform`, subjects, actors, dependencies, variants, constraints. */
    private nativeTraces(project: ApiElement[]): void {
        const endpointOf = (steps: ApiElement[], node: ApiElement) => this.endpoint(steps, { packageName: this.packageOf(node) }).id;
        const valueSteps = (value: ApiValue | undefined): ApiElement[][] => {
            if (!value) return [];
            if (value.kind === 'reference') return [[this.api.resolve(value.qualifiedName)].filter(Boolean) as ApiElement[]];
            if (value.kind === 'chain') return [value.steps.map(q => this.api.resolve(q)).filter(Boolean) as ApiElement[]];
            if (value.kind === 'sequence') return value.items.flatMap(valueSteps);
            return [];
        };
        for (const node of project) {
            const type = node['@type'];
            const file = this.file(node);
            if (type === 'SatisfyRequirementUsage') {
                if (node.isNegated === true) continue;
                const requirement = endpointOf(this.steps(this.api.referenced(node['@id'])[0] && this.api.related(node['@id'], ['ReferenceSubsetting'], 'referencedFeature')[0]), node);
                const subject = this.api.ownedRelationships(node['@id']).find(r => r['@type'] === 'SubjectMembership');
                const subjectFeature = subject ? this.api.element(((subject.ownedRelatedElement as { '@id': string }[] | undefined) ?? [])[0]?.['@id'] ?? '') : undefined;
                const by = subjectFeature ? valueSteps(this.api.value(subjectFeature['@id']))[0] : undefined;
                const satisfying = by ? endpointOf(by, node) : undefined;
                if (requirement && satisfying) this.native('satisfiedBy', requirement, satisfying, file);
            } else if (type === 'RequirementVerificationMembership') {
                const verified = this.api.ownedMembers(node['@id'])[0] ?? this.api.element(((node.ownedRelatedElement as { '@id': string }[] | undefined) ?? [])[0]?.['@id'] ?? '');
                const requirement = verified ? endpointOf(this.steps(this.api.related(verified['@id'], ['ReferenceSubsetting'], 'referencedFeature')[0]), node) : undefined;
                const owner = this.nearestElement(node);
                if (requirement && owner) this.native('verifiedBy', requirement, owner, file);
            } else if (type === 'RequirementConstraintMembership') {
                const constraint = this.api.element(((node.ownedRelatedElement as { '@id': string }[] | undefined) ?? [])[0]?.['@id'] ?? '');
                const referenced = constraint ? this.api.related(constraint['@id'], ['ReferenceSubsetting'], 'referencedFeature')[0] : undefined;
                const owner = this.nearestElement(node);
                const target = referenced ? endpointOf(this.steps(referenced), node) : undefined;
                if (owner && target) this.native(node.kind === 'assumption' ? 'assumes' : 'requires', owner, target, file);
            } else if (type === 'PerformActionUsage' || type === 'IncludeUseCaseUsage' || type === 'ExhibitStateUsage') {
                const referenced = this.api.related(node['@id'], ['ReferenceSubsetting'], 'referencedFeature')[0];
                const owner = this.nearestElement(node);
                const target = referenced ? endpointOf(this.steps(referenced), node)
                    : type === 'PerformActionUsage' ? this.performedHere(node, owner) : undefined;
                const edge = type === 'PerformActionUsage' ? 'performs' : type === 'IncludeUseCaseUsage' ? 'includesStep' : 'exhibitsMode';
                if (owner && target) this.native(edge, owner, target, file);
            } else if (type === 'FramedConcernMembership') {
                const concern = this.api.element(((node.ownedRelatedElement as { '@id': string }[] | undefined) ?? [])[0]?.['@id'] ?? '');
                const referenced = concern ? this.api.related(concern['@id'], ['ReferenceSubsetting'], 'referencedFeature')[0] : undefined;
                const owner = this.nearestElement(node);
                const target = referenced ? endpointOf(this.steps(referenced), node) : undefined;
                if (owner && target) this.native('framesConcern', owner, target, file);
            } else if (type === 'ActionUsage' && this.api.subsetted(node['@id']).length > 0) {
                // `action step :> fnX;` is fnX performed here; the step's owner performs it.
                const owner = this.nearestElement(node);
                const target = endpointOf(this.steps(this.api.subsetted(node['@id'])[0]), node);
                if (owner && target) this.native('performs', owner, target, file);
            } else if (type === 'SubjectMembership') {
                const ownerNode = this.api.owner(node['@id']);
                const ownerId = ownerNode ? this.api.qualifiedName(ownerNode['@id']) : undefined;
                if (!ownerNode || !ownerId || !this.elements.has(ownerId)) continue; // a satisfy's subject, say
                const subject = this.api.element(((node.ownedRelatedElement as { '@id': string }[] | undefined) ?? [])[0]?.['@id'] ?? '');
                if (!subject) continue;
                const bound = [...valueSteps(this.api.value(subject['@id'])),
                    ...this.api.subsetted(subject['@id']).map(f => this.steps(f)),
                    ...this.api.related(subject['@id'], ['ReferenceSubsetting'], 'referencedFeature').map(f => this.steps(f))];
                const aboutSubject = ownerNode['@type'] === 'RequirementUsage' || ownerNode['@type'] === 'RequirementDefinition';
                for (const steps of bound) {
                    const boundId = endpointOf(steps, node);
                    if (!boundId) continue;
                    if (aboutSubject) this.native('hasSubject', ownerId, boundId, file);
                    else this.native('verifiedBy', boundId, ownerId, file);
                }
            } else if (type === 'ActorMembership') {
                const actor = this.api.element(((node.ownedRelatedElement as { '@id': string }[] | undefined) ?? [])[0]?.['@id'] ?? '');
                const bound = actor ? valueSteps(this.api.value(actor['@id']))[0] : undefined;
                const owner = this.nearestElement(node);
                const source = bound ? endpointOf(bound, node) : undefined;
                if (source && owner) this.native('participatesIn', source, owner, file);
            } else if (type === 'Dependency') {
                const refinement = this.api.ownedRelationships(node['@id'])
                    .filter(r => r['@type'] === 'Annotation')
                    .flatMap(r => this.api.ownedMembers(r['@id']).length ? this.api.ownedMembers(r['@id'])
                        : ((r.ownedRelatedElement as { '@id': string }[] | undefined) ?? []).map(x => this.api.element(x['@id'])).filter(Boolean) as ApiElement[])
                    .some(metadata => (this.typeName(metadata) ?? '').toLowerCase() === REFINEMENT_METADATA);
                const ids = (key: string) => ((node[key] as { '@id': string }[] | undefined) ?? [])
                    .map(r => this.api.element(r['@id'])).filter(Boolean) as ApiElement[];
                for (const client of ids('client')) {
                    const sourceId = endpointOf([client], node);
                    if (!sourceId) continue;
                    for (const supplier of ids('supplier')) {
                        const targetId = endpointOf([supplier], node);
                        if (!targetId) continue;
                        this.native('dependency', sourceId, targetId, file);
                        if (refinement) this.native('realizes', sourceId, targetId, file);
                    }
                }
            } else if (type === 'VariantMembership') {
                const variant = this.api.element(((node.ownedRelatedElement as { '@id': string }[] | undefined) ?? [])[0]?.['@id'] ?? '');
                const referenced = variant ? this.api.related(variant['@id'], ['ReferenceSubsetting'], 'referencedFeature')[0] : undefined;
                const owner = this.nearestElement(node);
                const target = referenced ? endpointOf(this.steps(referenced), node) : undefined;
                if (owner && target) this.relationships.push({
                    id: this.nextId(), type: 'variant', sourceId: owner, sourceEnd: 'variationPoint',
                    targetId: target, targetEnd: 'variant', file,
                });
            }
        }
    }

    /** `composes` edges from native nesting: parts, items and states by owner; actions by parent action. */
    private composition(): void {
        const containing = new Set(['part', 'item', 'state']);
        for (const element of this.elements.values()) {
            if (!containing.has(element.construct) || !element.owner) continue;
            const parent = this.elements.get(element.owner);
            if (!parent || !containing.has(parent.construct)) continue;
            this.relationships.push({ id: this.nextId(), type: 'composes', sourceId: element.owner, sourceEnd: 'parent',
                targetId: element.id, targetEnd: 'child', file: element.file, named: false });
        }
        for (const element of this.elements.values()) {
            if (element.construct !== 'action' || !element.parentAction) continue;
            const parent = this.elements.get(element.parentAction);
            if (!parent || parent.construct !== 'action') continue;
            this.relationships.push({ id: this.nextId(), type: 'composes', sourceId: element.parentAction, sourceEnd: 'parent',
                targetId: element.id, targetEnd: 'child', file: element.file, named: false });
        }
    }

    // ─── After extraction ───────────────────────────────────────────────────

    /** A usage typed by a local definition takes the ontology kind that definition resolved to. */
    private inheritKindsFromLocalDefinitions(): void {
        const registry = this.registries?.kindRegistry;
        if (!registry) return;
        const byName = new Map<string, MemoElement>();
        for (const [id, element] of this.elements) {
            if (!byName.has(id)) byName.set(id, element);
            if (element.shortName && !byName.has(element.shortName)) byName.set(element.shortName, element);
            if (element.name && !byName.has(element.name)) byName.set(element.name, element);
        }
        for (let pass = 0; pass < 16; pass++) {
            let progressed = false;
            for (const element of this.elements.values()) {
                if (!element.kind || registry.getKind(element.kind)) continue;
                const def = byName.get(lastSegment(element.kind));
                if (def && def !== element && def.kind && def.kind !== element.kind) {
                    element.kind = def.kind;
                    if (def.layer && (!element.layer || element.layer === 'unknown')) element.layer = def.layer;
                    progressed = true;
                }
            }
            if (!progressed) break;
        }
    }
}

/** The metamodel's control nodes, keyed to the `controlKind` MEMO records. */
const CONTROL_METACLASS_KINDS: Record<string, string> = {
    ForkNode: 'fork', JoinNode: 'join', DecisionNode: 'decide', MergeNode: 'merge',
};

function displayNameOf(attributes: Record<string, string>, shortName: string): string {
    return attributes['label'] || attributes['name'] || attributes['title'] || shortName;
}

/**
 * A number as the source most plausibly wrote it: the JSON holds values, not
 * spellings, so a real that is whole is written `100.0` (a rational literal
 * always has a point) and no value is written in exponent form.
 */
function renderNumber(value: number, rational: boolean): string {
    if (!Number.isFinite(value)) return String(value);
    if (rational && Number.isInteger(value)) return `${value}.0`;
    const plain = value.toLocaleString('en-US', { useGrouping: false, maximumFractionDigits: 20 });
    return plain;
}
