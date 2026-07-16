// ─── Validation Types ─────────────────────────────────────────────────────────

/** A single rule violation */
export interface Violation {
    /** Closure rule id, e.g. "CR-MED-001" */
    ruleId: string;
    /** Rule description */
    description: string;
    /** Severity */
    severity: 'error' | 'warning' | 'info';
    /** Element id that violates the rule */
    elementId: string;
    /** Element kind */
    elementKind: string;
    /** Element name */
    elementName: string;
    /** CoSMA layer */
    layer: string;
}

/** Validation result for the entire model */
export interface ValidationResult {
    /** All violations found */
    violations: Violation[];
    /** Total rules evaluated */
    rulesEvaluated: number;
    /** Rules that passed (no violations) */
    rulesPassed: number;
    /** Timestamp */
    timestamp: number;
}

/** Per-layer completeness percentage */
export interface LayerCompleteness {
    /** Layer id */
    layerId: string;
    /** Layer label */
    layerLabel: string;
    /** Layer color */
    layerColor: string;
    /** Number of elements in this layer */
    totalElements: number;
    /** Number of elements with no violations */
    completeElements: number;
    /** Completeness percentage (0-100) */
    percentage: number;
}

/** Per-element completeness status */
export type ElementStatus = 'complete' | 'warning' | 'error';

/** Overall completeness report */
export interface CompletenessReport {
    /** Per-layer completeness */
    layers: LayerCompleteness[];
    /** Overall completeness percentage */
    overall: number;
    /** Total elements */
    totalElements: number;
    /** Complete elements (no violations) */
    completeElements: number;
    /** Per-element status: complete (no violations), warning (warnings only), error (has errors) */
    elementStatus: Record<string, ElementStatus>;
}
