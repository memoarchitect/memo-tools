package memo_examples_gpca_pump_model_views_document_vv_view {
    private import ScalarValues::*;

    private import memo_viewpoints_definitions::*;
    private import memo_viewpoints_verification_verification_viewpoint::*;
    private import memo_core_enumerations::*;

    view vvView : MemoDocumentView {
        expose memo_examples_gpca_pump_model_views_document_vv_view::*;
        attribute :>> id = "DOC-006";
        attribute :>> name = "VerificationValidationView";
        attribute :>> title = "GPCA Verification and Validation View";
        attribute :>> shortDescription = "V&V plan and coverage for requirements and risk controls.";
        attribute :>> longDescription = "Aggregates verification cases, validation cases, test artifacts, and evidence with their coverage of requirements, risk controls, behavior properties, and timing constraints.";
        attribute :>> version = "0.1";
        attribute :>> lifecycleState = LifecycleStateKind::development;
        attribute :>> viewKind = DocumentViewKind::VV;
        attribute :>> generationRule = "Include all VerifiedBy, Validates, and ProducesEvidence chains with status";
        attribute :>> marketScope = "generic";
        attribute :>> documentUsage = ("VV", "DHF", "QMSR");
        attribute :>> sectionIdentifier = "VV";
        part :>> viewpointDefinition = verificationViewpoint;
        part :>> selectionQuery {
            attribute :>> id = "QRY-DOC-006";
            attribute :>> name = "vvViewQuery";
            attribute :>> includeElementKinds = ("VerificationCase", "ValidationCase", "TestArtifact", "Evidence", "Requirement", "RiskControlMeasure");
            attribute :>> includeRelationshipKinds = ("VerifiedBy", "Validates", "TestedByUsability", "ProducesEvidence", "IncludedIn");
            attribute :>> rationaleText = "Declares what this document-backed view renders; the web renderer is presentation-only.";
        }
    }
}
