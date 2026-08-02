package memo_examples_gpca_pump_model_catalog_gpca_architecture {
    private import ScalarValues::*;

    private import memo_architecture_implementation_hardware_structure::*;
    private import memo_architecture_implementation_software_structure::*;
    private import memo_architecture_logical_structure::*;
    private import memo_core_relationships::*;
    private import memo_core_enumerations::*;

    // ── Logical components ──────────────────────────────────────
    part lcTherapyControl : LogicalComponent {
        attribute :>> id = "LC-001";
        attribute :>> name = "TherapyControlSubsystem";
        attribute :>> responsibility = "Owns therapy state, prescription execution, and dose limiting.";
        attribute :>> decompositionLevel = "subsystem";
        attribute :>> safetyPartition = "safety-critical partition";
    }
    part lcSafetyMonitoring : LogicalComponent {
        attribute :>> id = "LC-002";
        attribute :>> name = "SafetyMonitoringSubsystem";
        attribute :>> responsibility = "Detects exceptional conditions and drives the pump to a safe state.";
        attribute :>> decompositionLevel = "subsystem";
        attribute :>> safetyPartition = "safety-critical partition";
    }
    part lcOperatorInterface : LogicalComponent {
        attribute :>> id = "LC-003";
        attribute :>> name = "OperatorInterfaceSubsystem";
        attribute :>> responsibility = "Prescription entry, status display, and alarm annunciation to users.";
        attribute :>> decompositionLevel = "subsystem";
        attribute :>> safetyPartition = "interference-free from therapy control";
    }
    part lcDrugDelivery : LogicalComponent {
        attribute :>> id = "LC-004";
        attribute :>> name = "DrugDeliverySubsystem";
        attribute :>> responsibility = "Fluid path: reservoir, tubing, pump mechanism, and delivery sensors.";
        attribute :>> decompositionLevel = "subsystem";
        attribute :>> safetyPartition = "safety-critical partition";
    }
    part lcPowerSubsystem : LogicalComponent {
        attribute :>> id = "LC-005";
        attribute :>> name = "PowerSubsystem";
        attribute :>> responsibility = "Mains and battery power management with depletion warning.";
        attribute :>> decompositionLevel = "subsystem";
        attribute :>> safetyPartition = "supporting partition";
    }

    // ── Device (UMN AADL architectural model) ───────────────────
    // The AADL top-level `GPCA_Device` system. GPCA_Device.Impl declares only
    // GPCA_HW_Sensors, GPCA_SW, and GPCA_HW_Actuators as subcomponents.
    part gpcaDevice : PhysicalAssembly {
        attribute :>> id = "HW-000";
        attribute :>> name = "GPCA_Device";
        attribute :>> responsibility = "AADL device boundary containing the sensor wrapper, GPCA software, and actuator wrapper.";
        attribute :>> safetyRole = "device boundary carrying the intended use and the risk-control architecture";
        attribute :>> partNumber = "GPCA-DEV-001";
    }

    // ── Hardware: aggregates (UMN AADL architectural model) ─────
    part gpcaDeviceSensors : HardwareAssembly {
        attribute :>> id = "HW-001";
        attribute :>> name = "GPCA_HW_Sensors";
        attribute :>> responsibility = "Map inputs to software-visible signals.";
        attribute :>> safetyRole = "input acquisition";
    }
    part gpcaActuators : HardwareAssembly {
        attribute :>> id = "HW-002";
        attribute :>> name = "GPCA_HW_Actuators";
        attribute :>> responsibility = "Expose software outputs to physical outputs.";
        attribute :>> safetyRole = "actuation and operator output";
    }

    // ── Hardware: sensor suite ──────────────────────────────────
    part airInLineSensor : HardwareAssembly {
        attribute :>> id = "HW-006";
        attribute :>> name = "AirInLineSensor";
        attribute :>> responsibility = "Ultrasonic detection of air bubbles in the delivery tubing.";
        attribute :>> safetyRole = "detects air embolism precursor; feeds High-priority Air embolism notification";
        attribute :>> partNumber = "GPCA-SNS-AIR";
        attribute :>> mtbfHours = "150000";
    }
    part occlusionSensor : HardwareAssembly {
        attribute :>> id = "HW-007";
        attribute :>> name = "OcclusionPressureSensor";
        attribute :>> responsibility = "Measures downstream line pressure to detect occlusion.";
        attribute :>> safetyRole = "detects blocked line (under-infusion, post-occlusion bolus)";
        attribute :>> partNumber = "GPCA-SNS-OCC";
        attribute :>> mtbfHours = "150000";
    }
    part reservoirSensor : HardwareAssembly {
        attribute :>> id = "HW-008";
        attribute :>> name = "ReservoirVolumeSensor";
        attribute :>> responsibility = "Reports remaining reservoir volume and empty condition.";
        attribute :>> safetyRole = "prevents dry pumping and undetected therapy interruption";
        attribute :>> partNumber = "GPCA-SNS-RSV";
        attribute :>> mtbfHours = "120000";
    }
    part doorSensor : HardwareAssembly {
        attribute :>> id = "HW-009";
        attribute :>> name = "DoorLatchSensor";
        attribute :>> responsibility = "Detects open reservoir door / unlatched pumping chamber.";
        attribute :>> safetyRole = "prevents free flow and tampering with the fluid path";
        attribute :>> partNumber = "GPCA-SNS-DOR";
        attribute :>> mtbfHours = "200000";
    }
    part flowSensor : HardwareAssembly {
        attribute :>> id = "HW-010";
        attribute :>> name = "DeliveryFlowSensor";
        attribute :>> responsibility = "Independent measurement of delivered flow for cross-check against commanded flow.";
        attribute :>> safetyRole = "detects over/under-infusion independent of motor control";
        attribute :>> partNumber = "GPCA-SNS-FLW";
        attribute :>> mtbfHours = "100000";
    }
    part bolusButton : HardwareAssembly {
        attribute :>> id = "HW-011";
        attribute :>> name = "PatientBolusButton";
        attribute :>> responsibility = "Debounced patient pendant switch for bolus requests.";
        attribute :>> safetyRole = "sole patient input; stuck-button detection required";
        attribute :>> partNumber = "GPCA-INP-BOL";
        attribute :>> mtbfHours = "80000";
    }
    part operatorKeypad : HardwareAssembly {
        attribute :>> id = "HW-012";
        attribute :>> name = "OperatorKeypad";
        attribute :>> responsibility = "Clinician input for prescription programming and alarm handling.";
        attribute :>> safetyRole = "prescription entry path; key-lock guarded";
        attribute :>> partNumber = "GPCA-INP-KEY";
    }

    // ── Hardware: actuator and output suite ─────────────────────
    part pumpMotorAssembly : HardwareAssembly {
        attribute :>> id = "HW-003";
        attribute :>> name = "PumpMotorAssembly";
        attribute :>> responsibility = "Peristaltic pump mechanism and stepper motor driving drug delivery.";
        attribute :>> safetyRole = "single point of drug delivery; rotation monitored by flow sensor";
        attribute :>> partNumber = "GPCA-ACT-PMP";
        attribute :>> mtbfHours = "60000";
    }
    part antiFreeFlowValve : HardwareAssembly {
        attribute :>> id = "HW-013";
        attribute :>> name = "AntiFreeFlowValve";
        attribute :>> responsibility = "Mechanical valve that blocks gravity free flow whenever the pumping chamber is disengaged.";
        attribute :>> safetyRole = "inherent safe design against free-flow overdose";
        attribute :>> partNumber = "GPCA-ACT-AFF";
    }
    part audibleAlarm : HardwareAssembly {
        attribute :>> id = "HW-004";
        attribute :>> name = "AudibleAlarmAnnunciator";
        attribute :>> responsibility = "Buzzer producing multi-priority alarm tones at or above 45 dB(A) at 1 m.";
        attribute :>> safetyRole = "primary alarm annunciation path";
        attribute :>> partNumber = "GPCA-ACT-BZR";
    }
    part operatorDisplay : HardwareAssembly {
        attribute :>> id = "HW-005";
        attribute :>> name = "OperatorDisplay";
        attribute :>> responsibility = "Displays mode, prescription, delivered dose, and alarm messages.";
        attribute :>> safetyRole = "visual alarm annunciation and prescription confirmation readback";
        attribute :>> partNumber = "GPCA-ACT-DSP";
    }

    // ── Hardware: platform ──────────────────────────────────────
    part controllerBoard : HardwareAssembly {
        attribute :>> id = "HW-014";
        attribute :>> name = "MainControllerBoard";
        attribute :>> responsibility = "Hosts the microcontroller, memory, and hardware watchdog executing the GPCA software.";
        attribute :>> safetyRole = "computing platform; watchdog forces safe state on CPU hang";
        attribute :>> partNumber = "GPCA-PCB-MAIN";
        attribute :>> mtbfHours = "250000";
    }
    part batteryPack : HardwareAssembly {
        attribute :>> id = "HW-015";
        attribute :>> name = "BatteryPack";
        attribute :>> responsibility = "Rechargeable backup battery sustaining at least 4 hours of therapy.";
        attribute :>> safetyRole = "keeps therapy and alarms alive during mains loss";
        attribute :>> partNumber = "GPCA-PWR-BAT";
        attribute :>> mtbfHours = "20000";
    }
    part powerSupply : HardwareAssembly {
        attribute :>> id = "HW-016";
        attribute :>> name = "MainsPowerSupply";
        attribute :>> responsibility = "Medical-grade AC/DC supply with charger and mains-loss signal.";
        attribute :>> safetyRole = "isolation per IEC 60601-1; signals switchover to battery";
        attribute :>> partNumber = "GPCA-PWR-PSU";
        attribute :>> protectionClass = "Class II";
        attribute :>> ipRating = "IPX2";
    }
    part enclosure : HardwareAssembly {
        attribute :>> id = "HW-017";
        attribute :>> name = "DeviceEnclosure";
        attribute :>> responsibility = "Impact-resistant, liquid-ingress-protected housing for the pump.";
        attribute :>> safetyRole = "carries the drop and liquid-ingress requirements REQ-CS-83/84";
        attribute :>> partNumber = "GPCA-MECH-ENC";
    }

    // ── Software system and components (UMN behavioral model) ───
    part gpcaSoftware : SoftwareSystem {
        attribute :>> id = "SWS-001";
        attribute :>> name = "GPCA_Software";
        attribute :>> version = "2.0";
        attribute :>> lifecycleState = LifecycleStateKind::development;
        attribute :>> safetyClass = SafetyClassKind::C;
        attribute :>> complexity = ComplexityKind::high;
        attribute :>> operatingSystem = "synchronous data-flow execution; AADL immediate port semantics (source specifies no timing)";
    }
    part tlm : SoftwareModule {
        attribute :>> id = "SW-001";
        attribute :>> name = "Top_Level_Mode";
        attribute :>> responsibility = "Ensure system ON/OFF behavior and startup/shutdown checks.";
        attribute :>> safetyClass = SafetyClassKind::C;
        attribute :>> complexity = ComplexityKind::medium;
    }
    part config : SoftwareModule {
        attribute :>> id = "SW-002";
        attribute :>> name = "Config";
        attribute :>> responsibility = "Prescription entry, drug-library limit checking, confirmation, and persistent storage.";
        attribute :>> safetyClass = SafetyClassKind::C;
        attribute :>> complexity = ComplexityKind::high;
    }
    part alarm : SoftwareModule {
        attribute :>> id = "SW-003";
        attribute :>> name = "Alarm";
        attribute :>> responsibility = "Monitor and notify exceptional conditions.";
        attribute :>> safetyClass = SafetyClassKind::C;
        attribute :>> complexity = ComplexityKind::high;
    }
    part logging : SoftwareModule {
        attribute :>> id = "SW-004";
        attribute :>> name = "Logging";
        attribute :>> responsibility = "Append-only event log of doses, mode changes, alarms, and configuration changes.";
        attribute :>> safetyClass = SafetyClassKind::B;
        attribute :>> complexity = ComplexityKind::medium;
    }
    part infusionMgr : SoftwareModule {
        attribute :>> id = "SW-005";
        attribute :>> name = "Infusion_Manager";
        attribute :>> responsibility = "Handle drug infusion commands and therapy parameters.";
        attribute :>> safetyClass = SafetyClassKind::C;
        attribute :>> complexity = ComplexityKind::high;
    }
    part systemMonitor : SoftwareModule {
        attribute :>> id = "SW-006";
        attribute :>> name = "System_Monitor";
        attribute :>> responsibility = "POST, periodic CPU/RAM/ROM checks, watchdog kicking, and battery supervision.";
        attribute :>> safetyClass = SafetyClassKind::C;
        attribute :>> complexity = ComplexityKind::medium;
    }
    part systemStatus : SoftwareModule {
        attribute :>> id = "SW-007";
        attribute :>> name = "System_Status";
        attribute :>> responsibility = "Maintain the shared system status vector (Reservoir_Volume, Volume_Infused, Reservoir_Empty, In_Therapy) consumed by Alarm, Config, and Infusion_Manager.";
        attribute :>> safetyClass = SafetyClassKind::C;
        attribute :>> complexity = ComplexityKind::medium;
        attribute :>> sourceReference = "CITE-002: CriSys GPCA AADL v2.0, packages/System_Status.aadl";
    }
    part outputBus : SoftwareModule {
        attribute :>> id = "SW-008";
        attribute :>> name = "OutputBus";
        attribute :>> responsibility = "Aggregate all subsystem outputs into the single GPCA_SW_OUT output vector (mode, commanded flow rate, notifications, prescription echo, status).";
        attribute :>> safetyClass = SafetyClassKind::C;
        attribute :>> complexity = ComplexityKind::low;
        attribute :>> sourceReference = "CITE-002: CriSys GPCA AADL v2.0, packages/OutputBus.aadl";
    }

    // ── Structural composition ──────────────────────────────────
    // Device level (GPCA_Device.aadl): the assemblies and the software system
    // the device is built from.
    connection : Composes connect parent ::> gpcaDevice to child ::> gpcaDeviceSensors;
    connection : Composes connect parent ::> gpcaDevice to child ::> gpcaActuators;
    connection : Composes connect parent ::> gpcaDevice to child ::> gpcaSoftware;

    // The physical parts below are MEMO design extensions derived from system
    // requirements and hazard analysis, not subcomponents in the published
    // AADL packages. They intentionally remain outside this AADL composition
    // until a project authority defines their interfaces and ownership.
    connection : Composes connect parent ::> gpcaSoftware to child ::> tlm;
    connection : Composes connect parent ::> gpcaSoftware to child ::> config;
    connection : Composes connect parent ::> gpcaSoftware to child ::> alarm;
    connection : Composes connect parent ::> gpcaSoftware to child ::> logging;
    connection : Composes connect parent ::> gpcaSoftware to child ::> infusionMgr;
    connection : Composes connect parent ::> gpcaSoftware to child ::> systemMonitor;
    connection : Composes connect parent ::> gpcaSoftware to child ::> systemStatus;
    connection : Composes connect parent ::> gpcaSoftware to child ::> outputBus;
}
