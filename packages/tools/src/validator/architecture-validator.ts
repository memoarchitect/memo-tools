// ─── Architecture Validator ─────────────────────────────────────────────────
//
// Graph rules for structural parts. These sit beside the native constraint
// evaluator because they need to inspect containment and connector topology
// together — a single-subject KerML navigation cannot tell a composition edge
// from a connector owned by one of a part's descendants.
// ─────────────────────────────────────────────────────────────────────────────

import type { MemoElement, MemoModel } from '../model/semantic.js';
import type { Violation } from './types.js';
import type { KindRegistry } from '../model/kind-registry.js';

const COMPOSITION_TYPES = new Set(['composes', 'composedof', 'decomposedby', 'aggregation']);
// These are interface/flow relations. Trace, allocation, deployment, and
// satisfaction links are meaningful model relations, but do not make a block
// connected in an internal block diagram.
const CONNECTOR_TYPES = new Set(['exchangeswith', 'flow', 'logicalexchange', 'logicalconnector', 'connectsto', 'itemflow']);

/**
 * Warn on a structural part nested in another part when neither it nor a
 * descendant has a modeled IBD connector. A warning, rather than an error,
 * preserves legitimate passive or intentionally isolated components while
 * making omitted interfaces visible in Memo Architect's Problems panel.
 *
 * The SUBJECT SCOPE is ontology-driven: `appliesToKind` is the rule's declared
 * `appliesTo` from AR-IBD-001 in the ontology, and only kinds conforming to it
 * are judged. Narrowing or widening the rule is therefore an ontology edit, not
 * a code edit — this file holds the graph walk, never the list of kinds it
 * applies to. Omitting the argument judges every part.
 */
export function validateArchitecture(
    model: MemoModel,
    appliesToKind?: string,
    kindRegistry?: KindRegistry,
): Violation[] {
    // Kinds conforming to the ontology-declared subject, walked through the
    // registry's supertype chain. Unresolvable scope falls back to every part
    // rather than silently judging nothing.
    const inScope = (element: MemoElement): boolean => {
        if (!appliesToKind || !kindRegistry) return true;
        let name: string | undefined = element.kind;
        const seen = new Set<string>();
        while (name && !seen.has(name)) {
            if (name === appliesToKind) return true;
            seen.add(name);
            name = kindRegistry.getKind(name)?.superType;
        }
        return false;
    };

    const parentOf = new Map<string, string>();
    for (const rel of model.relationships) {
        if (COMPOSITION_TYPES.has(rel.type.toLowerCase())) parentOf.set(rel.targetId, rel.sourceId);
    }

    const partOfEndpoint = (id: string): string | undefined => {
        let current = model.elements.get(id);
        const seen = new Set<string>();
        while (current && !seen.has(current.id)) {
            if (current.construct === 'part') return current.id;
            seen.add(current.id);
            current = model.elements.get(current.owner ?? parentOf.get(current.id) ?? '');
        }
        return undefined;
    };

    const connected = new Set<string>();
    const markAncestors = (partId: string | undefined) => {
        let current = partId;
        const seen = new Set<string>();
        while (current && !seen.has(current)) {
            connected.add(current);
            seen.add(current);
            current = parentOf.get(current);
        }
    };

    for (const rel of model.relationships) {
        if (!CONNECTOR_TYPES.has(rel.type.toLowerCase())) continue;
        const sourcePart = partOfEndpoint(rel.sourceId);
        const targetPart = partOfEndpoint(rel.targetId);
        if (!sourcePart || !targetPart || sourcePart === targetPart) continue;
        markAncestors(sourcePart);
        markAncestors(targetPart);
    }

    const violations: Violation[] = [];
    for (const element of model.elements.values()) {
        if (element.construct !== 'part') continue;
        if (!inScope(element)) continue;
        // The root context block has no owning part, and therefore cannot be
        // judged for isolation within a parent composition.
        const parentId = parentOf.get(element.id);
        if (!parentId || !model.elements.get(parentId) || connected.has(element.id)) continue;
        violations.push({
            ruleId: 'AR-IBD-001',
            description: `Part "${element.name}" has no modeled interface connector within "${model.elements.get(parentId)!.name}"`,
            severity: 'warning',
            elementId: element.id,
            elementKind: element.kind,
            elementName: element.name,
            layer: element.layer,
        });
    }
    return violations;
}
