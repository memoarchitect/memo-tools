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
//   - AllocateUsage → MemoRelationship of type "allocateTo"
//   - ItemDefinition → MemoElement with construct "item"
// ─────────────────────────────────────────────────────────────────────────────

import type {
    Model,
    PackageDeclaration,
    PartUsage,
    RequirementUsage,
    ActionUsage,
    PortUsage,
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
    FlowConnectionUsage,
    SuccessionUsage,
    AllocateUsage,
    ControlNodeUsage,
} from '../language/generated/ast.js';
import type { MEMOConfig, KindDefinition } from './config.js';
import type {
    MemoElement,
    MemoRelationship,
    MemoModel,
    ParseError,
    ActionParameter,
    PortSpec,
} from './semantic.js';
import type { ParsedDocument } from './parser-utils.js';
import { PackageRegistry } from './package-registry.js';
import { assignSequentialShortIds } from './short-id.js';
import type { KindRegistry } from './kind-registry.js';
import type { RelationshipRegistry } from './relationship-registry.js';

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
    flow: FlowConnectionUsage;
    filePath: string;
    packageName: string;
    parentActionId?: string;
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

    // Fall back to config (if kinds are present)
    const kinds = config.kinds ?? {};
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

    // Phase 1: Build package registry from all documents
    const registry = new PackageRegistry();
    registry.buildFromDocuments(documents);

    // Phase 2: Extract elements from all documents (populates registry)
    for (const { document, filePath } of documents) {
        const model = document.parseResult.value;
        extractFromModel(model, filePath, config, elements, deferredConnections, deferredFlows, deferredSuccessions, deferredAllocates, errors, registry, registries);
    }

    // Phase 3: Resolve connections using the registry (all elements now known)
    const allElementIds = new Set(elements.keys());
    for (const { conn, filePath, packageName } of deferredConnections) {
        resolveConnection(conn, filePath, packageName, config, elements, relationships, registry, allElementIds);
    }

    // Phase 3b: Resolve flow connections
    for (const { flow, filePath, packageName, parentActionId } of deferredFlows) {
        resolveFlowConnection(flow, filePath, packageName, parentActionId, relationships, allElementIds);
    }

    // Phase 3c: Resolve successions
    for (const { succession, filePath, packageName, parentActionId } of deferredSuccessions) {
        resolveSuccession(succession, filePath, packageName, parentActionId, relationships, allElementIds);
    }

    // Phase 3d: Resolve allocations
    for (const { allocate, filePath, packageName } of deferredAllocates) {
        resolveAllocate(allocate, filePath, packageName, elements, relationships, registry, allElementIds);
    }

    // Build indexes
    const elementsByKind = new Map<string, MemoElement[]>();
    const elementsByLayer = new Map<string, MemoElement[]>();
    for (const el of elements.values()) {
        if (!elementsByKind.has(el.kind)) elementsByKind.set(el.kind, []);
        elementsByKind.get(el.kind)!.push(el);
        if (!elementsByLayer.has(el.layer)) elementsByLayer.set(el.layer, []);
        elementsByLayer.get(el.layer)!.push(el);
    }

    // Assign sequential short IDs: sort each kind group by element id, then
    // assign PREFIX-1, PREFIX-2, ... Deletion-stable (survivors keep their seq).
    for (const [kind, kindElements] of elementsByKind) {
        const idToShortId = assignSequentialShortIds(kind, kindElements.map(e => e.id));
        for (const el of kindElements) {
            (el as MemoElement).shortId = idToShortId.get(el.id);
        }
    }

    // Phase 4: Validate relationship end types (warnings only).
    // A kind conforms to an end type if it equals it or specializes it
    // (transitively) — e.g. HardwareAssembly conforms to ArchitectureElement.
    if (registries?.relationshipRegistry) {
        const conformsTo = (kind: string, expected: string): boolean => {
            let current: string | undefined = kind;
            const seen = new Set<string>();
            while (current && !seen.has(current)) {
                if (current === expected) return true;
                seen.add(current);
                current = registries.kindRegistry?.getKind(current)?.superType;
            }
            // Legacy fallback when the kind hierarchy is unknown to the registry
            return kind.endsWith(expected);
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
        elementsByKind,
        elementsByLayer,
        relationshipsByType,
        outgoing,
        incoming,
    };
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
    errors: ParseError[],
    registry: PackageRegistry,
    registries?: BuilderRegistries
): void {
    for (const member of model.members) {
        if (member.$type === 'PackageDeclaration') {
            extractFromPackage(member as PackageDeclaration, filePath, '', config, elements, deferredConnections, deferredFlows, deferredSuccessions, deferredAllocates, errors, registry, registries);
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
    errors: ParseError[],
    registry: PackageRegistry,
    registries?: BuilderRegistries
): void {
    const packageName = parentPackage ? `${parentPackage}::${pkg.name}` : pkg.name;

    for (const member of pkg.members) {
        switch (member.$type) {
            case 'PackageDeclaration':
                extractFromPackage(member as PackageDeclaration, filePath, packageName, config, elements, deferredConnections, deferredFlows, deferredSuccessions, deferredAllocates, errors, registry, registries);
                break;
            case 'PartUsage':
                extractUsage(member as PartUsage, 'part', filePath, packageName, config, elements, registry, registries);
                break;
            case 'RequirementUsage':
                extractUsage(member as RequirementUsage, 'requirement', filePath, packageName, config, elements, registry, registries);
                break;
            case 'ActionUsage':
                extractActionUsage(member as ActionUsage, filePath, packageName, config, elements, deferredFlows, deferredSuccessions, registry, registries);
                break;
            case 'PortUsage':
                extractUsage(member as PortUsage, 'port', filePath, packageName, config, elements, registry, registries);
                break;
            case 'ConnectionUsage':
                // Defer connection resolution until all elements are extracted
                deferredConnections.push({
                    conn: member as ConnectionUsage,
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
            // ─── Definition members ─────────────────────────────────────
            case 'ActionDefinition':
                extractActionDefinition(member as ActionDefinition, filePath, packageName, config, elements, registry);
                break;
            case 'ItemDefinition':
                extractItemDefinition(member as ItemDefinition, filePath, packageName, config, elements, registry);
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

type UsageNode = PartUsage | RequirementUsage | ActionUsage | PortUsage;

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

    // Nested part members: capture reference bindings (`part viewpoint :> vp;`)
    // and one level of nested part bodies (`part selectionQuery { ... }`) as
    // plain / prefixed attributes, so SysML-modelled views expose their
    // viewpoint binding and selection-query metadata to consumers.
    for (const member of usage.body || []) {
        if ((member as any).$type !== 'PartMember') continue;
        const pm = member as any;
        if (pm.boundRef && pm.name) {
            attributes[pm.name] = pm.boundRef;
        } else if (pm.body && pm.name) {
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
        element.portSpec = {
            type: portNode.type,
            direction: portNode.direction as PortSpec['direction'],
            isConjugated: portNode.isConjugated ?? false,
        };
    }

    elements.set(id, element);
    registry.registerElement(id, packageName);
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
    registry: PackageRegistry
): void {
    const id = actionDef.name;

    // Extract parameters from body
    const parameters: ActionParameter[] = [];
    const bodyMembers = actionDef.body || [];
    for (const member of bodyMembers) {
        if (member.$type === 'ActionParameterMember') {
            const param = member as ActionParameterMember;
            parameters.push({
                name: param.name,
                direction: param.direction as ActionParameter['direction'],
                type: param.type,
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
    registry: PackageRegistry
): void {
    const id = itemDef.name;

    const attributes = extractAttributes(itemDef.body);
    const doc = extractDocComment(itemDef.body);

    const element: MemoElement = {
        id,
        name: id,
        kind: 'ItemDefinition',
        construct: 'item',
        layer: 'behavior',
        file: filePath,
        package: packageName || undefined,
        attributes,
        doc,
    };

    elements.set(id, element);
    registry.registerElement(id, packageName);
}

/**
 * Walk a definition body to extract port usages as owned port elements.
 * Sets owner on ports and ownedPorts on the definition.
 */
function extractDefinitionPorts(
    def: PartDefinition | PortDefinition | InterfaceDefinition | ConnectionDefinition,
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
 * Extract a fork/join control node. Modeled as a behavior-layer element with
 * `construct: 'action'` so it participates in succession ordering and swimlane
 * layout like any other flow step, but carries a distinct kind
 * (`ForkNode` / `JoinNode`) and a `controlKind` attribute so renderers draw it
 * as a synchronization bar rather than an action card.
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
    const kind = node.controlKind === 'fork' ? 'ForkNode' : 'JoinNode';
    elements.set(id, {
        id,
        name: node.controlKind,
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
    if (!typeName) return;
    if (!conn.source || !conn.target) return;

    // Normalize: "Mitigates" → "mitigates", "TraceTo" → "traceTo"
    const normalizedType = normalizeRelType(typeName);

    // Resolve source and target using registry for cross-file resolution
    const sourceId = resolveEndpointId(conn.source.ref, packageName, registry, allElementIds);
    const targetId = resolveEndpointId(conn.target.ref, packageName, registry, allElementIds);
    if (!sourceId || !targetId) return;

    const rel: MemoRelationship = {
        id: `rel-${++relationshipCounter}`,
        type: normalizedType,
        sourceId,
        sourceEnd: conn.source.endName,
        targetId,
        targetEnd: conn.target.endName,
        file: filePath,
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
 * Resolve a flow connection usage into a MemoRelationship.
 * Flow endpoints use dot notation: "actionName.paramName"
 */
function resolveFlowConnection(
    flow: FlowConnectionUsage,
    filePath: string,
    packageName: string,
    parentActionId: string | undefined,
    relationships: MemoRelationship[],
    allElementIds: Set<string>
): void {
    const sourceRef = flow.source?.ref;
    const targetRef = flow.target?.ref;
    if (!sourceRef || !targetRef) return;

    // Parse dot notation: "receive.prescription" → actionId="receive", port="prescription"
    const sourceParts = sourceRef.split('.');
    const targetParts = targetRef.split('.');

    const sourceActionId = sourceParts[0];
    const sourcePort = sourceParts.length > 1 ? sourceParts.slice(1).join('.') : '';
    const targetActionId = targetParts[0];
    const targetPort = targetParts.length > 1 ? targetParts.slice(1).join('.') : '';

    // Only create relationship if both endpoints reference known elements
    if (!allElementIds.has(sourceActionId) || !allElementIds.has(targetActionId)) return;

    const rel: MemoRelationship = {
        id: `rel-${++relationshipCounter}`,
        type: 'flow',
        sourceId: sourceActionId,
        sourceEnd: sourcePort,
        targetId: targetActionId,
        targetEnd: targetPort,
        file: filePath,
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

        const rel: MemoRelationship = {
            id: `rel-${++relationshipCounter}`,
            type: 'succession',
            sourceId,
            sourceEnd: '',
            targetId,
            targetEnd: '',
            file: filePath,
        };

        relationships.push(rel);
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
    allElementIds: Set<string>
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

    const rel: MemoRelationship = {
        id: `rel-${++relationshipCounter}`,
        type: 'allocateTo',
        sourceId,
        sourceEnd: 'action',
        targetId,
        targetEnd: 'part',
        file: filePath,
    };

    relationships.push(rel);
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function extractAttributes(body: any[] | undefined): Record<string, string> {
    if (!body) return {};
    const attrs: Record<string, string> = {};

    for (const member of body) {
        if (member.$type === 'AttributeMember') {
            const attr = member as AttributeMember;
            if (attr.value) {
                attrs[attr.name] = extractAttributeValue(attr.value);
            } else if (attr.type) {
                attrs[attr.name] = `<${attr.type}>`;
            }
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
    ref: string,
    packageName: string,
    registry: PackageRegistry,
    allElementIds: Set<string>
): string | undefined {
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
 * Normalize relationship type name:
 *   PascalCase → camelCase for matching against config.relationshipTypes[].name
 *   "Mitigates" → "mitigates", "TraceTo" → "traceTo", "AllocateTo" → "allocateTo"
 */
function normalizeRelType(name: string): string {
    return name.charAt(0).toLowerCase() + name.slice(1);
}
