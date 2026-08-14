// ─── Model Builder ────────────────────────────────────────────────────────────
//
// Walks Langium AST documents and produces a serializable MemoModel.
// Maps SysML usages → MemoElements and ConnectionUsages → MemoRelationships.
//
// Key design decisions:
//   - usage.type (e.g. "Hazard") is matched against config.kinds for layer info
//   - ConnectionUsage.type (e.g. "Mitigates") → lowercase → matches config.relationshipTypes
//   - PackageRegistry tracks cross-file packages and resolves imports
//   - Connections are deferred until all elements are extracted (two-pass)
//   - Doc comments are extracted from usage bodies
//
// Dual-mode resolution (M41):
//   - If KindRegistry is provided, it takes precedence over config.kinds
//   - If RelationshipRegistry is provided, it takes precedence for relationship validation
//   - Falls back to config when registries are not provided or entry not found
//   - Backward compatible: existing callers pass no registries, behavior unchanged
//
// Phase 5 additions:
//   - ActionDefinition bodies extract parameters (in/out/inout)
//   - ActionUsage supports composite actions with nested actions
//   - FlowConnectionUsage → MemoRelationship of type "flow" with flowItem
//   - SuccessionUsage → MemoRelationship pairs of type "succession"
//   - ItemDefinition → MemoElement with construct "item"
//
// Language-native trace relations:
//   - AllocateUsage              → MemoRelationship "allocatedTo"
//   - SatisfyRequirementUsage    → MemoRelationship "satisfiedBy"
//   - RequirementVerificationMember → MemoRelationship "verifiedBy"
//   Each is the SAME edge the corresponding MEMO `connection def` produces —
//   see LANGUAGE_NATIVE_RELATIONS. A model may use either spelling and the
//   graph is identical, which is what makes the migration off the private
//   connection defs reversible one file at a time.
// ─────────────────────────────────────────────────────────────────────────────

import { createHash } from 'node:crypto';
import { AstUtils } from 'langium';
import type {
    Model,
    PackageDeclaration,
    PartUsage,
    RequirementUsage,
    ItemUsage,
    UseCaseDeclaration,
    VerificationUsage,
    StateUsage,
    InterfaceUsage,
    ActionUsage,
    PortUsage,
    ViewUsage,
    ConnectionUsage,
    AttributeMember,
    DocComment,
    StringValue,
    IntValue,
    BooleanValue,
    EnumValue,
    ActionDefinition,
    ItemDefinition,
    PartDefinition,
    PortDefinition,
    InterfaceDefinition,
    ConnectionDefinition,
    ActionParameterMember,
    BindingUsage,
    FlowConnectionUsage,
    MessageUsage,
    SuccessionUsage,
    AllocateUsage,
    ControlNodeUsage,
    SatisfyRequirementUsage,
    RequirementVerificationMember,
    PerformActionUsage,
    IncludeUseCaseUsage,
    ExhibitStateUsage,
    FramedConcernMember,
    SubjectMember,
    Dependency,
    VariantMember,
    ActorMember,
    StakeholderMember,
    ConcernUsage,
    TransitionUsage,
} from '../language/generated/ast.js';
import {
    isRequirementVerificationMember,
    isSatisfyRequirementUsage,
    isPerformActionUsage,
    isIncludeUseCaseUsage,
    isExhibitStateUsage,
    isFramedConcernMember,
    isSubjectMember,
    isDependency,
    isVariantMember,
    isActorMember,
} from '../language/generated/ast.js';
import type { MEMOConfig } from './config.js';
import type { KindDefinition } from './kind-registry.js';
import type {
    MemoElement,
    MemoRelationship,
    MemoModel,
    MemoPackageDTO,
    ParseError,
    ActionParameter,
    PortSpec,
} from './semantic.js';
import type { ParsedDocument } from './parser-utils.js';
import { PackageRegistry } from './package-registry.js';
import { assignSequentialShortIds, kindToPrefix } from './short-id.js';
import type { KindRegistry } from './kind-registry.js';
import type { RelationshipRegistry } from './relationship-registry.js';
import { LANGUAGE_NATIVE_RELATIONS, REFINEMENT_METADATA, pascalToCamelCase } from './relationship-registry.js';
import { indexKinds, kindConformsTo } from './relationship-legality.js';
import { CONTROL_KIND_METACLASS } from './activity-notation.js';
import type { ProvenanceTable, SemanticElementProvenance } from './source-provenance.js';
import { toModelType } from './naming.js';

/**
 * Optional registries for dual-mode resolution.
 * When provided, registries take precedence over config lookups.
 * Falls back to config when a registry entry is not found.
 */
export interface BuilderRegistries {
    /** KindRegistry populated from ontology SysML files */
    kindRegistry?: KindRegistry;
    /** RelationshipRegistry populated from ontology SysML files */
    relationshipRegistry?: RelationshipRegistry;
    /** Resolved source ownership; never infer this from a client-side path. */
    provenance?: ProvenanceTable;
}

let relationshipCounter = 0;

/** Deferred connection to resolve after all elements are extracted */
interface DeferredConnection {
    conn: ConnectionUsage;
    filePath: string;
    packageName: string;
}

/** Deferred flow to resolve after all elements are extracted */
interface DeferredFlow {
    flow: FlowConnectionUsage | MessageUsage;
    filePath: string;
    packageName: string;
    parentActionId?: string;
}

/**
 * Deferred binding to resolve after all elements are extracted.
 *
 * `bind outer = inner;` is port DELEGATION: the enclosing part's boundary port
 * and its interior port are the same feature, not two features with something
 * travelling between them. That distinction is why it cannot be spelled as a
 * flow — a flow's source must resolve to an output and a delegation runs `in`
 * to `in` (or `out` to `out`), which SysIDE rejects. SysML v2 keeps the two
 * apart the same way: training ch. 13 wires siblings with `flow`, ch. 12
 * delegates across a boundary with `bind`.
 */
interface DeferredBinding {
    binding: BindingUsage;
    filePath: string;
    packageName: string;
}

/** Deferred succession to resolve after all elements are extracted */
interface DeferredSuccession {
    succession: SuccessionUsage;
    filePath: string;
    packageName: string;
    parentActionId?: string;
}

/** Deferred allocate to resolve after all elements are extracted */
interface DeferredAllocate {
    allocate: AllocateUsage;
    filePath: string;
    packageName: string;
}

/**
 * Resolve a kind definition using registry-first, config-fallback strategy.
 * Returns the KindDefinition and the resolved kind name.
 */
function resolveKindDef(
    typeName: string,
    config: MEMOConfig,
    registries?: BuilderRegistries
): { kindDef: KindDefinition | undefined; resolvedKind: string } {
    // Try registry first
    if (registries?.kindRegistry) {
        const entry = registries.kindRegistry.getKind(typeName);
        if (entry) {
            return {
                kindDef: { label: entry.label, layer: entry.layer, sysmlConstruct: entry.sysmlConstruct },
                resolvedKind: typeName,
            };
        }
        // Try local part of qualified name
        if (typeName.includes('::')) {
            const localType = typeName.split('::').pop()!;
            const localEntry = registries.kindRegistry.getKind(localType);
            if (localEntry) {
                return {
                    kindDef: { label: localEntry.label, layer: localEntry.layer, sysmlConstruct: localEntry.sysmlConstruct },
                    resolvedKind: localType,
                };
            }
        }
    }

    // There is no config fallback. Kinds come from the ontology the project
    // resolves; a YAML `kinds:` block used to be able to declare one, which
    // meant a settings file could invent a type the ontology never defined.
    const kinds: Record<string, KindDefinition> = {};
    const kindDef = kinds[typeName];
    if (kindDef) {
        return { kindDef, resolvedKind: typeName };
    }

    // Try local part of qualified name in config
    if (typeName.includes('::')) {
        const localType = typeName.split('::').pop()!;
        if (kinds[localType]) {
            return { kindDef: kinds[localType], resolvedKind: localType };
        }
    }

    return { kindDef: undefined, resolvedKind: typeName };
}

/**
 * Build a MemoModel from parsed documents and config.
 * Optionally accepts registries for dual-mode resolution (registry-first, config-fallback).
 */
