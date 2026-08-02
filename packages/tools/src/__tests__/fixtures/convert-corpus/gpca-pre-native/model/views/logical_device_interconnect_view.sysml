package memo_examples_gpca_pump_model_views_logical_device_interconnect_view {
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

    view gpcaDeviceInterconnectView : MemoDiagramView {
        expose memo_examples_gpca_pump_model_views_logical_device_interconnect_view::*;
        attribute depth = 2;
        attribute :>> id = "VIEW-LOG-003";
        attribute :>> name = "GPCA_DeviceInterconnectView";
        attribute :>> title = "GPCA Device Interconnect View";
        attribute :>> shortDescription = "AADL device-level interconnection: GPCA_HW_Sensors, GPCA_SW, and GPCA_HW_Actuators with their declared boundary features.";
        attribute :>> longDescription = "Source-faithful interconnection view of GPCA_Device.Impl: exactly the three AADL subcomponents (GPCA_HW_Sensors, GPCA_SW, GPCA_HW_Actuators), the device and subsystem boundary ports, and the twelve declared port connections. MEMO physical-design additions such as the controller board, power sources, enclosure, and individual sensors/actuators are intentionally excluded because the published AADL v2.0 model does not declare them as GPCA_Device.Impl subcomponents. Drill into GPCA_SW to inspect its eight subcomponents and 42 internal connections; use the connection-density control to switch between bundled summary and full fidelity.";
        attribute :>> outputKind = (ViewOutputKind::diagram);
        attribute :>> presentationKind = (PresentationKind::internalDiagram);
        attribute :>> viewKind = DiagramViewKind::interconnection;
        attribute :>> diagramType = "ibd";
        attribute :>> dataSourceDescription = "GPCA hardware assemblies, software system, software components, boundary ports, and the ExchangesWith/Composes topology";
        attribute :>> autoPopulate = true;
        attribute :>> queryDescription = "Include hardware assemblies, the software system with its components and boundary ports, and the exchange topology between them.";
        attribute :>> documentUsage = ("SDD", "Architecture Description", "QMSR");
        part :>> selectionQuery {
            attribute :>> id = "QRY-LOG-003";
            attribute :>> name = "GPCA_DeviceInterconnectQuery";
            attribute :>> includeElementIds = ("gpcaDevice", "gpcaDeviceSensors", "gpcaSoftware", "gpcaActuators", "devOpCmdIn", "devDbIn", "devPresIn", "devPatientIn", "devGpcaOut", "snsOpCmdIn", "snsDbIn", "snsPresIn", "snsPatientIn", "snsOpCmdOut", "snsPresOut", "snsPatientOut", "snsSensorOut", "snsConstOut", "snsDbOut", "portOpCmdIn", "portPresIn", "portPatientIn", "portSensorIn", "portConstIn", "portDbIn", "portGpcaSwOut", "actGpcaSwIn", "actGpcaOut", "tlm", "systemStatus", "alarm", "config", "infusionMgr", "systemMonitor", "logging", "outputBus");
            attribute :>> includeRelationshipKinds = ("ExchangesWith", "Composes");
            attribute :>> includeLayers = ("logical_structure", "software_structure", "interfaces");
            attribute :>> selectionExpression = "product == 'GPCA'";
            attribute :>> rationaleText = "Render the device interconnect: parts with boundary ports as nodes, AADL connections as typed connectors, composition as nesting.";
        }
        part :>> viewpointDefinition = logicalArchitectureViewpoint;
    }
}
