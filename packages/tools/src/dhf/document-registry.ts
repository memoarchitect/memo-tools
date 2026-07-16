// ─── DHF Document Registry ───────────────────────────────────────────────────
//
// Registry of 18 regulated document types for medical device Design History File.
// Each document type has a unique ID, title, standard references, and section defs.
//
// Terminology note: "DHF" is the FDA's legacy QSR term (21 CFR 820.30(j)). Under
// QMSR (effective Feb 2026), which incorporates ISO 13485:2016 by reference, the
// equivalent record is the "design and development file" (ISO 13485 §7.3.10) —
// the regulation text no longer says "DHF". Kept as "DHF" here since that's still
// the term practitioners and eQMS tooling use; not a functional distinction.
// ─────────────────────────────────────────────────────────────────────────────

/** A section within a DHF document template */
export interface DhfSection {
    id: string;
    title: string;
    /** Handlebars template content or static markdown */
    description?: string;
    /** Whether this section is required for the document to be considered complete */
    required: boolean;
}

/** A registered DHF document type */
export interface DhfDocumentType {
    /** Short identifier, e.g. "rmp", "har", "fmea" */
    id: string;
    /** Full document title */
    title: string;
    /** Regulatory standard references */
    standards: string[];
    /** Architecture layers this document draws from */
    layers: string[];
    /** Element kinds relevant to this document */
    relevantKinds: string[];
    /** Relationship types relevant to this document */
    relevantRelationships: string[];
    /** Default sections */
    sections: DhfSection[];
    /** Document group for CLI aliases */
    group: 'risk' | 'design' | 'verification' | 'compliance' | 'all';
}

