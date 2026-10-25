// ─── Architecture Validator ─────────────────────────────────────────────────
//
// Graph rules for structural parts. These sit beside the native constraint
// evaluator because they need to inspect containment and connector topology
// together — a single-subject KerML navigation cannot tell a composition edge
// from a connector owned by one of a part's descendants.
// ─────────────────────────────────────────────────────────────────────────────

import type { MemoElement, MemoModel, ParameterDirection } from '../model/semantic.js';
import type { Violation } from './types.js';
import type { KindRegistry } from '../model/kind-registry.js';
import type { RelationshipRegistry } from '../model/relationship-registry.js';

const COMPOSITION_TYPES = new Set(['composes', 'composedof', 'decomposedby', 'aggregation']);
// A connector is what makes a block connected in an internal block diagram; trace, allocation, deployment and
// satisfaction links are meaningful model relations that do not. Which relations are connectors is the
// ontology's to say (`isConnector` on the relation, read through the registry). Two edge types are connectors by
// their SysML construct and have no definition to carry the flag: an `interface` usage
// (`interface x : Icd connect a to b;`) and a `flow` usage. They are the language's, not the ontology's.
const NATIVE_CONNECTOR_TYPES = new Set(['interface', 'flow']);

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
 *
 * Without a relationship registry only the native connectors count, so a relation the ontology
 * declares a connector (`LogicalConnector`) is not seen.
 */
export function validateArchitecture(
    model: MemoModel,
    appliesToKind?: string,
    kindRegistry?: KindRegistry,
    relationshipRegistry?: RelationshipRegistry,
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
        if (!NATIVE_CONNECTOR_TYPES.has(rel.type) && !relationshipRegistry?.isConnector(rel.type)) continue;
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
    return [...violations, ...validateExchangeDirections(model)];
}

// ─── AR-EXCH-001 and AR-EXCH-002: an exchange agrees with the ports it joins ──
//
// Direction is written on the ports (`in`, `out`, `inout`; `~` conjugates), and nowhere on the exchange. These
// two checks hold the exchange to that: a binding's ends have the same direction, and an interface or flow
// between ports leaves one that sends and enters one that receives. Only ends that are ports with a stated
// direction are judged. A conjugated port is read from the other side: `~` turns `in` into `out`.

const FLIPPED: Record<ParameterDirection, ParameterDirection> = { in: 'out', out: 'in', inout: 'inout' };

/** What the port does as seen from outside it, or undefined when it states no direction (or is no port). */
function portDirection(model: MemoModel, id: string): ParameterDirection | undefined {
    const element = model.elements.get(id);
    const spec = element?.construct === 'port' ? element.portSpec : undefined;
    if (!spec?.direction) return undefined;
    return spec.isConjugated ? FLIPPED[spec.direction] : spec.direction;
}

function exchangeViolation(
    model: MemoModel, ruleId: 'AR-EXCH-001' | 'AR-EXCH-002', rel: MemoModel['relationships'][number], description: string,
): Violation {
    const element = model.elements.get(rel.sourceId)!;
    return {
        ruleId, description, severity: 'error', elementId: element.id, elementKind: element.kind,
        elementName: element.name, layer: element.layer,
    };
}

function validateExchangeDirections(model: MemoModel): Violation[] {
    const violations: Violation[] = [];
    const name = (id: string) => model.elements.get(id)?.name ?? id;
    for (const rel of model.relationships) {
        const source = portDirection(model, rel.sourceId);
        const target = portDirection(model, rel.targetId);
        if (!source || !target) continue;
        if (rel.type === 'bind') {
            if (source !== target) {
                violations.push(exchangeViolation(model, 'AR-EXCH-001', rel,
                    `"${name(rel.sourceId)}" (${source}) is bound to "${name(rel.targetId)}" (${target}): a binding joins ports of the same direction`));
            }
        } else if (NATIVE_CONNECTOR_TYPES.has(rel.type)) {
            if (source === 'in' || target === 'out') {
                violations.push(exchangeViolation(model, 'AR-EXCH-002', rel,
                    `The ${rel.type} from "${name(rel.sourceId)}" (${source}) to "${name(rel.targetId)}" (${target}) must leave a port that sends and enter one that receives`));
            }
        }
    }
    return violations;
}
