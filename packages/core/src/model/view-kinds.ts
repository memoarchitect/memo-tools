// ─── SysML v2 View Kinds ─────────────────────────────────────────────────────
//
// The SysML v2 specification defines eight standard view kinds. Every diagram
// in MEMO resolves to exactly one of them (Epic KK). The ontology mirrors this
// as `enum def DiagramViewKind` in memo::core::enumerations, declared on
// DiagramView as `attribute viewKind : DiagramViewKind`.
//
// Legacy `diagramType` keys (v1-flavored: bdd/ibd/ucd/...) remain the storage
// and wire format; this module is the single source of truth for mapping them
// onto the spec taxonomy.
// ─────────────────────────────────────────────────────────────────────────────

/** The eight standard SysML v2 view kinds. */
export const VIEW_KINDS = [
    'general',
    'interconnection',
    'actionflow',
    'statetransition',
    'sequence',
    'grid',
    'browser',
    'geometry',
] as const;

export type ViewKind = (typeof VIEW_KINDS)[number];

const VIEW_KIND_SET: ReadonlySet<string> = new Set(VIEW_KINDS);

export function isViewKind(value: string): value is ViewKind {
    return VIEW_KIND_SET.has(value);
}

/**
 * Map every legacy `diagramType` key to its spec view kind.
 *
 * General subsumes definition/membership structure (bdd, pkg, req, ucd) and
 * free-form relationship graphs (risk chains, threat models). Parametric
 * diagrams render constraint networks as interconnection.
 */
export const DIAGRAM_TYPE_TO_VIEW_KIND: Record<string, ViewKind> = {
    bdd: 'general',
    pkg: 'general',
    req: 'general',
    ucd: 'general',
    risk: 'general',
    'threat-model': 'general',
    ibd: 'interconnection',
    par: 'interconnection',
    act: 'actionflow',
    afd: 'actionflow',
    ofd: 'actionflow',
    ffd: 'actionflow',
    stm: 'statetransition',
    seq: 'sequence',
    fmea: 'grid',
    alloc: 'grid',
};

/**
 * Normalize a declared viewKind attribute value to a spec view kind.
 * Enum references arrive from the parser as qualified names
 * ("DiagramViewKind::general") — strip the qualifier and validate.
 * Returns undefined for absent or non-taxonomy values (e.g. the
 * DocumentViewKind values that DocumentView declares under the same
 * attribute name).
 */
export function normalizeViewKind(raw: string | undefined): ViewKind | undefined {
    if (!raw) return undefined;
    const unqualified = raw.split('::').pop()!.trim();
    return isViewKind(unqualified) ? unqualified : undefined;
}

/**
 * Resolve the view kind for a view element: an explicitly declared
 * `viewKind` wins; otherwise the legacy `diagramType` key is mapped.
 * Views with neither (document-backed views) resolve to `browser`,
 * the hierarchical membership kind.
 */
export function resolveViewKind(
    declaredViewKind: string | undefined,
    diagramType: string | undefined
): ViewKind {
    const declared = normalizeViewKind(declaredViewKind);
    if (declared) return declared;
    if (diagramType) return DIAGRAM_TYPE_TO_VIEW_KIND[diagramType] ?? 'general';
    return 'browser';
}
