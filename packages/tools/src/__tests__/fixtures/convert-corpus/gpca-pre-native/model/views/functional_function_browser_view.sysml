package memo_examples_gpca_pump_model_views_functional_function_browser_view {
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

    view gpcaFunctionBrowserView : MemoDiagramView {
        expose memo_examples_gpca_pump_model_views_functional_function_browser_view::*;
        attribute depth = 2;
        attribute :>> id = "VIEW-FUN-103";
        attribute :>> name = "GPCA_FunctionBrowserView";
        attribute :>> title = "GPCA Function Browser";
        attribute :>> shortDescription = "Membership tree over the functions layer: logical functions, flows, and the exchange item definitions, grouped by kind.";
        attribute :>> longDescription = "Browser view (SysML v2 browser view kind) exposing the functions-layer membership hierarchy as a first-class view: the eleven logical functions, the logical flows connecting them, and the data/control definitions they exchange — with kind icons, expand/collapse, and filtering.";
        attribute :>> outputKind = (ViewOutputKind::diagram);
        attribute :>> presentationKind = (PresentationKind::blockDiagram);
        attribute :>> viewKind = DiagramViewKind::browser;
        attribute :>> dataSourceDescription = "GPCA logical functions, flows, and exchange item definitions";
        attribute :>> autoPopulate = true;
        attribute :>> queryDescription = "Include the functions layer's functions, flows, and exchange item definitions.";
        attribute :>> documentUsage = ("SDD");
        part :>> selectionQuery {
            attribute :>> id = "QRY-FUN-103";
            attribute :>> name = "GPCA_FunctionBrowserQuery";
            attribute :>> includeElementKinds = ("SystemFunction", "FunctionalExchange", "InterfaceItem");
            attribute :>> includeLayers = ("functions");
            attribute :>> selectionExpression = "product == 'GPCA'";
            attribute :>> rationaleText = "Auto-populate the function browser from the functions layer.";
        }
        part :>> viewpointDefinition = functionalViewpoint;
    }
}