export function buildMemoModel(
    documents: ParsedDocument[],
    config: MEMOConfig,
    parseErrors: ParseError[] = [],
    registries?: BuilderRegistries
): MemoModel {
    relationshipCounter = 0;
    const elements = new Map<string, MemoElement>();
    const relationships: MemoRelationship[] = [];
    const errors: ParseError[] = [...parseErrors];
    const deferredConnections: DeferredConnection[] = [];
    const deferredFlows: DeferredFlow[] = [];
    const deferredSuccessions: DeferredSuccession[] = [];
    const deferredAllocates: DeferredAllocate[] = [];
    const deferredBindings: DeferredBinding[] = [];

    // Phase 1: Build package registry from all documents
    const registry = new PackageRegistry();
    registry.buildFromDocuments(documents);

    // Phase 2: Extract elements from all documents (populates registry)
    for (const { document, filePath } of documents) {
        const model = document.parseResult.value;
        extractFromModel(model, filePath, config, elements, deferredConnections, deferredFlows, deferredSuccessions, deferredAllocates, deferredBindings, errors, registry, registries);
    }

    // Phase 3: Resolve connections using the registry (all elements now known)
    const allElementIds = new Set(elements.keys());
    for (const { conn, filePath, packageName } of deferredConnections) {
        resolveConnection(conn, filePath, packageName, config, elements, relationships, registry, allElementIds);
    }

    // Phase 3b: Resolve flow connections
    for (const { flow, filePath, packageName, parentActionId } of deferredFlows) {
        resolveFlowConnection(flow, filePath, packageName, parentActionId, relationships, allElementIds, elements);
    }

    // Phase 3b2: Resolve port delegations
    for (const { binding, filePath, packageName } of deferredBindings) {
        resolveBinding(binding, filePath, packageName, relationships, allElementIds, elements);
    }

    // Phase 3c: Resolve successions
    for (const { succession, filePath, packageName, parentActionId } of deferredSuccessions) {
        resolveSuccession(succession, filePath, packageName, parentActionId, relationships, allElementIds);
    }

    // Phase 3d: Resolve allocations
    for (const { allocate, filePath, packageName } of deferredAllocates) {
        resolveAllocate(allocate, filePath, packageName, elements, relationships, registry, allElementIds, registries?.relationshipRegistry);
    }

    // Phase 3e: Resolve the native requirement relations. Unlike connections
    // these are not package members — a `satisfy` sits in the body of the part
    // that is the design context, and a `verify` in the body of the case that
    // does the verifying — so they are found by walking containment rather than
    // by the package-member switch, and their context comes from their owner.
    for (const { document, filePath } of documents) {
        resolveNativeTraceUsages(document.parseResult.value, filePath, relationships, registry, allElementIds);
    }

    // Phase 3f: Synthesize containment edges from native nesting. A natively
    // nested part carries its parent in `owner` (set during extraction); MEMO's
    // consumers read containment as a `composes` relationship (parent → child),
    // so emit one per nesting. A model that nests natively then looks identical
    // to one that wrote `Composes`, which is what lets R10-S7 delete the
    // relationship without the containment vanishing. Ports carry `owner` too,
    // so this is confined to part-to-part nesting.
    for (const el of elements.values()) {
        if (el.construct !== 'part' || !el.owner) continue;
        const parent = elements.get(el.owner);
        if (!parent || parent.construct !== 'part') continue;
        relationships.push({
            id: `rel-${++relationshipCounter}`,
            type: 'composes',
            sourceId: el.owner,
            sourceEnd: 'parent',
            targetId: el.id,
            targetEnd: 'child',
            file: el.file,
            named: false,
        });
    }
    // A nested action carries its parent in `parentAction` rather than
    // `owner` (the two are set by separate extraction paths), and
    // CR-ONT-065/066 already treat an action-typed end as a legitimate
    // composes participant alongside parts — a functional decomposition
    // (`action fnParent { action fnChild : SystemFunction { ... } }`) needs
    // the same synthesis or a natively nested function tree loses the
    // `composes` edges DSM and traceability consumers read, the exact
    // silent-drop shape R10-S7 exists to close, not open. Every action
    // usage nests some way — a flow step under its flow, a control node
    // under its action — so this is not confined to decomposition the way
    // the part path is; a nested action's owner IS its containing action
    // for every shape the grammar produces, so there is no narrower
    // predicate to gate this on without re-deriving one from AST shape
    // that `parentAction` already erased.
    for (const el of elements.values()) {
        if (el.construct !== 'action' || !el.parentAction) continue;
        const parent = elements.get(el.parentAction);
        if (!parent || parent.construct !== 'action') continue;
        relationships.push({
            id: `rel-${++relationshipCounter}`,
            type: 'composes',
            sourceId: el.parentAction,
            sourceEnd: 'parent',
            targetId: el.id,
            targetEnd: 'child',
            file: el.file,
            named: false,
        });
    }

    // Keep ownership of a declaration separate from ownership of the type that
    // classifies it.  A project usage of `Hazard` is editable project content;
    // its classifier is a read-only ontology definition.
    applySemanticProvenance(elements, relationships, registries);

    // Build indexes
    const elementsByKind = new Map<string, MemoElement[]>();
    const elementsByLayer = new Map<string, MemoElement[]>();
    for (const el of elements.values()) {
        if (!elementsByKind.has(el.kind)) elementsByKind.set(el.kind, []);
        elementsByKind.get(el.kind)!.push(el);
        if (!elementsByLayer.has(el.layer)) elementsByLayer.set(el.layer, []);
        elementsByLayer.get(el.layer)!.push(el);
    }

    // Assign each three-letter prefix one sequential display index. This is
    // deliberately distinct from the technical UUID assigned below.
    const elementsByPrefix = new Map<string, MemoElement[]>();
    for (const element of elements.values()) {
        const prefix = kindToPrefix(element.kind);
        const prefixElements = elementsByPrefix.get(prefix) ?? [];
        prefixElements.push(element);
        elementsByPrefix.set(prefix, prefixElements);
    }
    for (const [prefix, prefixElements] of elementsByPrefix) {
        const idToShortId = assignSequentialShortIds(prefix, prefixElements.map(e => e.id));
        for (const el of prefixElements) {
            (el as MemoElement).shortId = idToShortId.get(el.id);
            // `uuid` is part of the ontology's identification core, so a model
            // may author it. An authored value wins: it is the whole point of
            // writing one — the element keeps its identity across a file move
            // or an id change, which the derived hash cannot survive.
            (el as MemoElement).uuid = el.attributes.uuid?.trim() || stableElementUuid(el);
        }
    }

    // Phase 4: Validate relationship end types (warnings only).
    // A kind conforms to an end type if it equals it or specializes it
    // (transitively) — e.g. HardwareAssembly conforms to ArchitectureElement.
    if (registries?.relationshipRegistry) {
        // Same resolver the authoring UI and the server persistence path use,
        // so a link the panel offers is a link the builder accepts.
        const kindIndex = indexKinds(registries.kindRegistry?.toDefinitionDTOs() ?? []);
        const conformsTo = (kind: string, expected: string): boolean => {
            if (kindConformsTo(kind, expected, kindIndex)) return true;
            // Legacy fallback when the kind hierarchy is unknown to the registry
            return !kindIndex.has(kind) && kind.endsWith(expected);
        };

        for (const rel of relationships) {
            const regEntry = registries.relationshipRegistry.getRelType(rel.type);
            if (!regEntry || regEntry.ends.length === 0) continue;

            const sourceEl = elements.get(rel.sourceId);
            const targetEl = elements.get(rel.targetId);

            // Check if the source/target kinds match the typed ends
            for (const end of regEntry.ends) {
                if (!end.type) continue; // untyped ends allow any kind

                // Match end to source or target by position (first end = source, second = target)
                const endIndex = regEntry.ends.indexOf(end);
                const el = endIndex === 0 ? sourceEl : targetEl;
                if (!el) continue;

                if (!conformsTo(el.kind, end.type)) {
                    errors.push({
                        message: `[well-formedness] Relationship "${rel.type}" expects ${end.name} to be ${end.type}, but found ${el.kind}`,
                        file: rel.file ?? '',
                    });
                }
            }
        }
    }

    const relationshipsByType = new Map<string, MemoRelationship[]>();
    const outgoing = new Map<string, MemoRelationship[]>();
    const incoming = new Map<string, MemoRelationship[]>();
    for (const rel of relationships) {
        if (!relationshipsByType.has(rel.type)) relationshipsByType.set(rel.type, []);
        relationshipsByType.get(rel.type)!.push(rel);
        if (!outgoing.has(rel.sourceId)) outgoing.set(rel.sourceId, []);
        outgoing.get(rel.sourceId)!.push(rel);
        if (!incoming.has(rel.targetId)) incoming.set(rel.targetId, []);
        incoming.get(rel.targetId)!.push(rel);
    }

    return {
        elements,
        relationships,
        errors,
        packages: collectPackages(registry),
        elementsByKind,
        elementsByLayer,
        relationshipsByType,
        outgoing,
        incoming,
    };
}

/**
 * The declared packages, in the shape the model carries them.
 *
 * Read from the registry rather than from element membership so a package that
 * declares nothing is still reported: an explorer builds its containment tree
 * from this list, and a newly created package has no members yet by definition.
 */
function collectPackages(registry: PackageRegistry): MemoPackageDTO[] {
    const packages: MemoPackageDTO[] = [];
    for (const entry of registry.getPackages().values()) {
        const separator = entry.qualifiedName.lastIndexOf('::');
        packages.push({
            qualifiedName: entry.qualifiedName,
            name: separator === -1 ? entry.qualifiedName : entry.qualifiedName.slice(separator + 2),
            ...(separator === -1 ? {} : { parent: entry.qualifiedName.slice(0, separator) }),
            file: entry.file,
        });
    }
    return packages.sort((a, b) => a.qualifiedName.localeCompare(b.qualifiedName));
}

function applySemanticProvenance(
    elements: Map<string, MemoElement>,
    relationships: MemoRelationship[],
    registries?: BuilderRegistries,
): void {
    const table = registries?.provenance;
    if (!table) return;

    const entryFor = (kind: string) => registries?.kindRegistry?.getKind(kind)
            ?? registries?.kindRegistry?.getKind(kind.split('::').pop() ?? kind);
    const classifierFor = (kind: string) => {
        const entry = entryFor(kind);
        if (!entry?.qualifiedName) return undefined;
        return {
            qualifiedName: entry.qualifiedName,
            shortName: entry.name,
            provenance: entry.sourceFile ? table.lookup(entry.sourceFile) : undefined,
        };
    };
    const classifierChainFor = (kind: string) => {
        const chain = [] as NonNullable<SemanticElementProvenance['classifierChain']>;
        const seen = new Set<string>();
        let entry = entryFor(kind);
        while (entry?.qualifiedName && !seen.has(entry.qualifiedName)) {
            seen.add(entry.qualifiedName);
            chain.push({
                qualifiedName: entry.qualifiedName,
                shortName: entry.name,
                provenance: entry.sourceFile ? table.lookup(entry.sourceFile) : undefined,
            });
            entry = entry.superType ? entryFor(entry.superType) : undefined;
        }
        return chain.length > 0 ? chain : undefined;
    };
    const declarationFor = (file: string, kind?: string): SemanticElementProvenance => ({
        declaration: table.lookupOrProject(file),
        classifier: kind ? classifierFor(kind) : undefined,
        classifierChain: kind ? classifierChainFor(kind) : undefined,
    });

    for (const element of elements.values()) {
        element.provenance = declarationFor(element.file, element.kind);
    }
    for (const relationship of relationships) {
        relationship.provenance = declarationFor(relationship.file, relationship.type);
    }
}

/**
 * Derive a UUID from source identity, rather than allocating a random value on
 * every compilation. This is the machine identity; `shortId` is the compact
 * human-facing PREFIX-1, PREFIX-2, … label used in explorers.
 */
