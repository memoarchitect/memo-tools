package memo_examples_gpca_pump_model_views_document_dhf_index_view {
    private import ScalarValues::*;

    private import memo_viewpoints_definitions::*;
    private import memo_viewpoints_requirements_requirements_viewpoint::*;
    private import memo_viewpoints_risk_risk_viewpoint::*;
    private import memo_viewpoints_verification_verification_viewpoint::*;
    private import memo_core_enumerations::*;

    view dhfIndexView : MemoDocumentView {
        expose memo_examples_gpca_pump_model_views_document_dhf_index_view::*;
        attribute :>> id = "DOC-007";
        attribute :>> name = "DesignHistoryFileIndexView";
        attribute :>> title = "GPCA Design History File Index View";
        attribute :>> shortDescription = "Index of design inputs, outputs, reviews, and V&V records for the DHF.";
        attribute :>> longDescription = "Collects the document-backed views (requirements, architecture, SDD, RMF, VV, usability, cybersecurity) into the design history file index required by 21 CFR 820.30(j).";
        attribute :>> version = "0.1";
        attribute :>> lifecycleState = LifecycleStateKind::development;
        attribute :>> viewKind = DocumentViewKind::DHF;
        attribute :>> generationRule = "Index every document-backed view with version and lifecycle state";
        attribute :>> marketScope = "generic";
        attribute :>> documentUsage = ("DHF");
        attribute :>> sectionIdentifier = "DHF";
        part :>> viewpointDefinition = requirementsViewpoint;
        part :>> viewpointDefinition = riskViewpoint;
        part :>> viewpointDefinition = verificationViewpoint;
        part :>> selectionQuery {
            attribute :>> id = "QRY-DOC-007";
            attribute :>> name = "dhfIndexViewQuery";
            attribute :>> includeElementKinds = ("MemoDocumentView", "MemoDiagramView", "MemoUsabilityEngineeringView", "MemoCybersecurityThreatModelView", "MemoCybersecurityAssessmentView", "Evidence", "Citation");
            attribute :>> includeRelationshipKinds = ("IncludedIn", "ProducesEvidence");
            attribute :>> rationaleText = "Declares what this document-backed view renders; the web renderer is presentation-only.";
        }
    }
}
