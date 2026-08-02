package memo_examples_gpca_pump_model_views_cybersecurity_cybersecurity_view {
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
    private import memo_viewpoints_cybersecurity_cybersecurity_viewpoint::*;
    private import memo_core_enumerations::*;

    view gpcaCybersecurityView : MemoDiagramView {
        expose memo_examples_gpca_pump_model_views_cybersecurity_cybersecurity_view::*;
        attribute depth = 2;
        attribute :>> id = "VIEW-CYB-001";
        attribute :>> name = "GPCA_CybersecurityView";
        attribute :>> title = "GPCA Cybersecurity View";
        attribute :>> shortDescription = "Shows GPCA assets, trust boundaries, threats, vulnerabilities, and mitigations.";
        attribute :>> longDescription = "Product-specific cybersecurity view intended for secure product development and cross-reference into cybersecurity risk documentation.";
        attribute :>> outputKind = (ViewOutputKind::diagram);
        attribute :>> presentationKind = (PresentationKind::custom);
        attribute :>> viewKind = DiagramViewKind::general;
        attribute :>> diagramType = "threat-model";
        attribute :>> dataSourceDescription = "GPCA cyber assets, threat scenarios, and trace links";
        attribute :>> autoPopulate = true;
        attribute :>> queryDescription = "Include cyber assets, trust boundaries, threats, vulnerabilities, cyber hazards, cyber risks, mitigations, security requirements, and verification.";
        attribute :>> documentUsage = ("Threat Model", "Cybersecurity Risk Assessment", "QMSR");
        part :>> selectionQuery {
            attribute :>> id = "QRY-CYB-001";
            attribute :>> name = "GPCA_CybersecurityQuery";
            attribute :>> includeElementKinds = ("CybersecurityAsset", "Threat", "Vulnerability", "CyberHazard", "CyberRisk", "CyberMitigation", "SecurityRequirement", "TrustBoundary", "ThreatScenario");
            attribute :>> includeLayers = ("cybersecurity", "risk", "assurance");
            attribute :>> includeConcerns = (ConcernKind::cybersecurity, ConcernKind::privacy, ConcernKind::safety);
            attribute :>> selectionExpression = "product == 'GPCA'";
            attribute :>> rationaleText = "Auto-populate the GPCA cybersecurity view from the cyber layer and cross-layer trace model.";
        }
        part :>> viewpointDefinition = cybersecurityViewpoint;
    }
}
