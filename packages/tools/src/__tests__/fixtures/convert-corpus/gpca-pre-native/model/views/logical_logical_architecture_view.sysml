package memo_examples_gpca_pump_model_views_logical_logical_architecture_view {
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

    view gpcaLogicalArchitectureView : MemoDiagramView {
        expose memo_examples_gpca_pump_model_views_logical_logical_architecture_view::*;
        attribute depth = 2;
        attribute :>> id = "VIEW-LOG-001";
        attribute :>> name = "GPCA_LogicalArchitectureView";
        attribute :>> title = "GPCA Logical Architecture View";
        attribute :>> shortDescription = "Logical decomposition of the GPCA system.";
        attribute :>> longDescription = "Product-specific logical architecture view that references the default logical architecture viewpoint and is intended for design description and architecture communication.";
        attribute :>> outputKind = (ViewOutputKind::diagram);
        attribute :>> presentationKind = (PresentationKind::blockDiagram);
        attribute :>> viewKind = DiagramViewKind::general;
        attribute :>> diagramType = "bdd";
        attribute :>> dataSourceDescription = "GPCA architecture and interface model elements";
        attribute :>> autoPopulate = true;
        attribute :>> queryDescription = "Include GPCA logical components and key interfaces relevant to therapy control.";
        attribute :>> documentUsage = ("SDD", "Architecture Description", "QMSR");
        part :>> selectionQuery {
            attribute :>> id = "QRY-LOG-001";
            attribute :>> name = "GPCA_LogicalArchitectureQuery";
            attribute :>> includeElementKinds = ("LogicalComponent", "Interface", "Function");
            attribute :>> includeLayers = ("functions", "logical_structure", "interfaces");
            attribute :>> selectionExpression = "product == 'GPCA' and concern contains therapy control";
            attribute :>> rationaleText = "Auto-populate the GPCA logical architecture view from the core product model.";
        }
        part :>> viewpointDefinition = logicalArchitectureViewpoint;
    }
}
