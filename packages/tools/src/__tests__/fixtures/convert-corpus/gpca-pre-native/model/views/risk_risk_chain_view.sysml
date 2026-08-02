package memo_examples_gpca_pump_model_views_risk_risk_chain_view {
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

    view gpcaRiskChainView : MemoDiagramView {
        expose memo_examples_gpca_pump_model_views_risk_risk_chain_view::*;
        attribute depth = 2;
        attribute :>> id = "VIEW-RISK-101";
        attribute :>> name = "GPCA_RiskChainView";
        attribute :>> title = "GPCA Risk Mitigation Chain View";
        attribute :>> shortDescription = "All seven hazard causal trees from categorized cause through harm with controls and residual risk.";
        attribute :>> longDescription = "Opioid over-infusion, under-infusion, air embolism, misprogramming, free-flow, reverse-delivery, and VTBI over-infusion causal trees (GIIP cause-source structure): categorized causes converging on each hazard, sequences of events, hazardous situations, harms, risk estimates, controls, and residual evaluations.";
        attribute :>> outputKind = (ViewOutputKind::diagram);
        attribute :>> presentationKind = (PresentationKind::blockDiagram);
        attribute :>> viewKind = DiagramViewKind::general;
        attribute :>> diagramType = "risk";
        attribute :>> dataSourceDescription = "GPCA risk layer and TracesRisk/MitigatesHazard links";
        attribute :>> autoPopulate = true;
        attribute :>> queryDescription = "Include hazards, sequences, situations, harms, risks before/after, controls, and residual evaluation.";
        attribute :>> documentUsage = ("RMF", "Hazard Analysis Report", "QMSR");
        part :>> selectionQuery {
            attribute :>> id = "QRY-RISK-101";
            attribute :>> name = "GPCA_RiskChainQuery";
            attribute :>> includeElementKinds = ("SafetyRelatedCharacteristic", "Hazard", "HazardCause", "SequenceOfEvents", "HazardousSituation", "Harm", "Risk", "RiskControlMeasure", "ResidualRisk", "Benefit", "OverallResidualRiskEvaluation");
            attribute :>> includeRelationshipKinds = ("TracesRisk", "Mitigates", "Causes", "Mitigates");
            attribute :>> includeLayers = ("risk", "assurance");
            attribute :>> includeConcerns = (ConcernKind::safety);
            attribute :>> selectionExpression = "product == 'GPCA'";
            attribute :>> rationaleText = "Auto-populate the risk chain diagram from the risk layer.";
        }
        part :>> viewpointDefinition = riskViewpoint;
    }
}
