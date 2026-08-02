package memo_examples_gpca_pump_model_views_logical_mode_state_view {
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

    view gpcaModeStateView : MemoDiagramView {
        expose memo_examples_gpca_pump_model_views_logical_mode_state_view::*;
        attribute depth = 2;
        attribute :>> id = "VIEW-BHV-001";
        attribute :>> name = "GPCA_ModeStateView";
        attribute :>> title = "GPCA Top-Level Mode State View";
        attribute :>> shortDescription = "The CriSys Fig 4.1 mode hierarchy (OFF, ON, IDLE, THERAPY, PAUSED, ACTIVE, BASAL, SQUARE_BOLUS, PATIENT_BOLUS) and all guarded transitions.";
        attribute :>> longDescription = "Hierarchical state diagram per CriSys §4.1 Fig 4.1: OFF and ON at top level, IDLE and THERAPY under ON, PAUSED (KVO delivery) and ACTIVE under THERAPY, and BASAL / SQUARE_BOLUS (auto-scheduled) / PATIENT_BOLUS under ACTIVE — with the REQ 4-47 transitions, Inhibited_* macro guards, and same-step-critical markings.";
        attribute :>> outputKind = (ViewOutputKind::diagram);
        attribute :>> presentationKind = (PresentationKind::stateDiagram);
        attribute :>> viewKind = DiagramViewKind::statetransition;
        attribute :>> diagramType = "stm";
        attribute :>> dataSourceDescription = "GPCA behavior machine, mode states, and transitions";
        attribute :>> autoPopulate = true;
        attribute :>> queryDescription = "Include the mode machine, the Fig 4.1 mode tree (Composes edges), transitions, and safety properties.";
        attribute :>> documentUsage = ("SDD", "RMF");
        part :>> selectionQuery {
            attribute :>> id = "QRY-BHV-101";
            attribute :>> name = "GPCA_ModeStateQuery";
            attribute :>> includeElementKinds = ("StateMachine", "ModeState", "Transition", "BehaviorProperty", "TimingConstraint");
            attribute :>> includeLayers = ("behavior");
            attribute :>> selectionExpression = "product == 'GPCA'";
            attribute :>> rationaleText = "Auto-populate the mode state view from the behavior layer.";
        }
        part :>> viewpointDefinition = logicalArchitectureViewpoint;
    }
}
