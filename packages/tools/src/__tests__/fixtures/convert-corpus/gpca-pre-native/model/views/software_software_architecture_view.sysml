package memo_examples_gpca_pump_model_views_software_software_architecture_view {
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

    view gpcaSoftwareArchitectureView : MemoDiagramView {
        expose memo_examples_gpca_pump_model_views_software_software_architecture_view::*;
        attribute depth = 2;
        attribute :>> id = "VIEW-SW-101";
        attribute :>> name = "GPCA_SoftwareArchitectureView";
        attribute :>> title = "GPCA Software Architecture View";
        attribute :>> shortDescription = "The eight AADL GPCA_SW.Impl subcomponents, top-level ports, and the full inter-component connection topology.";
        attribute :>> longDescription = "Top_Level_Mode, System_Status, Alarm, Config, Infusion_Manager, System_Monitor, Logging, and OutputBus inside the GPCA_Software system, wired per GPCA_SW.Impl with the seven top-level ports (OP_CMD_IN, PRES_IN, PATIENT_IN, SENSOR_IN, CONST_IN, DB_IN, GPCA_SW_OUT). Connections are synchronous with AADL immediate port semantics.";
        attribute :>> outputKind = (ViewOutputKind::diagram);
        attribute :>> presentationKind = (PresentationKind::internalDiagram);
        attribute :>> viewKind = DiagramViewKind::interconnection;
        attribute :>> diagramType = "ibd";
        attribute :>> dataSourceDescription = "GPCA software structure, top-level ports, and the GPCA_SW.Impl connection set (CE-101..CE-142)";
        attribute :>> autoPopulate = true;
        attribute :>> queryDescription = "Include the software system, its eight components, its boundary ports, and the ExchangesWith topology between them.";
        attribute :>> documentUsage = ("SDD", "QMSR");
        part :>> selectionQuery {
            attribute :>> id = "QRY-SW-101";
            attribute :>> name = "GPCA_SoftwareArchitectureQuery";
            attribute :>> includeElementKinds = ("SoftwareSystem", "SoftwareModule", "SoftwarePort");
            attribute :>> includeRelationshipKinds = ("ExchangesWith", "Composes");
            attribute :>> includeLayers = ("software_structure", "interfaces");
            attribute :>> selectionExpression = "product == 'GPCA'";
            attribute :>> rationaleText = "Render the real GPCA_SW.Impl topology: components and boundary ports as nodes, AADL connections as edges.";
        }
        part :>> viewpointDefinition = softwareViewpoint;
    }
}
