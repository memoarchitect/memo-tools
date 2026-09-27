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
import type { BuilderRegistries } from '../model/builder.js';
import { ElementIndex, qualifiedId } from '../model/element-index.js';
import { resolveLayerFromPath } from '../model/layer-resolver.js';
import type { ActionParameter, MemoConstruct, MemoElement, PortSpec } from '../model/semantic.js';
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

/**
 * Build MEMO's elements from a stage 1 handoff. `registries` are the ontology's,
 * loaded exactly as `buildMemoModel`'s caller loads them.
 */
export function buildElementsFromApi(api: ApiModel, registries?: BuilderRegistries): ApiBuildResult {
    const builder = new ElementBuilder(api, registries);
    builder.run();
    return { elements: builder.elements };
}

class ElementBuilder {
    readonly elements = new ElementIndex();

    constructor(private readonly api: ApiModel, private readonly registries?: BuilderRegistries) {}

    run(): void {
        for (const root of this.projectRootPackages()) this.visitPackage(root, '', undefined);
        this.inheritKindsFromLocalDefinitions();
    }

    /** Top-level packages the project declares. */
    private projectRootPackages(): ApiElement[] {
        const roots: ApiElement[] = [];
        for (const element of this.api.projectElements()) {
            if (element['@type'] !== 'Namespace') continue; // a document's root namespace
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

    private action(usage: ApiElement, packageName: string, parentActionId: string | undefined): void {
        const shortName = this.api.name(usage['@id']);
        if (!shortName) return;
        const id = qualifiedId(shortName, packageName, parentActionId);
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
            parentAction: parentActionId, parameters: this.parameters(usage),
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
