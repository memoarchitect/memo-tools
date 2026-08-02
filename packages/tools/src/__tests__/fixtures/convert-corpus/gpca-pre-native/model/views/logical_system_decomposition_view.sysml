package memo_examples_gpca_pump_model_views_logical_system_decomposition_view {
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

    view gpcaSystemDecompositionView : MemoDiagramView {
        expose memo_examples_gpca_pump_model_views_logical_system_decomposition_view::*;
        attribute depth = 2;
        attribute :>> id = "VIEW-LOG-002";
        attribute :>> name = "GPCA_SystemDecompositionView";
        attribute :>> title = "GPCA System Decomposition View";
        attribute :>> shortDescription = "Nested containment of the GPCA device: hardware assemblies and the software system.";
        attribute :>> longDescription = "General-kind membership structure of the GPCA device per the AADL GPCA_Device.Impl decomposition: sensor and actuator assemblies with their subcomponents, supporting hardware, and the GPCA software system with its eight AADL subcomponents. Rendered through the KK-2 General view template in containment mode (nested blocks with expand/collapse; the tree mode shows the same hierarchy as a decomposition tree).";
        attribute :>> outputKind = (ViewOutputKind::diagram);
        attribute :>> presentationKind = (PresentationKind::blockDiagram);
        attribute :>> viewKind = DiagramViewKind::general;
        attribute :>> diagramType = "bdd";
        attribute :>> layoutHint = "containment";
        attribute :>> dataSourceDescription = "GPCA hardware assemblies, software system, and software components with their Composes hierarchy";
        attribute :>> autoPopulate = true;
        attribute :>> queryDescription = "Include hardware assemblies, the software system, and software components; the Composes topology supplies the nesting.";
        attribute :>> documentUsage = ("SDD", "Architecture Description");
        part :>> selectionQuery {
            attribute :>> id = "QRY-LOG-002";
            attribute :>> name = "GPCA_SystemDecompositionQuery";
            attribute :>> includeElementKinds = ("HardwareAssembly", "SoftwareSystem", "SoftwareModule");
            attribute :>> includeRelationshipKinds = ("Composes");
            attribute :>> includeLayers = ("logical_structure", "software_structure");
            attribute :>> selectionExpression = "product == 'GPCA'";
            attribute :>> rationaleText = "Populate the decomposition from the device structure; composition edges drive the containment nesting.";
        }
        part :>> viewpointDefinition = logicalArchitectureViewpoint;
    }
}
