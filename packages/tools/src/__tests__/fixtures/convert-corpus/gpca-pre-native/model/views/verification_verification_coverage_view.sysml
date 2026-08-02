package memo_examples_gpca_pump_model_views_verification_verification_coverage_view {
    private import ScalarValues::*;

    private import memo_viewpoints_definitions::*;
    private import memo_viewpoints_context_context_viewpoint::*;
    private import memo_viewpoints_operational_operational_viewpoint::*;
    private import memo_viewpoints_functional_functional_viewpoint::*;
    private import memo_viewpoints_logical_logical_viewpoint::*;
    private import memo_viewpoints_software_software_viewpoint::*;
    private import memo_viewpoints_physical_physical_viewpoint::*;
    private import memo_viewpoints_requirements_requirements_viewpoint::*;
    private import memo_viewpoints_risk_risk_viewpoint::*;
    private import memo_viewpoints_verification_verification_viewpoint::*;
    private import memo_core_enumerations::*;

    view gpcaVerificationCoverageView : MemoDiagramView {
        expose memo_examples_gpca_pump_model_views_verification_verification_coverage_view::*;
        attribute depth = 2;
        attribute :>> id = "VIEW-VER-101";
        attribute :>> name = "GPCA_VerificationCoverageView";
        attribute :>> title = "GPCA Verification and Validation Coverage View";
        attribute :>> shortDescription = "Requirements and risk controls against verification cases, validation cases, and evidence.";
        attribute :>> outputKind = (ViewOutputKind::matrix);
        attribute :>> presentationKind = (PresentationKind::traceMatrix);
        attribute :>> viewKind = DiagramViewKind::grid;
        attribute :>> diagramType = "req";
        attribute :>> dataSourceDescription = "VerifiedBy, Validates, and ProducesEvidence links in the GPCA model";
        attribute :>> autoPopulate = true;
        attribute :>> queryDescription = "Include every requirement and risk control with its verification/validation status and produced evidence.";
        attribute :>> documentUsage = ("VV", "DHF", "QMSR");
        part :>> selectionQuery {
            attribute :>> id = "QRY-VER-101";
            attribute :>> name = "GPCA_VerificationCoverageQuery";
            attribute :>> includeElementKinds = ("Requirement", "RiskControlMeasure", "VerificationCase", "ValidationCase", "TestArtifact", "Evidence");
            attribute :>> includeRelationshipKinds = ("VerifiedBy", "Validates", "ProducesEvidence");
            attribute :>> includeLayers = ("requirements", "risk", "assurance");
            attribute :>> selectionExpression = "product == 'GPCA'";
            attribute :>> rationaleText = "Coverage gaps surface as requirements or controls without linked cases or evidence.";
        }
        part :>> viewpointDefinition = verificationViewpoint;
    }
}
