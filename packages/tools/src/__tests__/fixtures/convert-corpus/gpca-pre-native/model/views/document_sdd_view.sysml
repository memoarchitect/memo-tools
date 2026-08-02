package memo_examples_gpca_pump_model_views_document_sdd_view {
    private import ScalarValues::*;

    private import memo_viewpoints_definitions::*;
    private import memo_viewpoints_software_software_viewpoint::*;
    private import memo_core_enumerations::*;

    view sddView : MemoDocumentView {
        expose memo_examples_gpca_pump_model_views_document_sdd_view::*;
        attribute :>> id = "DOC-004";
        attribute :>> name = "SoftwareDesignDescriptionView";
        attribute :>> title = "GPCA Software Design Description View";
        attribute :>> shortDescription = "IEC 62304 software design description for the GPCA software system.";
        attribute :>> longDescription = "Aggregates the software system, its six components with safety classes and scheduling attributes, mode machine and transitions, interfaces, and function allocations for the SDD.";
        attribute :>> version = "0.1";
        attribute :>> lifecycleState = LifecycleStateKind::development;
        attribute :>> viewKind = DocumentViewKind::SDD;
        attribute :>> generationRule = "Include software structure, behavior machine with transitions, software interfaces, allocations, and timing constraints";
        attribute :>> marketScope = "generic";
        attribute :>> documentUsage = ("SDD", "QMSR");
        attribute :>> sectionIdentifier = "SDD";
        part :>> viewpointDefinition = softwareViewpoint;
        part :>> selectionQuery {
            attribute :>> id = "QRY-DOC-004";
            attribute :>> name = "sddViewQuery";
            attribute :>> includeElementKinds = ("SoftwareSystem", "SoftwareModule", "ModeState", "Transition", "Interface", "SystemFunction", "TimingConstraint", "SoftwareModule[moduleKind=soup]");
            attribute :>> includeRelationshipKinds = ("Composes", "AllocatedTo", "BindsToInterface", "Realizes", "DependsOnSoup", "Changes");
            attribute :>> rationaleText = "Declares what this document-backed view renders; the web renderer is presentation-only.";
        }
    }
}
