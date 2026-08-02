package memo_examples_gpca_pump_model_catalog_gpca_behavior_subsystems {
    private import ScalarValues::*;

    private import memo_architecture_functional_functions::*;
    private import memo_core_enumerations::*;

    // ── Logical functions ───────────────────────────────────────
    part fnAcquireSensors : SystemFunction {
        attribute :>> id = "FUNC-001";
        attribute :>> name = "AcquireSensorData";
        attribute :>> functionCategory = "sensing";
        attribute :>> trigger = "every 20 ms execution step";
        attribute :>> outputSummary = "Debounced, range-checked sensor status vector";
        attribute :>> concernKind = ConcernKind::safety;
        attribute :>> criticality = CriticalityKind::catastrophic;
    }
    part fnValidatePrescription : SystemFunction {
        attribute :>> id = "FUNC-002";
        attribute :>> name = "ValidatePrescription";
        attribute :>> functionCategory = "configuration";
        attribute :>> trigger = "prescription entry or edit";
        attribute :>> outputSummary = "Prescription accepted (within drug-library hard/soft limits) or rejected with reason";
        attribute :>> concernKind = ConcernKind::safety;
        attribute :>> criticality = CriticalityKind::catastrophic;
    }
    part fnMonitorAlarm : SystemFunction {
        attribute :>> id = "FUNC-003";
        attribute :>> name = "MonitorExceptionalConditions";
        attribute :>> functionCategory = "alarm";
        attribute :>> trigger = "every 20 ms execution step";
        attribute :>> outputSummary = "Alarm outputs and inhibition conditions";
        attribute :>> concernKind = ConcernKind::safety;
        attribute :>> criticality = CriticalityKind::catastrophic;
    }
    part fnAnnunciate : SystemFunction {
        attribute :>> id = "FUNC-004";
        attribute :>> name = "AnnunciateAlarms";
        attribute :>> functionCategory = "alarm";
        attribute :>> trigger = "alarm raised, escalated, or cleared";
        attribute :>> outputSummary = "Priority-coded audible tone and visual message";
        attribute :>> concernKind = ConcernKind::safety;
        attribute :>> criticality = CriticalityKind::high;
    }
    part fnManageInfusion : SystemFunction {
        attribute :>> id = "FUNC-005";
        attribute :>> name = "ManageInfusion";
        attribute :>> functionCategory = "infusion";
        attribute :>> trigger = "mode transitions and each execution step while therapy active";
        attribute :>> outputSummary = "Commanded flow and mode transitions";
        attribute :>> concernKind = ConcernKind::safety;
        attribute :>> criticality = CriticalityKind::catastrophic;
    }
    part fnEnforceLimits : SystemFunction {
        attribute :>> id = "FUNC-006";
        attribute :>> name = "EnforceDoseLimits";
        attribute :>> functionCategory = "infusion";
        attribute :>> trigger = "patient bolus request or clinician square bolus command";
        attribute :>> outputSummary = "Bolus authorized or rejected against lockout interval and hourly maximum";
        attribute :>> concernKind = ConcernKind::safety;
        attribute :>> criticality = CriticalityKind::catastrophic;
    }
    part fnCommandPump : SystemFunction {
        attribute :>> id = "FUNC-007";
        attribute :>> name = "CommandPumpMotor";
        attribute :>> functionCategory = "actuation";
        attribute :>> trigger = "flow command update";
        attribute :>> outputSummary = "Motor step rate with enable interlock; FlowRate_Mode_macro per mode, KVO floor in PAUSED (REQ 43), zero flow in OFF/IDLE (REQ 6/14)";
        attribute :>> concernKind = ConcernKind::safety;
        attribute :>> criticality = CriticalityKind::catastrophic;
    }
    part fnLogEvents : SystemFunction {
        attribute :>> id = "FUNC-008";
        attribute :>> name = "LogTherapyEvents";
        attribute :>> functionCategory = "logging";
        attribute :>> trigger = "dose delivered, mode change, alarm, or configuration change";
        attribute :>> outputSummary = "Timestamped append-only event records";
        attribute :>> concernKind = ConcernKind::regulatory;
        attribute :>> criticality = CriticalityKind::medium;
    }
    part fnManagePower : SystemFunction {
        attribute :>> id = "FUNC-009";
        attribute :>> name = "ManagePower";
        attribute :>> functionCategory = "platform";
        attribute :>> trigger = "mains-loss signal or battery level change";
        attribute :>> outputSummary = "Power source selection, low/depleted battery conditions";
        attribute :>> concernKind = ConcernKind::reliability;
        attribute :>> criticality = CriticalityKind::high;
    }
    part fnPresentStatus : SystemFunction {
        attribute :>> id = "FUNC-010";
        attribute :>> name = "PresentStatus";
        attribute :>> functionCategory = "user-interface";
        attribute :>> trigger = "state or prescription change";
        attribute :>> outputSummary = "Mode, prescription, delivered dose, and alarm text on display";
        attribute :>> concernKind = ConcernKind::usability;
        attribute :>> criticality = CriticalityKind::high;
    }
    part fnSelfTest : SystemFunction {
        attribute :>> id = "FUNC-011";
        attribute :>> name = "ExecuteSelfTest";
        attribute :>> functionCategory = "platform";
        attribute :>> trigger = "power-on and periodic in-service checks";
        attribute :>> outputSummary = "POST pass/fail; CPU, RAM, ROM, and sensor plausibility results";
        attribute :>> concernKind = ConcernKind::safety;
        attribute :>> criticality = CriticalityKind::catastrophic;
    }

    // ── Logical flows ───────────────────────────────────────────
    part lfSensorAcquisition : FunctionalExchange {
        attribute :>> id = "LF-001";
        attribute :>> name = "SensorAcquisitionFlow";
        attribute :>> flowKind = FlowKind::measurement;
        attribute :>> direction = DirectionKind::input;
        attribute :>> latencyBudgetMs = 20.0;
        attribute :>> staleAfterMs = 40.0;
        attribute :>> integrityLevel = "class C data path";
        ref :>> sourceFunction = fnAcquireSensors;
        ref :>> targetFunction = fnMonitorAlarm;
    }
    part lfFlowCommand : FunctionalExchange {
        attribute :>> id = "LF-002";
        attribute :>> name = "FlowCommandFlow";
        attribute :>> flowKind = FlowKind::command;
        attribute :>> direction = DirectionKind::output;
        attribute :>> latencyBudgetMs = 20.0;
        attribute :>> staleAfterMs = 20.0;
        attribute :>> integrityLevel = "class C command path";
        ref :>> sourceFunction = fnManageInfusion;
        ref :>> targetFunction = fnCommandPump;
    }
    part lfAlarmSignal : FunctionalExchange {
        attribute :>> id = "LF-003";
        attribute :>> name = "AlarmSignalFlow";
        attribute :>> flowKind = FlowKind::alarm;
        attribute :>> direction = DirectionKind::output;
        attribute :>> latencyBudgetMs = 20.0;
        attribute :>> staleAfterMs = 20.0;
        attribute :>> integrityLevel = "class C alarm path; same-step delivery to infusion manager";
        ref :>> sourceFunction = fnMonitorAlarm;
        ref :>> targetFunction = fnAnnunciate;
    }
    part lfPrescriptionEntry : FunctionalExchange {
        attribute :>> id = "LF-004";
        attribute :>> name = "PrescriptionEntryFlow";
        attribute :>> flowKind = FlowKind::configuration;
        attribute :>> direction = DirectionKind::input;
        attribute :>> latencyBudgetMs = 500.0;
        attribute :>> staleAfterMs = 0.0;
        attribute :>> integrityLevel = "confirmed double-entry path";
        ref :>> targetFunction = fnValidatePrescription;
    }

    // ── Exchange item definitions ───────────────────────────────
    item ddPrescription : InterfaceItem {
        attribute :>> itemKind = InterfaceItemKind::data;
        attribute :>> id = "DD-001";
        attribute :>> name = "PrescriptionRecord";
        attribute :>> semantics = "patient id, drug name, concentration, VTBI total, duration total, basal flow rate, square bolus rate/duration/interval, patient bolus rate/duration/lockout period, max boluses per hour (DD-005..DD-017)";
        attribute :>> unit = "ml/hr, ml, minutes, mg/ml, per hour";
        attribute :>> minValue = "pharmacy-database safe-value lower bounds (lo_hd)";
        attribute :>> maxValue = "pharmacy-database safe-value upper bounds (hi_hd)";
        attribute :>> encoding = "checksummed persistent record";
        attribute :>> timestampRequired = true;
        attribute :>> integrityClass = "class C";
        attribute :>> confidentialityClass = "clinical";
        attribute :>> availabilityClass = "must survive power loss";
        attribute :>> sourceReference = "CITE-001: CriSys GPCA System Requirements (2013), §3.1.1 Prescription Data";
    }
    item ddBolusRequest : InterfaceItem {
        attribute :>> itemKind = InterfaceItemKind::data;
        attribute :>> id = "DD-002";
        attribute :>> name = "BolusRequestSignal";
        attribute :>> semantics = "debounced patient pendant press event";
        attribute :>> encoding = "edge event with 50 ms debounce";
        attribute :>> timestampRequired = true;
        attribute :>> integrityClass = "class C";
        attribute :>> confidentialityClass = "none";
        attribute :>> availabilityClass = "sampled every step";
    }
    item ddSensorVector : InterfaceItem {
        attribute :>> itemKind = InterfaceItemKind::data;
        attribute :>> id = "DD-003";
        attribute :>> name = "SensorStatusVector";
        attribute :>> semantics = "air-in-line, occlusion pressure, reservoir volume, door state, flow measurement, battery level, CPU/memory status";
        attribute :>> encoding = "fixed-layout status word per 20 ms step";
        attribute :>> timestampRequired = true;
        attribute :>> integrityClass = "class C";
        attribute :>> confidentialityClass = "none";
        attribute :>> availabilityClass = "stale after two missed steps";
    }
    item ddEventRecord : InterfaceItem {
        attribute :>> itemKind = InterfaceItemKind::data;
        attribute :>> id = "DD-004";
        attribute :>> name = "TherapyEventRecord";
        attribute :>> semantics = "timestamped dose, alarm, mode, and configuration events";
        attribute :>> encoding = "append-only sequenced records";
        attribute :>> timestampRequired = true;
        attribute :>> integrityClass = "tamper-evident";
        attribute :>> confidentialityClass = "patient-identifiable";
        attribute :>> availabilityClass = "retained 90 days";
    }
    item cdFlowCommand : InterfaceItem {
        attribute :>> itemKind = InterfaceItemKind::command;
        attribute :>> id = "CD-001";
        attribute :>> name = "FlowCommand";
        attribute :>> controlType = "commanded flow rate with enable interlock";
        attribute :>> timeoutMs = 40.0;
        attribute :>> retryPolicy = "no retry; missing command forces zero flow";
    }
    item cdAlarmSignal : InterfaceItem {
        attribute :>> itemKind = InterfaceItemKind::command;
        attribute :>> id = "CD-002";
        attribute :>> name = "AlarmSignal";
        attribute :>> controlType = "priority-coded alarm assertion (level 1 stops infusion, level 2 warns)";
        attribute :>> timeoutMs = 20.0;
        attribute :>> retryPolicy = "latched until acknowledged and condition cleared";
    }
}
