package memo_examples_gpca_pump_model_views_requirements_requirements_trace_view {
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

    view gpcaRequirementsTraceView : MemoDiagramView {
        expose memo_examples_gpca_pump_model_views_requirements_requirements_trace_view::*;
        attribute depth = 2;
        attribute :>> id = "VIEW-REQ-101";
        attribute :>> name = "GPCA_RequirementsTraceabilityView";
        attribute :>> title = "GPCA Requirements Traceability View";
        attribute :>> shortDescription = "Needs to system/software/hardware requirements to satisfying components and verification.";
        attribute :>> outputKind = (ViewOutputKind::matrix);
        attribute :>> presentationKind = (PresentationKind::traceMatrix);
        attribute :>> viewKind = DiagramViewKind::grid;
        attribute :>> diagramType = "req";
        attribute :>> dataSourceDescription = "GPCA requirements with DerivesFrom, SatisfiedBy, and VerifiedBy links";
        attribute :>> autoPopulate = true;
        attribute :>> queryDescription = "Include all needs and requirements with derivation, satisfaction, and verification links.";
        attribute :>> documentUsage = ("Requirements Traceability Matrix", "DHF", "QMSR");
        part :>> selectionQuery {
            attribute :>> id = "QRY-REQ-101";
            attribute :>> name = "GPCA_RequirementsTraceQuery";
            attribute :>> includeElementKinds = ("Need", "Requirement", "VerificationCase");
            attribute :>> includeRelationshipKinds = ("DerivesFrom", "SatisfiedBy", "VerifiedBy");
            attribute :>> includeLayers = ("requirements", "assurance");
            attribute :>> selectionExpression = "product == 'GPCA'";
            attribute :>> rationaleText = "Full derivation-to-verification traceability for design reviews.";
        }
        part :>> viewpointDefinition = requirementsViewpoint;
    }
}
