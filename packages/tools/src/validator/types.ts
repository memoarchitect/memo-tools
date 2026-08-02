// ─── Validation Types ─────────────────────────────────────────────────────────

import type { SemanticElementProvenance } from '../model/source-provenance.js';

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
    /** The declaration/classifier provenance of the violating element. */
    provenance?: SemanticElementProvenance;
    /**
     * Where the rule that produced this violation came from, and what was done
     * to it. Section 10.4: a violation names the active rule, the rule it
     * replaced if any, the policy that changed it, the effective severity, and
     * the rationale and approval behind the tailoring. A tailored rule that
     * reports violations without saying it was tailored is not auditable.
     */
    ruleProvenance?: ViolationRuleProvenance;
}

/** Rule-side provenance carried on every violation (section 10.4). */
export interface ViolationRuleProvenance {
    /** Qualified name of the active rule's `constraint def`. */
    activeRuleType: string;
    /** Set when the active rule replaced a different one. */
    baseRuleId?: string;
    /** Severity the ontology authored, before any override. */
    declaredSeverity: 'error' | 'warning' | 'info';
    /** How far the rule may be tailored. */
    tailoring: 'invariant' | 'assurance' | 'methodology';
    /** Which methodology or binding changed it, in application order. */
    policyChain: Array<{
        source: string;
        level: 'methodology' | 'project';
        disposition: 'enabled' | 'disabled' | 'replaced';
    }>;
    rationaleText?: string;
    authority?: string;
    approvalReference?: string;
    /** File declaring the rule. */
    sourceFile?: string;
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
