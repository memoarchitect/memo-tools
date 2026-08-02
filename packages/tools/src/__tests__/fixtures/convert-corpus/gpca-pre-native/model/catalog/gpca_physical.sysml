package memo_examples_gpca_pump_model_catalog_gpca_physical {
    private import ScalarValues::*;

    private import memo_architecture_realization_physical::*;
    private import memo_core_enumerations::*;

    part mainController : ProcessingNode {
        attribute :>> id = "PN-001";
        attribute :>> name = "MainControllerMCU";
        attribute :>> nodeKind = ProcessingNodeKind::microcontroller;
        attribute :>> processorArchitecture = "ARM Cortex-M4, lockstep-capable";
        attribute :>> memoryMB = "1 MB flash / 256 KB SRAM with ECC";
        attribute :>> operatingSystem = "bare-metal cyclic executive, 20 ms base step";
        attribute :>> safetyPartition = true;
        attribute :>> redundancyKind = "hardware watchdog plus independent flow cross-check";
    }

    part portSensorHarness : PhysicalPort {
        attribute :>> id = "PP-001";
        attribute :>> name = "SensorHarnessConnector";
        attribute :>> portKind = InterfaceKind::digitalSignal;
        attribute :>> connectorType = "keyed 12-pin locking header";
        attribute :>> direction = DirectionKind::input;
    }
    part portMotorDrive : PhysicalPort {
        attribute :>> id = "PP-002";
        attribute :>> name = "MotorDriveConnector";
        attribute :>> portKind = InterfaceKind::digitalSignal;
        attribute :>> connectorType = "keyed 6-pin locking header with enable interlock";
        attribute :>> direction = DirectionKind::output;
    }
    part portPatientPendant : PhysicalPort {
        attribute :>> id = "PP-003";
        attribute :>> name = "PatientPendantJack";
        attribute :>> portKind = InterfaceKind::digitalSignal;
        attribute :>> connectorType = "latching 3.5 mm pendant jack";
        attribute :>> direction = DirectionKind::input;
    }
    part portServiceAccess : PhysicalPort {
        attribute :>> id = "PP-004";
        attribute :>> name = "ServiceMaintenancePort";
        attribute :>> portKind = InterfaceKind::api;
        attribute :>> connectorType = "covered UART/USB service connector";
        attribute :>> direction = DirectionKind::inputOutput;
    }
    part portMainsInlet : PhysicalPort {
        attribute :>> id = "PP-005";
        attribute :>> name = "MainsPowerInlet";
        attribute :>> portKind = InterfaceKind::power;
        attribute :>> connectorType = "IEC 60320 C8 inlet";
        attribute :>> direction = DirectionKind::input;
    }
}
