package memo_examples_gpca_pump_model_views_physical_physical_bom_view {
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

    view gpcaPhysicalBomView : MemoDiagramView {
        expose memo_examples_gpca_pump_model_views_physical_physical_bom_view::*;
        attribute depth = 2;
        attribute :>> id = "VIEW-PHY-101";
        attribute :>> name = "GPCA_PhysicalBomView";
        attribute :>> title = "GPCA Physical Architecture and BOM View";
        attribute :>> shortDescription = "Hardware assemblies, processing node, physical ports, and part numbers.";
        attribute :>> outputKind = (ViewOutputKind::table);
        attribute :>> presentationKind = (PresentationKind::blockDiagram);
        attribute :>> viewKind = DiagramViewKind::grid;
        attribute :>> diagramType = "bdd";
        attribute :>> dataSourceDescription = "GPCA hardware assemblies, processing node, and physical ports";
        attribute :>> autoPopulate = true;
        attribute :>> queryDescription = "Include hardware assemblies with part numbers, the MCU node, and external ports.";
        attribute :>> documentUsage = ("Architecture Description", "DHF");
        part :>> selectionQuery {
            attribute :>> id = "QRY-PHY-101";
            attribute :>> name = "GPCA_PhysicalBomQuery";
            attribute :>> includeElementKinds = ("HardwareAssembly", "ProcessingNode", "PhysicalPort", "Interface");
            attribute :>> includeLayers = ("hardware_structure", "physical", "interfaces");
            attribute :>> selectionExpression = "product == 'GPCA'";
            attribute :>> rationaleText = "Auto-populate the physical BOM from the hardware and physical layers.";
        }
        part :>> viewpointDefinition = physicalViewpoint;
    }
}
