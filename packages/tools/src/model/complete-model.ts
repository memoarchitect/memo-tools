// ─── Finishing a model ───────────────────────────────────────────────────────
//
// What stage 2 does once the elements and relationships of a compiled project
// exist: provenance, identities, end-kind checks, indexes, kinds inherited
// through local definitions, and unresolved qualified references.
// ─────────────────────────────────────────────────────────────────────────────

import { createHash } from 'node:crypto';
import type { MEMOConfig } from './config.js';
import type {
    MemoElement,
    MemoRelationship,
    MemoModel,
    MemoPackageDTO,
    ParseError,
    UnresolvedReference,
} from './semantic.js';
import { assignSequentialShortIds, assignUsageShortIds, familyPrefix, kindToPrefix, parseUsageShortId } from './short-id.js';
import { priorIdentityFor, priorShortIds } from './identity-registry.js';
import {
    ElementIndex, describeLocation, qualifiedId, shortNameOf,
    ELEMENT_NAME_COLLISION, AMBIGUOUS_ELEMENT_REFERENCE, RELATIONSHIP_NAME_COLLISION,
} from './element-index.js';
import type { KindRegistry } from './kind-registry.js';
import type { RelationshipRegistry } from './relationship-registry.js';
import { BUILDER_NATIVE_RELATION_TYPES } from './selector-vocabulary.js';
import { LANGUAGE_NATIVE_RELATIONS, REFINEMENT_METADATA, pascalToCamelCase } from './relationship-registry.js';
import { indexKinds, kindConformsTo } from './relationship-legality.js';
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


/** What `completeModel` needs from whichever builder extracted the elements and relationships. */
export interface CompleteModelInput {
    elements: ElementIndex;
    relationships: MemoRelationship[];
    errors: ParseError[];
    config: MEMOConfig;
    registries?: BuilderRegistries;
    /** The declared packages. */
    packages?: MemoPackageDTO[];
    /** The 1-based line a relationship is declared on, for end-kind findings. */
    lineOfRelationship?: (relationship: MemoRelationship) => number | undefined;
}

/**
 * Finish a model once its elements and relationships exist: provenance,
 * identities, end-kind checks, indexes, kinds inherited through local
 * definitions. Stage 2's builder over API JSON (stage2/build-from-api.ts)
 * calls it once it has extracted the elements and relationships.
 */
