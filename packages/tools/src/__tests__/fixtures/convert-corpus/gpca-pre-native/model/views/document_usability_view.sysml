package memo_examples_gpca_pump_model_views_document_usability_view {
    private import ScalarValues::*;

    private import memo_viewpoints_definitions::*;
    private import memo_viewpoints_usability_usability_engineering_view::*;
    private import memo_viewpoints_usability_usability_viewpoint::*;
    private import memo_core_enumerations::*;

    view usabilityView : MemoUsabilityEngineeringView {
        expose memo_examples_gpca_pump_model_views_document_usability_view::*;
        attribute :>> id = "DOC-008";
        attribute :>> name = "UsabilityEngineeringFileView";
        attribute :>> title = "GPCA Usability Engineering File View";
        attribute :>> shortDescription = "IEC 62366-1 usability engineering file content for GPCA.";
        attribute :>> longDescription = "Aggregates intended use, use contexts, actors, foreseeable use errors, related risk chains, usability requirements, and the summative usability validation case.";
        attribute :>> version = "0.1";
        attribute :>> lifecycleState = LifecycleStateKind::development;
        attribute :>> marketScope = "generic";
        attribute :>> documentUsage = ("Usability Engineering File", "DHF");
        attribute :>> sectionIdentifier = "UEF";
        part :>> viewpointDefinition = usabilityViewpoint;
        part :>> selectionQuery {
            attribute :>> id = "QRY-DOC-002";
            attribute :>> name = "usabilityViewQuery";
            attribute :>> includeElementKinds = ("UseError", "UseContext", "Actor", "ValidationCase", "OperativeScenario", "IntendedUse", "ReasonablyForeseeableMisuse");
            attribute :>> includeRelationshipKinds = ("TestedByUsability", "RealizedByScenario", "InteractsWith", "IncludedIn");
            attribute :>> rationaleText = "Declares what this document-backed view renders; the web renderer is presentation-only.";
        }
    }
}
