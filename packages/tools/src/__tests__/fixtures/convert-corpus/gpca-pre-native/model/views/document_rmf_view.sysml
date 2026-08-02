package memo_examples_gpca_pump_model_views_document_rmf_view {
    private import ScalarValues::*;

    private import memo_viewpoints_definitions::*;
    private import memo_viewpoints_risk_risk_viewpoint::*;
    private import memo_core_enumerations::*;

    view rmfView : MemoDocumentView {
        expose memo_examples_gpca_pump_model_views_document_rmf_view::*;
        attribute :>> id = "DOC-001";
        attribute :>> name = "RiskManagementFileView";
        attribute :>> title = "GPCA Risk Management File View";
        attribute :>> shortDescription = "Document-backed risk view for GPCA.";
        attribute :>> longDescription = "Aggregates the risk chain, controls, verification, residual risk, and cybersecurity links needed for the GPCA risk management file.";
        attribute :>> version = "0.2";
        attribute :>> lifecycleState = LifecycleStateKind::development;
        attribute :>> viewKind = DocumentViewKind::RMF;
        attribute :>> generationRule = "Include risk chain, controls, verification, residual risk, and cybersecurity traceability";
        attribute :>> marketScope = "generic";
        attribute :>> documentUsage = ("RMF", "QMSR");
        attribute :>> sectionIdentifier = "RMF";
        part :>> viewpointDefinition = riskViewpoint;
        part :>> selectionQuery {
            attribute :>> id = "QRY-DOC-001";
            attribute :>> name = "rmfViewQuery";
            attribute :>> includeElementKinds = ("IntendedUse", "ReasonablyForeseeableMisuse", "SafetyRelatedCharacteristic", "Hazard", "HazardCause", "SequenceOfEvents", "HazardousSituation", "Harm", "Risk", "RiskControlMeasure", "ResidualRisk", "Benefit", "OverallResidualRiskEvaluation", "VerificationCase", "Evidence");
            attribute :>> includeRelationshipKinds = ("Causes", "Mitigates", "Mitigates", "TracesRisk", "AssessedAgainst", "VerifiedBy", "ProducesEvidence", "IncludedIn");
            attribute :>> rationaleText = "Declares what this document-backed view renders; the web renderer is presentation-only.";
        }
    }
}
