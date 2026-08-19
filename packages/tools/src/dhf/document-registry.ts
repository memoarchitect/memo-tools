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
//
// `standards` used to be a hardcoded array on every entry here — the second of
// five places a clause reference lived, and one that disagreed with the others
// (this file said IEC 60812:2018 for the FMEA while the template's frontmatter
// said ISO 14971:2019). It is now DERIVED: a document type names the template
// that carries its content, and the clause references come from that template's
// frontmatter, resolved against the ontology's standards library. Adding a
// standard changes no TypeScript, and the two registries cannot disagree
// because there is only one.
// ─────────────────────────────────────────────────────────────────────────────

import { listBuiltinTemplates } from './template-resolver.js';
import { parseClauseReference, formatClauseReference } from './standards-library.js';

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
    /**
     * Id of the shipped template that carries this document's content, e.g.
     * "iso-14971/rmp". It is where the clause claims are written down; a
     * document type without one derives no standards, which is honest — it has
     * no document to make a claim in.
     */
    template?: string;
    /**
     * Regulatory clause references, e.g. "IEC 62304:2006+AMD1:2015 §5.2".
     * DERIVED from `template`'s frontmatter — never written here.
     */
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

/** A document type as authored: everything except the derived clause list. */
type DhfDocumentTypeDeclaration = Omit<DhfDocumentType, 'standards'>;

/**
 * Clause references a template claims, in citation form.
 *
 * The template's own `standard:` supplies the designation for bare clause
 * numbers; an entry carrying "§" brings its own. A template that names a
 * standard and claims no clause still cites the standard — the claim is at
 * document level, which is coarser but not absent.
 */
function standardsForTemplate(templateId: string | undefined): string[] {
    if (!templateId) return [];
    const template = templateIndex().get(templateId);
    if (!template) return [];

    const designation = template.frontmatter.standard;
    const clauses = template.frontmatter.clauses ?? [];
    if (clauses.length === 0) return designation ? [designation] : [];

    return clauses.map(entry => formatClauseReference(parseClauseReference(entry, designation)));
}

let cachedIndex: Map<string, { frontmatter: { standard?: string; clauses?: string[] } }> | undefined;
function templateIndex(): Map<string, { frontmatter: { standard?: string; clauses?: string[] } }> {
    if (!cachedIndex) {
        cachedIndex = new Map(listBuiltinTemplates().map(t => [t.id, { frontmatter: t.frontmatter }]));
    }
    return cachedIndex;
}

/** The 18 DHF document types for medical device development */
const DHF_DOCUMENT_TYPE_DECLARATIONS: DhfDocumentTypeDeclaration[] = [
    // ─── Risk Management ─────────────────────────────────────────────────
    {
        id: 'rmp',
        title: 'Risk Management Plan',
        template: 'iso-14971/rmp',
        layers: ['risk'],
        relevantKinds: ['Hazard', 'HazardousSituation', 'Harm', 'RiskControlMeasure', 'RiskAcceptabilityCriteria'],
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
        template: 'iso-14971/har',
        layers: ['risk'],
        relevantKinds: ['Hazard', 'HazardousSituation', 'Harm', 'RiskControlMeasure'],
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
        template: 'iso-14971/fmea',
        layers: ['risk', 'functional', 'physical'],
        relevantKinds: ['Hazard', 'RiskControlMeasure', 'Function', 'Component', 'Subsystem'],
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
        template: 'iec-62304/sw-traceability',
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
        template: 'system/sad',
        layers: ['functional', 'logical', 'physical', 'software', 'interfaces'],
        relevantKinds: ['Function', 'Component', 'Subsystem', 'Interface', 'Port', 'SoftwareElement', 'SOUPComponent'],
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
        template: 'iec-62304/detailed-design',
        layers: ['software'],
        relevantKinds: ['SoftwareElement', 'SoftwareUnit', 'SoftwareSystem', 'SOUPComponent', 'Interface'],
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
        template: 'iec-62304/soup',
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
        template: '21cfr820/design-input',
        layers: ['requirements', 'business'],
        relevantKinds: ['DesignInput', 'Requirement', 'Need', 'UseCase'],
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
        template: '21cfr820/design-output',
        layers: ['functional', 'physical', 'software'],
        relevantKinds: ['DesignOutput', 'Component', 'SoftwareElement', 'Function'],
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
        template: '21cfr820/vv-plan',
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
        template: '21cfr820/vv-report',
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
        template: 'iec-62304/sdp',
        layers: ['software', 'verification'],
        relevantKinds: ['SoftwareElement', 'SoftwareUnit', 'SoftwareSystem', 'TestCase'],
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
        // No shipped template claims this document, so it derives no
        // clause references. Adding one is what gives it standards back.
        layers: ['risk', 'verification'],
        relevantKinds: ['Hazard', 'RiskControlMeasure', 'ClinicalEvidence', 'ValidationActivity'],
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
        // No shipped template claims this document, so it derives no
        // clause references. Adding one is what gives it standards back.
        layers: ['ui', 'requirements'],
        relevantKinds: ['UseCase', 'UserActivity', 'UserInterface', 'UsabilityRequirement'],
        relevantRelationships: ['performs', 'connect', 'satisfies'],
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
        // No shipped template claims this document, so it derives no
        // clause references. Adding one is what gives it standards back.
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
        // No shipped template claims this document, so it derives no
        // clause references. Adding one is what gives it standards back.
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
        template: '21cfr820/dhf-index',
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
        template: '21cfr820/change-record',
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

/**
 * The registered document types, each with its clause references filled in
 * from its template. Derivation happens once, at load: the templates are
 * shipped content that cannot change under a running process.
 */
export const DHF_DOCUMENT_TYPES: DhfDocumentType[] = DHF_DOCUMENT_TYPE_DECLARATIONS.map(d => ({
    ...d,
    standards: standardsForTemplate(d.template),
}));

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