/** The 18 DHF document types for medical device development */
export const DHF_DOCUMENT_TYPES: DhfDocumentType[] = [
    // ─── Risk Management ─────────────────────────────────────────────────
    {
        id: 'rmp',
        title: 'Risk Management Plan',
        standards: ['ISO 14971:2019 §4.4'],
        layers: ['risk'],
        relevantKinds: ['Hazard', 'HazardousSituation', 'Harm', 'RiskControl', 'RiskAcceptabilityCriteria'],
        relevantRelationships: ['mitigates', 'causedBy', 'leadsTo'],
        group: 'risk',
        sections: [
            { id: 'scope', title: 'Scope', required: true },
            { id: 'risk-policy', title: 'Risk Acceptability Policy', required: true },
            { id: 'risk-process', title: 'Risk Management Process', required: true },
            { id: 'verification-activities', title: 'Verification of Risk Control Measures', required: true },
            { id: 'residual-risk', title: 'Overall Residual Risk Evaluation', required: true },
            { id: 'review', title: 'Risk Management Review', required: false },
        ],
    },
    {
        id: 'har',
        title: 'Hazard Analysis Report',
        standards: ['ISO 14971:2019 §5', 'ISO 14971:2019 §6'],
        layers: ['risk'],
        relevantKinds: ['Hazard', 'HazardousSituation', 'Harm', 'RiskControl'],
        relevantRelationships: ['mitigates', 'causedBy', 'leadsTo', 'identifiedIn'],
        group: 'risk',
        sections: [
            { id: 'hazard-identification', title: 'Hazard Identification', required: true },
            { id: 'risk-estimation', title: 'Risk Estimation', required: true },
            { id: 'risk-evaluation', title: 'Risk Evaluation', required: true },
            { id: 'risk-controls', title: 'Risk Control Measures', required: true },
            { id: 'residual-risk', title: 'Residual Risk Assessment', required: true },
        ],
    },
    {
        id: 'fmea',
        title: 'Failure Mode and Effects Analysis',
        standards: ['IEC 60812:2018'],
        layers: ['risk', 'functional', 'physical'],
        relevantKinds: ['Hazard', 'RiskControl', 'Function', 'Component', 'Subsystem'],
        relevantRelationships: ['mitigates', 'allocatedTo', 'performs'],
        group: 'risk',
        sections: [
            { id: 'scope', title: 'FMEA Scope & Boundaries', required: true },
            { id: 'function-analysis', title: 'Function Analysis', required: true },
            { id: 'failure-modes', title: 'Failure Mode Identification', required: true },
            { id: 'effects-analysis', title: 'Effects Analysis', required: true },
            { id: 'risk-priority', title: 'Risk Priority Numbers', required: true },
            { id: 'actions', title: 'Recommended Actions', required: false },
        ],
    },

    // ─── Traceability ────────────────────────────────────────────────────
    {
        id: 'rtm',
        title: 'Requirements Traceability Matrix',
        standards: ['IEC 62304:2006 §5.1.1', 'ISO 13485:2016 §7.3.3'],
        layers: ['requirements', 'functional', 'verification'],
        relevantKinds: ['Requirement', 'Requirement', 'DesignInput', 'DesignOutput', 'TestCase', 'VerificationActivity'],
        relevantRelationships: ['traceTo', 'satisfies', 'verifies', 'derivedFrom'],
        group: 'design',
        sections: [
            { id: 'requirements-list', title: 'Requirements Inventory', required: true },
            { id: 'design-trace', title: 'Requirements → Design Traceability', required: true },
            { id: 'verification-trace', title: 'Requirements → Verification Traceability', required: true },
            { id: 'coverage-summary', title: 'Coverage Summary', required: true },
            { id: 'gaps', title: 'Traceability Gaps', required: false },
        ],
    },

    // ─── Architecture ────────────────────────────────────────────────────
    {
        id: 'sad',
        title: 'System Architecture Description',
        standards: ['ISO/IEC/IEEE 42010:2022', 'IEC 62304:2006 §5.3'],
        layers: ['functional', 'logical', 'physical', 'software', 'interfaces'],
        relevantKinds: ['Function', 'Component', 'Subsystem', 'Interface', 'Port', 'SoftwareItem', 'SOUPComponent'],
        relevantRelationships: ['composedOf', 'allocatedTo', 'connectedTo', 'dependsOn', 'implements'],
        group: 'design',
        sections: [
            { id: 'system-overview', title: 'System Overview', required: true },
            { id: 'functional-arch', title: 'Functional Architecture', required: true },
            { id: 'physical-arch', title: 'Physical Architecture', required: true },
            { id: 'software-arch', title: 'Software Architecture', required: true },
            { id: 'interface-spec', title: 'Interface Specification', required: true },
            { id: 'allocation', title: 'Function-to-Component Allocation', required: false },
        ],
    },
    {
        id: 'sds',
        title: 'Software Design Specification',
        standards: ['IEC 62304:2006 §5.4'],
        layers: ['software'],
        relevantKinds: ['SoftwareItem', 'SoftwareUnit', 'SoftwareSystem', 'SOUPComponent', 'Interface'],
        relevantRelationships: ['composedOf', 'dependsOn', 'implements', 'connectedTo'],
        group: 'design',
        sections: [
            { id: 'software-items', title: 'Software Items', required: true },
            { id: 'interfaces', title: 'Software Interfaces', required: true },
            { id: 'soup', title: 'SOUP Components', required: true },
            { id: 'decomposition', title: 'Software Decomposition', required: true },
        ],
    },
    {
        id: 'soup',
        title: 'SOUP List (Software of Unknown Provenance)',
        standards: ['IEC 62304:2006 §8.1.2'],
        layers: ['software'],
        relevantKinds: ['SOUPComponent'],
        relevantRelationships: ['dependsOn', 'usedBy'],
        group: 'design',
        sections: [
            { id: 'soup-inventory', title: 'SOUP Component Inventory', required: true },
            { id: 'risk-assessment', title: 'SOUP Risk Assessment', required: true },
            { id: 'version-management', title: 'Version Management', required: true },
        ],
    },

    // ─── Design Control ──────────────────────────────────────────────────
    {
        id: 'dip',
        title: 'Design Input Plan',
        standards: ['ISO 13485:2016 §7.3.3'],
        layers: ['requirements', 'business'],
        relevantKinds: ['DesignInput', 'Requirement', 'StakeholderNeed', 'UseCase'],
        relevantRelationships: ['traceTo', 'derivedFrom', 'satisfies'],
        group: 'design',
        sections: [
            { id: 'stakeholder-needs', title: 'Stakeholder Needs', required: true },
            { id: 'design-inputs', title: 'Design Inputs', required: true },
            { id: 'trace-to-needs', title: 'Input-to-Need Traceability', required: true },
        ],
    },
    {
        id: 'dop',
        title: 'Design Output Plan',
        standards: ['ISO 13485:2016 §7.3.4'],
        layers: ['functional', 'physical', 'software'],
        relevantKinds: ['DesignOutput', 'Component', 'SoftwareItem', 'Function'],
        relevantRelationships: ['satisfies', 'implements', 'allocatedTo'],
        group: 'design',
        sections: [
            { id: 'design-outputs', title: 'Design Outputs', required: true },
            { id: 'output-to-input', title: 'Output-to-Input Traceability', required: true },
        ],
    },

    // ─── Verification & Validation ───────────────────────────────────────
    {
        id: 'vvp',
        title: 'Verification & Validation Plan',
        standards: ['ISO 13485:2016 §7.3.6', 'IEC 62304:2006 §5.7'],
        layers: ['verification'],
        relevantKinds: ['TestCase', 'VerificationActivity', 'ValidationActivity', 'TestProtocol'],
        relevantRelationships: ['verifies', 'validates', 'traceTo'],
        group: 'verification',
        sections: [
            { id: 'verification-strategy', title: 'Verification Strategy', required: true },
            { id: 'test-cases', title: 'Test Cases', required: true },
            { id: 'acceptance-criteria', title: 'Acceptance Criteria', required: true },
            { id: 'validation-plan', title: 'Validation Plan', required: false },
        ],
    },
    {
        id: 'vvr',
        title: 'Verification & Validation Report',
        standards: ['ISO 13485:2016 §7.3.7', 'IEC 62304:2006 §5.8'],
        layers: ['verification'],
        relevantKinds: ['TestCase', 'VerificationActivity', 'ValidationActivity', 'TestResult'],
        relevantRelationships: ['verifies', 'validates', 'traceTo'],
        group: 'verification',
        sections: [
            { id: 'results-summary', title: 'Results Summary', required: true },
            { id: 'test-results', title: 'Test Results', required: true },
            { id: 'deviations', title: 'Deviations & Non-Conformances', required: false },
            { id: 'conclusion', title: 'Conclusion', required: true },
        ],
    },

    // ─── Compliance ──────────────────────────────────────────────────────
    {
        id: 'sdp',
        title: 'Software Development Plan',
        standards: ['IEC 62304:2006 §5.1'],
        layers: ['software', 'verification'],
        relevantKinds: ['SoftwareItem', 'SoftwareUnit', 'SoftwareSystem', 'TestCase'],
        relevantRelationships: ['composedOf', 'verifies', 'implements'],
        group: 'compliance',
        sections: [
            { id: 'scope', title: 'Scope & Software Safety Class', required: true },
            { id: 'lifecycle', title: 'Software Development Life Cycle', required: true },
            { id: 'deliverables', title: 'Deliverables', required: true },
            { id: 'tools', title: 'Development Tools & Environment', required: false },
        ],
    },
    {
        id: 'csr',
        title: 'Clinical Safety Report',
        standards: ['ISO 14971:2019 §10'],
        layers: ['risk', 'verification'],
        relevantKinds: ['Hazard', 'RiskControl', 'ClinicalEvidence', 'ValidationActivity'],
        relevantRelationships: ['mitigates', 'validates', 'supports'],
        group: 'compliance',
        sections: [
            { id: 'safety-summary', title: 'Safety Summary', required: true },
            { id: 'risk-benefit', title: 'Risk-Benefit Analysis', required: true },
            { id: 'post-market', title: 'Post-Market Surveillance Plan', required: false },
        ],
    },
    {
        id: 'uer',
        title: 'Usability Engineering Report',
        standards: ['IEC 62366-1:2015'],
        layers: ['ui', 'requirements'],
        relevantKinds: ['UseCase', 'UserActivity', 'UserInterface', 'UsabilityRequirement'],
        relevantRelationships: ['performs', 'interactsWith', 'satisfies'],
        group: 'compliance',
        sections: [
            { id: 'use-specification', title: 'Use Specification', required: true },
            { id: 'use-scenarios', title: 'Use Scenarios', required: true },
            { id: 'hazard-related-use', title: 'Hazard-Related Use Scenarios', required: true },
            { id: 'evaluation', title: 'Usability Evaluation', required: false },
        ],
    },
    {
        id: 'cybersecurity',
        title: 'Cybersecurity Documentation',
        standards: ['IEC 81001-5-1:2021'],
        layers: ['software', 'interfaces'],
        relevantKinds: ['ThreatModel', 'SecurityControl', 'Interface', 'SOUPComponent'],
        relevantRelationships: ['mitigates', 'connectedTo', 'dependsOn'],
        group: 'compliance',
        sections: [
            { id: 'threat-model', title: 'Threat Model', required: true },
            { id: 'security-controls', title: 'Security Controls', required: true },
            { id: 'vulnerability-assessment', title: 'Vulnerability Assessment', required: false },
        ],
    },
    {
        id: 'labeling',
        title: 'Labeling Specification',
        standards: ['21 CFR 801', 'MDR Annex I §23'],
        layers: ['requirements', 'ui'],
        relevantKinds: ['LabelingRequirement', 'Requirement'],
        relevantRelationships: ['traceTo', 'satisfies'],
        group: 'compliance',
        sections: [
            { id: 'label-content', title: 'Label Content Requirements', required: true },
            { id: 'ifu', title: 'Instructions for Use', required: true },
            { id: 'udi', title: 'Unique Device Identification', required: false },
        ],
    },
    {
        id: 'dhf-index',
        title: 'Design History File Index',
        standards: ['ISO 13485:2016 §4.2.4', '21 CFR 820.30'],
        layers: [],
        relevantKinds: [],
        relevantRelationships: [],
        group: 'all',
        sections: [
            { id: 'document-list', title: 'Document Inventory', required: true },
            { id: 'status-summary', title: 'Status Summary', required: true },
            { id: 'completeness', title: 'Completeness Overview', required: true },
            { id: 'approvals', title: 'Approval History', required: false },
        ],
    },
    {
        id: 'change-log',
        title: 'Design Change Log',
        standards: ['ISO 13485:2016 §7.3.9'],
        layers: [],
        relevantKinds: [],
        relevantRelationships: [],
        group: 'all',
        sections: [
            { id: 'changes', title: 'Change History', required: true },
            { id: 'impact-assessment', title: 'Impact Assessment', required: false },
            { id: 'approvals', title: 'Change Approvals', required: false },
        ],
    },
];

