package memo_examples_gpca_pump_model_views_operational_use_case_view {
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

    view gpcaUseCaseView : MemoDiagramView {
        expose memo_examples_gpca_pump_model_views_operational_use_case_view::*;
        attribute depth = 2;
        attribute :>> id = "VIEW-OPS-101";
        attribute :>> name = "GPCA_UseCaseView";
        attribute :>> title = "GPCA Use Case View";
        attribute :>> shortDescription = "Actors connected to the patient-controlled analgesia use case.";
        attribute :>> longDescription = "Connects the nurse, patient, prescriber, and pharmacist to the patient-controlled analgesia use case.";
        attribute :>> outputKind = (ViewOutputKind::diagram);
        attribute :>> presentationKind = (PresentationKind::custom);
        attribute :>> viewKind = DiagramViewKind::general;
        attribute :>> diagramType = "ucd";
        attribute :>> dataSourceDescription = "GPCA use case and participating context actors";
        attribute :>> autoPopulate = true;
        attribute :>> queryDescription = "Include actors, use cases, and their participation relationships.";
        attribute :>> documentUsage = ("Usability Engineering File", "Architecture Description");
        part :>> selectionQuery {
            attribute :>> id = "QRY-OPS-101";
            attribute :>> name = "GPCA_UseCaseQuery";
            attribute :>> includeElementKinds = ("Actor", "User", "UseCase");
            attribute :>> includeRelationshipKinds = ("Initiates", "ParticipatesIn");
            attribute :>> includeLayers = ("context", "operational");
            attribute :>> selectionExpression = "product == 'GPCA'";
            attribute :>> rationaleText = "Auto-populate the GPCA use case view from the operational layer.";
        }
        part :>> viewpointDefinition = operationalViewpoint;
    }
}
