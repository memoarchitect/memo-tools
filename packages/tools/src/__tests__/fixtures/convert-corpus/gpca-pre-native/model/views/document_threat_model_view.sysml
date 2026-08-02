package memo_examples_gpca_pump_model_views_document_threat_model_view {
    private import ScalarValues::*;

    private import memo_viewpoints_definitions::*;
    private import memo_viewpoints_cybersecurity_threat_model_view::*;
    private import memo_viewpoints_cybersecurity_cybersecurity_viewpoint::*;
    private import memo_core_enumerations::*;

    view threatModelView : MemoCybersecurityThreatModelView {
        expose memo_examples_gpca_pump_model_views_document_threat_model_view::*;
        attribute :>> id = "DOC-002";
        attribute :>> name = "GPCACyberThreatModelView";
        attribute :>> title = "GPCA Cybersecurity Threat Model View";
        attribute :>> shortDescription = "Threat-model-oriented document view for GPCA.";
        attribute :>> longDescription = "Captures GPCA cyber assets, trust boundaries, threats, threat scenarios, vulnerabilities, and mitigations for secure product development records.";
        attribute :>> version = "0.1";
        attribute :>> lifecycleState = LifecycleStateKind::development;
        attribute :>> marketScope = "generic";
        attribute :>> documentUsage = ("Threat Model", "QMSR");
        attribute :>> sectionIdentifier = "CYB-TM";
        part :>> viewpointDefinition = cybersecurityViewpoint;
        part :>> selectionQuery {
            attribute :>> id = "QRY-DOC-008";
            attribute :>> name = "threatModelViewQuery";
            attribute :>> includeElementKinds = ("Threat", "ThreatScenario", "Vulnerability", "CybersecurityAsset", "TrustBoundary", "AttackSurface", "CyberMitigation", "SecurityRequirement");
            attribute :>> includeRelationshipKinds = ("ThreatenedBy", "Exploits", "RealizedByScenario", "CrossesTrustBoundary", "Mitigates", "DerivesCyberRequirement");
            attribute :>> rationaleText = "Declares what this document-backed view renders; the web renderer is presentation-only.";
        }
    }
}