function stableElementUuid(element: Pick<MemoElement, 'file' | 'kind' | 'id'>): string {
    const bytes = createHash('sha256')
        .update(`${element.file}\0${element.kind}\0${element.id}`)
        .digest()
        .subarray(0, 16);
    bytes[6] = (bytes[6] & 0x0f) | 0x50; // UUID v5 shape
    bytes[8] = (bytes[8] & 0x3f) | 0x80; // RFC 4122 variant
    const hex = bytes.toString('hex');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

// ─── AST Walking ────────────────────────────────────────────────────────────

function extractFromModel(
    model: Model,
    filePath: string,
    config: MEMOConfig,
    elements: Map<string, MemoElement>,
    deferredConnections: DeferredConnection[],
    deferredFlows: DeferredFlow[],
    deferredSuccessions: DeferredSuccession[],
    deferredAllocates: DeferredAllocate[],
    deferredBindings: DeferredBinding[],
    errors: ParseError[],
    registry: PackageRegistry,
    registries?: BuilderRegistries
): void {
    for (const member of model.members) {
        if (member.$type === 'PackageDeclaration') {
            extractFromPackage(member as PackageDeclaration, filePath, '', config, elements, deferredConnections, deferredFlows, deferredSuccessions, deferredAllocates, deferredBindings, errors, registry, registries);
        }
    }
}

function extractFromPackage(
    pkg: PackageDeclaration,
    filePath: string,
    parentPackage: string,
    config: MEMOConfig,
    elements: Map<string, MemoElement>,
    deferredConnections: DeferredConnection[],
    deferredFlows: DeferredFlow[],
    deferredSuccessions: DeferredSuccession[],
    deferredAllocates: DeferredAllocate[],
    deferredBindings: DeferredBinding[],
    errors: ParseError[],
    registry: PackageRegistry,
    registries?: BuilderRegistries
): void {
    const packageName = parentPackage ? `${parentPackage}::${pkg.name}` : pkg.name;

    for (const member of pkg.members) {
        switch (member.$type) {
            case 'PackageDeclaration':
                extractFromPackage(member as PackageDeclaration, filePath, packageName, config, elements, deferredConnections, deferredFlows, deferredSuccessions, deferredAllocates, deferredBindings, errors, registry, registries);
                break;
            case 'PartUsage':
                extractUsage(member as PartUsage, 'part', filePath, packageName, config, elements, registry, registries);
                break;
            case 'RequirementUsage':
                extractUsage(member as RequirementUsage, 'requirement', filePath, packageName, config, elements, registry, registries);
                break;
            case 'ItemUsage':
                extractUsage(member as ItemUsage, 'item', filePath, packageName, config, elements, registry, registries);
                break;
            case 'UseCaseDeclaration': {
                const useCase = member as UseCaseDeclaration;
                if (!useCase.isDefinition) {
                    extractUsage({ name: useCase.name, type: useCase.type, body: useCase.usageBody }, 'use case', filePath, packageName, config, elements, registry, registries);
                }
                break;
            }
            case 'VerificationUsage':
                extractUsage(member as VerificationUsage, 'verification', filePath, packageName, config, elements, registry, registries);
                break;
            case 'StateUsage':
                extractUsage(member as StateUsage, 'state', filePath, packageName, config, elements, registry, registries);
                break;
            case 'InterfaceUsage':
                extractUsage(member as InterfaceUsage, 'interface', filePath, packageName, config, elements, registry, registries);
                break;
            case 'ActionUsage':
                extractActionUsage(member as ActionUsage, filePath, packageName, config, elements, deferredFlows, deferredSuccessions, registry, registries);
                break;
            case 'PortUsage':
                extractUsage(member as PortUsage, 'port', filePath, packageName, config, elements, registry, registries);
                break;
            case 'ViewUsage':
                extractUsage(member as ViewUsage, 'view', filePath, packageName, config, elements, registry, registries);
                break;
            case 'ConnectionUsage':
                // Defer connection resolution until all elements are extracted
                deferredConnections.push({
                    conn: member as ConnectionUsage,
                    filePath,
                    packageName,
                });
                break;
            case 'BindingUsage':
                // Port delegation. Deferred for the same reason as flows: both
                // ends are dotted paths that only resolve once every nested
                // port is an element.
                deferredBindings.push({
                    binding: member as BindingUsage,
                    filePath,
                    packageName,
                });
                break;
            case 'FlowConnectionUsage':
                // A flow between two action usages declared side by side in a
                // package has no enclosing action, so parentActionId is unset
                // and the endpoints resolve against the package scope.
                deferredFlows.push({
                    flow: member as FlowConnectionUsage,
                    filePath,
                    packageName,
                });
                break;
            case 'MessageUsage':
                // `Message : FlowUsage`: native messages deliberately lower
                // through the same path as MEMO's flow-shaped compatibility
                // vocabulary, so consumers retain one trace-edge spelling.
                deferredFlows.push({
                    flow: member as MessageUsage,
                    filePath,
                    packageName,
                });
                break;
            case 'SuccessionUsage':
                deferredSuccessions.push({
                    succession: member as SuccessionUsage,
                    filePath,
                    packageName,
                });
                break;
            case 'AllocateUsage':
                deferredAllocates.push({
                    allocate: member as AllocateUsage,
                    filePath,
                    packageName,
                });
                break;
            // ─── Native declarations (plan §8) ──────────────────────────
            //
            // `actor u : User;`, `stakeholder s : Stakeholder;` and
            // `concern c : Concern;` declare the same elements `part u : User;`
            // declares — same id, same kind, same attributes, same doc. Only
            // the metaclass differs, and the metaclass is what makes them
            // legible to a conforming tool. Routing them through extractUsage
            // is what keeps the migration in step 3 a spelling change rather
            // than a content change.
            case 'ActorMember':
                extractUsage(member as ActorMember, 'actor', filePath, packageName, config, elements, registry, registries);
                break;
            case 'StakeholderMember':
                extractUsage(member as StakeholderMember, 'stakeholder', filePath, packageName, config, elements, registry, registries);
                break;
            case 'ConcernUsage':
                extractUsage(member as ConcernUsage, 'concern', filePath, packageName, config, elements, registry, registries);
                break;
            case 'TransitionUsage':
                extractTransition(member as TransitionUsage, filePath, packageName, config, elements, registry, registries);
                break;
            // ─── Definition members ─────────────────────────────────────
            case 'ActionDefinition':
                extractActionDefinition(member as ActionDefinition, filePath, packageName, config, elements, deferredFlows, deferredSuccessions, registry, registries);
                break;
            case 'ItemDefinition':
                extractItemDefinition(member as ItemDefinition, filePath, packageName, config, elements, registry, registries);
                break;
            case 'PartDefinition':
            case 'PortDefinition':
            case 'InterfaceDefinition':
            case 'ConnectionDefinition':
                extractDefinitionPorts(member as PartDefinition | PortDefinition | InterfaceDefinition | ConnectionDefinition, filePath, packageName, config, elements, registry, registries);
                break;
            // Other definitions (viewpoint def, view def, etc.) inside packages are
            // ontology-level — we don't extract them as model elements in device projects
        }
    }
}

interface UsageNode {
    name: string;
    type?: string;
    body: any[];
}

function extractUsage(
    usage: UsageNode,
    construct: string,
    filePath: string,
    packageName: string,
    config: MEMOConfig,
    elements: Map<string, MemoElement>,
    registry: PackageRegistry,
    registries?: BuilderRegistries
): void {
    const id = usage.name;
    const typeName = usage.type; // e.g. "Hazard", "Requirement"

    // Dual-mode resolution: registry first, then config fallback
    const { kindDef: finalKindDef, resolvedKind } = typeName
        ? resolveKindDef(typeName, config, registries)
        : { kindDef: undefined, resolvedKind: 'Unknown' };

    const attributes = extractAttributes(usage.body);
    const doc = extractDocComment(usage.body);

    // A view's `expose <path>;` members declare its element membership
    // natively — SysML v2's own visibility mechanism, in place of the MEMO
    // `IncludedIn` relationship. Collected as a comma-separated attribute so
    // `resolveViewElementIds` in view-deriver.ts can resolve each path
    // against the model the same way it resolves `selectionQuery.*`.
    if (construct === 'view') {
        const exposePaths = (usage.body || [])
            .filter(member => (member as any).$type === 'ExposeMember')
            .map(member => (member as any).path as string);
        if (exposePaths.length > 0) {
            attributes['expose'] = exposePaths.join(',');
        }
    }

    // Nested part members that are view METADATA, not containment: reference
    // bindings (`part viewpoint :> vp;`) and the `:>>` redefinition of an
    // inherited feature whose body is attributes (`part :>> selectionQuery
    // { ... }`). These are flattened onto the owner as plain / prefixed
    // attributes so SysML-modelled views expose their viewpoint binding and
    // selection-query metadata to consumers. A typed nested part is NOT metadata
    // — it is real containment and is extracted as its own element below.
    for (const member of usage.body || []) {
        if ((member as any).$type !== 'PartMember') continue;
        const pm = member as any;
        if (pm.boundRef && pm.name) {
            // Two shapes land here. `part viewpointDefinition :> vp;` names the
            // feature in `name` and the value in `boundRef`. The subsetting
            // form for a multi-valued feature —
            // `part vpLogical :> viewpointDefinition = someViewpoint;` — puts
            // the FEATURE in `boundRef` and the value in `subsetValue`, and its
            // member name is arbitrary. Attribute it to the feature it subsets,
            // or a view governed by three viewpoints would surface as three
            // unrelated attributes nothing reads.
            const key = pm.subsetValue ? pm.boundRef : pm.name;
            const value = pm.subsetValue ?? pm.boundRef;

            // A feature with multiplicity may be rebound more than once. Keep
            // every binding as a comma-separated value so view conformance can
            // model one view against several viewpoints without cloning it.
            const previous = attributes[key];
            attributes[key] = previous ? `${previous},${value}` : value;
        } else if (!pm.type && pm.body && pm.name) {
            // R10-S3 guard: an UNTYPED nested part with an attribute body is
            // view metadata — the `part :>> selectionQuery { ... }` (or the
            // un-redefined `part selectionQuery { ... }`) that view derivation
            // reads as `selectionQuery.*` attributes. It carries no kind, so it
            // is not a contained element. Flatten it; a TYPED nested part
            // (`part valve : Valve`) is real containment and is extracted below.
            const nested = extractAttributes(pm.body);
            for (const [k, v] of Object.entries(nested)) {
                attributes[`${pm.name}.${k}`] = v;
            }
        }
    }

    // Human-readable name: prefer "attribute redefines name" over usage name
    const displayName = attributes['name'] || attributes['title'] || id;

    const element: MemoElement = {
        id,
        name: displayName,
        kind: resolvedKind,
        construct,
        layer: finalKindDef?.layer || 'unknown',
        file: filePath,
        package: packageName || undefined,
        attributes,
        doc,
    };

    // Port-specific fields
    if (construct === 'port') {
        const portNode = usage as PortUsage;
        const directedItems = (usage.body || [])
            .filter(member => member.$type === 'ItemUsage' && !!(member as ItemUsage).direction)
            .map(member => member as ItemUsage);
        const itemDirections = new Set(directedItems.map(item => item.direction));
        element.portSpec = {
            type: portNode.type,
            direction: (portNode.direction ?? (itemDirections.size === 1 ? directedItems[0]?.direction : undefined)) as PortSpec['direction'],
            isConjugated: portNode.isConjugated ?? false,
        };
        element.parameters = directedItems
            .map(feature => {
                return {
                    name: feature.name,
                    direction: feature.direction as ActionParameter['direction'],
                    type: feature.type || 'Item',
                };
            });
    }

    elements.set(id, element);
    registry.registerElement(id, packageName);

    // A port's body may declare further ports. Recurse only after the parent is
    // in the map, so the child's `owner` points at an element that exists.
    if (construct === 'port') {
        extractDefinitionPorts(usage, filePath, packageName, config, elements, registry, registries);
    }

    // A part's body may nest further parts. SysML v2 expresses containment by
    // nesting; MEMO historically expressed it with a `Composes` connection, and
    // the two must yield the same model. Extract each nested part as its own
    // element with `owner` set — exactly as a nested port is — only after the
    // parent is in the map. buildMemoModel synthesizes the `composes` edge from
    // the resulting `owner` chain.
    //
    // A part usage may also declare its OWN boundary ports directly in its
    // body (`part x : T { in port p : DataPort; }`), distinct from a nested
    // part's ports and from any ports the type `T` declares at the def level
    // (that path is `extractDefinitionPorts` at package scope, line ~668).
    // Without this, an inline-authored port silently has no element: it
    // parses, every relationship endpoint referencing it resolves to a
    // dangling id, and nothing downstream reports why.
    if (construct === 'part') {
        extractNestedParts(usage, filePath, packageName, config, elements, registry, registries);
        extractDefinitionPorts(usage, filePath, packageName, config, elements, registry, registries);
    }

    // A native `transition` lives inside the state machine that owns it, which
    // is where the language puts it and where MEMO's `part def Transition`
    // never could. Extract it from the state usage's body so the two spellings
    // yield the same element set.
    for (const member of usage.body || []) {
        if ((member as any).$type === 'TransitionUsage') {
            extractTransition(member as TransitionUsage, filePath, packageName, config, elements, registry, registries);
        }
    }
}

/**
 * Extract a native `transition` as a MemoElement.
 *
 * MEMO models a transition as `part def Transition` with `sourceState` and
 * `targetState` as **Strings** (§13.3) — and in the shipped content those
 * strings hold display names ("Idle"), not element ids, so nothing can follow
 * them to the states they name. The native form's source and target are real
 * references, so they are resolved to element ids here.
 *
 * Both are still written into the attribute map under the same keys the part
 * def declares. That is deliberate: it keeps every existing consumer of
 * `sourceState` / `targetState` working while the two spellings coexist, and it
 * is what makes the eventual migration a change of value (display name →
 * element id) that a diff can show, rather than a change of shape that it
 * cannot.
 *
 * An anonymous transition (`transition initial then off;`) declares no element.
 * It is a control statement, not a named thing the model traces to.
 */
function extractTransition(
    transition: TransitionUsage,
    filePath: string,
    packageName: string,
    config: MEMOConfig,
    elements: Map<string, MemoElement>,
    registry: PackageRegistry,
    registries?: BuilderRegistries,
): void {
    if (!transition.name) return;

    const attributes: Record<string, string> = {
        ...extractAttributes(transition.body),
        sourceState: transition.source,
        targetState: transition.target,
    };
    if (transition.trigger) attributes.trigger = transition.trigger;
    if (transition.effect) attributes.effectSummary = transition.effect;
    const guard = renderGuardExpression(transition.guard);
    if (guard !== undefined) attributes.guardSummary = guard;

    const { kindDef, resolvedKind } = transition.type
        ? resolveKindDef(transition.type, config, registries)
        : { kindDef: undefined, resolvedKind: 'Unknown' };

    elements.set(transition.name, {
        id: transition.name,
        name: attributes.name || transition.name,
        kind: resolvedKind,
        construct: 'transition',
        layer: kindDef?.layer || 'unknown',
        file: filePath,
        package: packageName || undefined,
        attributes,
        doc: extractDocComment(transition.body),
    });
    registry.registerElement(transition.name, packageName);
}

/**
 * Extract an ActionDefinition as a MemoElement with parameters.
 */
function extractActionDefinition(
    actionDef: ActionDefinition,
    filePath: string,
    packageName: string,
    config: MEMOConfig,
    elements: Map<string, MemoElement>,
    deferredFlows: DeferredFlow[],
    deferredSuccessions: DeferredSuccession[],
    registry: PackageRegistry,
    registries?: BuilderRegistries,
): void {
    const id = actionDef.name;

    // Extract parameters from body
    const parameters: ActionParameter[] = [];
    const bodyMembers = actionDef.body || [];
    for (const member of bodyMembers) {
        if (member.$type === 'ActionParameterMember' || (member.$type === 'ItemUsage' && (member as ItemUsage).direction)) {
            const param = member as ActionParameterMember | ItemUsage;
            parameters.push({
                name: param.name,
                direction: param.direction as ActionParameter['direction'],
                type: param.type || 'Item',
            });
        }
    }

    const attributes = extractAttributes(bodyMembers);
    const doc = extractDocComment(bodyMembers);

    const behaviorKind = actionDef.behaviorKind ?? 'action';
    const element: MemoElement = {
        id,
        name: id,
        kind: behaviorKind === 'operator' ? 'OperatorDefinition'
            : behaviorKind === 'function' ? 'FunctionDefinition' : 'ActionDefinition',
        construct: 'action',
        layer: 'behavior',
        file: filePath,
        package: packageName || undefined,
        attributes: { ...attributes, behaviorKind },
        doc,
        parameters: parameters.length > 0 ? parameters : undefined,
    };

    elements.set(id, element);
    registry.registerElement(id, packageName);

    // Standard SysML activity bodies may contain action/control usages directly
    // (not wrapped in an ActionUsage). Preserve those declarations so a valid
    // activity diagram cannot collapse to its enclosing action alone.
    // `previousStep` carries the member a `then` refers back to: in standard
    // SysML a body member written `then action x ...` succeeds the step declared
    // before it, with no `succession` usage naming either end.
    let previousStep: string | undefined;
    let terminateCount = 0;
    for (const member of bodyMembers) {
        let step: string | undefined;
        if (member.$type === 'ActionUsage') {
            extractActionUsage(member as ActionUsage, filePath, packageName, config, elements, deferredFlows, deferredSuccessions, registry, registries, id);
            step = (member as ActionUsage).name;
        } else if (member.$type === 'ControlNodeUsage') {
            extractControlNode(member as ControlNodeUsage, filePath, packageName, elements, registry, id);
            step = (member as ControlNodeUsage).name;
        } else if (['AcceptActionUsage', 'SendActionUsage', 'DecisionNodeUsage', 'MergeNodeUsage', 'TerminateUsage'].includes(member.$type)) {
            const node = member as any;
            // A terminate node has no name to be given one by, and an id keyed
            // on `elements.size` moves whenever anything else in the file does.
            // Key it on the action that owns it instead, so a view can name it
            // and a saved layout keeps pointing at the same node.
            const fallback = node.$type === 'TerminateUsage'
                ? `${id}__terminate${terminateCount++ === 0 ? '' : terminateCount}`
                : `${node.$type}-${elements.size}`;
            const nodeId: string = node.name ?? fallback;
            step = nodeId;
            extractStandardActivityNode(node, filePath, packageName, elements, registry, id, nodeId);
        } else if (member.$type === 'SuccessionUsage') {
            deferredSuccessions.push({ succession: member as SuccessionUsage, filePath, packageName, parentActionId: id });
        }

        if (step && (member as any).followsPrevious && previousStep) {
            deferredSuccessions.push({
                succession: { steps: [{ ref: previousStep }, { ref: step }] } as unknown as SuccessionUsage,
                filePath,
                packageName,
                parentActionId: id,
            });
        }
        if (step) previousStep = step;
    }
}

function extractStandardActivityNode(node: { $type: string; name?: string; payloadName?: string; payloadType?: string }, filePath: string, packageName: string, elements: Map<string, MemoElement>, registry: PackageRegistry, parentActionId: string, id: string): void {
    const typeToKind: Record<string, string> = {
        AcceptActionUsage: 'AcceptActionUsage', SendActionUsage: 'SendActionUsage',
        DecisionNodeUsage: 'DecisionNodeUsage', MergeNodeUsage: 'MergeNodeUsage', TerminateUsage: 'ActivityFinalNodeUsage',
    };
    const parameters: ActionParameter[] | undefined = node.$type === 'AcceptActionUsage' && node.payloadName
        ? [{ name: node.payloadName, direction: 'out', type: node.payloadType ?? 'Item' }]
        : undefined;
    elements.set(id, {
        id, name: node.name ?? node.$type, kind: typeToKind[node.$type] ?? node.$type,
        construct: 'action', layer: 'behavior', file: filePath, package: packageName || undefined,
        attributes: { ...(node.payloadName ? { payloadName: node.payloadName } : {}), ...(node.payloadType ? { payloadType: node.payloadType } : {}) }, parentAction: parentActionId, parameters,
    });
    registry.registerElement(id, packageName);
}

/**
 * Extract an ItemDefinition as a MemoElement.
 */
function extractItemDefinition(
    itemDef: ItemDefinition,
    filePath: string,
    packageName: string,
    config: MEMOConfig,
    elements: Map<string, MemoElement>,
    registry: PackageRegistry,
    registries?: BuilderRegistries
): void {
    const id = itemDef.name;

    const attributes = extractAttributes(itemDef.body);
    const doc = extractDocComment(itemDef.body);
    const typeName = itemDef.specialization?.superType;
    const { kindDef, resolvedKind } = typeName
        ? resolveKindDef(typeName, config, registries)
        : { kindDef: undefined, resolvedKind: 'ItemDefinition' };

    const element: MemoElement = {
        id,
        name: id,
        kind: kindDef?.layer && kindDef.layer !== 'unknown' ? resolvedKind : 'ItemDefinition',
        construct: 'item',
        layer: kindDef?.layer && kindDef.layer !== 'unknown' ? kindDef.layer : 'behavior',
        file: filePath,
        package: packageName || undefined,
        attributes,
        doc,
    };

    elements.set(id, element);
    registry.registerElement(id, packageName);
}

/**
 * Walk an owner's body to extract port usages as owned port elements.
 * Sets owner on ports and ownedPorts on the owner.
 *
 * The owner may be a definition (`part def Board { port p : DataPort; }`) or a
 * USAGE — including another port. SysML v2 nests ports inside ports, which is
 * how a panel cluster says "this one boundary feature carries these three
 * connectors". Without the usage case a model that nests natively simply loses
 * the children: they are declared, they resolve, and they never become
 * elements, so they vanish from every diagram and every count. The only
 * alternative spelling is a `Composes` connection from a port to a port, which
 * CR-ONT-065 forbids — a whole in a decomposition has to be a part, an action
 * or a state. So the native form was the only correct one, and it was the one
 * that did not work.
 */
function extractDefinitionPorts(
    def: PartDefinition | PortDefinition | InterfaceDefinition | ConnectionDefinition | UsageNode,
    filePath: string,
    packageName: string,
    config: MEMOConfig,
    elements: Map<string, MemoElement>,
    registry: PackageRegistry,
    registries?: BuilderRegistries
): void {
    const ownerId = def.name;
    const body = def.body || [];
    const ownedPortIds: string[] = [];

    for (const member of body) {
        if (member.$type === 'PortUsage') {
            const portUsage = member as PortUsage;
            extractUsage(portUsage, 'port', filePath, packageName, config, elements, registry, registries);
            const portEl = elements.get(portUsage.name);
            if (portEl) {
                portEl.owner = ownerId;
                ownedPortIds.push(portUsage.name);
            }
        }
    }

    if (ownedPortIds.length > 0) {
        const ownerEl = elements.get(ownerId);
        if (ownerEl) {
            ownerEl.ownedPorts = ownedPortIds;
        }
    }
}

/**
 * Walk a part usage's body to extract nested parts as owned elements, setting
 * `owner` on each child.
 *
 * `extractUsage` flattens the `PartMember` shapes that are view metadata — a
 * reference binding (`part viewpoint :> vp;`) and an untyped body
 * (`part :>> selectionQuery { ... }`). A TYPED nested part
 * (`part valve : Valve { ... }`) is real containment: without this it is
 * declared, resolves, and never becomes an element — the same silent drop
 * nested ports had before `extractDefinitionPorts` walked port usages. The
 * `composes` edge that makes containment legible to consumers is synthesized
 * from the `owner` chain in buildMemoModel.
 */
function extractNestedParts(
    owner: UsageNode,
    filePath: string,
    packageName: string,
    config: MEMOConfig,
    elements: Map<string, MemoElement>,
    registry: PackageRegistry,
    registries?: BuilderRegistries
): void {
    const ownerId = owner.name;

    for (const member of owner.body || []) {
        if ((member as any).$type !== 'PartMember') continue;
        const pm = member as any;
        // Only a TYPED nested part is containment. Untyped bodies (view
        // selectionQuery) and reference bindings are view metadata, flattened
        // to attributes in extractUsage — skip them here or a view's metadata
        // becomes a phantom element and its selection query is lost.
        if (!pm.type || pm.boundRef || !pm.name) continue;

        extractUsage(
            { name: pm.name, type: pm.type, body: pm.body },
            'part', filePath, packageName, config, elements, registry, registries,
        );
        const childEl = elements.get(pm.name);
        if (childEl) childEl.owner = ownerId;
    }
}

/**
 * Extract an ActionUsage, including nested actions, flows, and successions.
 * Supports both typed (action name : Type;) and composite (action name { ... }) forms.
 */
function extractActionUsage(
    usage: ActionUsage,
    filePath: string,
    packageName: string,
    config: MEMOConfig,
    elements: Map<string, MemoElement>,
    deferredFlows: DeferredFlow[],
    deferredSuccessions: DeferredSuccession[],
    registry: PackageRegistry,
    registries?: BuilderRegistries,
    parentActionId?: string
): void {
    const id = usage.name;
    const typeName = usage.type;

    // Dual-mode resolution: registry first, then config fallback. A type
    // that resolves without a real layer is a model-local action def, not an
    // ontology kind — the usage stays an ActionUsage on the behavior layer
    // (the def reference is kept in the actionType attribute below).
    const behaviorKind = usage.behaviorKind ?? 'action';
    let kind = behaviorKind === 'operator' ? 'OperatorUsage'
        : behaviorKind === 'function' ? 'FunctionUsage' : 'ActionUsage';
    let layer = 'behavior';
    if (typeName) {
        const { kindDef, resolvedKind } = resolveKindDef(typeName, config, registries);
        if (kindDef && kindDef.layer && kindDef.layer !== 'unknown') {
            kind = resolvedKind;
            layer = kindDef.layer;
        }
    }

    const bodyMembers = usage.body || [];
    const attributes = extractAttributes(bodyMembers);
    attributes['behaviorKind'] = behaviorKind;
    const doc = extractDocComment(bodyMembers);
    const displayName = attributes['name'] || attributes['title'] || id;

    // Store the action definition type for flow type checking
    if (typeName) {
        attributes['actionType'] = typeName;
    }

    const element: MemoElement = {
        id,
        name: displayName,
        kind,
        construct: 'action',
        layer,
        file: filePath,
        package: packageName || undefined,
        attributes,
        doc,
        parentAction: parentActionId,
        parameters: bodyMembers
            .filter(member => member.$type === 'ActionParameterMember')
            .map(member => ({ name: (member as ActionParameterMember).name, direction: (member as ActionParameterMember).direction as ActionParameter['direction'], type: (member as ActionParameterMember).type || 'Item' })),
    };

    elements.set(id, element);
    registry.registerElement(id, packageName);

    // Walk body for nested behavior members
    for (const member of bodyMembers) {
        switch (member.$type) {
            case 'ActionUsage':
                // Nested action usage — recursive extraction
                extractActionUsage(
                    member as ActionUsage, filePath, packageName, config,
                    elements, deferredFlows, deferredSuccessions, registry, registries, id
                );
                break;
            case 'FlowConnectionUsage':
                deferredFlows.push({
                    flow: member as FlowConnectionUsage,
                    filePath,
                    packageName,
                    parentActionId: id,
                });
                break;
            case 'SuccessionUsage':
                deferredSuccessions.push({
                    succession: member as SuccessionUsage,
                    filePath,
                    packageName,
                    parentActionId: id,
                });
                break;
            case 'ControlNodeUsage':
                extractControlNode(
                    member as ControlNodeUsage, filePath, packageName,
                    elements, registry, id,
                );
                break;
        }
    }
}

/**
 * Extract a control node. Modeled as a behavior-layer element with
 * `construct: 'action'` so it participates in succession ordering and swimlane
 * layout like any other flow step, but carries the metaclass its `controlKind`
 * names and a `controlKind` attribute, so renderers draw the right symbol —
 * a bar for fork/join, a diamond for decide/merge.
 *
 * The kind comes from `CONTROL_KIND_METACLASS`, the same binding
 * `activityNodeType` classifies by; a second mapping here is how `decide` and
 * `merge` came to be stored as `JoinNode`.
 */
function extractControlNode(
    node: ControlNodeUsage,
    filePath: string,
    packageName: string,
    elements: Map<string, MemoElement>,
    registry: PackageRegistry,
    parentActionId: string,
): void {
    const id = node.name;
    const kind = CONTROL_KIND_METACLASS[node.controlKind];
    elements.set(id, {
        id,
        name: node.name,
        kind,
        construct: 'action',
        layer: 'behavior',
        file: filePath,
        package: packageName || undefined,
        attributes: { controlKind: node.controlKind },
        parentAction: parentActionId,
    });
    registry.registerElement(id, packageName);
}

function resolveConnection(
    conn: ConnectionUsage,
    filePath: string,
    packageName: string,
    config: MEMOConfig,
    elements: Map<string, MemoElement>,
    relationships: MemoRelationship[],
    registry: PackageRegistry,
    allElementIds: Set<string>
): void {
    const typeName = conn.type; // e.g. "Mitigates", "TraceTo"
    if (!conn.source || !conn.target) return;

    // An untyped connection (`connection connect a to b;`, no `: SomeDef`) is
    // the native binary connection with nothing further classifying it — the
    // keyword IS the type, `connect`, the same as `flow`/`bind` (R10-S6,
    // `ConnectsPhysically`'s migration). Before this it built to nothing at
    // all: the same silent-drop shape as `BindingUsage`/`ExposeMember`.
    // A typed connection normalizes its definition name: "Mitigates" → "mitigates".
    const normalizedType = typeName ? normalizeRelType(typeName) : 'connect';

    // Resolve source and target using registry for cross-file resolution
    const sourceId = resolveEndpointId(conn.source.ref, packageName, registry, allElementIds);
    const targetId = resolveEndpointId(conn.target.ref, packageName, registry, allElementIds);
    if (!sourceId || !targetId) return;

    // A named connection usage carries its own stable ID; anonymous ones fall
    // back to a positional counter that shifts whenever the file changes.
    const attributes = { ...extractAttributes(conn.body), ...extractRelationshipMetadata(conn.body) };
    const rel: MemoRelationship = {
        id: conn.name || `rel-${++relationshipCounter}`,
        type: normalizedType,
        sourceId,
        sourceEnd: conn.source.endName,
        targetId,
        targetEnd: conn.target.endName,
        file: filePath,
        sourceRange: conn.$cstNode
            ? { offset: conn.$cstNode.offset, length: conn.$cstNode.length }
            : undefined,
        named: conn.name ? true : undefined,
        attributes,
        flowItem: attributes.transportedItem || attributes.flowItem || undefined,
    };

    // Tag port IDs when endpoints reference port elements
    const sourceEl = elements.get(sourceId);
    if (sourceEl?.construct === 'port') {
        rel.sourcePortId = sourceId;
    }
    const targetEl = elements.get(targetId);
    if (targetEl?.construct === 'port') {
        rel.targetPortId = targetId;
    }

    relationships.push(rel);
}

/**
 * Resolve a dotted endpoint path to the deepest element it names.
 *
 * A dotted endpoint has two shapes and they resolve differently.
 *
 * `receive.prescription` names an action and one of its PARAMETERS. The
 * parameter is not an element, so the endpoint is the action and the parameter
 * is the end label.
 *
 * `touchscreen.touchUsbIo` names a port and a port NESTED inside it, and
 * `coffeeMachine.serviceInterface.diagnostics` nests one level deeper again.
 * The nested port IS an element in its own right, so the endpoint is the child.
 * Reading it the first way silently retargets the edge at the parent, which is
 * not a resolution failure anyone sees: it produces a plausible relationship
 * pointing at the wrong feature, and it only surfaces later as a payload
 * mismatch on whichever edge happened to carry a different item from its
 * parent's.
 *
 * Walk the path through `owner` and take the deepest real element.
 */
function resolveEndpoint(
    ref: string,
    elements: Map<string, MemoElement>
): { id: string; end: string } {
    const parts = ref.split('.');
    let id = parts[0];
    let i = 1;
    while (i < parts.length) {
        const child = elements.get(parts[i]);
        if (!child || child.owner !== id) break;
        id = parts[i];
        i++;
    }
    return { id, end: parts.slice(i).join('.') };
}

/**
 * Resolve a `bind outer = inner;` port delegation into a MemoRelationship.
 *
 * Unlike a flow this carries no item: delegation is identity, so there is
 * nothing travelling and nothing to label the edge with. Consumers that render
 * an itemless edge already suppress the label.
 */
function resolveBinding(
    binding: BindingUsage,
    filePath: string,
    _packageName: string,
    relationships: MemoRelationship[],
    allElementIds: Set<string>,
    elements: Map<string, MemoElement>
): void {
    const sourceRef = binding.source;
    const targetRef = binding.target;
    if (!sourceRef || !targetRef) return;

    const { id: sourceId, end: sourceEnd } = resolveEndpoint(sourceRef, elements);
    const { id: targetId, end: targetEnd } = resolveEndpoint(targetRef, elements);

    if (!allElementIds.has(sourceId) || !allElementIds.has(targetId)) return;

    relationships.push({
        id: `rel-${++relationshipCounter}`,
        type: 'bind',
        sourceId,
        sourceEnd,
        targetId,
        targetEnd,
        file: filePath,
    });
}

/**
 * Resolve a flow connection usage into a MemoRelationship.
 * Flow endpoints use dot notation: "actionName.paramName"
 */
function resolveFlowConnection(
    flow: FlowConnectionUsage | MessageUsage,
    filePath: string,
    packageName: string,
    parentActionId: string | undefined,
    relationships: MemoRelationship[],
    allElementIds: Set<string>,
    elements: Map<string, MemoElement>
): void {
    const sourceRef = flow.source?.ref;
    const targetRef = flow.target?.ref;
    if (!sourceRef || !targetRef) return;

    const { id: sourceActionId, end: sourcePort } = resolveEndpoint(sourceRef, elements);
    const { id: targetActionId, end: targetPort } = resolveEndpoint(targetRef, elements);

    // Only create relationship if both endpoints reference known elements
    if (!allElementIds.has(sourceActionId) || !allElementIds.has(targetActionId)) return;

    // A NAMED flow carries a stable ID that survives rebuilds; an anonymous one
    // falls back to a positional counter that shifts whenever the file changes.
    // Same rule `resolveConnection` applies to connection usages, and the same
    // reason: authoring needs to inspect, delete, and deep-link a flow, and a
    // positional id makes every one of those wrong after the next edit.
    const rel: MemoRelationship = {
        id: flow.name || `rel-${++relationshipCounter}`,
        type: 'flow',
        sourceId: sourceActionId,
        sourceEnd: sourcePort,
        targetId: targetActionId,
        targetEnd: targetPort,
        file: filePath,
        sourceRange: flow.$cstNode
            ? { offset: flow.$cstNode.offset, length: flow.$cstNode.length }
            : undefined,
        named: flow.name ? true : undefined,
        attributes: extractAttributes(flow.body),
        flowItem: flow.itemType || undefined,
    };

    relationships.push(rel);
}

/**
 * Resolve a succession usage into pairs of MemoRelationships.
 * "first start then A then B then done" → (start→A), (A→B), (B→done)
 */
function resolveSuccession(
    succession: SuccessionUsage,
    filePath: string,
    packageName: string,
    parentActionId: string | undefined,
    relationships: MemoRelationship[],
    allElementIds: Set<string>
): void {
    const steps = succession.steps || [];
    if (steps.length < 2) return;

    for (let i = 0; i < steps.length - 1; i++) {
        const fromRef = steps[i].ref;
        const toRef = steps[i + 1].ref;

        // "start" and "done" are pseudo-elements; use parent action as context
        const sourceId = fromRef === 'start'
            ? (parentActionId ? `${parentActionId}__start` : '__start')
            : fromRef;
        const targetId = toRef === 'done'
            ? (parentActionId ? `${parentActionId}__done` : '__done')
            : toRef;

        // Skip if neither endpoint is a known element (allow start/done pseudo-elements)
        const sourceKnown = fromRef === 'start' || allElementIds.has(sourceId);
        const targetKnown = toRef === 'done' || allElementIds.has(targetId);
        if (!sourceKnown || !targetKnown) continue;

        const guardLabel = renderGuardExpression(steps[i].guard as any);
        const rel: MemoRelationship = {
            id: `rel-${++relationshipCounter}`,
            type: 'succession',
            sourceId,
            sourceEnd: guardLabel === undefined ? '' : `[${guardLabel}]`,
            targetId,
            targetEnd: '',
            file: filePath,
        };

        relationships.push(rel);
    }
}

/**
 * Preserve a SysML succession guard as readable diagram text.
 *
 * Guards use the same expression AST as constraints. Previously only literal
 * `true`/`false` nodes happened to carry one of the three fields inspected by
 * the builder, so a valid guard such as `validUser == true` silently vanished
 * during lowering even though SysIDE accepted it.
 */
function renderGuardExpression(expr: any): string | undefined {
    if (!expr) return undefined;
    switch (expr.$type) {
        case 'LiteralExpr':
            return expr.boolValue ?? expr.intValue ?? expr.strValue;
        case 'FeatureChain':
            return Array.isArray(expr.segments) ? expr.segments.join('.') : undefined;
        case 'UnaryExpr': {
            const operand = renderGuardExpression(expr.operand);
            return operand === undefined ? undefined : `${expr.op} ${operand}`;
        }
        case 'BinaryExpr': {
            const left = renderGuardExpression(expr.left);
            const right = renderGuardExpression(expr.right);
            return left === undefined || right === undefined
                ? undefined
                : `${left} ${expr.op} ${right}`;
        }
        case 'CollectionOp': {
            const target = renderGuardExpression(expr.target);
            const argument = renderGuardExpression(expr.argument);
            if (target === undefined) return undefined;
            return `${target}->${expr.op}(${argument ?? ''})`;
        }
        default:
            return expr.text ?? expr.value;
    }
}

/**
 * Resolve an allocate usage into a MemoRelationship and set allocatedTo on the element.
 */
function resolveAllocate(
    allocate: AllocateUsage,
    filePath: string,
    packageName: string,
    elements: Map<string, MemoElement>,
    relationships: MemoRelationship[],
    registry: PackageRegistry,
    allElementIds: Set<string>,
    relationshipRegistry?: RelationshipRegistry,
): void {
    const sourceRef = allocate.source;
    const targetRef = allocate.target;
    if (!sourceRef || !targetRef) return;

    // Resolve references
    const sourceId = resolveEndpointId(sourceRef, packageName, registry, allElementIds);
    const targetId = resolveEndpointId(targetRef, packageName, registry, allElementIds);
    if (!sourceId || !targetId) return;

    // Set allocatedTo on the source element
    const sourceEl = elements.get(sourceId);
    if (sourceEl) {
        sourceEl.allocatedTo = targetId;
    }

    // `allocate a to b;` and `connection : AllocatedTo connect …` are the same
    // statement, so they produce the same edge. They did not: the native form
    // emitted `allocateTo` with invented ends while the connection emitted
    // `allocatedTo` with the ontology's, and consumers keyed on one silently
    // missed the other — the DHF allocation queries ask for `allocatedTo`.
    //
    // A TYPED allocation — `allocation d : DeploysTo allocate m to node;` —
    // carries which allocation it is, and that distinction has to survive.
    // `DeploysTo` and `BuildsInto` are not `AllocatedTo` under another name:
    // they are separate edges the deployment views and the DHF read by name.
    // The `allocation def` naming them is what the typed form points at, so the
    // edge is its camelCase name whenever the registry knows it; an unknown or
    // absent type falls back to the base allocation, which is what bare
    // `allocate` has always meant.
    const typed = allocate.type ? pascalToCamelCase(allocate.type.split('::').pop()!) : undefined;
    const edge = typed && relationshipRegistry?.has(typed) ? typed : 'allocatedTo';
    relationships.push(
        edge === 'allocatedTo'
            ? nativeTraceEdge('allocatedTo', sourceId, targetId, filePath)
            : typedAllocationEdge(edge, sourceId, targetId, filePath, relationshipRegistry),
    );
}

/**
 * The trace edge for an `allocation x : SomeAllocationDef allocate a to b;`.
 *
 * Ends come from the registry entry for the named definition, so a typed
 * allocation and the equivalent `connection : SomeAllocationDef connect …`
 * produce byte-identical links — the same guarantee the three
 * LANGUAGE_NATIVE_RELATIONS rows carry, extended to every allocation def the
 * ontology declares rather than to a fixed list of three.
 */
function typedAllocationEdge(
    type: string,
    sourceId: string,
    targetId: string,
    filePath: string,
    relationshipRegistry: RelationshipRegistry | undefined,
): MemoRelationship {
    const ends = relationshipRegistry?.getRelType(type)?.ends ?? [];
    return {
        id: `rel-${++relationshipCounter}`,
        type,
        sourceId,
        sourceEnd: ends[0]?.name ?? 'source',
        targetId,
        targetEnd: ends[1]?.name ?? 'target',
        file: filePath,
    };
}

/** Build the trace edge for a language-native relation, typed from the registry. */
function nativeTraceEdge(
    name: keyof typeof LANGUAGE_NATIVE_RELATIONS,
    sourceId: string,
    targetId: string,
    filePath: string,
): MemoRelationship {
    const [sourceEnd, targetEnd] = LANGUAGE_NATIVE_RELATIONS[name].ends;
    return {
        id: `rel-${++relationshipCounter}`,
        type: name,
        sourceId,
        sourceEnd: sourceEnd.name,
        targetId,
        targetEnd: targetEnd.name,
        file: filePath,
    };
}

/**
 * The owner context of a native trace usage: the package it is declared in, and
 * the nearest enclosing named element.
 *
 * `verify` needs the second one — the case that does the verifying is the owner
 * of the member, never a written end — and `satisfy` needs the first to resolve
 * its references the way every other endpoint is resolved.
 */
function nativeUsageContext(node: { $container?: unknown }): {
    packageName: string;
    ownerId?: string;
} {
    const packages: string[] = [];
    let ownerId: string | undefined;
    for (let current = node.$container as any; current; current = current.$container) {
        if (current.$type === 'PackageDeclaration') {
            if (current.name) packages.unshift(current.name as string);
            continue;
        }
        // An `objective` is a MEMBERSHIP, not the element that does the
        // verifying — the standard writes `objective { verify r; }` inside the
        // case, and the case is the verifier. A named objective would otherwise
        // capture `ownerId` and the `verifiedBy` edge would point at a wrapper
        // that is not an extracted element, silently dropping the link.
        if (current.$type === 'ObjectiveMember') continue;
        if (ownerId === undefined && typeof current.name === 'string' && current.name) {
            ownerId = current.name;
        }
    }
    return { packageName: packages.join('::'), ownerId };
}

/**
 * Project a native usage that names ONE end and takes the other from its owner.
 *
 * `perform`, `include`, `exhibit` and `frame` all have this shape, and it is
 * `verify`'s shape with the ends swapped: `verify` names its source and owns
 * its target, these four own their source and name their target. Sharing the
 * resolution keeps the four from drifting apart, and keeps the rule that the
 * owner supplies the unwritten end stated in exactly one place.
 */
function resolveOwnerRootedUsage(
    node: { $container?: unknown },
    written: string | undefined,
    name: keyof typeof LANGUAGE_NATIVE_RELATIONS,
    filePath: string,
    relationships: MemoRelationship[],
    registry: PackageRegistry,
    allElementIds: Set<string>,
): void {
    if (!written) return;
    const { packageName, ownerId } = nativeUsageContext(node);
    const sourceId = ownerId
        ? resolveEndpointId(ownerId, packageName, registry, allElementIds)
        : undefined;
    const targetId = resolveEndpointId(written, packageName, registry, allElementIds);
    if (!sourceId || !targetId) return;
    relationships.push(nativeTraceEdge(name, sourceId, targetId, filePath));
}

/**
 * Project a verification case's `subject` onto the `verifiedBy` edge.
 *
 * This is the standard's answer to verifying something that is not a
 * requirement: the verified element becomes the case's SUBJECT and the
 * requirement its `objective { verify … }`. 61 of MEMO's 99 `VerifiedBy` links
 * target a SystemFunction, a RiskControlMeasure, a SoftwareModule, a
 * BehaviorProperty or a TimingConstraint — none of which native `verify`
 * admits, because `verify` takes a RequirementUsage.
 *
 * The edge direction matches `VerifiedBy`: the subject is the source
 * (verificationTarget) and the owning case the target (verificationCase).
 *
 * A `subject` that declares a fresh feature rather than pointing at an existing
 * element — `subject testVehicle : Vehicle;` — binds nothing and contributes no
 * edge. Only the referring forms (`subject v :> vehicleTestConfig;`,
 * `subject v = vehicleTestConfig;`) name something already in the model. A
 * multi-valued subject is one parameter whose binding is a parenthesized list;
 * each bound element is one `verifiedBy` fact for the owning case.
 */
function resolveSubject(
    subject: SubjectMember,
    filePath: string,
    relationships: MemoRelationship[],
    registry: PackageRegistry,
    allElementIds: Set<string>,
): void {
    if (!subject.boundRefs?.length) return;
    const { packageName, ownerId } = nativeUsageContext(subject);
    const targetId = ownerId
        ? resolveEndpointId(ownerId, packageName, registry, allElementIds)
        : undefined;
    if (!targetId) return;
    for (const boundRef of subject.boundRefs) {
        const sourceId = resolveEndpointId(boundRef, packageName, registry, allElementIds);
        if (sourceId) relationships.push(nativeTraceEdge('verifiedBy', sourceId, targetId, filePath));
    }
}

/**
 * Project a native `actor` onto the `participatesIn` edge (R10-S6).
 *
 * Same shape as `resolveSubject`: only the REFERRING form —
 * `actor driver = existingPart;` — names something already in the model, so
 * only that form produces an edge. A fresh declaration (`actor x : Person;`,
 * no `boundRef`) introduces a locally-scoped actor the model does not yet
 * have an element for; collapsing `MemoRelationship`'s `Initiates` and
 * `ParticipatesIn` onto the single native `actor` keyword means the
 * initiating/participating distinction is no longer a typed relationship —
 * it lives in how the actor is named, the same way `Composes` gave up its
 * whole/part distinction to plain nesting.
 *
 * The owner is the TARGET and the written reference the SOURCE — `verify`'s
 * shape, not `perform`'s: the use case is what the actor participates IN.
 */
function resolveActorParticipation(
    actor: ActorMember,
    filePath: string,
    relationships: MemoRelationship[],
    registry: PackageRegistry,
    allElementIds: Set<string>,
): void {
    if (!actor.boundRef) return;
    const { packageName, ownerId } = nativeUsageContext(actor);
    const sourceId = resolveEndpointId(actor.boundRef, packageName, registry, allElementIds);
    const targetId = ownerId ? resolveEndpointId(ownerId, packageName, registry, allElementIds) : undefined;
    if (!sourceId || !targetId) return;
    relationships.push(nativeTraceEdge('participatesIn', sourceId, targetId, filePath));
}

/**
 * Project every `dependency a to b;` onto the generic `dependency` edge, and
 * additionally onto `realizes` when it carries `#refinement` (R10-S6).
 *
 * The only native relation here that is not a connection. A Dependency takes n
 * clients and n suppliers rather than a source and a target, so one written
 * dependency can produce several edges — `dependency Schemata from s to a, b;`
 * is two statements sharing a name, and it lowers to two links, which is what
 * `Realizes` would have needed two connection usages to say.
 *
 * A dependency WITHOUT `#refinement` is an unclassified dependency: it means
 * strictly less than `Realizes` does, so it contributes only the generic
 * `dependency` edge, never `realizes` — inferring realization from a bare
 * dependency would put a claim in the traceability matrix that the model
 * never made. `#refinement` adds `realizes` on top; it does not replace the
 * generic edge, because a refinement dependency IS a dependency.
 *
 * Before R10-S6 a bare (non-`#refinement`) dependency built to nothing at
 * all — the same silent-drop shape as `BindingUsage`/`ExposeMember` — which
 * is what `ModuleUses`/`MonitorsChannel`'s migration to plain `dependency`
 * would otherwise have hit. Both collapse onto this one generic edge; native
 * `dependency` does not distinguish "uses a module" from "monitors a
 * channel" any more than `actor` distinguished an initiating actor from a
 * participating one, so that distinction now lives in the dependency's own
 * name/doc, not in a relationship type.
 */
function resolveDependency(
    dependency: Dependency,
    filePath: string,
    relationships: MemoRelationship[],
    registry: PackageRegistry,
    allElementIds: Set<string>,
): void {
    const isRefinement = (dependency.prefixMetadata ?? [])
        .some(annotation => annotation.type?.split('::').pop() === REFINEMENT_METADATA);

    const { packageName } = nativeUsageContext(dependency);
    for (const client of dependency.clients ?? []) {
        const sourceId = resolveEndpointId(client, packageName, registry, allElementIds);
        if (!sourceId) continue;
        for (const supplier of dependency.suppliers ?? []) {
            const targetId = resolveEndpointId(supplier, packageName, registry, allElementIds);
            if (!targetId) continue;
            relationships.push(nativeTraceEdge('dependency', sourceId, targetId, filePath));
            if (isRefinement) relationships.push(nativeTraceEdge('realizes', sourceId, targetId, filePath));
        }
    }
}

/**
 * Project every `satisfy` and `verify` in a document onto the trace edge its
 * MEMO connection-def equivalent produces.
 */
function resolveNativeTraceUsages(
    model: Model,
    filePath: string,
    relationships: MemoRelationship[],
    registry: PackageRegistry,
    allElementIds: Set<string>,
): void {
    for (const node of AstUtils.streamAllContents(model)) {
        if (isSatisfyRequirementUsage(node)) {
            resolveSatisfy(node, filePath, relationships, registry, allElementIds);
        } else if (isRequirementVerificationMember(node)) {
            resolveVerify(node, filePath, relationships, registry, allElementIds);
        } else if (isPerformActionUsage(node)) {
            resolveOwnerRootedUsage(node, node.performed, 'performs', filePath, relationships, registry, allElementIds);
        } else if (isIncludeUseCaseUsage(node)) {
            resolveOwnerRootedUsage(node, node.included, 'includesStep', filePath, relationships, registry, allElementIds);
        } else if (isExhibitStateUsage(node)) {
            resolveOwnerRootedUsage(node, node.exhibited, 'exhibitsMode', filePath, relationships, registry, allElementIds);
        } else if (isFramedConcernMember(node)) {
            resolveOwnerRootedUsage(node, node.framed, 'framesConcern', filePath, relationships, registry, allElementIds);
        } else if (isSubjectMember(node)) {
            resolveSubject(node, filePath, relationships, registry, allElementIds);
        } else if (isActorMember(node)) {
            resolveActorParticipation(node, filePath, relationships, registry, allElementIds);
        } else if (isDependency(node)) {
            resolveDependency(node, filePath, relationships, registry, allElementIds);
        } else if (isVariantMember(node)) {
            resolveVariant(node, filePath, relationships, registry, allElementIds);
        }
    }
}

/**
 * Project `variant x;` onto a navigable choice-point edge.
 *
 * A variation's alternatives are memberships rather than connection usages,
 * so they would otherwise disappear from the consumer model entirely.  The
 * nearest owner is the variation point and the written member names the
 * selected configuration.  Keeping this as a first-class edge lets DSMs and
 * views distinguish a real choice from four unrelated parts.
 */
function resolveVariant(
    variant: VariantMember,
    filePath: string,
    relationships: MemoRelationship[],
    registry: PackageRegistry,
    allElementIds: Set<string>,
): void {
    const { packageName, ownerId } = nativeUsageContext(variant);
    const sourceId = ownerId
        ? resolveEndpointId(ownerId, packageName, registry, allElementIds)
        : undefined;
    const targetId = resolveEndpointId(variant.name, packageName, registry, allElementIds);
    if (!sourceId || !targetId) return;
    relationships.push({
        id: `rel-${++relationshipCounter}`,
        type: 'variant',
        sourceId,
        sourceEnd: 'variationPoint',
        targetId,
        targetEnd: 'variant',
        file: filePath,
    });
}

function resolveSatisfy(
    satisfy: SatisfyRequirementUsage,
    filePath: string,
    relationships: MemoRelationship[],
    registry: PackageRegistry,
    allElementIds: Set<string>,
): void {
    // A negated claim — `assert not satisfy r by p;` — states that the
    // requirement is NOT satisfied. There is no MEMO connection for it, and
    // emitting a `satisfiedBy` edge would make a design review's rejection read
    // as coverage in the traceability matrix. It parses; it contributes no
    // trace edge until the model has somewhere honest to put it.
    if (satisfy.isNegated) return;

    const { packageName } = nativeUsageContext(satisfy);
    const sourceId = resolveEndpointId(satisfy.requirement, packageName, registry, allElementIds);
    // Without `by`, the satisfying subject is inherited from the enclosing
    // requirement rather than written. Nothing to bind, so no edge.
    const targetId = satisfy.satisfyingFeature
        ? resolveEndpointId(satisfy.satisfyingFeature, packageName, registry, allElementIds)
        : undefined;
    if (!sourceId || !targetId) return;

    relationships.push(nativeTraceEdge('satisfiedBy', sourceId, targetId, filePath));
}

function resolveVerify(
    verify: RequirementVerificationMember,
    filePath: string,
    relationships: MemoRelationship[],
    registry: PackageRegistry,
    allElementIds: Set<string>,
): void {
    const { packageName, ownerId } = nativeUsageContext(verify);
    const sourceId = resolveEndpointId(verify.requirement, packageName, registry, allElementIds);
    // The verifying case is the owner. A `verify` whose owner is not an
    // extracted element — a bare `verification def`, say — has no second end
    // to bind, so it stays a parse fact and not a graph fact.
    const targetId = ownerId ? resolveEndpointId(ownerId, packageName, registry, allElementIds) : undefined;
    if (!sourceId || !targetId) return;

    relationships.push(nativeTraceEdge('verifiedBy', sourceId, targetId, filePath));
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function extractAttributes(body: any[] | undefined): Record<string, string> {
    if (!body) return {};
    const attrs: Record<string, string> = {};

    for (const member of body) {
        if (member.$type === 'AttributeMember' || member.$type === 'RefMember' || member.$type === 'MetadataFeatureMember') {
            const attr = member as AttributeMember;
            if (attr.value) {
                attrs[attr.name] = extractAttributeValue(attr.value);
            } else if (attr.type) {
                attrs[attr.name] = `<${attr.type}>`;
            } else if (attr.body?.length) {
                // Structured value: the members of an `attribute def` assigned
                // inline, e.g. `attribute :>> bounds { attribute :>> x = 0.1; }`.
                // Flattened to dotted keys ("bounds.x") so the value lands in
                // the same flat map every consumer already reads. Without this
                // branch the whole assignment is dropped and the model carries
                // no record of it.
                for (const [key, value] of Object.entries(extractAttributes(attr.body as any[]))) {
                    attrs[`${attr.name}.${key}`] = value;
                }
            }
        }
    }

    return attrs;
}

/**
 * Read the standard `Rationale`/`StatusInfo` metadata (ModelingMetadata.sysml)
 * off a connection usage's body into the same flat attribute keys the deleted
 * `MemoRelationship.rationale`/`.status` used to occupy (R10-S5, 2026-08-13).
 *
 * `extractAttributes` only walks `AttributeMember`/`RefMember`/
 * `MetadataFeatureMember`; a `MetadataApplication` in a usage body (the `@Foo
 * {...}` form) is invisible to it, so without this a `@Rationale`/`@StatusInfo`
 * annotation would parse and silently vanish from the model — the same
 * BindingUsage/ExposeMember shape this epic exists to stop repeating.
 */
function extractRelationshipMetadata(body: any[] | undefined): Record<string, string> {
    if (!body) return {};
    const attrs: Record<string, string> = {};
    for (const member of body) {
        if (member.$type !== 'MetadataApplication') continue;
        const metadataType = (member.type as string | undefined)?.split('::').pop();
        const fields = extractAttributes(member.body);
        if (metadataType === 'Rationale' && fields.text) {
            attrs.rationale = fields.text;
        } else if (metadataType === 'StatusInfo' && fields.status) {
            attrs.status = fields.status;
        }
    }
    return attrs;
}

function extractAttributeValue(value: any): string {
    if (!value) return '';
    switch (value.$type) {
        case 'StringValue':
            return (value as StringValue).value.replace(/^"|"$/g, '');
        case 'IntValue':
            return String((value as IntValue).value);
        case 'RealValue':
            return String((value as { value: string }).value);
        case 'BooleanValue':
            return (value as BooleanValue).value;
        case 'EnumValue':
            return (value as EnumValue).enumRef;
        case 'SetLiteral':
            // { A, B, "c" } → "A, B, c" — keeps attributes flat and readable
            return ((value.elements ?? []) as any[])
                .map(el => el.value ?? (el.stringValue ?? '').replace(/^"|"$/g, ''))
                .filter((s: string) => s.length > 0)
                .join(', ');
        default:
            return String(value);
    }
}

function extractDocComment(body: any[] | undefined): string | undefined {
    if (!body) return undefined;
    const doc = body.find((m: any) => m.$type === 'DocComment') as DocComment | undefined;
    if (!doc) return undefined;
    return doc.content
        .replace(/^doc\s+\/\*\s*/, '')
        .replace(/\s*\*\/$/, '')
        .replace(/\n\s*\*\s?/g, ' ')
        .trim();
}

/**
 * Resolve a QualifiedName reference to just the local name.
 * In SysML v2 usages: `control ::> rcFlowRateLimiter` — ref is "rcFlowRateLimiter"
 */
function resolveRef(ref: string): string | undefined {
    if (!ref) return undefined;
    // Take the last segment of a qualified name
    const parts = ref.split('::');
    return parts[parts.length - 1] || undefined;
}

/**
 * Resolve a relationship endpoint reference to an element id, including
 * dotted feature chains (`sampleActionFlow.process.processStepB`): elements
 * are registered under their leaf name, so when the full reference is not a
 * known element id, resolve its last dot segment instead.
 */
function resolveEndpointId(
    // An endpoint can parse without a reference — the Release examples contain
    // connection forms the MEMO grammar accepts structurally but cannot bind.
    // An unresolvable endpoint drops the relationship at the call site, which
    // is the same outcome as any other unresolved reference; crashing the whole
    // build over it is not (§1.1 — the compiler reports, it does not refuse).
    ref: string | undefined,
    packageName: string,
    registry: PackageRegistry,
    allElementIds: Set<string>
): string | undefined {
    if (!ref) return undefined;
    const direct = registry.resolveElementId(ref, packageName, allElementIds) || resolveRef(ref);
    if (direct && allElementIds.has(direct)) return direct;
    if (ref.includes('.')) {
        const leaf = ref.split('.').pop()!;
        const resolved = registry.resolveElementId(leaf, packageName, allElementIds) || resolveRef(leaf);
        if (resolved && allElementIds.has(resolved)) return resolved;
    }
    return direct;
}

/**
 * Relationship type names are normalized by the shared helper in `naming.ts`,
 * which is the single definition of the source-name → model-key rule.
 */
const normalizeRelType = toModelType;