/** Get a document type by ID */
export function getDocumentType(id: string): DhfDocumentType | undefined {
    return DHF_DOCUMENT_TYPES.find(d => d.id === id);
}

/** Get all document types in a group */
export function getDocumentsByGroup(group: string): DhfDocumentType[] {
    if (group === 'all') return DHF_DOCUMENT_TYPES;
    return DHF_DOCUMENT_TYPES.filter(d => d.group === group || d.group === 'all');
}

/** All document IDs */
export function getAllDocumentIds(): string[] {
    return DHF_DOCUMENT_TYPES.map(d => d.id);
}

// ─── Artifact Kind → DHF Document Lookup (Epic E) ──────────────────────────

const ARTIFACT_KIND_TO_DHF: Record<string, string> = {
    RiskManagementPlan: 'rmp',
    RequirementsSpecification: 'dip',
    SystemArchitectureDescription: 'sad',
    SoftwareDesignDescription: 'sds',
    HazardAnalysisReport: 'har',
    RequirementsTraceabilityMatrix: 'rtm',
    TestProtocol: 'vvp',
    TestReport: 'vvr',
    EvidenceRecord: 'dhf-index',
    CybersecurityAssessmentReport: 'cybersecurity',
    ThreatModelReport: 'cybersecurity',
    UsabilityEngineeringReport: 'uer',
    ClinicalSafetyReport: 'csr',
    FailureModeEffectsAnalysisReport: 'fmea',
    SoupList: 'soup',
    DesignInputPlan: 'dip',
    DesignOutputPlan: 'dop',
    SoftwareDevelopmentPlan: 'sdp',
    LabelingSpecification: 'labeling',
    DesignHistoryFileIndex: 'dhf-index',
    DesignChangeLog: 'change-log',
};

/**
 * Resolve a DHF document type through an artifact kind name from the ontology.
 * Falls back to built-in document types when no artifact kind mapping exists.
 *
 * @param artifactKindOrDocId - Artifact kind name (e.g. "RiskManagementPlan") or document ID (e.g. "rmp")
 * @returns The matching DhfDocumentType, or undefined if no match
 */
export function resolveDocumentType(artifactKindOrDocId: string): DhfDocumentType | undefined {
    const dhfId = ARTIFACT_KIND_TO_DHF[artifactKindOrDocId];
    if (dhfId) return getDocumentType(dhfId);
    return getDocumentType(artifactKindOrDocId);
}
