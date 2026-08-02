package memo_examples_gpca_pump_model_views_behavior_action_flow_view {
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

    view gpcaActionFlowView : MemoDiagramView {
        expose memo_examples_gpca_pump_model_views_behavior_action_flow_view::*;
        attribute depth = 2;
        attribute :>> id = "VIEW-BHV-003";
        attribute :>> name = "GPCA_InfusionDeliveryActionFlowView";
        attribute :>> title = "GPCA Infusion Delivery Action Flow";
        attribute :>> shortDescription = "The 20 ms execution-step pipeline from sensor acquisition through alarm evaluation and dose limiting to pump actuation and event logging.";
        attribute :>> longDescription = "Action flow over the infusionDeliveryFlow composite action: typed action steps with in/out parameters, item flows carrying the DD/CD exchange items, succession ordering from start to done, and swimlane allocation onto the logical architecture (sensors, alarm, infusion manager, pump motor, logging).";
        attribute :>> outputKind = (ViewOutputKind::diagram);
        attribute :>> presentationKind = (PresentationKind::activityDiagram);
        attribute :>> viewKind = DiagramViewKind::actionflow;
        attribute :>> diagramType = "afd";
        attribute :>> dataSourceDescription = "GPCA infusion delivery composite action, item flows, and successions";
        attribute :>> autoPopulate = true;
        attribute :>> queryDescription = "Include the nested action usages of the infusion delivery flow with their flows and successions.";
        attribute :>> documentUsage = ("SDD");
        part :>> selectionQuery {
            attribute :>> id = "QRY-BHV-103";
            attribute :>> name = "GPCA_ActionFlowQuery";
            attribute :>> includeElementKinds = ("ActionUsage");
            attribute :>> selectionExpression = "product == 'GPCA'";
            attribute :>> rationaleText = "Auto-populate the action flow view from the behavior layer's action usages.";
        }
        part :>> viewpointDefinition = logicalArchitectureViewpoint;
    }
}