export function completeModel(input: CompleteModelInput): MemoModel {
    const { elements, relationships, errors, config, registries } = input;
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
    const prefixOf = idFamilyResolver(elements);
    // A usage typed by a project definition is the definition seen again: its id is the definition's
    // short id and a number of its own, assigned below once the definitions have theirs.
    const definitionOfUsage = usageDefinitions(elements);
    for (const element of elements.values()) {
        if (definitionOfUsage.has(element.id)) continue;
        const prefix = prefixOf(element);
        const prefixElements = elementsByPrefix.get(prefix) ?? [];
        prefixElements.push(element);
        elementsByPrefix.set(prefix, prefixElements);
    }
    // Identities assigned on earlier builds win. Both of these are quoted
    // outside the model, so recomputing them from current content — which is
    // what happened before `memo.identity.yaml` — silently repointed every
    // external reference whenever a file moved or an element was inserted.
    const priorIdentities = config.priorIdentities ?? {};
    const priorShortIdsByElement = priorShortIds(priorIdentities);
    // Adopt the identity a NESTED element was keyed under before ids carried
    // their owner chain. Without this every port and every nested action in
    // every existing project would be a newcomer on the next build and take a
    // fresh number, silently repointing whatever quotes the old one.
    for (const el of elements.values()) {
        if (priorShortIdsByElement.has(el.id)) continue;
        const legacy = priorIdentityFor(priorIdentities, el);
        if (legacy?.shortId) priorShortIdsByElement.set(el.id, legacy.shortId);
    }
    for (const [prefix, prefixElements] of elementsByPrefix) {
        // A dependency's elements keep the identity their own package gives them
        // (its `providedId`), and take no display number here: it would be minted
        // in this model's sequence, and be wrong the moment the dependency moved.
        const idToShortId = assignSequentialShortIds(
            prefix,
            prefixElements.filter(e => e.provenance?.declaration.origin !== 'dependency').map(e => e.id),
            priorShortIdsByElement,
        );
        for (const el of prefixElements) (el as MemoElement).shortId = idToShortId.get(el.id);
    }
    const usagesByBase = new Map<string, string[]>();
    for (const [usageId, definition] of definitionOfUsage) {
        if (!definition.shortId) continue;
        usagesByBase.set(definition.shortId, [...(usagesByBase.get(definition.shortId) ?? []), usageId]);
    }
    for (const [id, shortId] of assignUsageShortIds(usagesByBase, priorShortIdsByElement)) {
        (elements.get(id) as MemoElement).shortId = shortId;
    }
    for (const el of elements.values()) {
        // `uuid` is part of the ontology's identification core, so a model
        // may author it. An authored value wins: it is the whole point of
        // writing one — the element keeps its identity across a file move
        // or an id change, which the derived hash cannot survive.
        // Precedence: an authored uuid, then the one this project already
        // assigned, then a fresh derivation. The middle term is what makes a
        // uuid survive a file move — the derivation hashes the file path, so
        // without it the same element gets a new identity when it moves.
        (el as MemoElement).uuid = el.attributes.uuid?.trim()
            || priorIdentityFor(priorIdentities, el)?.uuid
            || stableElementUuid(el);
        el.idFamily = el.shortId?.split('-')[0];
        el.displayId = el.attributes.providedId?.trim() || usageDisplayId(el, definitionOfUsage.get(el.id)) || el.shortId;
    }

    // Phase 4: Validate relationship end types (warnings only).
    // A kind conforms to an end type if it equals it or specializes it
    // (transitively) — e.g. HardwareAssembly conforms to MemoPart.
    if (registries?.relationshipRegistry) {
        // Same resolver the authoring UI and the server persistence path use,
        // so a link the panel offers is a link the builder accepts.
        const kindIndex = indexKinds(registries.kindRegistry?.toDefinitionDTOs() ?? []);
        // A project definition specializes an ontology kind, and the ontology
        // registry has never heard of it: `AfferaStakeholder` is declared in
        // this project, not in memo. So a chain like
        // `AfferaHospitalEpLabStakeholder :> AfferaStakeholder :> MemoPart`
        // broke at the first hop and fell through to guessing by name suffix,
        // reporting a well-formed context diagram as malformed.
        //
        // A definition element records what it specializes in its own `kind`,
        // so the model supplies the missing links. This is the same walk the
        // explorer makes to file an element under its ontology kind.
        const projectSuper = new Map<string, string>();
        for (const el of elements.values()) {
            if (!el.isDefinition || !el.kind || el.kind === el.name) continue;
            const short = el.shortName ?? el.name;
            if (!projectSuper.has(short)) projectSuper.set(short, el.kind);
            if (el.name && !projectSuper.has(el.name)) projectSuper.set(el.name, el.kind);
            if (!projectSuper.has(el.id)) projectSuper.set(el.id, el.kind);
        }
        const conformsTo = (kind: string, expected: string): boolean => {
            let current: string | undefined = kind;
            const seen = new Set<string>();
            while (current && !seen.has(current)) {
                if (current === expected) return true;
                if (kindConformsTo(current, expected, kindIndex)) return true;
                seen.add(current);
                current = kindIndex.get(current)?.superType ?? projectSuper.get(current);
            }
            // Legacy fallback when neither the ontology nor the project knows
            // this kind's hierarchy at all.
            return !kindIndex.has(kind) && !projectSuper.has(kind) && kind.endsWith(expected);
        };

        // A finding names the edge's own line. Every one of them used to point
        // at 1:1 of its file, which in a trace file of six hundred lines is no
        // location at all.
        const lineOfRelationship = (rel: MemoRelationship): number | undefined => input.lineOfRelationship?.(rel);

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
                        code: RELATIONSHIP_END_KIND,
                        message: `[well-formedness] Relationship "${rel.type}" expects ${end.name} to be ${end.type}, but found ${el.kind}`,
                        file: rel.file ?? '',
                        line: lineOfRelationship(rel),
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

    // A local definition has already resolved its own ontology kind; usages
    // typed by it inherit that kind, including through a local definition chain.
    if (registries?.kindRegistry) {
        const byName = new Map<string, MemoElement>();
        for (const [id, el] of elements) {
            if (!byName.has(id)) byName.set(id, el);
            // A usage names its type by the SHORT name the definition declares,
            // never by the qualified id, so both spellings answer here.
            if (el.shortName && !byName.has(el.shortName)) byName.set(el.shortName, el);
            if (el.name && !byName.has(el.name)) byName.set(el.name, el);
        }
        const known = (kind: string) => Boolean(registries.kindRegistry?.getKind(kind));
        for (let pass = 0; pass < 16; pass++) {
            let progressed = false;
            for (const el of elements.values()) {
                if (!el.kind || known(el.kind)) continue;
                const def = byName.get(el.kind.split('::').pop()!);
                if (def && def !== el && def.kind && def.kind !== el.kind) {
                    el.kind = def.kind;
                    if (def.layer && (!el.layer || el.layer === 'unknown')) el.layer = def.layer;
                    progressed = true;
                }
            }
            if (!progressed) break;
        }
    }

    // A reference that names nothing is a stage 1 error: the compiler rejects the
    // project before a model is built, so none reaches here.
    const unresolvedReferences: UnresolvedReference[] = [];

    return {
        elements,
        relationships,
        errors,
        packages: input.packages ?? [],
        unresolvedReferences,
        elementsByKind,
        elementsByLayer,
        relationshipsByType,
        ...(registries?.relationshipRegistry && {
            declaredRelationTypes: new Set(
                [...registries.relationshipRegistry.relTypeNames(), ...BUILDER_NATIVE_RELATION_TYPES].map(name => name.toLowerCase())),
        }),
        outgoing,
        incoming,
    };
}

function applySemanticProvenance(
    elements: ElementIndex,
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

/** The definition's own display id and the usage's number, `EXT-AFR-06:1`. */
function usageDisplayId(usage: MemoElement, definition: MemoElement | undefined): string | undefined {
    const seq = usage.shortId ? parseUsageShortId(usage.shortId)?.seq : undefined;
    if (!definition || seq === undefined) return undefined;
    return `${definition.attributes.providedId?.trim() || definition.shortId}:${seq}`;
}

/**
 * Each usage typed by a project definition, with that definition. A usage names its type by the name the
 * definition declares; one typed by an ontology kind, or by nothing the project declares, is not here.
 */
function usageDefinitions(elements: ElementIndex): Map<string, MemoElement> {
    const projectDefinitions = new Map<string, MemoElement>();
    for (const el of elements.values()) {
        if (el.isDefinition && el.provenance?.declaration.origin !== 'dependency') projectDefinitions.set(el.shortName ?? el.name, el);
    }
    const out = new Map<string, MemoElement>();
    for (const el of elements.values()) {
        if (el.isDefinition || el.provenance?.declaration.origin === 'dependency') continue;
        const typeName = (el.attributes.usageType ?? el.attributes.actionType ?? el.kind ?? '').split('::').pop();
        const definition = typeName ? projectDefinitions.get(typeName) : undefined;
        if (definition && definition !== el) out.set(el.id, definition);
    }
    return out;
}

/**
 * The family of an element's display id.
 *
 * A project definition is registered as a kind of its own, so an element typed by one carries that
 * definition's name as its `kind`; minting a family from that name made one family per definition
 * (`HospitalEpRecordingSystemExternal` → HSP). The family belongs to the ontology: walk the project
 * definitions the kind names, up their specialization chain, to the first ontology kind. The one
 * exception is a definition that declares `@MemoKind { idPrefix }`, which extends the ontology with a
 * family of its own, and so does whatever is typed by it or specializes it.
 */
function idFamilyResolver(elements: ElementIndex): (element: MemoElement) => string {
    const projectDefinitions = new Map<string, MemoElement>();
    for (const el of elements.values()) {
        if (el.isDefinition && el.provenance?.declaration.origin !== 'dependency') projectDefinitions.set(el.shortName ?? el.name, el);
    }
    const memo = new Map<string, string>();
    const familyOfKind = (kind: string): string => {
        const cached = memo.get(kind);
        if (cached) return cached;
        let name = kind.split('::').pop() ?? kind;
        const seen = new Set<string>();
        let found: string | undefined;
        while (!seen.has(name)) {
            seen.add(name);
            const def = projectDefinitions.get(name);
            if (!def) break;
            const chosen = familyPrefix(def.attributes.idPrefix);
            if (chosen) { found = chosen; break; }
            name = def.kind.split('::').pop() ?? def.kind;
        }
        const family = found ?? kindToPrefix(name);
        memo.set(kind, family);
        return family;
    };
    return element => {
        const own = element.isDefinition ? familyPrefix(element.attributes.idPrefix) : undefined;
        return own ?? familyOfKind(element.kind);
    };
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

/** The kind a nested grouping package becomes, distinct from a namespace package. */
export const ELEMENT_PACKAGE_KIND = 'ElementPackage';

/**
 * The `ParseError.code` a relationship carries when an end's element does not
 * conform to the kind the relationship's definition types that end with.
 */
export const RELATIONSHIP_END_KIND = 'relationship-end-kind';

/** The `ParseError.code` an `interface … connect` with an end naming nothing carries. */
export const UNRESOLVED_INTERFACE_END = 'unresolved-interface-end';

/** The `ParseError.code` a `flow` or `message` with an end naming nothing carries. */
export const UNRESOLVED_FLOW_END = 'unresolved-flow-end';

/** The `ParseError.code` a `bind` with an end naming nothing carries. */
export const UNRESOLVED_BINDING_END = 'unresolved-binding-end';

