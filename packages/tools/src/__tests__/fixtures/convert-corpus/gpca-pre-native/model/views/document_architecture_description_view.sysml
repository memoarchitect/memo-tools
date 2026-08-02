package memo_examples_gpca_pump_model_views_document_architecture_description_view {
    private import ScalarValues::*;

    private import memo_viewpoints_definitions::*;
    private import memo_viewpoints_logical_logical_viewpoint::*;
    private import memo_viewpoints_software_software_viewpoint::*;
    private import memo_viewpoints_physical_physical_viewpoint::*;
    private import memo_core_enumerations::*;

    view architectureDescriptionView : MemoDocumentView {
        expose memo_examples_gpca_pump_model_views_document_architecture_description_view::*;
        attribute :>> id = "DOC-005";
        attribute :>> name = "ArchitectureDescriptionView";
        attribute :>> title = "GPCA System Architecture Description View";
        attribute :>> shortDescription = "ISO/IEC/IEEE 42010 architecture description across all layers.";
        attribute :>> longDescription = "Aggregates context, operational, functional, logical, software, and physical layers with their views and correspondences for the system architecture description.";
        attribute :>> version = "0.1";
        attribute :>> lifecycleState = LifecycleStateKind::development;
        attribute :>> viewKind = DocumentViewKind::architectureDescription;
        attribute :>> generationRule = "Include all architecture layers, functional chains, interfaces, and the physical BOM with cross-layer allocations";
        attribute :>> marketScope = "generic";
        attribute :>> documentUsage = ("Architecture Description", "DHF");
        attribute :>> sectionIdentifier = "AD";
        part :>> viewpointDefinition = logicalArchitectureViewpoint;
        part :>> viewpointDefinition = softwareViewpoint;
        part :>> viewpointDefinition = physicalViewpoint;
        part :>> selectionQuery {
            attribute :>> id = "QRY-DOC-005";
            attribute :>> name = "architectureDescriptionViewQuery";
            attribute :>> includeElementKinds = ("LogicalComponent", "SystemFunction", "ComponentExchange", "SoftwareSystem", "SoftwareModule", "HardwareAssembly", "ProcessingNode", "PhysicalPort", "FunctionalFlow", "FunctionalFlowStep");
            attribute :>> includeRelationshipKinds = ("Composes", "AllocatedTo", "Realizes", "BindsToInterface", "InvolvesFunction", "Precedes", "DeploysTo", "HostedBy");
            attribute :>> rationaleText = "Declares what this document-backed view renders; the web renderer is presentation-only.";
        }
    }
}
