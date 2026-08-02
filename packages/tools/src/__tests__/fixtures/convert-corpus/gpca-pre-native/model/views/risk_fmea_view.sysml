package memo_examples_gpca_pump_model_views_risk_fmea_view {
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

    view gpcaFmeaView : MemoDiagramView {
        expose memo_examples_gpca_pump_model_views_risk_fmea_view::*;
        attribute depth = 2;
        attribute :>> id = "VIEW-RISK-102";
        attribute :>> name = "GPCA_FmeaView";
        attribute :>> title = "GPCA FMEA and Fault Tree View";
        attribute :>> shortDescription = "Failure modes with causes, effects, detection, RPN, and the overdose fault tree.";
        attribute :>> outputKind = (ViewOutputKind::table);
        attribute :>> presentationKind = (PresentationKind::riskTable);
        attribute :>> viewKind = DiagramViewKind::grid;
        attribute :>> diagramType = "fmea";
        attribute :>> dataSourceDescription = "GPCA FMEA worksheet, failure modes, fault tree events, gates, and cut sets";
        attribute :>> autoPopulate = true;
        attribute :>> queryDescription = "Include FMEA worksheet rows and the overdose fault tree structure.";
        attribute :>> documentUsage = ("FMEA", "RMF");
        part :>> selectionQuery {
            attribute :>> id = "QRY-RISK-102";
            attribute :>> name = "GPCA_FmeaQuery";
            attribute :>> includeElementKinds = ("FMEAWorksheet", "FailureMode", "FailureEffect", "FailureCause", "DetectionMethod", "FMEAAction", "FaultTree", "FaultTreeEvent", "FaultTreeGate", "MinimalCutSet");
            attribute :>> includeLayers = ("analysis", "risk");
            attribute :>> includeConcerns = (ConcernKind::safety, ConcernKind::reliability);
            attribute :>> selectionExpression = "product == 'GPCA'";
            attribute :>> rationaleText = "Auto-populate the FMEA/FTA view from the analysis layer.";
        }
        part :>> viewpointDefinition = riskViewpoint;
    }
}
